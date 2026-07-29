export type * from './connector-instance.records'
export type * from './connector-checkpoint.records'
export type * from './connector-observation.records'
export type * from './connector-run.records'
export type * from './connector-retry-work.records'
export type * from './connector-status.records'
export type * from './connector.overview-page'

import type {
  ConnectorInstanceRecord,
  UpsertConnectorInstanceInput,
} from './connector-instance.records'
import type {
  ConnectorCheckpointRecord,
  GetConnectorCheckpointInput,
  ListConnectorCheckpointsInput,
  RecordConnectorCheckpointInput,
} from './connector-checkpoint.records'
import type {
  ConnectorObservationRecord,
  ListConnectorObservationsInput,
} from './connector-observation.records'
import type {
  CompleteConnectorRunInput,
  ConnectorRunRecord,
  ListConnectorRunsInput,
  ListConnectorRunsResult,
  MarkConnectorRunFailedInput,
  MarkConnectorRunRunningInput,
  RecordConnectorRefreshResultInput,
  RecordConnectorRunFailureInput,
  RecordConnectorRunRequestInput,
  RecordConnectorRunRequestResult,
  RecordConnectorRunSkippedInput,
  RecoverInterruptedConnectorRunsInput,
  UpdateConnectorRunProgressInput,
} from './connector-run.records'
import type { ConnectorStatusSummaryRecord } from './connector-status.records'
import type {
  ConnectorOverviewStatusPage,
  ConnectorOverviewStatusPageInput,
} from './connector.overview-page'

export interface ConnectorRepository {
  getRunSynchronization(connectorRunId: string): Promise<unknown>
  createInstance(input: UpsertConnectorInstanceInput): Promise<ConnectorInstanceRecord>
  upsertInstance(input: UpsertConnectorInstanceInput): Promise<ConnectorInstanceRecord>
  recordRefreshResult(input: RecordConnectorRefreshResultInput): Promise<ConnectorRunRecord>
  recordCheckpoint(input: RecordConnectorCheckpointInput): Promise<ConnectorCheckpointRecord>
  recordRunRequest(input: RecordConnectorRunRequestInput): Promise<RecordConnectorRunRequestResult>
  recordRunFailure(input: RecordConnectorRunFailureInput): Promise<ConnectorRunRecord>
  claimQueuedRunToRunning(
    input: MarkConnectorRunRunningInput,
  ): Promise<{ claimed: boolean; run: ConnectorRunRecord }>
  markRunRunning(input: MarkConnectorRunRunningInput): Promise<ConnectorRunRecord>
  recoverInterruptedRuns(input: RecoverInterruptedConnectorRunsInput): Promise<number>
  updateRunProgress(input: UpdateConnectorRunProgressInput): Promise<ConnectorRunRecord>
  completeRun(input: CompleteConnectorRunInput): Promise<ConnectorRunRecord>
  recordRunSkipped(input: RecordConnectorRunSkippedInput): Promise<ConnectorRunRecord>
  markRunFailed(input: MarkConnectorRunFailedInput): Promise<ConnectorRunRecord>
  getRun(connectorRunId: string): Promise<ConnectorRunRecord | null>
  getInstance(connectorInstanceId: string): Promise<ConnectorInstanceRecord | null>
  listInstances(): Promise<ConnectorInstanceRecord[]>
  getStatusSummary(connectorInstanceId: string): Promise<ConnectorStatusSummaryRecord | null>
  listStatusSummaries(): Promise<ConnectorStatusSummaryRecord[]>
  listOverviewStatusSummaries(
    input: ConnectorOverviewStatusPageInput,
  ): Promise<ConnectorOverviewStatusPage>
  getCheckpoint(input: GetConnectorCheckpointInput): Promise<ConnectorCheckpointRecord | null>
  listRuns(input: ListConnectorRunsInput): Promise<ListConnectorRunsResult>
  listCheckpoints(input: ListConnectorCheckpointsInput): Promise<ConnectorCheckpointRecord[]>
  listObservations(input: ListConnectorObservationsInput): Promise<ConnectorObservationRecord[]>
  getObservation(connectorObservationId: string): Promise<ConnectorObservationRecord | null>
}
