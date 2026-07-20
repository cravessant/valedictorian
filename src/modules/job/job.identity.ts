/**
 * Job external identities, conflicts, attach, and merge (issue #300, slice 2).
 *
 * External identities are established or STRENGTHENED (provisional→strong) without
 * replacing the internal UUIDv7 Job id. The strong-uniqueness partial index on
 * job_external_identities `(kind, provider, coalesce(account,''), value) WHERE
 * strong AND not removed` is the DB-level "one Job per strong identity":
 *  - ATTACH: establishing/strengthening a strong identity that the index already
 *    owns resolves deterministically to the proven Job (never errors or mints a
 *    duplicate). This is the primary promotion flow.
 *  - MERGE: two existing Jobs later proven identical are merged deterministically
 *    (winner = earliest created_at then id): identities move by tombstone-on-loser
 *    + insert-on-winner (identities are append-only except one-way removal), lineage
 *    re-points by delete-on-loser + insert-on-winner, history appends on both, and
 *    the loser Job is tombstoned. No schema change is required.
 *
 * Owner lookups are workspace-scoped (isolation). The strong index is global; a
 * cross-workspace strong collision therefore surfaces as strong_identity_conflict
 * rather than attaching across a workspace boundary.
 */
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { PgliteDatabase } from '../../db/pglite'
import { type Clock, createUuidV7Generator, type UuidV7Generator } from '../../db/uuidv7'
import { jobExternalIdentityKinds, jobIdentityStrengths } from '../../db/lifecycle-vocabulary'
import { jobCaptureEvidenceReferences, jobExternalIdentities, jobHistory, lifecycleJobs } from './job.schema'
import {
  deleteJobCaptureEvidenceReferences,
  insertJobCaptureEvidenceReferences,
  insertJobExternalIdentities,
  insertJobHistory,
  updateJobExternalIdentities,
  updateLifecycleJobs,
} from './job.repository'
import {
  type JobActor,
  type JobFailure,
  type JsonValue,
  JobInputError,
  WORKSPACE_MAX,
  auditJson,
  boundedJson,
  fail,
  isUniqueViolation,
  requireActor,
  requireText,
} from './job.validation'

export type JobIdentityKind = (typeof jobExternalIdentityKinds)[number]
export type JobIdentityStrength = (typeof jobIdentityStrengths)[number]

const PROVIDER_MAX = 200
const ACCOUNT_MAX = 500
const VALUE_MAX = 2_048
const PROVENANCE_MAX = 128
const EVIDENCE_MAX = 16_384

export interface JobIdentityInput {
  readonly kind: JobIdentityKind
  readonly provider: string
  readonly account?: string | null
  readonly value: string
  readonly strength: JobIdentityStrength
  readonly provenanceKind: string
  readonly provenanceVersion: string
  readonly evidence: JsonValue
}

export interface EstablishIdentityInput {
  readonly workspaceId: string
  readonly jobId: string
  readonly identity: JobIdentityInput
  readonly actor: JobActor
}

export interface StrengthenIdentityInput {
  readonly workspaceId: string
  readonly jobId: string
  readonly identityId: string
  readonly account: string
  readonly actor: JobActor
}

export interface MergeJobsInput {
  readonly workspaceId: string
  readonly jobIdA: string
  readonly jobIdB: string
  readonly actor: JobActor
}

export interface IdentityTuple {
  readonly kind: JobIdentityKind
  readonly provider: string
  readonly account?: string | null
  readonly value: string
}

export interface JobIdentityRecord {
  readonly id: string
  readonly jobId: string
  readonly kind: JobIdentityKind
  readonly provider: string
  readonly account: string | null
  readonly value: string
  readonly strength: JobIdentityStrength
  readonly createdAt: string
}

export interface IdentityOwner {
  readonly jobId: string
  readonly identityId: string
}

/**
 * `resolvedJobId` is the Job the identity provably belongs to. It equals the input
 * jobId when established there; a different value means ATTACH resolved to an
 * existing owner (the caller should treat that Job as the truth, e.g. merge).
 */
export type EstablishIdentityResult =
  | { readonly ok: true; readonly identityId: string; readonly jobId: string; readonly resolvedJobId: string; readonly attached: boolean }
  | JobFailure

export type MergeJobsResult =
  | { readonly ok: true; readonly winnerJobId: string; readonly loserJobId: string }
  | JobFailure

export interface JobIdentityService {
  establish(input: EstablishIdentityInput): Promise<EstablishIdentityResult>
  strengthen(input: StrengthenIdentityInput): Promise<EstablishIdentityResult>
  listIdentities(workspaceId: string, jobId: string): Promise<readonly JobIdentityRecord[]>
  inspectOwner(workspaceId: string, tuple: IdentityTuple): Promise<IdentityOwner | null>
  merge(input: MergeJobsInput): Promise<MergeJobsResult>
}

export interface JobIdentityServiceOptions {
  readonly now?: Clock
  readonly newId?: UuidV7Generator
}

function requireOneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new JobInputError('invalid_input', `${field} is invalid`)
  }
  return value as T
}

interface ValidatedIdentity {
  kind: JobIdentityKind
  provider: string
  account: string | null
  value: string
  strength: JobIdentityStrength
  provenanceKind: string
  provenanceVersion: string
  evidenceJson: string
}

function validateIdentity(identity: JobIdentityInput): ValidatedIdentity {
  const strength = requireOneOf(identity.strength, jobIdentityStrengths, 'identity.strength')
  const account = identity.account === undefined || identity.account === null
    ? null
    : requireText(identity.account, 'identity.account', 1, ACCOUNT_MAX).toLowerCase()
  if (strength === 'strong' && account === null) {
    throw new JobInputError('invalid_input', 'a strong identity requires an account')
  }
  const evidenceJson = boundedJson(identity.evidence, 'identity.evidence', EVIDENCE_MAX)
  if (evidenceJson.length < 2) throw new JobInputError('invalid_input', 'identity.evidence must be a JSON object or array')
  return {
    kind: requireOneOf(identity.kind, jobExternalIdentityKinds, 'identity.kind'),
    provider: requireText(identity.provider, 'identity.provider', 1, PROVIDER_MAX).toLowerCase(),
    account,
    value: requireText(identity.value, 'identity.value', 1, VALUE_MAX),
    strength,
    provenanceKind: requireText(identity.provenanceKind, 'identity.provenanceKind', 1, PROVENANCE_MAX),
    provenanceVersion: requireText(identity.provenanceVersion, 'identity.provenanceVersion', 1, PROVENANCE_MAX),
    evidenceJson,
  }
}

type Tx = Parameters<Parameters<PgliteDatabase['transaction']>[0]>[0]

/**
 * Resolve which Job (if any) provably owns a strong external identity in a
 * workspace. The strong-uniqueness index guarantees at most one. Exported so the
 * Capture→Job promotion (#300 slice 3) composes the same ATTACH resolution.
 */
export async function resolveStrongIdentityOwner(
  exec: Pick<PgliteDatabase, 'select'>,
  workspaceId: string,
  tuple: { kind: string; provider: string; account: string | null; value: string },
): Promise<IdentityOwner | null> {
  const [row] = await exec
    .select({ jobId: jobExternalIdentities.jobId, identityId: jobExternalIdentities.id })
    .from(jobExternalIdentities)
    .innerJoin(lifecycleJobs, eq(lifecycleJobs.id, jobExternalIdentities.jobId))
    .where(and(
      eq(lifecycleJobs.workspaceId, workspaceId),
      eq(jobExternalIdentities.kind, tuple.kind),
      eq(jobExternalIdentities.provider, tuple.provider),
      sql`coalesce(${jobExternalIdentities.account}, '') = ${tuple.account ?? ''}`,
      eq(jobExternalIdentities.value, tuple.value),
      eq(jobExternalIdentities.strength, 'strong'),
      isNull(jobExternalIdentities.removedAt),
    ))
    .limit(1)
  return row ?? null
}

export function createPgliteJobIdentityService(
  database: PgliteDatabase,
  options: JobIdentityServiceOptions = {},
): JobIdentityService {
  const clock = options.now ?? (() => new Date())
  const nowIso = () => clock().toISOString()
  const newId = options.newId ?? createUuidV7Generator(clock)

  async function jobExists(workspaceId: string, jobId: string): Promise<{ id: string; createdAt: string; removedAt: string | null } | null> {
    const [row] = await database
      .select({ id: lifecycleJobs.id, createdAt: lifecycleJobs.createdAt, removedAt: lifecycleJobs.removedAt })
      .from(lifecycleJobs)
      .where(and(eq(lifecycleJobs.workspaceId, workspaceId), eq(lifecycleJobs.id, jobId)))
      .limit(1)
    return row ?? null
  }

  const strongOwner = resolveStrongIdentityOwner

  async function appendHistory(tx: Tx, jobId: string, kind: string, snapshotJson: string, actor: JobActor, createdAt: string) {
    const [seqRow] = await tx
      .select({ maxSeq: sql<number>`coalesce(max(${jobHistory.sequence}), 0)` })
      .from(jobHistory)
      .where(eq(jobHistory.jobId, jobId))
    await insertJobHistory(tx).values({
      id: newId(),
      jobId,
      sequence: Number(seqRow?.maxSeq ?? 0) + 1,
      kind,
      snapshotJson,
      auditJson: auditJson(actor),
      createdAt,
    })
  }

  function identitySnapshot(identity: ValidatedIdentity): string {
    return JSON.stringify({ kind: identity.kind, provider: identity.provider, account: identity.account, value: identity.value, strength: identity.strength })
  }

  async function insertIdentity(tx: Tx, jobId: string, identity: ValidatedIdentity, createdAt: string): Promise<string> {
    const id = newId()
    await insertJobExternalIdentities(tx).values({
      id,
      jobId,
      kind: identity.kind,
      provider: identity.provider,
      account: identity.account,
      value: identity.value,
      strength: identity.strength,
      provenanceKind: identity.provenanceKind,
      provenanceVersion: identity.provenanceVersion,
      evidenceJson: identity.evidenceJson,
      createdAt,
    })
    return id
  }

  return {
    async establish(input) {
      let workspaceId: string
      let jobId: string
      let actor: JobActor
      let identity: ValidatedIdentity
      try {
        workspaceId = requireText(input.workspaceId, 'workspaceId', 1, WORKSPACE_MAX)
        jobId = requireText(input.jobId, 'jobId', 1, WORKSPACE_MAX)
        actor = requireActor(input.actor)
        identity = validateIdentity(input.identity)
      } catch (error) {
        if (error instanceof JobInputError) return fail(error.code, error.message)
        throw error
      }
      const job = await jobExists(workspaceId, jobId)
      if (!job) return fail('not_found', 'job not found in this workspace')

      if (identity.strength === 'strong') {
        const owner = await strongOwner(database, workspaceId, identity)
        if (owner) {
          // ATTACH: the strong identity is already proven to a Job (this one or another).
          return { ok: true, identityId: owner.identityId, jobId: owner.jobId, resolvedJobId: owner.jobId, attached: true }
        }
      }
      const createdAt = nowIso()
      try {
        return await database.transaction(async (tx) => {
          const identityId = await insertIdentity(tx, jobId, identity, createdAt)
          await appendHistory(tx, jobId, 'identity_added', identitySnapshot(identity), actor, createdAt)
          return { ok: true as const, identityId, jobId, resolvedJobId: jobId, attached: false }
        })
      } catch (error) {
        if (isUniqueViolation(error)) {
          // A concurrent establish claimed the strong identity, or a duplicate on
          // this job — resolve to the proven owner.
          const owner = await strongOwner(database, workspaceId, identity)
          if (owner) return { ok: true, identityId: owner.identityId, jobId: owner.jobId, resolvedJobId: owner.jobId, attached: true }
          return fail('strong_identity_conflict', 'strong identity is owned outside this workspace')
        }
        throw error
      }
    },

    async strengthen(input) {
      let workspaceId: string
      let jobId: string
      let identityId: string
      let account: string
      let actor: JobActor
      try {
        workspaceId = requireText(input.workspaceId, 'workspaceId', 1, WORKSPACE_MAX)
        jobId = requireText(input.jobId, 'jobId', 1, WORKSPACE_MAX)
        identityId = requireText(input.identityId, 'identityId', 1, WORKSPACE_MAX)
        account = requireText(input.account, 'account', 1, ACCOUNT_MAX).toLowerCase()
        actor = requireActor(input.actor)
      } catch (error) {
        if (error instanceof JobInputError) return fail(error.code, error.message)
        throw error
      }
      const job = await jobExists(workspaceId, jobId)
      if (!job) return fail('not_found', 'job not found in this workspace')
      const [provisional] = await database
        .select()
        .from(jobExternalIdentities)
        .where(and(
          eq(jobExternalIdentities.id, identityId),
          eq(jobExternalIdentities.jobId, jobId),
          eq(jobExternalIdentities.strength, 'provisional'),
          isNull(jobExternalIdentities.removedAt),
        ))
        .limit(1)
      if (!provisional) return fail('not_found', 'active provisional identity not found on this job')

      const strong: ValidatedIdentity = {
        kind: provisional.kind as JobIdentityKind,
        provider: provisional.provider,
        account,
        value: provisional.value,
        strength: 'strong',
        provenanceKind: provisional.provenanceKind,
        provenanceVersion: provisional.provenanceVersion,
        evidenceJson: provisional.evidenceJson,
      }
      const owner = await strongOwner(database, workspaceId, strong)
      if (owner && owner.jobId !== jobId) {
        // ATTACH: strengthening reveals the Job is actually the strong owner.
        return { ok: true, identityId: owner.identityId, jobId: owner.jobId, resolvedJobId: owner.jobId, attached: true }
      }
      if (owner && owner.jobId === jobId) {
        // The job already holds this strong identity; the provisional is redundant.
        return { ok: true, identityId: owner.identityId, jobId, resolvedJobId: jobId, attached: true }
      }
      const createdAt = nowIso()
      try {
        return await database.transaction(async (tx) => {
          await updateJobExternalIdentities(tx)
            .set({ removedAt: createdAt })
            .where(eq(jobExternalIdentities.id, provisional.id))
          const identityId2 = await insertIdentity(tx, jobId, strong, createdAt)
          await appendHistory(tx, jobId, 'identity_removed', identitySnapshot({ ...strong, strength: 'provisional' }), actor, createdAt)
          await appendHistory(tx, jobId, 'identity_added', identitySnapshot(strong), actor, createdAt)
          return { ok: true as const, identityId: identityId2, jobId, resolvedJobId: jobId, attached: false }
        })
      } catch (error) {
        if (isUniqueViolation(error)) {
          const raced = await strongOwner(database, workspaceId, strong)
          if (raced) return { ok: true, identityId: raced.identityId, jobId: raced.jobId, resolvedJobId: raced.jobId, attached: true }
          return fail('strong_identity_conflict', 'strong identity is owned outside this workspace')
        }
        throw error
      }
    },

    async listIdentities(workspaceId, jobId) {
      const job = await jobExists(workspaceId, jobId)
      if (!job) return []
      const rows = await database
        .select()
        .from(jobExternalIdentities)
        .where(and(eq(jobExternalIdentities.jobId, jobId), isNull(jobExternalIdentities.removedAt)))
        .orderBy(asc(jobExternalIdentities.createdAt), asc(jobExternalIdentities.id))
      return rows.map((row) => ({
        id: row.id,
        jobId: row.jobId,
        kind: row.kind as JobIdentityKind,
        provider: row.provider,
        account: row.account,
        value: row.value,
        strength: row.strength as JobIdentityStrength,
        createdAt: row.createdAt,
      }))
    },

    async inspectOwner(workspaceId, tuple) {
      const account = tuple.account === undefined || tuple.account === null ? null : tuple.account.trim().toLowerCase()
      return strongOwner(database, workspaceId, {
        kind: tuple.kind,
        provider: tuple.provider.trim().toLowerCase(),
        account,
        value: tuple.value,
      })
    },

    async merge(input) {
      let workspaceId: string
      let jobIdA: string
      let jobIdB: string
      let actor: JobActor
      try {
        workspaceId = requireText(input.workspaceId, 'workspaceId', 1, WORKSPACE_MAX)
        jobIdA = requireText(input.jobIdA, 'jobIdA', 1, WORKSPACE_MAX)
        jobIdB = requireText(input.jobIdB, 'jobIdB', 1, WORKSPACE_MAX)
        actor = requireActor(input.actor)
      } catch (error) {
        if (error instanceof JobInputError) return fail(error.code, error.message)
        throw error
      }
      if (jobIdA === jobIdB) return { ok: true, winnerJobId: jobIdA, loserJobId: jobIdA }
      const jobA = await jobExists(workspaceId, jobIdA)
      const jobB = await jobExists(workspaceId, jobIdB)
      if (!jobA || !jobB) return fail('not_found', 'both jobs must exist in this workspace')

      // Deterministic winner: earliest created_at, then id.
      const [winner, loser] = jobA.createdAt < jobB.createdAt || (jobA.createdAt === jobB.createdAt && jobA.id < jobB.id)
        ? [jobA, jobB]
        : [jobB, jobA]
      const createdAt = nowIso()

      return await database.transaction(async (tx) => {
        const identities = await tx
          .select()
          .from(jobExternalIdentities)
          .where(and(eq(jobExternalIdentities.jobId, loser.id), isNull(jobExternalIdentities.removedAt)))
        for (const identity of identities) {
          // Tombstone the loser's identity FIRST so a strong identity frees its
          // strong-uniqueness slot before the winner re-inserts it (otherwise the
          // still-active loser row would conflict and the identity would be lost).
          await updateJobExternalIdentities(tx).set({ removedAt: createdAt }).where(eq(jobExternalIdentities.id, identity.id))
          await appendHistory(tx, loser.id, 'identity_removed', JSON.stringify({ kind: identity.kind, value: identity.value }), actor, createdAt)
          const inserted = await insertJobExternalIdentities(tx)
            .values({
              id: newId(),
              jobId: winner.id,
              kind: identity.kind,
              provider: identity.provider,
              account: identity.account,
              value: identity.value,
              strength: identity.strength,
              provenanceKind: identity.provenanceKind,
              provenanceVersion: identity.provenanceVersion,
              evidenceJson: identity.evidenceJson,
              createdAt,
            })
            .onConflictDoNothing()
            .returning({ id: jobExternalIdentities.id })
          if (inserted.length > 0) {
            await appendHistory(tx, winner.id, 'identity_added', JSON.stringify({ kind: identity.kind, value: identity.value, mergedFrom: loser.id }), actor, createdAt)
          }
        }

        const references = await tx
          .select()
          .from(jobCaptureEvidenceReferences)
          .where(eq(jobCaptureEvidenceReferences.jobId, loser.id))
        for (const reference of references) {
          await insertJobCaptureEvidenceReferences(tx)
            .values({
              id: newId(),
              jobId: winner.id,
              captureId: reference.captureId,
              captureRevision: reference.captureRevision,
              evidenceIndexesJson: reference.evidenceIndexesJson,
              createdAt,
            })
            .onConflictDoNothing()
          await deleteJobCaptureEvidenceReferences(tx).where(eq(jobCaptureEvidenceReferences.id, reference.id))
        }

        await updateLifecycleJobs(tx).set({ removedAt: createdAt, updatedAt: createdAt }).where(eq(lifecycleJobs.id, loser.id))
        await appendHistory(tx, loser.id, 'removed', JSON.stringify({ kind: 'merged', into: winner.id }), actor, createdAt)
        return { ok: true as const, winnerJobId: winner.id, loserJobId: loser.id }
      })
    },
  }
}
