import { and, eq, isNull } from 'drizzle-orm'
import { connectorCheckpoints, connectorObservations } from '../../../../db/schema.js'
import type { PgliteDatabase } from '../../../../db/pglite.js'
import { mapConnectorCheckpoint, upsertConnectorCheckpoint } from './connector-checkpoint.persistence.js'
import { mapConnectorObservation } from './connector-observation.persistence.js'
import { readConnectorRunSynchronization } from './connector-synchronization.persistence.js'
import type { ConnectorInstanceRecord } from '../../ports/connector-instance.records.js'
import type {
  ConnectorCheckpointRecord,
  GetConnectorCheckpointInput,
  ListConnectorCheckpointsInput,
  RecordConnectorCheckpointInput,
} from '../../ports/connector-checkpoint.records.js'
import type {
  ConnectorObservationRecord,
  ListConnectorObservationsInput,
} from '../../ports/connector-observation.records.js'

type RequireInstance = (connectorInstanceId: string) => Promise<ConnectorInstanceRecord>

export async function readConnectorRunSynchronizationSnapshot(
  database: PgliteDatabase,
  connectorRunId: string,
): Promise<unknown> {
  return readConnectorRunSynchronization(database, connectorRunId)
}

export async function recordConnectorCheckpoint(
  database: PgliteDatabase,
  requireInstance: RequireInstance,
  input: RecordConnectorCheckpointInput,
): Promise<ConnectorCheckpointRecord> {
  await requireInstance(input.connectorInstanceId)
  await upsertConnectorCheckpoint(database, input, new Date().toISOString())
  const checkpoint = await getConnectorCheckpointRecord(database, {
    connectorInstanceId: input.connectorInstanceId,
    filterSignature: input.filterSignature,
  })
  if (!checkpoint) {
    throw new Error(`Connector checkpoint not found after insert: ${input.connectorInstanceId}`)
  }
  return checkpoint
}

export async function getConnectorCheckpointRecord(
  database: PgliteDatabase,
  input: GetConnectorCheckpointInput,
): Promise<ConnectorCheckpointRecord | null> {
  const [row] = await database
    .select()
    .from(connectorCheckpoints)
    .where(
      and(
        eq(connectorCheckpoints.connectorInstanceId, input.connectorInstanceId),
        eq(connectorCheckpoints.filterSignature, input.filterSignature),
        isNull(connectorCheckpoints.deletedAt),
      ),
    )
    .limit(1)
  return row ? mapConnectorCheckpoint(row) : null
}

export async function listConnectorCheckpointRecords(
  database: PgliteDatabase,
  input: ListConnectorCheckpointsInput,
): Promise<ConnectorCheckpointRecord[]> {
  return (await database
    .select()
    .from(connectorCheckpoints)
    .where(
      and(
        eq(connectorCheckpoints.connectorInstanceId, input.connectorInstanceId),
        isNull(connectorCheckpoints.deletedAt),
      ),
    ))
    .map(mapConnectorCheckpoint)
    .filter(
      (checkpoint) =>
        input.filterSignature === undefined ||
        checkpoint.filterSignature === input.filterSignature,
    )
}

export async function listConnectorObservationRecords(
  database: PgliteDatabase,
  input: ListConnectorObservationsInput,
): Promise<ConnectorObservationRecord[]> {
  return (await database
    .select()
    .from(connectorObservations)
    .where(
      and(
        eq(connectorObservations.connectorInstanceId, input.connectorInstanceId),
        isNull(connectorObservations.deletedAt),
      ),
    ))
    .map(mapConnectorObservation)
    .filter(
      (observation) =>
        input.connectorRunId === undefined ||
        observation.connectorRunId === input.connectorRunId,
    )
}

export async function getConnectorObservationRecord(
  database: PgliteDatabase,
  connectorObservationId: string,
): Promise<ConnectorObservationRecord | null> {
  const [row] = await database
    .select()
    .from(connectorObservations)
    .where(
      and(
        eq(connectorObservations.id, connectorObservationId),
        isNull(connectorObservations.deletedAt),
      ),
    )
    .limit(1)
  return row ? mapConnectorObservation(row) : null
}
