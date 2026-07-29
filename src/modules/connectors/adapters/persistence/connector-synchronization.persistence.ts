import { and, desc, eq, isNull } from 'drizzle-orm'
import { connectorRuns, connectorRunSynchronizations } from '../../../../db/schema'
import type { PgliteDatabase } from '../../../../db/pglite'
import type { ConnectorRunRecord } from '../../ports/connector-run.records'
import { mapConnectorRun } from './connector-run.persistence'
import { toJsonRecord } from '../../ports/connector.json-values'

export function connectorSynchronizationSnapshot(boundary: string, outcome: unknown) {
  return {
    newestFrontier: { state: 'not_started' as const },
    historicalBackfill: {
      state: 'not_started' as const,
      boundary: { earliestDate: boundary },
    },
    pendingResolutionCount: 0,
    outcome,
  }
}

export async function readConnectorRunSynchronization(
  database: PgliteDatabase,
  connectorRunId: string,
): Promise<unknown> {
  const [row] = await database.select({ snapshotJson: connectorRunSynchronizations.snapshotJson })
    .from(connectorRunSynchronizations)
    .where(eq(connectorRunSynchronizations.connectorRunId, connectorRunId)).limit(1)
  return row ? JSON.parse(row.snapshotJson) as unknown : null
}

export async function writeConnectorRunSynchronization(
  database: Pick<PgliteDatabase, 'insert'>,
  connectorRunId: string,
  snapshot: unknown,
  now: string,
): Promise<void> {
  await database.insert(connectorRunSynchronizations).values({
    connectorRunId,
    snapshotJson: JSON.stringify(snapshot),
    createdAt: now,
    updatedAt: now,
  })
}

export async function latestSynchronizedConnectorRun(
  database: PgliteDatabase,
  connectorInstanceId: string,
): Promise<ConnectorRunRecord | null> {
  const [row] = await database.select({
    run: connectorRuns,
    snapshotJson: connectorRunSynchronizations.snapshotJson,
  }).from(connectorRuns)
    .innerJoin(
      connectorRunSynchronizations,
      eq(connectorRunSynchronizations.connectorRunId, connectorRuns.id),
    )
    .where(and(
      eq(connectorRuns.connectorInstanceId, connectorInstanceId),
      isNull(connectorRuns.deletedAt),
    ))
    .orderBy(desc(connectorRuns.startedAt), desc(connectorRuns.createdAt), desc(connectorRuns.id))
    .limit(1)

  return row ? synchronizedConnectorRun(row.run, row.snapshotJson) : null
}

export function synchronizedConnectorRun(
  row: typeof connectorRuns.$inferSelect,
  snapshotJson: string,
): ConnectorRunRecord {
  return { ...mapConnectorRun(row), synchronization: JSON.parse(snapshotJson) as unknown }
}

export async function updateConnectorSynchronizationOutcome(
  database: Pick<PgliteDatabase, 'select' | 'update'>,
  connectorRunId: string,
  outcome: unknown,
  updatedAt: string,
): Promise<void> {
  const [row] = await database.select({ snapshotJson: connectorRunSynchronizations.snapshotJson })
    .from(connectorRunSynchronizations)
    .where(eq(connectorRunSynchronizations.connectorRunId, connectorRunId))
    .limit(1)
  if (!row) return
  const snapshot = toJsonRecord(JSON.parse(row.snapshotJson))
  await database.update(connectorRunSynchronizations).set({
    snapshotJson: JSON.stringify({ ...snapshot, outcome }),
    updatedAt,
  }).where(eq(connectorRunSynchronizations.connectorRunId, connectorRunId))
}

export async function finalizeInProgressConnectorSynchronization(
  database: Pick<PgliteDatabase, 'select' | 'update'>,
  connectorRunId: string,
  outcome: unknown,
  updatedAt: string,
): Promise<void> {
  const [row] = await database.select({ snapshotJson: connectorRunSynchronizations.snapshotJson })
    .from(connectorRunSynchronizations)
    .where(eq(connectorRunSynchronizations.connectorRunId, connectorRunId))
    .limit(1)
  if (!row) throw new Error(`Connector run synchronization not found: ${connectorRunId}`)
  const snapshot = toJsonRecord(JSON.parse(row.snapshotJson))
  const current = toJsonRecord(snapshot.outcome)
  if (current.kind !== 'in_progress') return
  await database.update(connectorRunSynchronizations).set({
    snapshotJson: JSON.stringify({ ...snapshot, outcome }),
    updatedAt,
  }).where(eq(connectorRunSynchronizations.connectorRunId, connectorRunId))
}
