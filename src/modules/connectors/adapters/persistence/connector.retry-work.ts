import { createHash, randomUUID } from 'node:crypto'
import { and, asc, eq, sql } from 'drizzle-orm'
import { retryAdviceSchema, type RetryAdvice } from '@sparxie/sdk'
import { connectorCaptureWork } from './connector.schema'
import { DEFAULT_WORKSPACE_ID } from '../../../../db/workspaces.schema'
import type { PgliteDatabase } from '../../../../db/pglite'
import type { AcquiredRetryWork } from '../../ports/connector-retry-work.records'
import type { ConnectorCheckpointPayload } from '../../ports/connector-checkpoint.records'

export type ConnectorCaptureWorkRow = typeof connectorCaptureWork.$inferSelect
type RetryWorkDatabase = Pick<PgliteDatabase, 'insert' | 'select' | 'update'>

export function parseRetryAdviceJson(value: string): RetryAdvice | null {
  const parsed = JSON.parse(value) as unknown
  return parsed === null ? null : retryAdviceSchema.parse(parsed)
}

export function retryAdviceFromWork(
  work: ConnectorCaptureWorkRow,
  state: 'not_due' | 'exhausted' | 'cancelled',
): RetryAdvice {
  if (!work.failureReason) throw new Error(`Connector capture work ${work.id} has no retry reason`)
  return retryAdviceSchema.parse({
    state,
    reason: work.failureReason,
    attempt: work.attempt,
    maxAttempts: work.maxAttempts,
    lastAttemptAt: work.lastAttemptAt,
    computedDelayMs: work.computedDelayMs,
    serverMinimumDelayMs: work.serverMinimumDelayMs,
    nextAttemptAt: state === 'not_due' ? work.nextEligibleAt : null,
    horizonAt: work.horizonAt,
  })
}

export async function synchronizeConnectorRetryWork(
  database: RetryWorkDatabase,
  input: {
    advice: RetryAdvice | null
    checkpoint: ConnectorCheckpointPayload
    checkpointSchemaVersion: string
    connectorInstanceId: string
    connectorVersion: string
    executionScopeId: string
    filterSignature: string
    now: string
    runId: string
  },
) {
  assertValidJobrightV5CheckpointRetryState(input.checkpoint)
  const [existing] = await database.select().from(connectorCaptureWork).where(and(
    eq(connectorCaptureWork.connectorInstanceId, input.connectorInstanceId),
    eq(connectorCaptureWork.filterSignature, input.filterSignature),
    sql`${connectorCaptureWork.status} in ('scheduled','claimed')`,
  )).limit(1)

  if (!input.advice) {
    if (existing?.status === 'claimed' && existing.acquisitionRunId === input.runId) {
      await database.update(connectorCaptureWork).set({
        status: 'completed', nextEligibleAt: null, acquisitionToken: null,
        claimedAt: null, claimExpiresAt: null, updatedAt: input.now,
      }).where(eq(connectorCaptureWork.id, existing.id))
    }
    return
  }

  const advice = retryAdviceSchema.parse(input.advice)
  const status = advice.state === 'not_due' ? 'scheduled' : advice.state
  const unchangedWindow = existing?.attempt === advice.attempt
    && existing.nextEligibleAt === advice.nextAttemptAt
  const values = {
    checkpointSchemaVersion: input.checkpointSchemaVersion,
    checkpointGeneration: input.connectorVersion,
    attempt: advice.attempt,
    maxAttempts: advice.maxAttempts,
    status,
    nextEligibleAt: advice.nextAttemptAt,
    failureReason: advice.reason,
    lastAttemptAt: advice.lastAttemptAt,
    computedDelayMs: advice.computedDelayMs,
    serverMinimumDelayMs: advice.serverMinimumDelayMs ?? null,
    horizonAt: advice.horizonAt,
    ownerVersion: input.connectorVersion,
    acquisitionToken: null,
    claimedAt: null,
    claimExpiresAt: null,
    acquisitionRunId: null,
    skippedRunId: unchangedWindow ? existing?.skippedRunId ?? null : null,
    updatedAt: input.now,
  } as const

  if (existing) {
    await database.update(connectorCaptureWork).set(values).where(eq(connectorCaptureWork.id, existing.id))
    return
  }
  await database.insert(connectorCaptureWork).values({
    id: randomUUID(),
    workspaceId: DEFAULT_WORKSPACE_ID,
    idempotencyKey: workIdempotencyKey(input.connectorInstanceId, input.filterSignature),
    connectorInstanceId: input.connectorInstanceId,
    filterSignature: input.filterSignature,
    ...values,
    createdAt: input.now,
  }).onConflictDoNothing()
}

export function assertValidJobrightV5CheckpointRetryState(checkpoint: ConnectorCheckpointPayload) {
  if (checkpoint.schemaVersion !== 'jobright-resolution-checkpoint@5') return
  const value = checkpoint.checkpoint
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Jobright v5 checkpoint is malformed')
  }
  const pending = (value as Record<string, unknown>).pendingDetailRetries
  if (!Array.isArray(pending)) throw new Error('Jobright v5 checkpoint pending retry ledger is malformed')
  const ids = pending.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('Jobright v5 checkpoint pending retry entry is malformed')
    }
    const record = entry as Record<string, unknown>
    if (typeof record.sourceId !== 'string' || !record.sourceId.startsWith('jobright.public:')) {
      throw new Error('Jobright v5 checkpoint pending retry source identity is malformed')
    }
    const id = record.sourceId.slice('jobright.public:'.length)
    if (!id || id.trim() !== id) throw new Error('Jobright v5 checkpoint pending retry source identity is malformed')
    const advice = retryAdviceSchema.parse(record.advice)
    if (advice.state !== 'scheduled' && advice.state !== 'not_due') {
      throw new Error('Jobright v5 checkpoint pending retry advice is malformed')
    }
    if (record.ownership !== 'active' && record.ownership !== 'suspended') {
      throw new Error('Jobright v5 checkpoint pending retry ownership is malformed')
    }
    return id
  })
  if (new Set(ids).size !== ids.length) {
    throw new Error('Jobright v5 checkpoint pending retry source identities are duplicated')
  }
}

export function mapAcquiredRetryWork(work: ConnectorCaptureWorkRow): AcquiredRetryWork {
  return { kind: 'connector_capture', retryWorkId: work.id }
}

/**
 * Puts a tentatively claimed row back exactly as it was read, for a claim the caller
 * decided not to keep. Restoring every field the claim wrote, including `updatedAt`,
 * leaves the row as untouched as a claim predicate that had matched nothing. The
 * conditions scope the restore to this run's own claim.
 */
export async function restoreUnclaimedConnectorWork(
  database: RetryWorkDatabase,
  work: ConnectorCaptureWorkRow,
  acquisitionRunId: string,
) {
  await database.update(connectorCaptureWork).set({
    status: work.status,
    acquisitionToken: work.acquisitionToken,
    acquisitionRunId: work.acquisitionRunId,
    claimedAt: work.claimedAt,
    claimExpiresAt: work.claimExpiresAt,
    skippedRunId: work.skippedRunId,
    updatedAt: work.updatedAt,
  }).where(and(
    eq(connectorCaptureWork.id, work.id),
    eq(connectorCaptureWork.status, 'claimed'),
    eq(connectorCaptureWork.acquisitionRunId, acquisitionRunId),
  ))
}

/**
 * Selects the retry work an admitted execution scope may run.
 *
 * The caller admits the scope first, and that admission holds the scope row for the
 * rest of the transaction, so selection reads connector state only.
 */
export async function selectPendingRetryWork(
  database: RetryWorkDatabase,
  input: {
    connectorInstanceId: string
    filterSignature: string
  },
) {
  const claimed = await database.select().from(connectorCaptureWork).where(and(
    eq(connectorCaptureWork.connectorInstanceId, input.connectorInstanceId),
    eq(connectorCaptureWork.filterSignature, input.filterSignature),
    eq(connectorCaptureWork.status, 'claimed'),
  )).orderBy(asc(connectorCaptureWork.id)).limit(1)
  if (claimed[0]) return claimed[0]
  const scheduled = await database.select().from(connectorCaptureWork).where(and(
    eq(connectorCaptureWork.connectorInstanceId, input.connectorInstanceId),
    eq(connectorCaptureWork.filterSignature, input.filterSignature),
    eq(connectorCaptureWork.status, 'scheduled'),
  )).orderBy(asc(connectorCaptureWork.nextEligibleAt), asc(connectorCaptureWork.createdAt), asc(connectorCaptureWork.id)).limit(1)
  return scheduled[0]
}

function workIdempotencyKey(connectorInstanceId: string, filterSignature: string) {
  return `connector-capture:${createHash('sha256').update(`${connectorInstanceId}\0${filterSignature}`).digest('hex')}`
}
