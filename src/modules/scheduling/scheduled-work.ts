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
 * Runtime adoption note: the LIVE provider-URL / normalization / connector-capture
 * writers still run on the legacy `retry_work` table because the legacy intake pipeline
 * does not create `lifecycle_captures` (moving them now would FK-fail or force the
 * umbrella-forbidden dual-write of captures). Repointing those live writers onto this
 * engine belongs to #304's read-path surface; #303 delivers the engine + proves it at
 * the canonical seam (including provider_url_resolution_work) and keeps #233 green.
 */
import { scheduleRetry } from '@sparxie/valedictorian-connectors-core'
import type { TransientRetryReason } from 'sparxie'
import { and, asc, eq, isNotNull, lte } from 'drizzle-orm'
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import type { PgliteDatabase } from '../../db/pglite'
import { SENSITIVE_KEY_SUBSTRINGS } from '../../db/sensitive-keys'
import {
  connectorCaptureWork,
  hostedResultPollingWork,
  hostedSubmissionWork,
  normalizationWork,
  providerUrlResolutionWork,
  scheduledWorkDeterministicReasons,
  scheduledWorkRetryableReasons,
} from './scheduling.schema'

export const scheduledOperations = [
  'connector_capture',
  'normalization',
  'provider_url_resolution',
  'hosted_submission',
  'hosted_result_polling',
] as const
export type ScheduledOperation = (typeof scheduledOperations)[number]

export type ScheduledWorkRetryableReason = (typeof scheduledWorkRetryableReasons)[number]
export type ScheduledWorkDeterministicReason = (typeof scheduledWorkDeterministicReasons)[number]

const FAILURE_DETAIL_MAX = 2_000
const FORBIDDEN_KEY_REGEX = new RegExp(`"[^"]*(?:${SENSITIVE_KEY_SUBSTRINGS})[^"]*"[\\t\\n\\r ]*:`, 'i')

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
}

/** A scheduled operation with all Drizzle table ops bound to its concrete table. */
export interface ScheduledOperationDescriptor<Subject, Claim> {
  readonly operation: ScheduledOperation
  readonly defaults: OperationDefaults
  insertIfAbsent(exec: ScheduledExecutor, common: CommonInsert, subject: Subject): Promise<boolean>
  claimDueCandidate(exec: ScheduledExecutor, dueAt: string): Promise<ScheduledRow<Claim> | null>
  lockClaimed(exec: ScheduledExecutor, id: string, token: string): Promise<ScheduledRow<Claim> | null>
  patchById(exec: ScheduledExecutor, id: string, patch: CommonPatch): Promise<void>
  claimScheduled(exec: ScheduledExecutor, id: string, patch: CommonPatch): Promise<boolean>
  completeClaim(exec: ScheduledExecutor, id: string, token: string, patch: CommonPatch): Promise<boolean>
  recoverClaimed(exec: ScheduledExecutor, patch: CommonPatch): Promise<number>
  nextDue(exec: ScheduledExecutor): Promise<string | null>
}

const DEFAULTS: OperationDefaults = { maxAttempts: 3, baseDelayMs: 30_000, maxDelayMs: 30 * 60_000, horizonMs: 24 * 60 * 60_000 }

function defineOperation<TTable extends PgTable, Subject, Claim>(
  operation: ScheduledOperation,
  table: TTable,
  columns: { id: PgColumn; status: PgColumn; nextEligibleAt: PgColumn; createdAt: PgColumn; acquisitionToken: PgColumn },
  subjectValues: (subject: Subject) => Partial<InferInsertModel<TTable>>,
  readSubject: (row: InferSelectModel<TTable>) => Claim,
  defaults: OperationDefaults = DEFAULTS,
): ScheduledOperationDescriptor<Subject, Claim> {
  const normalize = (row: InferSelectModel<TTable>): ScheduledRow<Claim> => {
    const r = row as InferSelectModel<TTable> & {
      id: string; attempt: number; maxAttempts: number; ownerVersion: string; status: string; acquisitionToken: string | null; nextEligibleAt: string | null
    }
    return {
      id: r.id, attempt: r.attempt, maxAttempts: r.maxAttempts, ownerVersion: r.ownerVersion,
      status: r.status, acquisitionToken: r.acquisitionToken, nextEligibleAt: r.nextEligibleAt,
      subject: readSubject(row),
    }
  }
  return {
    operation,
    defaults,
    async insertIfAbsent(exec, common, subject) {
      const values = { ...common, ...subjectValues(subject) } as InferInsertModel<TTable>
      const inserted = await exec.insert(table).values(values).onConflictDoNothing().returning({ id: columns.id })
      return inserted.length > 0
    },
    async claimDueCandidate(exec, dueAt) {
      const [row] = await exec.select().from(table as PgTable)
        .where(and(eq(columns.status, 'scheduled'), isNotNull(columns.nextEligibleAt), lte(columns.nextEligibleAt, dueAt)))
        .orderBy(asc(columns.nextEligibleAt), asc(columns.createdAt), asc(columns.id))
        .limit(1)
        .for('update', { skipLocked: true })
      return row ? normalize(row as InferSelectModel<TTable>) : null
    },
    async lockClaimed(exec, id, token) {
      const [row] = await exec.select().from(table as PgTable)
        .where(and(eq(columns.id, id), eq(columns.status, 'claimed'), eq(columns.acquisitionToken, token)))
        .limit(1)
        .for('update')
      return row ? normalize(row as InferSelectModel<TTable>) : null
    },
    async patchById(exec, id, patch) {
      await exec.update(table).set(patch as Partial<InferInsertModel<TTable>>).where(eq(columns.id, id))
    },
    async claimScheduled(exec, id, patch) {
      const updated = await exec.update(table).set(patch as Partial<InferInsertModel<TTable>>)
        .where(and(eq(columns.id, id), eq(columns.status, 'scheduled')))
        .returning({ id: columns.id })
      return updated.length > 0
    },
    async completeClaim(exec, id, token, patch) {
      const updated = await exec.update(table).set(patch as Partial<InferInsertModel<TTable>>)
        .where(and(eq(columns.id, id), eq(columns.status, 'claimed'), eq(columns.acquisitionToken, token)))
        .returning({ id: columns.id })
      return updated.length > 0
    },
    async recoverClaimed(exec, patch) {
      const recovered = await exec.update(table).set(patch as Partial<InferInsertModel<TTable>>)
        .where(eq(columns.status, 'claimed'))
        .returning({ id: columns.id })
      return recovered.length
    },
    async nextDue(exec) {
      const [row] = await exec.select({ nextEligibleAt: columns.nextEligibleAt }).from(table as PgTable)
        .where(and(eq(columns.status, 'scheduled'), isNotNull(columns.nextEligibleAt)))
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
export const providerUrlResolutionOperation = defineOperation<typeof providerUrlResolutionWork, ProviderUrlResolutionSubject, ProviderUrlResolutionSubject>(
  'provider_url_resolution',
  providerUrlResolutionWork,
  { id: providerUrlResolutionWork.id, status: providerUrlResolutionWork.status, nextEligibleAt: providerUrlResolutionWork.nextEligibleAt, createdAt: providerUrlResolutionWork.createdAt, acquisitionToken: providerUrlResolutionWork.acquisitionToken },
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
  { id: normalizationWork.id, status: normalizationWork.status, nextEligibleAt: normalizationWork.nextEligibleAt, createdAt: normalizationWork.createdAt, acquisitionToken: normalizationWork.acquisitionToken },
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
  { id: connectorCaptureWork.id, status: connectorCaptureWork.status, nextEligibleAt: connectorCaptureWork.nextEligibleAt, createdAt: connectorCaptureWork.createdAt, acquisitionToken: connectorCaptureWork.acquisitionToken },
  (s) => ({ connectorInstanceId: s.connectorInstanceId, filterSignature: s.filterSignature, checkpointSchemaVersion: s.checkpointSchemaVersion, checkpointGeneration: s.checkpointGeneration }),
  (row) => ({ connectorInstanceId: row.connectorInstanceId, filterSignature: row.filterSignature, checkpointSchemaVersion: row.checkpointSchemaVersion, checkpointGeneration: row.checkpointGeneration }),
)

export interface HostedSubmissionSubject {
  readonly captureId: string
  readonly canonicalUrlHash: string
}
export const hostedSubmissionOperation = defineOperation<typeof hostedSubmissionWork, HostedSubmissionSubject, HostedSubmissionSubject>(
  'hosted_submission',
  hostedSubmissionWork,
  { id: hostedSubmissionWork.id, status: hostedSubmissionWork.status, nextEligibleAt: hostedSubmissionWork.nextEligibleAt, createdAt: hostedSubmissionWork.createdAt, acquisitionToken: hostedSubmissionWork.acquisitionToken },
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
  { id: hostedResultPollingWork.id, status: hostedResultPollingWork.status, nextEligibleAt: hostedResultPollingWork.nextEligibleAt, createdAt: hostedResultPollingWork.createdAt, acquisitionToken: hostedResultPollingWork.acquisitionToken },
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
}

export interface ScheduledWorkRepository<Subject, Claim> {
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
  return FORBIDDEN_KEY_REGEX.test(bounded) ? null : bounded
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

  return {
    async enqueue(input) {
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
        const candidate = await descriptor.claimDueCandidate(tx, dueAt)
        if (!candidate) return null
        const token = newId()
        const claimedAt = now().toISOString()
        const claimExpiresAt = new Date(now().getTime() + leaseMs).toISOString()
        const claimed = await descriptor.claimScheduled(tx, candidate.id, {
          status: 'claimed', acquisitionToken: token, claimedAt, claimExpiresAt, updatedAt: claimedAt,
        })
        if (!claimed) return null
        return {
          id: candidate.id,
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
      })
    },

    async fail(input) {
      return database.transaction(async (tx): Promise<FailScheduledWorkOutcome> => {
        const row = await descriptor.lockClaimed(tx, input.id, input.token)
        if (!row) return { outcome: 'not_owner' }
        const updatedAt = now().toISOString()
        const detail = sanitizeDetail(input.detail)

        if (input.deterministicReason) {
          await descriptor.patchById(tx, input.id, {
            status: 'terminal', failureReason: input.deterministicReason, failureDetail: detail,
            nextEligibleAt: null, acquisitionToken: null, claimedAt: null, claimExpiresAt: null, updatedAt,
          })
          return { outcome: 'terminal' }
        }

        const reason: TransientRetryReason = input.retryReason ?? 'server_failure'
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
          })
          return { outcome: 'retry', attempt: nextAttempt, nextEligibleAt: advice.nextAttemptAt }
        }
        await descriptor.patchById(tx, input.id, {
          status: 'exhausted', failureReason: reason, failureDetail: detail,
          nextEligibleAt: null, acquisitionToken: null, claimedAt: null, claimExpiresAt: null, updatedAt,
        })
        return { outcome: 'exhausted' }
      })
    },

    async recoverClaimed(recoveredAt = now().toISOString()) {
      return descriptor.recoverClaimed(database, {
        status: 'scheduled', acquisitionToken: null, claimedAt: null, claimExpiresAt: null, updatedAt: recoveredAt,
      })
    },

    async nextDueAt() {
      return descriptor.nextDue(database)
    },
  }
}
