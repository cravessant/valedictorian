import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import { retryAdviceSchema, type RetryAdvice } from 'sparxie'
import {
  connectorCheckpoints,
  retryWork,
} from '../../db/schema'
import type { DrizzleDatabase } from '../../db/sqlite'
import type { AcquiredRetryWork } from './connector-retry-work.identity-types'
import type { ConnectorCheckpointPayload } from './connector-checkpoint.persistence-types'
import {
  JOBRIGHT_AUTHENTICATED_DESTINATION_RESOLVER_ID,
  JOBRIGHT_AUTHENTICATED_DESTINATION_RESOLVER_VERSION,
  JOBRIGHT_CAPTURE_CHECKPOINT_SCHEMA_V1,
  JOBRIGHT_CHECKPOINT_SCHEMA_V5,
  JOBRIGHT_CONNECTOR_ID,
} from './jobright.constants'

type RetryWorkRow = typeof retryWork.$inferSelect
type RetryWorkDatabase = Pick<DrizzleDatabase, 'insert' | 'select' | 'update'>

const JOBRIGHT_PUBLIC_SOURCE_PREFIX = 'jobright.public:'

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
    executionScopeId: string
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
    notProviderUrlWork(),
  )).all()
  // Validate Jobright v5 pending-retry ledger when present, but never infer
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
      notProviderUrlWork(),
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
    executionScopeId: input.executionScopeId,
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
    captureEvidenceVersionId: null,
    resolverId: null,
    resolverVersion: null,
    inputHash: null,
    ...values,
    createdAt: input.now,
    deletedAt: null,
  }).run()
}

export function assertValidJobrightV5CheckpointRetryState(checkpoint: ConnectorCheckpointPayload) {
  currentJobrightRetryProviderRecordIds(checkpoint)
}

function currentJobrightRetryProviderRecordIds(checkpoint: ConnectorCheckpointPayload): Set<string> | null {
  if (checkpoint.schemaVersion !== 'jobright-resolution-checkpoint@5') return null
  const value = checkpoint.checkpoint
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Jobright v5 checkpoint is malformed')
  }
  const pendingDetailRetries = (value as Record<string, unknown>).pendingDetailRetries
  if (!Array.isArray(pendingDetailRetries)) {
    throw new Error('Jobright v5 checkpoint pending retry ledger is malformed')
  }
  const providerRecordIds = pendingDetailRetries.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || typeof (entry as Record<string, unknown>).sourceId !== 'string'
      || !Object.prototype.hasOwnProperty.call(entry, 'advice')
      || !Object.prototype.hasOwnProperty.call(entry, 'ownership')) {
      throw new Error('Jobright v5 checkpoint pending retry entry is malformed')
    }
    const retryEntry = entry as Record<string, unknown>
    const sourceId = retryEntry.sourceId as string
    const prefix = 'jobright.public:'
    const providerRecordId = sourceId.startsWith(prefix) ? sourceId.slice(prefix.length) : ''
    if (!providerRecordId || providerRecordId.trim() !== providerRecordId) {
      throw new Error('Jobright v5 checkpoint pending retry source identity is malformed')
    }
    const advice = retryAdviceSchema.parse(retryEntry.advice)
    if (advice.state !== 'scheduled' && advice.state !== 'not_due') {
      throw new Error('Jobright v5 checkpoint pending retry advice is malformed')
    }
    if (retryEntry.ownership !== 'active' && retryEntry.ownership !== 'suspended') {
      throw new Error('Jobright v5 checkpoint pending retry ownership is malformed')
    }
    return providerRecordId
  })
  const uniqueProviderRecordIds = new Set(providerRecordIds)
  if (uniqueProviderRecordIds.size !== providerRecordIds.length) {
    throw new Error('Jobright v5 checkpoint pending retry source identities are duplicated')
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
    work.captureEvidenceVersionId === null
    || work.resolverId === null
    || work.resolverVersion === null
    || work.inputHash === null
  ) {
    throw new Error(`Normalization retry work ${work.id} is missing identity fields`)
  }
  return {
    kind: 'normalization',
    executionScopeId: work.executionScopeId,
    retryWorkId: work.id,
    rawRevisionId: work.captureEvidenceVersionId,
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
    connectorId: string
    executionScopeId: string
    coverageStartedAt: string
    filterSignature: string
    now: string
    retryKind?: 'connector_capture'
  },
) {
  const activeJobrightProviderIds = input.connectorId === JOBRIGHT_CONNECTOR_ID
    ? selectActiveJobrightProviderIds(database, input)
    : null
  const capturePredicate = (state: 'scheduled' | 'acquired') => and(
    eq(retryWork.kind, 'connector_capture'),
    eq(retryWork.connectorInstanceId, input.connectorInstanceId),
    eq(retryWork.filterSignature, input.filterSignature),
    eq(retryWork.state, state),
    scopeAvailableAt(input.now),
    isNull(retryWork.deletedAt),
  )
  const captureAcquired = database.select().from(retryWork)
    .where(capturePredicate('acquired')).limit(1).all()
  const captureScheduled = database
    .select()
    .from(retryWork)
    .where(capturePredicate('scheduled'))
    .orderBy(asc(retryWork.nextAttemptAt))
    .limit(1)
    .all()
  const normalizationPredicate = (state: 'scheduled' | 'acquired') => and(
    eq(retryWork.kind, 'normalization'),
    eq(retryWork.executionScopeId, input.executionScopeId),
    eq(retryWork.state, state),
    notProviderUrlWork(),
    activeJobrightProviderIds === null ? sql`1 = 1` : or(
      ne(retryWork.resolverId, JOBRIGHT_AUTHENTICATED_DESTINATION_RESOLVER_ID),
      ne(retryWork.resolverVersion, JOBRIGHT_AUTHENTICATED_DESTINATION_RESOLVER_VERSION),
      activeJobrightProviderIds.length === 0
        ? sql`0 = 1`
        : currentJobrightRevision(activeJobrightProviderIds),
    ),
    scopeAvailableAt(input.now),
    isNull(retryWork.deletedAt),
  )
  const normalizationAcquired = input.retryKind === 'connector_capture'
    ? []
    : database.select().from(retryWork)
      .where(normalizationPredicate('acquired')).limit(1).all()
  const normalizationScheduled = input.retryKind === 'connector_capture'
    ? []
    : database
      .select()
      .from(retryWork)
      .where(normalizationPredicate('scheduled'))
      .orderBy(asc(retryWork.nextAttemptAt), asc(retryWork.createdAt))
      .limit(1)
      .all()
  const retryCandidates = [
    ...captureAcquired, ...normalizationAcquired,
    ...captureScheduled, ...normalizationScheduled,
  ]
  return retryCandidates.find((work) => work.state === 'acquired')
    ?? retryCandidates
      .filter((work) => work.state === 'scheduled' && work.nextAttemptAt !== null && Date.parse(input.now) >= Date.parse(work.nextAttemptAt))
      .sort((left, right) => Date.parse(left.nextAttemptAt!) - Date.parse(right.nextAttemptAt!))[0]
    ?? retryCandidates
      .filter((work) => work.state === 'scheduled')
      .sort((left, right) => Date.parse(left.nextAttemptAt!) - Date.parse(right.nextAttemptAt!))[0]
}

function notProviderUrlWork() {
  return sql`coalesce(json_extract(${retryWork.lineageJson}, '$.workKind'), '') <> 'provider_url_resolution'`
}

function scopeAvailableAt(now: string) {
  return sql`exists (
    select 1 from source_execution_scopes scope
    where scope.id = ${retryWork.executionScopeId}
      and scope.status in ('available', 'cooldown')
      and (scope.blocked_until is null or scope.blocked_until <= ${now})
  )`
}

function selectActiveJobrightProviderIds(
  database: RetryWorkDatabase & Pick<DrizzleDatabase, 'select'>,
  input: {
    connectorInstanceId: string
    connectorId: string
    coverageStartedAt: string
    executionScopeId: string
    filterSignature: string
  },
) {
  const authenticatedRetry = database.select({ id: retryWork.id }).from(retryWork).where(and(
    eq(retryWork.kind, 'normalization'),
    eq(retryWork.executionScopeId, input.executionScopeId),
    eq(retryWork.resolverId, JOBRIGHT_AUTHENTICATED_DESTINATION_RESOLVER_ID),
    eq(retryWork.resolverVersion, JOBRIGHT_AUTHENTICATED_DESTINATION_RESOLVER_VERSION),
    inArray(retryWork.state, ['scheduled', 'acquired']),
    notProviderUrlWork(),
    isNull(retryWork.deletedAt),
  )).limit(1).get()
  if (!authenticatedRetry) return null
  const checkpointRow = database
    .select()
    .from(connectorCheckpoints)
    .where(and(
      eq(connectorCheckpoints.connectorInstanceId, input.connectorInstanceId),
      eq(connectorCheckpoints.filterSignature, input.filterSignature),
      isNull(connectorCheckpoints.deletedAt),
    ))
    .get()

  if (!checkpointRow) {
    return []
  }
  if (checkpointRow.schemaVersion === JOBRIGHT_CAPTURE_CHECKPOINT_SCHEMA_V1) {
    return []
  }
  if (checkpointRow.schemaVersion !== JOBRIGHT_CHECKPOINT_SCHEMA_V5) {
    throw new Error('Jobright connector checkpoint must use checkpoint-v5 for exact retry acquisition')
  }

  let checkpoint: Record<string, unknown>
  try {
    const parsed = JSON.parse(checkpointRow.checkpointJson) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('malformed')
    }
    checkpoint = parsed as Record<string, unknown>
  } catch {
    throw new Error('Jobright v5 checkpoint payload is malformed')
  }

  const generationId = checkpoint.generationId
  if (typeof generationId !== 'string' || generationId.trim().length === 0) {
    throw new Error('Jobright v5 checkpoint generation identity is malformed')
  }

  const effectiveCoverageStart = checkpoint.effectiveCoverageStart
  if (typeof effectiveCoverageStart !== 'string' || effectiveCoverageStart.trim().length === 0) {
    throw new Error('Jobright v5 checkpoint effective coverage start is malformed')
  }
  if (effectiveCoverageStart !== input.coverageStartedAt) {
    // Boundary changed; force a full connector cycle to reconcile ownership first.
    return []
  }

  if (!Array.isArray(checkpoint.pendingDetailRetries)) {
    throw new Error('Jobright v5 checkpoint pending retry ledger is malformed')
  }

  const activeProviderRecordIds = checkpoint.pendingDetailRetries.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('Jobright v5 checkpoint pending retry entry is malformed')
    }
    const pending = entry as Record<string, unknown>
    if (typeof pending.sourceId !== 'string') {
      throw new Error('Jobright v5 checkpoint pending retry entry is malformed')
    }
    if (pending.ownership !== 'active' && pending.ownership !== 'suspended') {
      throw new Error('Jobright v5 checkpoint pending retry ownership is malformed')
    }
    if (!pending.sourceId.startsWith(JOBRIGHT_PUBLIC_SOURCE_PREFIX)) {
      throw new Error('Jobright v5 checkpoint pending retry source identity is malformed')
    }
    return pending.ownership === 'active' && pending.generationId === generationId
      ? [pending.sourceId.slice(JOBRIGHT_PUBLIC_SOURCE_PREFIX.length)]
      : []
  })
  if (new Set(activeProviderRecordIds).size !== activeProviderRecordIds.length) {
    throw new Error('Jobright v5 checkpoint pending retry source identities are duplicated')
  }
  return activeProviderRecordIds
}

function currentJobrightRevision(providerRecordIds: string[]) {
  const values = sql.join(providerRecordIds.map((id) => sql`${id}`), sql`, `)
  return sql`exists (
    select 1 from capture_evidence_versions current indexed by idx_capture_evidence_versions_provider_current
    where current.id = ${retryWork.captureEvidenceVersionId}
      and current.provider_record_id in (${values})
      and current.id = (
        select latest.id from capture_evidence_versions latest
        where latest.capture_lineage_id = current.capture_lineage_id
        order by latest.revision desc limit 1
      )
  )`
}
