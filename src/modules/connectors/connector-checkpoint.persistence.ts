import { and, eq, isNull } from 'drizzle-orm'
import { connectorCheckpoints } from '../../db/schema'
import type { DrizzleDatabase } from '../../db/sqlite'
import type { ConnectorCheckpointRecord, RecordConnectorCheckpointInput } from './connector-checkpoint.persistence-types'

export function upsertConnectorCheckpoint(
  database: Pick<DrizzleDatabase, 'insert' | 'select' | 'update'>,
  input: RecordConnectorCheckpointInput,
  now: string,
) {
  const existingCheckpoint = database
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
    .get()
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
    database
      .update(connectorCheckpoints)
      .set(checkpointValues)
      .where(
        and(
          eq(connectorCheckpoints.connectorInstanceId, input.connectorInstanceId),
          eq(connectorCheckpoints.filterSignature, input.filterSignature),
        ),
      )
      .run()
    return
  }

  database
    .insert(connectorCheckpoints)
    .values({
      connectorInstanceId: input.connectorInstanceId,
      filterSignature: input.filterSignature,
      ...checkpointValues,
      createdAt: now,
    })
    .run()
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
