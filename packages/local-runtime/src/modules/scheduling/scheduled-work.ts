/**
 * Generic durable scheduled-work engine (issue #303). Owned by the scheduling module.
 *
 * The app-wide scheduler claims a DISTINCT durable work record for each independently
 * retryable lifecycle operation. #298 installed five canonical identity tables — one
 * per operation (connector_capture_work, normalization_work, provider_url_resolution_work,
 * hosted_submission_work, hosted_result_polling_work), each with its own attempt budget,
 * status, next-eligible time, and active-subject uniqueness. This module is the ONE
 * claim/backoff/recovery engine over them, so one operation can never exhaust, complete,
 * or delay another. It is owned OUTSIDE connectors and aggregate modules; the
 * state-ownership scanner attributes every canonical scheduling-table write here.
 *
 * Aggregate/producer modules PUBLISH work through `enqueue` (AC5); they never write the
 * scheduling tables directly. The shared bounded exponential-backoff + sanitized
 * Retry-After policy is `scheduleRetry` from the connectors-core package — the SAME
 * policy #233's provider-URL path uses, integrated here rather than duplicated. Retry
 * math and the retry/deterministic reason vocabularies stay identical across operations.
 *
 * Each concrete table's Drizzle ops are bound inside `defineOperation` (where the table
 * type is concrete), so the state-machine engine stays table-agnostic and fully typed.
 *
 * Connector capture resumption is integrated with the connector repository; the
 * remaining operation descriptors share this generic claim/backoff engine.
 */
import { scheduleRetry } from '@sparxie/valedictorian-connectors-core'
import type { TransientRetryReason } from '@sparxie/sdk'
import { and, asc, eq, isNotNull, lte } from 'drizzle-orm'
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import type { PgliteDatabase } from '../../db/pglite.js'
import { containsSensitiveJsonKey } from '../lifecycle/lifecycle-representation.js'
// connector_capture_work is connector-owned; scheduling reads it through the
// canonical aggregate so the connector slice can keep depending on the shared
// scheduled-work vocabulary declared here without closing a module cycle.
import { connectorCaptureWork } from '../../db/schema.js'
import {
  captureDestinationResolutionWork,
  hostedResultPollingWork,
  hostedSubmissionWork,
  normalizationWork,
  providerUrlResolutionWork,
  scheduledWorkDeterministicReasons,
  scheduledWorkRetryableReasons,
} from './scheduling.schema.js'

export const scheduledOperations = [
  'capture_destination_resolution',
  'connector_capture',
  'normalization',
  'hosted_submission',
  'hosted_result_polling',
] as const
export type ScheduledOperation = (typeof scheduledOperations)[number]

export type ScheduledWorkRetryableReason = (typeof scheduledWorkRetryableReasons)[number]
export type ScheduledWorkDeterministicReason = (typeof scheduledWorkDeterministicReasons)[number]

const FAILURE_DETAIL_MAX = 2_000

/** A read+write executor — the workspace database OR an open transaction. */
export type ScheduledExecutor = Pick<PgliteDatabase, 'select' | 'insert' | 'update'>

interface CommonInsert {
  id: string
  workspaceId: string
  idempotencyKey: string
  attempt: number
  maxAttempts: number
  status: 'scheduled'
  nextEligibleAt: string
  failureReason: null
  failureDetail: null
  ownerVersion: string
  acquisitionToken: null
  claimedAt: null
  claimExpiresAt: null
  createdAt: string
  updatedAt: string
}

interface CommonPatch {
  status?: string
  attempt?: number
  nextEligibleAt?: string | null
  failureReason?: string | null
  failureDetail?: string | null
  acquisitionToken?: string | null
  claimedAt?: string | null
  claimExpiresAt?: string | null
  updatedAt?: string
}

/** Normalized scheduled-work row (common fields + the operation's typed subject). */
export interface ScheduledRow<Claim> {
  id: string
  workspaceId: string
  attempt: number
  maxAttempts: number
  ownerVersion: string
  status: string
  acquisitionToken: string | null
  nextEligibleAt: string | null
  subject: Claim
}

export interface OperationDefaults {
  readonly maxAttempts: number
  readonly baseDelayMs: number
  readonly maxDelayMs: number
  readonly horizonMs: number
  /** Fixed policy delays for operations whose accepted contract forbids jitter. */
  readonly retryDelaysMs?: readonly number[]
}

/** A scheduled operation with all Drizzle table ops bound to its concrete table. */
export interface ScheduledOperationDescriptor<Subject, Claim> {
  /**
   * A descriptor can remain available to inspect historical tables without being an
   * active scheduler operation (the retired provider-URL descriptor is one case).
   */
  readonly operation: string
  readonly defaults: OperationDefaults
  /** A row-owned retry policy takes precedence over descriptor defaults. */
  retryDelayMs?(row: ScheduledRow<Claim>): number | undefined
  insertIfAbsent(exec: ScheduledExecutor, common: CommonInsert, subject: Subject): Promise<boolean>
  claimDueCandidate(exec: ScheduledExecutor, dueAt: string, workspaceId?: string): Promise<ScheduledRow<Claim> | null>
  lockClaimed(exec: ScheduledExecutor, id: string, token: string, workspaceId?: string): Promise<ScheduledRow<Claim> | null>
  patchById(exec: ScheduledExecutor, id: string, patch: CommonPatch, workspaceId?: string): Promise<void>
  claimScheduled(exec: ScheduledExecutor, id: string, patch: CommonPatch, workspaceId?: string): Promise<boolean>
  completeClaim(exec: ScheduledExecutor, id: string, token: string, patch: CommonPatch, workspaceId?: string): Promise<boolean>
  recoverClaimed(exec: ScheduledExecutor, patch: CommonPatch, workspaceId?: string): Promise<number>
  nextDue(exec: ScheduledExecutor, workspaceId?: string): Promise<string | null>
}

const DEFAULTS: OperationDefaults = { maxAttempts: 3, baseDelayMs: 30_000, maxDelayMs: 30 * 60_000, horizonMs: 24 * 60 * 60_000 }
const CAPTURE_DESTINATION_DEFAULTS: OperationDefaults = {
  maxAttempts: 7,
  baseDelayMs: 2_000,
  maxDelayMs: 60_000,
  horizonMs: 24 * 60 * 60_000,
  retryDelaysMs: [2_000, 4_000, 8_000, 16_000, 32_000, 60_000],
}

function defineOperation<TTable extends PgTable, Subject, Claim>(
  operation: string,
  table: TTable,
  columns: { id: PgColumn; workspaceId: PgColumn; status: PgColumn; nextEligibleAt: PgColumn; createdAt: PgColumn; acquisitionToken: PgColumn },
  subjectValues: (subject: Subject, common: CommonInsert) => Partial<InferInsertModel<TTable>>,
  readSubject: (row: InferSelectModel<TTable>) => Claim,
  defaults: OperationDefaults = DEFAULTS,
): ScheduledOperationDescriptor<Subject, Claim> {
  const normalize = (row: InferSelectModel<TTable>): ScheduledRow<Claim> => {
    const r = row as InferSelectModel<TTable> & {
      id: string; workspaceId: string; attempt: number; maxAttempts: number; ownerVersion: string; status: string; acquisitionToken: string | null; nextEligibleAt: string | null
    }
    return {
      id: r.id, workspaceId: r.workspaceId, attempt: r.attempt, maxAttempts: r.maxAttempts, ownerVersion: r.ownerVersion,
      status: r.status, acquisitionToken: r.acquisitionToken, nextEligibleAt: r.nextEligibleAt,
      subject: readSubject(row),
    }
  }
  return {
    operation,
    defaults,
    async insertIfAbsent(exec, common, subject) {
      const values = { ...common, ...subjectValues(subject, common) } as InferInsertModel<TTable>
      const inserted = await exec.insert(table).values(values).onConflictDoNothing().returning({ id: columns.id })
      return inserted.length > 0
    },
    async claimDueCandidate(exec, dueAt, workspaceId) {
      const [row] = await exec.select().from(table as PgTable)
        .where(and(eq(columns.status, 'scheduled'), isNotNull(columns.nextEligibleAt), lte(columns.nextEligibleAt, dueAt), workspaceId ? eq(columns.workspaceId, workspaceId) : undefined))
        .orderBy(asc(columns.nextEligibleAt), asc(columns.createdAt), asc(columns.id))
        .limit(1)
        .for('update', { skipLocked: true })
      return row ? normalize(row as InferSelectModel<TTable>) : null
    },
    async lockClaimed(exec, id, token, workspaceId) {
      const [row] = await exec.select().from(table as PgTable)
        .where(and(eq(columns.id, id), eq(columns.status, 'claimed'), eq(columns.acquisitionToken, token), workspaceId ? eq(columns.workspaceId, workspaceId) : undefined))
        .limit(1)
        .for('update')
      return row ? normalize(row as InferSelectModel<TTable>) : null
    },
    async patchById(exec, id, patch, workspaceId) {
      await exec.update(table).set(patch as Partial<InferInsertModel<TTable>>).where(and(eq(columns.id, id), workspaceId ? eq(columns.workspaceId, workspaceId) : undefined))
    },
    async claimScheduled(exec, id, patch, workspaceId) {
      const updated = await exec.update(table).set(patch as Partial<InferInsertModel<TTable>>)
        .where(and(eq(columns.id, id), eq(columns.status, 'scheduled'), workspaceId ? eq(columns.workspaceId, workspaceId) : undefined))
        .returning({ id: columns.id })
      return updated.length > 0
    },
    async completeClaim(exec, id, token, patch, workspaceId) {
      const updated = await exec.update(table).set(patch as Partial<InferInsertModel<TTable>>)
        .where(and(eq(columns.id, id), eq(columns.status, 'claimed'), eq(columns.acquisitionToken, token), workspaceId ? eq(columns.workspaceId, workspaceId) : undefined))
        .returning({ id: columns.id })
      return updated.length > 0
    },
    async recoverClaimed(exec, patch, workspaceId) {
      const recovered = await exec.update(table).set(patch as Partial<InferInsertModel<TTable>>)
        .where(and(eq(columns.status, 'claimed'), workspaceId ? eq(columns.workspaceId, workspaceId) : undefined))
        .returning({ id: columns.id })
      return recovered.length
    },
    async nextDue(exec, workspaceId) {
      const [row] = await exec.select({ nextEligibleAt: columns.nextEligibleAt }).from(table as PgTable)
        .where(and(eq(columns.status, 'scheduled'), isNotNull(columns.nextEligibleAt), workspaceId ? eq(columns.workspaceId, workspaceId) : undefined))
        .orderBy(asc(columns.nextEligibleAt))
        .limit(1)
      return (row?.nextEligibleAt as string | null | undefined) ?? null
    },
  }
}

// --- Operation subject types + descriptors ---

export interface ProviderUrlResolutionSubject {
  readonly captureId: string
  readonly resolverId: string
  readonly resolverVersion: string
  readonly intermediaryUrlHash: string
}

export interface CaptureDestinationResolutionSubject {
  readonly captureId: string
  readonly captureRevision: number
  readonly generationId: string
  readonly resolverId: string
  readonly resolverVersion: string
  readonly inputFingerprint: string
  /** Immutable, generation-derived schedule. Stored as bounded columns on the work row. */
  readonly retryDelay1Ms: number
  readonly retryDelay2Ms: number
  readonly retryDelay3Ms: number
  readonly retryDelay4Ms: number
  readonly retryDelay5Ms: number
  readonly retryDelay6Ms: number
}

export const captureDestinationResolutionOperation = defineOperation<
  typeof captureDestinationResolutionWork,
  CaptureDestinationResolutionSubject,
  CaptureDestinationResolutionSubject
>(
  'capture_destination_resolution',
  captureDestinationResolutionWork,
  {
    id: captureDestinationResolutionWork.id,
    workspaceId: captureDestinationResolutionWork.workspaceId,
    status: captureDestinationResolutionWork.status,
    nextEligibleAt: captureDestinationResolutionWork.nextEligibleAt,
    createdAt: captureDestinationResolutionWork.createdAt,
    acquisitionToken: captureDestinationResolutionWork.acquisitionToken,
  },
  (subject) => subject,
  (row) => ({
    captureId: row.captureId,
    captureRevision: row.captureRevision,
    generationId: row.generationId,
    resolverId: row.resolverId,
    resolverVersion: row.resolverVersion,
    inputFingerprint: row.inputFingerprint,
    retryDelay1Ms: row.retryDelay1Ms,
    retryDelay2Ms: row.retryDelay2Ms,
    retryDelay3Ms: row.retryDelay3Ms,
    retryDelay4Ms: row.retryDelay4Ms,
    retryDelay5Ms: row.retryDelay5Ms,
    retryDelay6Ms: row.retryDelay6Ms,
  }),
  CAPTURE_DESTINATION_DEFAULTS,
)
captureDestinationResolutionOperation.retryDelayMs = (row) => [
  row.subject.retryDelay1Ms,
  row.subject.retryDelay2Ms,
  row.subject.retryDelay3Ms,
  row.subject.retryDelay4Ms,
  row.subject.retryDelay5Ms,
  row.subject.retryDelay6Ms,
][row.attempt - 1]
export const providerUrlResolutionOperation = defineOperation<typeof providerUrlResolutionWork, ProviderUrlResolutionSubject, ProviderUrlResolutionSubject>(
  'provider_url_resolution',
  providerUrlResolutionWork,
  { id: providerUrlResolutionWork.id, workspaceId: providerUrlResolutionWork.workspaceId, status: providerUrlResolutionWork.status, nextEligibleAt: providerUrlResolutionWork.nextEligibleAt, createdAt: providerUrlResolutionWork.createdAt, acquisitionToken: providerUrlResolutionWork.acquisitionToken },
  (s) => ({ captureId: s.captureId, resolverId: s.resolverId, resolverVersion: s.resolverVersion, intermediaryUrlHash: s.intermediaryUrlHash }),
  (row) => ({ captureId: row.captureId, resolverId: row.resolverId, resolverVersion: row.resolverVersion, intermediaryUrlHash: row.intermediaryUrlHash }),
)

export interface NormalizationSubject {
  readonly captureId: string
  readonly captureRevision: number
  readonly resolverId: string
  readonly resolverVersion: string
  readonly inputHash: string
}
export const normalizationOperation = defineOperation<typeof normalizationWork, NormalizationSubject, NormalizationSubject>(
  'normalization',
  normalizationWork,
  { id: normalizationWork.id, workspaceId: normalizationWork.workspaceId, status: normalizationWork.status, nextEligibleAt: normalizationWork.nextEligibleAt, createdAt: normalizationWork.createdAt, acquisitionToken: normalizationWork.acquisitionToken },
  (s) => ({ captureId: s.captureId, captureRevision: s.captureRevision, resolverId: s.resolverId, resolverVersion: s.resolverVersion, inputHash: s.inputHash }),
  (row) => ({ captureId: row.captureId, captureRevision: row.captureRevision, resolverId: row.resolverId, resolverVersion: row.resolverVersion, inputHash: row.inputHash }),
)

export interface ConnectorCaptureSubject {
  readonly connectorInstanceId: string
  readonly filterSignature: string
  readonly checkpointSchemaVersion: string
  readonly checkpointGeneration: string
}
export const connectorCaptureOperation = defineOperation<typeof connectorCaptureWork, ConnectorCaptureSubject, ConnectorCaptureSubject>(
  'connector_capture',
  connectorCaptureWork,
  { id: connectorCaptureWork.id, workspaceId: connectorCaptureWork.workspaceId, status: connectorCaptureWork.status, nextEligibleAt: connectorCaptureWork.nextEligibleAt, createdAt: connectorCaptureWork.createdAt, acquisitionToken: connectorCaptureWork.acquisitionToken },
  (s, common) => ({
    connectorInstanceId: s.connectorInstanceId,
    filterSignature: s.filterSignature,
    checkpointSchemaVersion: s.checkpointSchemaVersion,
    checkpointGeneration: s.checkpointGeneration,
    lastAttemptAt: common.createdAt,
    horizonAt: new Date(Date.parse(common.createdAt) + DEFAULTS.horizonMs).toISOString(),
  }),
  (row) => ({ connectorInstanceId: row.connectorInstanceId, filterSignature: row.filterSignature, checkpointSchemaVersion: row.checkpointSchemaVersion, checkpointGeneration: row.checkpointGeneration }),
)

export interface HostedSubmissionSubject {
  readonly captureId: string
  readonly canonicalUrlHash: string
}
export const hostedSubmissionOperation = defineOperation<typeof hostedSubmissionWork, HostedSubmissionSubject, HostedSubmissionSubject>(
  'hosted_submission',
  hostedSubmissionWork,
  { id: hostedSubmissionWork.id, workspaceId: hostedSubmissionWork.workspaceId, status: hostedSubmissionWork.status, nextEligibleAt: hostedSubmissionWork.nextEligibleAt, createdAt: hostedSubmissionWork.createdAt, acquisitionToken: hostedSubmissionWork.acquisitionToken },
  (s) => ({ captureId: s.captureId, canonicalUrlHash: s.canonicalUrlHash }),
  (row) => ({ captureId: row.captureId, canonicalUrlHash: row.canonicalUrlHash }),
)

export interface HostedResultPollingSubject {
  readonly captureId: string
  readonly resolutionRequestId: string
}
export const hostedResultPollingOperation = defineOperation<typeof hostedResultPollingWork, HostedResultPollingSubject, HostedResultPollingSubject>(
  'hosted_result_polling',
  hostedResultPollingWork,
  { id: hostedResultPollingWork.id, workspaceId: hostedResultPollingWork.workspaceId, status: hostedResultPollingWork.status, nextEligibleAt: hostedResultPollingWork.nextEligibleAt, createdAt: hostedResultPollingWork.createdAt, acquisitionToken: hostedResultPollingWork.acquisitionToken },
  (s) => ({ captureId: s.captureId, resolutionRequestId: s.resolutionRequestId }),
  (row) => ({ captureId: row.captureId, resolutionRequestId: row.resolutionRequestId }),
)

// --- Public command/query contract ---

export interface EnqueueScheduledWorkInput<Subject> {
  readonly workspaceId: string
  readonly idempotencyKey: string
  readonly ownerVersion: string
  readonly subject: Subject
  readonly maxAttempts?: number
  readonly eligibleAt?: string
}

export interface ClaimedScheduledWork<Claim> {
  readonly id: string
  readonly workspaceId: string
  readonly token: string
  readonly attempt: number
  readonly maxAttempts: number
  readonly ownerVersion: string
  readonly subject: Claim
}

export interface FailScheduledWorkInput {
  readonly id: string
  readonly token: string
  readonly retryReason?: ScheduledWorkRetryableReason
  readonly deterministicReason?: ScheduledWorkDeterministicReason
  readonly detail?: string
  readonly serverMinimumDelayMs?: number
}

export type FailScheduledWorkOutcome =
  | { readonly outcome: 'retry'; readonly attempt: number; readonly nextEligibleAt: string }
  | { readonly outcome: 'exhausted' }
  | { readonly outcome: 'terminal' }
  | { readonly outcome: 'not_owner' }

export interface ScheduledWorkRepositoryOptions {
  readonly now?: () => Date
  readonly random?: () => number
  readonly newId?: () => string
  /** Claim lease window recorded for observability; a crash orphans claims regardless. */
  readonly leaseMs?: number
  /** A client/runtime repository is always bound to one workspace. */
  readonly workspaceId?: string
}

export interface ScheduledWorkRepository<Subject, Claim> {
  readonly workspaceId?: string
  enqueue(input: EnqueueScheduledWorkInput<Subject>): Promise<boolean>
  claimDue(dueAt: string): Promise<ClaimedScheduledWork<Claim> | null>
  complete(input: { id: string; token: string }): Promise<boolean>
  fail(input: FailScheduledWorkInput): Promise<FailScheduledWorkOutcome>
  recoverClaimed(recoveredAt?: string): Promise<number>
  nextDueAt(): Promise<string | null>
}

function sanitizeDetail(detail: string | undefined): string | null {
  if (detail === undefined) return null
  const trimmed = detail.trim()
  if (trimmed.length === 0) return null
  const bounded = trimmed.slice(0, FAILURE_DETAIL_MAX)
  // The failureDetail CHECK forbids sensitive JSON keys; drop the detail rather than
  // persist a value the constraint would reject mid-transaction.
  return containsSensitiveJsonKey(bounded) ? null : bounded
}

export function createScheduledWorkRepository<Subject, Claim>(
  database: PgliteDatabase,
  descriptor: ScheduledOperationDescriptor<Subject, Claim>,
  options: ScheduledWorkRepositoryOptions = {},
): ScheduledWorkRepository<Subject, Claim> {
  const now = options.now ?? (() => new Date())
  const random = options.random ?? Math.random
  const newId = options.newId ?? (() => globalThis.crypto.randomUUID())
  const leaseMs = options.leaseMs ?? 5 * 60_000
  const workspaceId = options.workspaceId

  return {
    workspaceId,
    async enqueue(input) {
      if (workspaceId && input.workspaceId !== workspaceId) {
        throw new Error('Scheduled work cannot be enqueued outside its bound workspace')
      }
      const createdAt = now().toISOString()
      const common: CommonInsert = {
        id: newId(),
        workspaceId: input.workspaceId,
        idempotencyKey: input.idempotencyKey,
        attempt: 1,
        maxAttempts: input.maxAttempts ?? descriptor.defaults.maxAttempts,
        status: 'scheduled',
        nextEligibleAt: input.eligibleAt ?? createdAt,
        failureReason: null,
        failureDetail: null,
        ownerVersion: input.ownerVersion,
        acquisitionToken: null,
        claimedAt: null,
        claimExpiresAt: null,
        createdAt,
        updatedAt: createdAt,
      }
      return descriptor.insertIfAbsent(database, common, input.subject)
    },

    async claimDue(dueAt) {
      return database.transaction(async (tx) => {
        const candidate = await descriptor.claimDueCandidate(tx, dueAt, workspaceId)
        if (!candidate) return null
        const token = newId()
        const claimedAt = now().toISOString()
        const claimExpiresAt = new Date(now().getTime() + leaseMs).toISOString()
        const claimed = await descriptor.claimScheduled(tx, candidate.id, {
          status: 'claimed', acquisitionToken: token, claimedAt, claimExpiresAt, updatedAt: claimedAt,
        }, workspaceId)
        if (!claimed) return null
        return {
          id: candidate.id,
          workspaceId: candidate.workspaceId,
          token,
          attempt: candidate.attempt,
          maxAttempts: candidate.maxAttempts,
          ownerVersion: candidate.ownerVersion,
          subject: candidate.subject,
        }
      })
    },

    async complete(input) {
      return descriptor.completeClaim(database, input.id, input.token, {
        status: 'completed', nextEligibleAt: null, acquisitionToken: null, claimedAt: null, claimExpiresAt: null, updatedAt: now().toISOString(),
      }, workspaceId)
    },

    async fail(input) {
      return database.transaction(async (tx): Promise<FailScheduledWorkOutcome> => {
        const row = await descriptor.lockClaimed(tx, input.id, input.token, workspaceId)
        if (!row) return { outcome: 'not_owner' }
        const updatedAt = now().toISOString()
        const detail = sanitizeDetail(input.detail)

        if (input.deterministicReason) {
          await descriptor.patchById(tx, input.id, {
            status: 'terminal', failureReason: input.deterministicReason, failureDetail: detail,
            nextEligibleAt: null, acquisitionToken: null, claimedAt: null, claimExpiresAt: null, updatedAt,
          }, workspaceId)
          return { outcome: 'terminal' }
        }

        const reason: TransientRetryReason = input.retryReason ?? 'server_failure'
        const fixedDelayMs = descriptor.retryDelayMs?.(row) ?? descriptor.defaults.retryDelaysMs?.[row.attempt - 1]
        if (fixedDelayMs !== undefined) {
          if (row.attempt >= row.maxAttempts) {
            await descriptor.patchById(tx, input.id, {
              status: 'exhausted', failureReason: reason, failureDetail: detail,
              nextEligibleAt: null, acquisitionToken: null, claimedAt: null, claimExpiresAt: null, updatedAt,
            }, workspaceId)
            return { outcome: 'exhausted' }
          }
          const delayMs = Math.max(fixedDelayMs, input.serverMinimumDelayMs ?? 0)
          const nextEligibleAt = new Date(now().getTime() + delayMs).toISOString()
          const nextAttempt = row.attempt + 1
          await descriptor.patchById(tx, input.id, {
            status: 'scheduled', attempt: nextAttempt, nextEligibleAt,
            failureReason: reason, failureDetail: detail, acquisitionToken: null, claimedAt: null, claimExpiresAt: null, updatedAt,
          }, workspaceId)
          return { outcome: 'retry', attempt: nextAttempt, nextEligibleAt }
        }

        const advice = scheduleRetry({
          attempt: row.attempt,
          baseDelayMs: descriptor.defaults.baseDelayMs,
          horizonAt: new Date(now().getTime() + descriptor.defaults.horizonMs).toISOString(),
          maxAttempts: row.maxAttempts,
          maxDelayMs: descriptor.defaults.maxDelayMs,
          reason,
          serverMinimumDelayMs: input.serverMinimumDelayMs,
        }, { nowEpochMs: () => now().getTime(), random })

        if (advice.state === 'scheduled' || advice.state === 'not_due') {
          // scheduleRetry.attempt is the attempt just made; the reschedule advances the
          // stored budget to the NEXT attempt. Exhaustion is decided by advice.state
          // (attempt >= maxAttempts), so the bumped value never exceeds maxAttempts.
          const nextAttempt = advice.attempt + 1
          await descriptor.patchById(tx, input.id, {
            status: 'scheduled', attempt: nextAttempt, nextEligibleAt: advice.nextAttemptAt,
            failureReason: reason, failureDetail: detail, acquisitionToken: null, claimedAt: null, claimExpiresAt: null, updatedAt,
          }, workspaceId)
          return { outcome: 'retry', attempt: nextAttempt, nextEligibleAt: advice.nextAttemptAt }
        }
        await descriptor.patchById(tx, input.id, {
          status: 'exhausted', failureReason: reason, failureDetail: detail,
          nextEligibleAt: null, acquisitionToken: null, claimedAt: null, claimExpiresAt: null, updatedAt,
        }, workspaceId)
        return { outcome: 'exhausted' }
      })
    },

    async recoverClaimed(recoveredAt = now().toISOString()) {
      return descriptor.recoverClaimed(database, {
        status: 'scheduled', acquisitionToken: null, claimedAt: null, claimExpiresAt: null, updatedAt: recoveredAt,
      }, workspaceId)
    },

    async nextDueAt() {
      return descriptor.nextDue(database, workspaceId)
    },
  }
}
