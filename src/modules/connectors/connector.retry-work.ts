import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { retryAdviceSchema, type RetryAdvice } from 'sparxie'
import { retryWork } from '../../db/schema'
import type { DrizzleDatabase } from '../../db/sqlite'
import type { AcquiredRetryWork, ConnectorCheckpointPayload } from './connector.repository.types'

type RetryWorkRow = typeof retryWork.$inferSelect
type RetryWorkDatabase = Pick<DrizzleDatabase, 'insert' | 'select' | 'update'>

export function parseRetryAdviceJson(value: string): RetryAdvice | null {
  const parsed = JSON.parse(value) as unknown
  if (parsed === null) return null
  return retryAdviceSchema.parse(parsed)
}

export function retryAdviceFromWork(
  work: RetryWorkRow,
  state: 'not_due' | 'exhausted' | 'cancelled',
): RetryAdvice {
  return retryAdviceSchema.parse({
    state,
    reason: work.reason,
    attempt: work.attempt,
    maxAttempts: work.maxAttempts,
    lastAttemptAt: work.lastAttemptAt,
    computedDelayMs: work.computedDelayMs,
    serverMinimumDelayMs: work.serverMinimumDelayMs,
    nextAttemptAt: state === 'not_due' ? work.nextAttemptAt : null,
    horizonAt: work.horizonAt,
  })
}

export function synchronizeConnectorRetryWork(
  database: RetryWorkDatabase,
  input: {
    advice: RetryAdvice | null
    checkpoint: ConnectorCheckpointPayload
    checkpointSchemaVersion: string
    connectorInstanceId: string
    connectorVersion: string
    filterSignature: string
    now: string
    preserveAcquiredNormalizationWork?: boolean
    runId: string
  },
) {
  const acquiredNormalization = database.select().from(retryWork).where(and(
    eq(retryWork.kind, 'normalization'),
    eq(retryWork.state, 'acquired'),
    eq(retryWork.acquisitionRunId, input.runId),
  )).all()
  // Validate Jobright v4 checkpoint shape when present, but never infer
  // normalization completion from provider-id disappearance. Exact acquired
  // rows complete only through normalization persistence.
  currentJobrightRetryProviderRecordIds(input.checkpoint)
  if (!input.preserveAcquiredNormalizationWork) {
    for (const work of acquiredNormalization) {
      database.update(retryWork).set({
        state: 'scheduled',
        nextAttemptAt: work.nextAttemptAt,
        acquiredAt: null,
        acquisitionToken: null,
        acquisitionRunId: null,
        updatedAt: input.now,
      }).where(eq(retryWork.id, work.id)).run()
    }
  }
  const normalizationOwnedAdvice = input.advice && database.select({ id: retryWork.id })
    .from(retryWork)
    .where(and(
      eq(retryWork.kind, 'normalization'),
      eq(retryWork.state, 'scheduled'),
      sql`json_extract(${retryWork.lineageJson}, '$.connectorRunId') = ${input.runId}`,
      isNull(retryWork.deletedAt),
    )).get()
  if (normalizationOwnedAdvice) return
  const generation = input.connectorVersion
  const existing = database.select().from(retryWork).where(and(
    eq(retryWork.kind, 'connector_capture'),
    eq(retryWork.connectorInstanceId, input.connectorInstanceId),
    eq(retryWork.filterSignature, input.filterSignature),
    eq(retryWork.checkpointSchemaVersion, input.checkpointSchemaVersion),
    eq(retryWork.checkpointGeneration, generation),
    isNull(retryWork.deletedAt),
  )).get()

  if (!input.advice) {
    if (existing?.state === 'acquired' && existing.acquisitionRunId === input.runId) {
      database.update(retryWork).set({
        state: 'completed',
        nextAttemptAt: null,
        updatedAt: input.now,
      }).where(eq(retryWork.id, existing.id)).run()
    }
    return
  }

  const advice = retryAdviceSchema.parse(input.advice)
  if (existing?.state === 'exhausted' || existing?.state === 'cancelled') return
  const state = advice.state === 'not_due' ? 'scheduled' : advice.state
  const unchangedRetryWindow = existing?.attempt === advice.attempt
    && existing.nextAttemptAt === advice.nextAttemptAt
  const values = {
    reason: advice.reason,
    attempt: advice.attempt,
    maxAttempts: advice.maxAttempts,
    lastAttemptAt: advice.lastAttemptAt,
    computedDelayMs: advice.computedDelayMs,
    serverMinimumDelayMs: advice.serverMinimumDelayMs ?? null,
    nextAttemptAt: advice.nextAttemptAt,
    horizonAt: advice.horizonAt,
    state,
    ownerVersion: input.connectorVersion,
    lineageJson: JSON.stringify({ connectorRunId: input.runId }),
    acquiredAt: null,
    acquisitionToken: null,
    acquisitionRunId: null,
    skippedRunId: unchangedRetryWindow ? existing.skippedRunId : null,
    updatedAt: input.now,
  } as const

  if (existing) {
    database.update(retryWork).set(values).where(eq(retryWork.id, existing.id)).run()
    return
  }

  database.insert(retryWork).values({
    id: randomUUID(),
    kind: 'connector_capture',
    connectorInstanceId: input.connectorInstanceId,
    filterSignature: input.filterSignature,
    checkpointSchemaVersion: input.checkpointSchemaVersion,
    checkpointGeneration: generation,
    rawRevisionId: null,
    resolverId: null,
    resolverVersion: null,
    inputHash: null,
    ...values,
    createdAt: input.now,
    deletedAt: null,
  }).run()
}

export function assertValidJobrightV4CheckpointRetryState(checkpoint: ConnectorCheckpointPayload) {
  currentJobrightRetryProviderRecordIds(checkpoint)
}

function currentJobrightRetryProviderRecordIds(checkpoint: ConnectorCheckpointPayload): Set<string> | null {
  if (checkpoint.schemaVersion !== 'jobright-resolution-checkpoint@4') return null
  const value = checkpoint.checkpoint
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Jobright v4 checkpoint is malformed')
  }
  const retryState = (value as Record<string, unknown>).retryState
  if (!Array.isArray(retryState)) throw new Error('Jobright v4 checkpoint retry state is malformed')
  const providerRecordIds = retryState.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || typeof (entry as Record<string, unknown>).sourceId !== 'string'
      || !Object.prototype.hasOwnProperty.call(entry, 'advice')) {
      throw new Error('Jobright v4 checkpoint retry entry is malformed')
    }
    const retryEntry = entry as Record<string, unknown>
    const sourceId = retryEntry.sourceId as string
    const prefix = 'jobright.public:'
    const providerRecordId = sourceId.startsWith(prefix) ? sourceId.slice(prefix.length) : ''
    if (!providerRecordId || providerRecordId.trim() !== providerRecordId) {
      throw new Error('Jobright v4 checkpoint retry source identity is malformed')
    }
    const advice = retryAdviceSchema.parse(retryEntry.advice)
    if (advice.state !== 'scheduled' && advice.state !== 'not_due') {
      throw new Error('Jobright v4 checkpoint retry advice is malformed')
    }
    return providerRecordId
  })
  const uniqueProviderRecordIds = new Set(providerRecordIds)
  if (uniqueProviderRecordIds.size !== providerRecordIds.length) {
    throw new Error('Jobright v4 checkpoint retry source identities are duplicated')
  }
  return uniqueProviderRecordIds
}

export function mapAcquiredRetryWork(work: RetryWorkRow): AcquiredRetryWork {
  if (work.kind === 'connector_capture') {
    return {
      kind: 'connector_capture',
      retryWorkId: work.id,
    }
  }
  if (
    work.rawRevisionId === null
    || work.resolverId === null
    || work.resolverVersion === null
    || work.inputHash === null
  ) {
    throw new Error(`Normalization retry work ${work.id} is missing identity fields`)
  }
  return {
    kind: 'normalization',
    retryWorkId: work.id,
    rawRevisionId: work.rawRevisionId,
    resolverId: work.resolverId,
    resolverVersion: work.resolverVersion,
    inputHash: work.inputHash,
    lastAttemptAt: work.lastAttemptAt,
  }
}

export function selectPendingRetryWork(
  database: RetryWorkDatabase & Pick<DrizzleDatabase, 'select'>,
  input: {
    connectorInstanceId: string
    filterSignature: string
    now: string
  },
) {
  const captureRetries = database
    .select()
    .from(retryWork)
    .where(and(
      eq(retryWork.kind, 'connector_capture'),
      eq(retryWork.connectorInstanceId, input.connectorInstanceId),
      eq(retryWork.filterSignature, input.filterSignature),
      inArray(retryWork.state, ['scheduled', 'acquired', 'exhausted', 'cancelled']),
      isNull(retryWork.deletedAt),
    ))
    .orderBy(desc(retryWork.updatedAt))
    .all()
  const normalizationRetries = database
    .select()
    .from(retryWork)
    .where(and(
      eq(retryWork.kind, 'normalization'),
      sql`json_extract(${retryWork.lineageJson}, '$.connectorInstanceId') = ${input.connectorInstanceId}`,
      inArray(retryWork.state, ['scheduled', 'acquired', 'exhausted', 'cancelled']),
      isNull(retryWork.deletedAt),
    ))
    .orderBy(asc(retryWork.nextAttemptAt), asc(retryWork.createdAt))
    .all()
  const retryCandidates = [...captureRetries, ...normalizationRetries]
  return retryCandidates.find((work) => work.state === 'acquired')
    ?? retryCandidates
      .filter((work) => work.state === 'scheduled' && work.nextAttemptAt !== null && Date.parse(input.now) >= Date.parse(work.nextAttemptAt))
      .sort((left, right) => Date.parse(left.nextAttemptAt!) - Date.parse(right.nextAttemptAt!))[0]
    ?? retryCandidates
      .filter((work) => work.state === 'scheduled')
      .sort((left, right) => Date.parse(left.nextAttemptAt!) - Date.parse(right.nextAttemptAt!))[0]
    ?? retryCandidates.find((work) => work.state === 'exhausted' || work.state === 'cancelled')
}
