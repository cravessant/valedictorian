import { connectorRuns } from '../../db/schema'
import type { DrizzleDatabase } from '../../db/sqlite'
import { readConnectorRunLifecycleCounts, reconcileConnectorRunLifecycleCounts } from './connector.lifecycle-counts'
import type { ConnectorRunRecord, ConnectorWarning } from './connector-run.persistence-types'
import { parseRetryAdviceJson } from './connector.retry-work'
import { toJsonRecord } from './connector.persistence-json'

export function readConnectorWarnings(value: string): ConnectorWarning[] {
  const parsed = JSON.parse(value) as unknown

  if (!Array.isArray(parsed)) {
    return []
  }

  return parsed.flatMap((item) => {
    const record = toJsonRecord(item)

    if (typeof record.code !== 'string' || typeof record.message !== 'string') {
      return []
    }

    return [
      {
        code: record.code,
        message: record.message,
      },
    ]
  })
}

export function mapConnectorRun(row: typeof connectorRuns.$inferSelect | undefined): ConnectorRunRecord {
  if (!row) {
    throw new Error('Connector run not found after insert.')
  }

  return {
    id: row.id,
    connectorInstanceId: row.connectorInstanceId,
    mode: row.mode,
    status: row.status,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    coverageStartedAt: row.coverageStartedAt,
    coverageEndedAt: row.coverageEndedAt,
    config: JSON.parse(row.configJson) as unknown,
    filters: JSON.parse(row.filtersJson) as unknown,
    filterSignature: row.filterSignature,
    observationCount: row.observationCount,
    warningCount: row.warningCount,
    stats: JSON.parse(row.statsJson) as unknown,
    warnings: JSON.parse(row.warningsJson) as unknown,
    retryHints: parseRetryAdviceJson(row.retryHintsJson),
  }
}

export function withConnectorRunLifecycleCounts(
  database: DrizzleDatabase,
  run: ConnectorRunRecord,
): ConnectorRunRecord {
  const stats = toJsonRecord(run.stats)
  const lifecycleCounts = readConnectorRunLifecycleCounts(stats, run.id)
    ?? reconcileConnectorRunLifecycleCounts(database, run)
  return {
    ...run,
    stats: { ...stats, lifecycleCounts },
  }
}
