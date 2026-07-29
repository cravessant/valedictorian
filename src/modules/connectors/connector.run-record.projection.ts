/**
 * Connector run record projections (issue #327).
 *
 * Reads a persisted connector run, checkpoint, or observation row and produces the
 * sparxie-shaped or consumer-shaped value a caller may hold. It lives with the
 * capability that owns the row, so no consumer imports a persistence record and no
 * projection depends on the runtime shell it used to sit in.
 */
import { connectorRunSummarySchema, retryAdviceSchema, type ConnectorObservation, type ConnectorRunSummary, type RetryAdvice } from '@sparxie/sdk'
import type {
  ConnectorCheckpointRecord,
  ConnectorObservationRecord,
  ConnectorRunRecord,
  createPgliteConnectorRepository,
} from './connector.repository'
import type { createConnectorScheduleRepository } from './connector-schedule.repository'
import type { LocalConnectorRunSummary } from './connector.consumer-contract'
import { mapConnectorWarnings } from './connector.status'
import { publicConnectorRunLifecycleCounts } from './connector.run-projection'

export function mapConnectorCheckpoint(record: ConnectorCheckpointRecord) {
  return {
    connectorInstanceId: record.connectorInstanceId,
    filterSignature: record.filterSignature,
    checkpoint: record.checkpoint,
    schemaVersion: record.schemaVersion,
    coverage: { start: record.coverageStartedAt, end: record.coverageEndedAt },
  }
}

export function mapConnectorObservation(record: ConnectorObservationRecord): ConnectorObservation {
  return {
    ...record,
    opportunityId: null,
    locationRaw: record.locationRaw ?? null,
    descriptionText: record.descriptionText ?? null,
    pay: record.pay ?? null,
  }
}

export function publicRunStatus(status: string): ConnectorRunSummary['status'] {
  if (status === 'queued' || status === 'running' || status === 'completed'
    || status === 'failed' || status === 'cancelled' || status === 'skipped') return status
  throw new Error(`Invalid persisted connector run status: ${status}`)
}

export function parseConnectorRetryAdvice(value: unknown): RetryAdvice | null {
  return value === null || value === undefined ? null : retryAdviceSchema.parse(value)
}

export function runFrontiers(record: ConnectorRunRecord) {
  const reported = requireReportedSynchronization(record)
  return {
    newestFrontier: reported.newestFrontier,
    historicalBackfill: reported.historicalBackfill,
  }
}

export function runOutcome(record: ConnectorRunRecord): ConnectorRunSummary['outcome'] {
  return requireReportedSynchronization(record).outcome
}

export function pendingResolutionCount(record: ConnectorRunRecord) {
  return requireReportedSynchronization(record).pendingResolutionCount
}

function requireReportedSynchronization(record: ConnectorRunRecord) {
  const reported = reportedSynchronization(record)
  if (!reported) {
    throw new Error(`Missing or invalid persisted connector run synchronization: ${record.id}`)
  }
  return reported
}

function reportedSynchronization(record: ConnectorRunRecord) {
  if (!record.synchronization || typeof record.synchronization !== 'object' || Array.isArray(record.synchronization)) return null
  const value = record.synchronization as Record<string, unknown>
  if (Object.keys(value).sort().join(',') !== 'historicalBackfill,newestFrontier,outcome,pendingResolutionCount') return null
  const outcome = value.outcome as { kind?: unknown } | undefined
  const status = outcome?.kind === 'in_progress' ? 'running'
    : outcome?.kind === 'failed' ? 'failed'
      : outcome?.kind === 'cancelled' ? 'cancelled'
        : outcome?.kind === 'yielded'
          || outcome?.kind === 'cooling_down'
          || outcome?.kind === 'action_required' ? 'skipped' : 'completed'
  const parsed = connectorRunSummarySchema.safeParse({
    id: record.id, connectorInstanceId: record.connectorInstanceId,
    executionScopeId: record.executionScopeId, mode: 'manual', scheduleOccurrence: null,
    status, filterSignature: record.filterSignature, observationCount: record.observationCount,
    warningCount: 0, warnings: [], newestFrontier: value.newestFrontier,
    historicalBackfill: value.historicalBackfill,
    pendingResolutionCount: value.pendingResolutionCount, outcome: value.outcome,
    startedAt: record.startedAt, completedAt: status === 'running' ? null : record.completedAt ?? record.startedAt,
  })
  if (!parsed.success) return null
  return {
    newestFrontier: parsed.data.newestFrontier,
    historicalBackfill: parsed.data.historicalBackfill,
    pendingResolutionCount: parsed.data.pendingResolutionCount,
    outcome: parsed.data.outcome,
  }
}

export function mapConnectorRunSummary(
  record: ConnectorRunRecord,
  scheduleOccurrence: ConnectorRunSummary['scheduleOccurrence'] = null,
): LocalConnectorRunSummary {
  const lifecycleCounts = publicConnectorRunLifecycleCounts(
    record.stats,
    record.id,
    record.executionScopeId,
  )
  const lifecycleSummary = lifecycleCounts ? { lifecycleCounts } : {}
  const shared = {
    id: record.id,
    connectorInstanceId: record.connectorInstanceId,
    executionScopeId: record.executionScopeId,
    status: publicRunStatus(record.status),
    coverage: {
      start: record.coverageStartedAt,
      end: record.coverageEndedAt,
    },
    filterSignature: record.filterSignature,
    observationCount: record.observationCount,
    warningCount: record.warningCount,
    ...runFrontiers(record),
    pendingResolutionCount: pendingResolutionCount(record),
    ...lifecycleSummary,
    outcome: runOutcome(record),
    stats: record.stats,
    warnings: mapConnectorWarnings(record.warnings),
    retryHints: parseConnectorRetryAdvice(record.retryHints),
    startedAt: record.startedAt,
    completedAt: record.completedAt,
  } as const
  if (
    scheduleOccurrence
    && record.mode === 'scheduled'
    && scheduleOccurrence.admittedMode === 'scheduled'
  ) {
    return {
      ...shared,
      mode: 'scheduled',
      scheduleOccurrence,
    }
  }
  if (
    scheduleOccurrence
    && record.mode === 'catch_up'
    && scheduleOccurrence.admittedMode === 'catch_up'
  ) {
    return {
      ...shared,
      mode: 'catch_up',
      scheduleOccurrence,
    }
  }
  return {
    ...shared,
    mode: 'manual',
    scheduleOccurrence: null,
  }
}

/**
 * The run projection the desktop client uses: it completes a run's persisted
 * synchronization on demand and attaches the schedule occurrence that produced it,
 * so a caller never holds the persisted row.
 */
export function createConnectorRunSummaryProjection({
  connectorRepository,
  scheduleRepository,
}: {
  connectorRepository: ReturnType<typeof createPgliteConnectorRepository>
  scheduleRepository: ReturnType<typeof createConnectorScheduleRepository>
}) {
  return async (record: ConnectorRunRecord): Promise<LocalConnectorRunSummary> => {
    const synchronizedRecord = {
      ...record,
      synchronization: record.synchronization
        ?? await connectorRepository.getRunSynchronization(record.id),
    }
    const occurrence = await scheduleRepository.getOccurrenceLinkForRun(record.id)
    if (!occurrence || !occurrence.connectorRunId) {
      return mapConnectorRunSummary(synchronizedRecord)
    }
    return mapConnectorRunSummary(synchronizedRecord, {
      scheduleId: occurrence.scheduleId,
      scheduleRevision: occurrence.scheduleRevision,
      occurrenceId: occurrence.id,
      nominalAt: occurrence.nominalAt,
      admittedMode: occurrence.admittedMode,
      idempotencyKey: occurrence.idempotencyKey,
    })
  }
}
