import { and, eq, isNull } from 'drizzle-orm'
import { connectorCheckpoints } from '../../../../db/schema.js'
import type { PgliteDatabase } from '../../../../db/pglite.js'
import type { ConnectorCheckpointRecord, RecordConnectorCheckpointInput } from '../../ports/connector-checkpoint.records.js'

export async function upsertConnectorCheckpoint(
  database: Pick<PgliteDatabase, 'insert' | 'select' | 'update'>,
  input: RecordConnectorCheckpointInput,
  now: string,
) {
  const [existingCheckpoint] = await database
    .select({
      connectorInstanceId: connectorCheckpoints.connectorInstanceId,
      filterSignature: connectorCheckpoints.filterSignature,
    })
    .from(connectorCheckpoints)
    .where(
      and(
        eq(connectorCheckpoints.connectorInstanceId, input.connectorInstanceId),
        eq(connectorCheckpoints.filterSignature, input.filterSignature),
        isNull(connectorCheckpoints.deletedAt),
      ),
    )
    .limit(1)
  const checkpointValues = {
    checkpointJson: JSON.stringify(input.checkpoint.checkpoint),
    schemaVersion: input.checkpoint.schemaVersion,
    coverageStartedAt: input.coverage.start,
    coverageEndedAt: input.coverage.end,
    savedAt: input.savedAt,
    updatedAt: now,
    deletedAt: null,
  }

  if (existingCheckpoint) {
    await database
      .update(connectorCheckpoints)
      .set(checkpointValues)
      .where(
        and(
          eq(connectorCheckpoints.connectorInstanceId, input.connectorInstanceId),
          eq(connectorCheckpoints.filterSignature, input.filterSignature),
        ),
      )
    return
  }

  await database
    .insert(connectorCheckpoints)
    .values({
      connectorInstanceId: input.connectorInstanceId,
      filterSignature: input.filterSignature,
      ...checkpointValues,
      createdAt: now,
    })
}


export function mapConnectorCheckpoint(
  row: typeof connectorCheckpoints.$inferSelect,
): ConnectorCheckpointRecord {
  return {
    connectorInstanceId: row.connectorInstanceId,
    filterSignature: row.filterSignature,
    checkpoint: JSON.parse(row.checkpointJson) as unknown,
    schemaVersion: row.schemaVersion,
    coverageStartedAt: row.coverageStartedAt,
    coverageEndedAt: row.coverageEndedAt,
  }
}
