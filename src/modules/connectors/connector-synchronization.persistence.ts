import { and, desc, eq, isNull } from 'drizzle-orm'
import { connectorRuns, connectorRunSynchronizations } from '../../db/schema'
import type { DrizzleDatabase } from '../../db/sqlite'
import type { ConnectorRunRecord } from './connector-run.persistence-types'
import { mapConnectorRun } from './connector-run.persistence'
import { toJsonRecord } from './connector.persistence-json'

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

export function readConnectorRunSynchronization(
  database: DrizzleDatabase,
  connectorRunId: string,
): unknown {
  const row = database.select({ snapshotJson: connectorRunSynchronizations.snapshotJson })
    .from(connectorRunSynchronizations)
    .where(eq(connectorRunSynchronizations.connectorRunId, connectorRunId)).get()
  return row ? JSON.parse(row.snapshotJson) as unknown : null
}

export function writeConnectorRunSynchronization(
  database: Pick<DrizzleDatabase, 'insert'>,
  connectorRunId: string,
  snapshot: unknown,
  now: string,
): void {
  database.insert(connectorRunSynchronizations).values({
    connectorRunId,
    snapshotJson: JSON.stringify(snapshot),
    createdAt: now,
    updatedAt: now,
  }).run()
}

export function latestSynchronizedConnectorRun(
  database: DrizzleDatabase,
  connectorInstanceId: string,
): ConnectorRunRecord | null {
  const row = database.select({
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
    .orderBy(desc(connectorRuns.startedAt), desc(connectorRuns.createdAt))
    .limit(1)
    .get()
  return row ? synchronizedConnectorRun(row.run, row.snapshotJson) : null
}

export function synchronizedConnectorRun(
  row: typeof connectorRuns.$inferSelect,
  snapshotJson: string,
): ConnectorRunRecord {
  return { ...mapConnectorRun(row), synchronization: JSON.parse(snapshotJson) as unknown }
}

export function updateConnectorSynchronizationOutcome(
  database: Pick<DrizzleDatabase, 'select' | 'update'>,
  connectorRunId: string,
  outcome: unknown,
  updatedAt: string,
): void {
  const row = database.select({ snapshotJson: connectorRunSynchronizations.snapshotJson })
    .from(connectorRunSynchronizations)
    .where(eq(connectorRunSynchronizations.connectorRunId, connectorRunId))
    .get()
  if (!row) return
  const snapshot = toJsonRecord(JSON.parse(row.snapshotJson))
  database.update(connectorRunSynchronizations).set({
    snapshotJson: JSON.stringify({ ...snapshot, outcome }),
    updatedAt,
  }).where(eq(connectorRunSynchronizations.connectorRunId, connectorRunId)).run()
}

export function finalizeInProgressConnectorSynchronization(
  database: Pick<DrizzleDatabase, 'select' | 'update'>,
  connectorRunId: string,
  outcome: unknown,
  updatedAt: string,
): void {
  const row = database.select({ snapshotJson: connectorRunSynchronizations.snapshotJson })
    .from(connectorRunSynchronizations)
    .where(eq(connectorRunSynchronizations.connectorRunId, connectorRunId))
    .get()
  if (!row) throw new Error(`Connector run synchronization not found: ${connectorRunId}`)
  const snapshot = toJsonRecord(JSON.parse(row.snapshotJson))
  const current = toJsonRecord(snapshot.outcome)
  if (current.kind !== 'in_progress') return
  database.update(connectorRunSynchronizations).set({
    snapshotJson: JSON.stringify({ ...snapshot, outcome }),
    updatedAt,
  }).where(eq(connectorRunSynchronizations.connectorRunId, connectorRunId)).run()
}
