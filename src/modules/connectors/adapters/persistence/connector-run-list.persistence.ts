import { and, count, desc, eq, isNull } from 'drizzle-orm'
import { connectorRuns, connectorRunSynchronizations } from '../../../../db/schema'
import type { PgliteDatabase } from '../../../../db/pglite'
import type { ListConnectorRunsInput, ListConnectorRunsResult } from '../../ports/connector-run.records'
import { withConnectorRunLifecycleCounts } from './connector-run.persistence'
import { synchronizedConnectorRun } from './connector-synchronization.persistence'

export function listConnectorRunsSnapshot(
  database: PgliteDatabase,
  input: ListConnectorRunsInput,
): Promise<ListConnectorRunsResult> {
  const limit = input.limit ?? 50
  const offset = input.offset ?? 0
  const where = and(
    eq(connectorRuns.connectorInstanceId, input.connectorInstanceId),
    isNull(connectorRuns.deletedAt),
    input.status === undefined ? undefined : eq(connectorRuns.status, input.status),
    input.mode === undefined ? undefined : eq(connectorRuns.mode, input.mode),
  )
  return database.transaction(async (transaction) => {
    const rows = await transaction.select({
      run: connectorRuns,
      snapshotJson: connectorRunSynchronizations.snapshotJson,
    }).from(connectorRuns).innerJoin(
      connectorRunSynchronizations,
      eq(connectorRunSynchronizations.connectorRunId, connectorRuns.id),
    ).where(where)
      .orderBy(desc(connectorRuns.startedAt), desc(connectorRuns.createdAt), desc(connectorRuns.id))
      .limit(limit)
      .offset(offset)
    const items = await Promise.all(rows
      .map(({ run, snapshotJson }) => synchronizedConnectorRun(run, snapshotJson))
      .map((run) => withConnectorRunLifecycleCounts(transaction, run)))
    const [totalRow] = await transaction.select({ value: count() })
      .from(connectorRuns)
      .innerJoin(
        connectorRunSynchronizations,
        eq(connectorRunSynchronizations.connectorRunId, connectorRuns.id),
      )
      .where(where)
    const total = totalRow?.value ?? 0
    return {
      items,
      total,
      limit,
      offset,
      hasMore: offset + items.length < total,
    }
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
}
