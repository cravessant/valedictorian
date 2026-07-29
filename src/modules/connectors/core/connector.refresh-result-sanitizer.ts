import {
  sanitizeConnectorRefreshStats,
  sanitizeConnectorRefreshWarnings,
  sanitizeConnectorSynchronization,
  type ConnectorRefreshResult,
} from '@sparxie/valedictorian-connectors-core'
import type { ConnectorRefreshResultInput } from '../ports/connector-run.records'

export function sanitizeConnectorRefreshResult(
  value: unknown,
): ConnectorRefreshResultInput {
  const record = isRecord(value) ? value : {}
  return {
    observations: record.observations as ConnectorRefreshResult['observations'],
    nextCheckpoint: record.nextCheckpoint as ConnectorRefreshResult['nextCheckpoint'],
    coverage: record.coverage as ConnectorRefreshResult['coverage'],
    stats: sanitizeConnectorRefreshStats(record.stats),
    warnings: sanitizeConnectorRefreshWarnings(record.warnings),
    status: record.status as ConnectorRefreshResult['status'],
    retryHints: record.retryHints as ConnectorRefreshResult['retryHints'],
    operationOutcome: record.operationOutcome as ConnectorRefreshResult['operationOutcome'],
    synchronization: sanitizeConnectorSynchronization(record.synchronization),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
