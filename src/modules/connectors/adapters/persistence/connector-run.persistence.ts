import { connectorRuns } from '../../../../db/schema'
import { eq } from 'drizzle-orm'
import type { PgliteDatabase } from '../../../../db/pglite'
import {
  freezeConnectorRunLifecycleCounts,
  readConnectorRunLifecycleCounts,
  reconcileConnectorRunLifecycleCounts,
} from './connector.lifecycle-counts'
import type {
  ConnectorRunRecord,
  ConnectorRunStatus,
  ConnectorWarning,
} from '../../ports/connector-run.records'
import { parseRetryAdviceJson } from './connector.retry-work'
import { toJsonRecord } from '../../ports/connector.json-values'

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
    executionScopeId: row.executionScopeId ?? (() => { throw new Error('Connector run is missing execution scope identity') })(),
    connectorInstanceId: row.connectorInstanceId,
    mode: row.mode,
    status: persistedConnectorRunStatus(row.status),
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

const connectorRunStatuses = new Set<ConnectorRunStatus>([
  'cancelled', 'completed', 'failed', 'queued', 'running', 'skipped',
])

function persistedConnectorRunStatus(value: string): ConnectorRunStatus {
  if (!connectorRunStatuses.has(value as ConnectorRunStatus)) {
    throw new Error(`Invalid persisted connector run status: ${value}`)
  }
  return value as ConnectorRunStatus
}

export async function withConnectorRunLifecycleCounts(
  database: Pick<PgliteDatabase, 'select'>,
  run: ConnectorRunRecord,
): Promise<ConnectorRunRecord> {
  const stats = toJsonRecord(run.stats)
  const persisted = readConnectorRunLifecycleCounts(stats, run.id)
  if (persisted) {
    return { ...run, stats: { ...stats, lifecycleCounts: persisted } }
  }
  if (run.status !== 'queued' && run.status !== 'running') return run
  return {
    ...run,
    stats: {
      ...stats,
      lifecycleCounts: await reconcileConnectorRunLifecycleCounts(database, run),
    },
  }
}

export async function persistFrozenConnectorRunLifecycleCounts(
  database: Pick<PgliteDatabase, 'select' | 'update'>,
  connectorRunId: string,
  updatedAt: string,
): Promise<ConnectorRunRecord> {
  const [row] = await database.select().from(connectorRuns)
    .where(eq(connectorRuns.id, connectorRunId)).limit(1)
  const run = mapConnectorRun(row)
  const stats = toJsonRecord(run.stats)
  await database.update(connectorRuns).set({
    statsJson: JSON.stringify({
      ...stats,
      lifecycleCounts: await freezeConnectorRunLifecycleCounts(database, run),
    }),
    updatedAt,
  }).where(eq(connectorRuns.id, connectorRunId))
  const [persisted] = await database.select().from(connectorRuns)
    .where(eq(connectorRuns.id, connectorRunId)).limit(1)
  return mapConnectorRun(persisted)
}
