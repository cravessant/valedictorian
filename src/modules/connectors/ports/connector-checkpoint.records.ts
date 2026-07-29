export interface ConnectorCoverageWindow {
  start: string
  end: string
}

export interface ConnectorCheckpointPayload {
  checkpoint: unknown
  schemaVersion: string
}

export interface RecordConnectorCheckpointInput {
  connectorInstanceId: string
  filterSignature: string
  checkpoint: ConnectorCheckpointPayload
  coverage: ConnectorCoverageWindow
  savedAt: string
}

export interface GetConnectorCheckpointInput {
  connectorInstanceId: string
  filterSignature: string
}

export interface ConnectorCheckpointRecord {
  connectorInstanceId: string
  filterSignature: string
  checkpoint: unknown
  schemaVersion: string
  coverageStartedAt: string | null
  coverageEndedAt: string | null
}

export interface ListConnectorCheckpointsInput {
  connectorInstanceId: string
  filterSignature?: string
}
