/**
 * Capture -> Job provider-field normalization work (issue #325). Owned by scheduling.
 *
 * The scheduling-owned execution seam over the canonical `normalization_work` identity.
 * Work identity deterministically binds workspace, Capture id/revision, resolver id/version,
 * and input hash (hashed into the 200-character idempotency bound). The executor loads the
 * exact immutable Capture revision input through the Capture-owned store, calls the pure
 * connector resolver, persists bounded outcomes idempotently, and completes the claimed work.
 * A crash after outcome persistence but before completion re-runs and converges (idempotent
 * persist), so there are no duplicate outcomes. Deterministic invalid input becomes sanitized
 * terminal work, never raw exception evidence.
 *
 * Startup reconciliation cancels obsolete active resolver-version work (a scheduling-owned
 * command over its own table) and idempotently enqueues every eligible Jobright revision with
 * available immutable payload for the current resolver version, closing the post-ack gap.
 */
import { and, eq, sql } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import type { ConnectorProviderFieldResolver } from '@sparxie/valedictorian-connectors-core'
import type { CreateCaptureInput } from 'sparxie'
import type { PgliteDatabase } from '../../db/pglite'
import type { CaptureFieldOutcomeStore } from '../capture/capture.field-outcomes'
import { normalizationWork } from './scheduling.schema'
import {
  createScheduledWorkRepository,
  normalizationOperation,
  type NormalizationSubject,
  type ScheduledWorkRepository,
} from './scheduled-work'

export type NormalizationWorkRepository = ScheduledWorkRepository<NormalizationSubject, NormalizationSubject>

export interface NormalizationWorkIdentity {
  readonly workspaceId: string
  readonly captureId: string
  readonly captureRevision: number
  readonly resolverId: string
  readonly resolverVersion: string
  readonly inputHash: string
}

/** Deterministic bounded idempotency key binding workspace + Capture id/revision + resolver id/version + input hash. */
export function normalizationIdempotencyKey(identity: NormalizationWorkIdentity): string {
  const canonical = JSON.stringify([
    identity.workspaceId,
    identity.captureId,
    identity.captureRevision,
    identity.resolverId,
    identity.resolverVersion,
    identity.inputHash,
  ])
  return `norm:sha256:${createHash('sha256').update(canonical).digest('hex')}`
}

export function normalizationSubject(identity: NormalizationWorkIdentity): NormalizationSubject {
  return {
    captureId: identity.captureId,
    captureRevision: identity.captureRevision,
    resolverId: identity.resolverId,
    resolverVersion: identity.resolverVersion,
    inputHash: identity.inputHash,
  }
}

/** Enqueue one normalization work record idempotently. Returns true when a new row was created. */
export function enqueueNormalizationWork(
  repository: NormalizationWorkRepository,
  identity: NormalizationWorkIdentity,
): Promise<boolean> {
  return repository.enqueue({
    workspaceId: identity.workspaceId,
    idempotencyKey: normalizationIdempotencyKey(identity),
    ownerVersion: identity.resolverVersion,
    subject: normalizationSubject(identity),
  })
}

export interface NormalizationExecutorOptions {
  readonly database: PgliteDatabase
  readonly fieldOutcomes: CaptureFieldOutcomeStore
  /** Lazily resolves the trusted resolver so client construction never loads connector implementations. */
  readonly getResolver: () => ConnectorProviderFieldResolver
  readonly repository: NormalizationWorkRepository
  readonly workspaceId: string
  readonly now: () => Date
}

/**
 * The scheduled-work executor for one claimed normalization record. Loads the exact revision
 * input, runs the pure resolver, persists bounded outcomes idempotently, and completes the work.
 */
export function createNormalizationExecutor(options: NormalizationExecutorOptions) {
  const { database, fieldOutcomes, getResolver, repository, workspaceId, now } = options
  return async function executeNormalizationWork(work: {
    id: string
    token: string
    subject: NormalizationSubject
  }): Promise<void> {
    const subject = work.subject
    const input = await fieldOutcomes.loadRevisionInput(workspaceId, subject.captureId, subject.captureRevision)
    if (!input || input.contentHash !== subject.inputHash) {
      await repository.fail({ id: work.id, token: work.token, deterministicReason: 'invalid_target', detail: 'revision_input_unavailable' })
      return
    }
    const resolver = getResolver()
    const declaration = resolver.declaration
    if (declaration.id !== subject.resolverId || declaration.version !== subject.resolverVersion) {
      await repository.fail({ id: work.id, token: work.token, deterministicReason: 'invalid_target', detail: 'resolver_identity_mismatch' })
      return
    }
    const adapters = declaration.supportedAdapters
    const unsupportedAdapter = adapters?.ids && !adapters.ids.includes(input.adapter.id)
      || adapters?.kinds && !adapters.kinds.includes(input.adapter.kind as CreateCaptureInput['adapter']['kind'])
      || adapters?.versions && !adapters.versions.includes(input.adapter.version)
    const schemas = declaration.supportedProviderSchemas
    const unsupportedSchema = schemas && (input.providerSchema === null || !schemas.includes(input.providerSchema))
    if (unsupportedAdapter || unsupportedSchema) {
      await repository.fail({ id: work.id, token: work.token, deterministicReason: 'invalid_target', detail: 'resolver_not_applicable' })
      return
    }
    let outcomes: ReturnType<ConnectorProviderFieldResolver['resolve']>
    try {
      outcomes = resolver.resolve({
        captureRevision: {
          id: `${subject.captureId}:${subject.captureRevision}`,
          captureId: subject.captureId,
          revision: subject.captureRevision,
          contentHash: input.contentHash,
          reused: false,
          createdAt: now().toISOString(),
        },
        adapter: {
          id: input.adapter.id,
          kind: input.adapter.kind as CreateCaptureInput['adapter']['kind'],
          version: input.adapter.version,
        },
        providerSchema: input.providerSchema,
        payload: input.payload,
      })
    } catch {
      await repository.fail({ id: work.id, token: work.token, deterministicReason: 'invalid_target', detail: 'resolver_invalid_input' })
      return
    }
    await fieldOutcomes.persistOutcomes(database, {
      captureId: subject.captureId,
      captureRevision: subject.captureRevision,
      resolverId: declaration.id,
      resolverVersion: declaration.version,
      inputHash: input.contentHash,
      outcomes,
      createdAt: now().toISOString(),
    })
    await repository.complete({ id: work.id, token: work.token })
  }
}

export interface ReconcileNormalizationOptions {
  readonly database: PgliteDatabase
  readonly fieldOutcomes: CaptureFieldOutcomeStore
  readonly repository: NormalizationWorkRepository
  readonly workspaceId: string
  readonly adapterId: string
  readonly resolverId: string
  readonly resolverVersion: string
  readonly supportedProviderSchemas?: readonly string[]
  readonly now: () => Date
}

/**
 * Scheduling-owned cancellation of active normalization work whose resolver version no longer
 * matches the current version. Frees the per-(capture,revision) active slot so the current
 * version can be enqueued. Writes only the scheduling-owned `normalization_work` table.
 */
export async function cancelObsoleteActiveNormalizationWork(
  database: PgliteDatabase,
  workspaceId: string,
  resolverId: string,
  currentResolverVersion: string,
  updatedAt: string,
): Promise<number> {
  const cancelled = await database
    .update(normalizationWork)
    .set({ status: 'cancelled', nextEligibleAt: null, acquisitionToken: null, claimedAt: null, claimExpiresAt: null, updatedAt })
    .where(and(
      eq(normalizationWork.workspaceId, workspaceId),
      eq(normalizationWork.resolverId, resolverId),
      sql`${normalizationWork.status} in ('scheduled','claimed')`,
      sql`${normalizationWork.resolverVersion} <> ${currentResolverVersion}`,
    ))
    .returning({ id: normalizationWork.id })
  return cancelled.length
}

/**
 * Startup/version reconciliation: cancel obsolete active resolver-version work, then idempotently
 * enqueue every eligible Jobright revision with available immutable payload for the current
 * resolver version. Skips revisions without a truthfully preserved input. Never rewrites Capture
 * evidence.
 */
export async function reconcileNormalizationWork(options: ReconcileNormalizationOptions): Promise<{ enqueued: number; cancelled: number }> {
  const { database, fieldOutcomes, repository, workspaceId, adapterId, resolverId, resolverVersion, supportedProviderSchemas, now } = options
  const cancelled = await cancelObsoleteActiveNormalizationWork(database, workspaceId, resolverId, resolverVersion, now().toISOString())
  const eligible = await fieldOutcomes.listEligibleRevisions(workspaceId, adapterId)
  let enqueued = 0
  for (const revision of eligible) {
    if (supportedProviderSchemas && (
      revision.providerSchema === null || !supportedProviderSchemas.includes(revision.providerSchema)
    )) continue
    const created = await enqueueNormalizationWork(repository, {
      workspaceId,
      captureId: revision.captureId,
      captureRevision: revision.captureRevision,
      resolverId,
      resolverVersion,
      inputHash: revision.contentHash,
    })
    if (created) enqueued += 1
  }
  return { enqueued, cancelled }
}

export function createNormalizationWorkRepository(
  database: PgliteDatabase,
  options: { now?: () => Date } = {},
): NormalizationWorkRepository {
  return createScheduledWorkRepository(database, normalizationOperation, { now: options.now })
}
