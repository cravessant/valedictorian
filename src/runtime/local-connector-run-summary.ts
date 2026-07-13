import { connectorRunSummarySchema, retryAdviceSchema, type ConnectorObservation, type ConnectorRunSummary, type RetryAdvice } from 'sparxie'
import type { ConnectorCheckpointRecord, ConnectorObservationRecord, ConnectorRunRecord } from '../modules/connectors/connector.repository'

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
  return { ...record, locationRaw: record.locationRaw ?? null, descriptionText: record.descriptionText ?? null, pay: record.pay ?? null }
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
  const reported = reportedSynchronization(record)
  return reported ? {
    newestFrontier: reported.newestFrontier,
    historicalBackfill: reported.historicalBackfill,
  } : {
    newestFrontier: { state: 'not_started' as const },
    historicalBackfill: { state: 'not_started' as const, boundary: { earliestDate: runBoundary(record) } },
  }
}

export function runOutcome(record: ConnectorRunRecord): ConnectorRunSummary['outcome'] {
  const reported = reportedSynchronization(record)
  if (reported) return reported.outcome
  if (record.status === 'queued' || record.status === 'running') return { kind: 'in_progress' }
  if (record.status === 'failed') return { kind: 'failed', reason: 'connector_run_failed' }
  if (record.status === 'cancelled') return { kind: 'cancelled', reason: 'connector_run_cancelled' }
  if (record.status === 'skipped') {
    const retry = parseConnectorRetryAdvice(record.retryHints)
    if (retry?.reason === 'rate_limit' && retry.nextAttemptAt) {
      return {
        kind: 'cooling_down',
        operation: {
          kind: 'scope_rate_limited',
          executionScopeId: record.executionScopeId,
          retryAt: retry.nextAttemptAt,
          serverMinimumDelayMs: retry.serverMinimumDelayMs ?? null,
        },
      }
    }
    return { kind: 'yielded', reason: 'operation_timeout' }
  }
  if (record.status === 'completed' && record.warningCount > 0) {
    return { kind: 'yielded', reason: 'operation_timeout' }
  }
  if (record.status === 'completed' && record.retryHints) return { kind: 'yielded', reason: 'invocation_budget' }
  return { kind: 'yielded', reason: 'invocation_budget' }
}

export function pendingResolutionCount(record: ConnectorRunRecord) {
  return reportedSynchronization(record)?.pendingResolutionCount ?? 0
}

function reportedSynchronization(record: ConnectorRunRecord) {
  if (!record.synchronization || typeof record.synchronization !== 'object' || Array.isArray(record.synchronization)) return null
  const value = record.synchronization as Record<string, unknown>
  if (Object.keys(value).sort().join(',') !== 'historicalBackfill,newestFrontier,outcome,pendingResolutionCount') return null
  const outcome = value.outcome as { kind?: unknown } | undefined
  const status = outcome?.kind === 'in_progress' ? 'running'
    : outcome?.kind === 'failed' ? 'failed'
      : outcome?.kind === 'cancelled' ? 'cancelled' : 'completed'
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

function runBoundary(record: ConnectorRunRecord) {
  return (record.coverageStartedAt ?? record.startedAt).slice(0, 10)
}
