import type { PgliteDatabase } from '../../../../db/pglite'
import type { ConnectorRepository } from '../../ports/connector.repository.port'
import type { ConnectorInstanceRecord } from '../../ports/connector-instance.records'
import {
  createConnectorInstanceRecord,
  getConnectorInstanceRecord,
  getConnectorStatusSummaryRecord,
  listConnectorInstanceRecords,
  listConnectorOverviewStatusSummaryRecords,
  listConnectorStatusSummaryRecords,
  upsertConnectorInstanceRecord,
} from './connector-instance.repository'
import { recordConnectorRunRequest } from './connector-run-request.repository'
import {
  claimQueuedConnectorRunToRunning,
  completeConnectorRun,
  getConnectorRunRecord,
  listConnectorRunRecords,
  markConnectorRunFailed,
  recordConnectorRefreshResult,
  recordConnectorRunFailure,
  recordConnectorRunSkipped,
  recoverInterruptedConnectorRunRecords,
  updateConnectorRunProgress,
} from './connector-run.repository'
import {
  getConnectorCheckpointRecord,
  getConnectorObservationRecord,
  listConnectorCheckpointRecords,
  listConnectorObservationRecords,
  readConnectorRunSynchronizationSnapshot,
  recordConnectorCheckpoint,
} from './connector-evidence.repository'

export function createPgliteConnectorRepository(
  database: PgliteDatabase,
): ConnectorRepository {
  const requireInstance = async (
    connectorInstanceId: string,
  ): Promise<ConnectorInstanceRecord> => {
    const instance = await getConnectorInstanceRecord(database, connectorInstanceId)
    if (!instance) {
      throw new Error(`Connector instance not found: ${connectorInstanceId}`)
    }
    return instance
  }

  return {
    async getRunSynchronization(connectorRunId) {
      return readConnectorRunSynchronizationSnapshot(database, connectorRunId)
    },
    async createInstance(input) {
      return createConnectorInstanceRecord(database, input)
    },
    async upsertInstance(input) {
      return upsertConnectorInstanceRecord(database, input)
    },
    async recordRefreshResult(input) {
      return recordConnectorRefreshResult(database, input)
    },
    async recordCheckpoint(input) {
      return recordConnectorCheckpoint(database, requireInstance, input)
    },
    async recordRunRequest(input) {
      return recordConnectorRunRequest(database, input)
    },
    async recordRunFailure(input) {
      return recordConnectorRunFailure(database, requireInstance, input)
    },
    async claimQueuedRunToRunning(input) {
      return claimQueuedConnectorRunToRunning(database, input)
    },
    async markRunRunning(input) {
      const claim = await claimQueuedConnectorRunToRunning(database, input)
      if (!claim.claimed) {
        throw new Error(`Queued connector run not found: ${input.connectorRunId}`)
      }
      return claim.run
    },
    async recoverInterruptedRuns(input) {
      return recoverInterruptedConnectorRunRecords(database, input)
    },
    async updateRunProgress(input) {
      return updateConnectorRunProgress(database, input)
    },
    async completeRun(input) {
      return completeConnectorRun(database, input)
    },
    async recordRunSkipped(input) {
      return recordConnectorRunSkipped(database, requireInstance, input)
    },
    async markRunFailed(input) {
      return markConnectorRunFailed(database, input)
    },
    async getRun(connectorRunId) {
      return getConnectorRunRecord(database, connectorRunId)
    },
    async getInstance(connectorInstanceId) {
      return getConnectorInstanceRecord(database, connectorInstanceId)
    },
    async listInstances() {
      return listConnectorInstanceRecords(database)
    },
    async getStatusSummary(connectorInstanceId) {
      return getConnectorStatusSummaryRecord(database, connectorInstanceId)
    },
    async listStatusSummaries() {
      return listConnectorStatusSummaryRecords(database)
    },
    async listOverviewStatusSummaries(input) {
      return listConnectorOverviewStatusSummaryRecords(database, input)
    },
    async getCheckpoint(input) {
      return getConnectorCheckpointRecord(database, input)
    },
    async listRuns(input) {
      return listConnectorRunRecords(database, input)
    },
    async listCheckpoints(input) {
      return listConnectorCheckpointRecords(database, input)
    },
    async listObservations(input) {
      return listConnectorObservationRecords(database, input)
    },
    async getObservation(connectorObservationId) {
      return getConnectorObservationRecord(database, connectorObservationId)
    },
  }
}
