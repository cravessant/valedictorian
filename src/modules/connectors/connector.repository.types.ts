export type JsonRecord = Record<string, unknown>

export interface ConnectorCoverageWindow {
  start: string
  end: string
}

export interface ConnectorWarning {
  code: string
  message: string
}

export interface ConnectorCheckpointPayload {
  checkpoint: unknown
  schemaVersion: string
}

export type ConnectorRunStatus =
  | 'cancelled'
  | 'completed'
  | 'failed'
  | 'partial_success'
  | 'queued'
  | 'running'
  | 'skipped'

export type ConnectorRunTerminalStatus = Exclude<ConnectorRunStatus, 'queued' | 'running'>

export type ConnectorAuthMode =
  | 'none'
  | 'api_key'
  | 'bearer_token'
  | 'oauth'
  | 'cookie_jar'
  | 'browser_session'
  | 'username_password'

export interface ConnectorAuthReference {
  id: string
  mode: ConnectorAuthMode
  label?: string
  secretKey?: string
  sessionKey?: string
}

export interface ConnectorObservationLinks {
  source: string | null
  intermediary: string | null
  official: string | null
}

export interface ConnectorObservationResolution {
  status: string
  method: string | null
  reason: string | null
}

export interface ConnectorObservationEvidence {
  type: string
  capturedAt: string
  sourceUrl: string | null
}

export interface ConnectorObservationInput {
  connectorId: string
  connectorVersion: string
  parserVersion?: string | null
  observationSchemaVersion?: string | null
  sourceRecordKey: string
  observedAt: string
  companyName: string
  roleTitle: string
  locationRaw?: string | null
  descriptionText?: string | null
  pay?: unknown
  links: ConnectorObservationLinks
  resolution: ConnectorObservationResolution
  dedupeKeys: string[]
  sourceMetadata?: JsonRecord
  evidence: ConnectorObservationEvidence[]
}

export interface ConnectorRefreshResultInput {
  observations: ConnectorObservationInput[]
  nextCheckpoint: ConnectorCheckpointPayload
  coverage: ConnectorCoverageWindow
  stats: JsonRecord & { observations: number }
  warnings: ConnectorWarning[]
  status?: ConnectorRunStatus
  retryHints?: unknown
}

export interface UpsertConnectorInstanceInput {
  id: string
  connectorId: string
  connectorVersion: string
  displayName: string
  enabled: boolean
  auth?: ConnectorAuthReference[]
  config?: JsonRecord
  filters?: JsonRecord
  createdAt?: string
}

export interface RecordConnectorRefreshResultInput {
  connectorRunId?: string
  connectorInstanceId: string
  mode: string
  startedAt: string
  completedAt: string
  config: JsonRecord
  filters: JsonRecord
  filterSignature: string
  checkpointPersistence?: 'deferred' | 'immediate'
  result: ConnectorRefreshResultInput
}

export interface RecordConnectorRunRequestInput {
  connectorInstanceId: string
  mode: string
  startedAt: string
  coverageStartedAt?: string | null
  coverageEndedAt?: string | null
  filters?: unknown
  filterSignature?: string | null
  reason?: string | null
  dryRun?: boolean
}

export interface RecordConnectorRunRequestResult {
  acquired: boolean
  run: ConnectorRunRecord
}

export interface RecordConnectorRunFailureInput {
  connectorInstanceId: string
  mode: string
  startedAt: string
  completedAt: string
  coverageStartedAt?: string | null
  coverageEndedAt?: string | null
  filters?: unknown
  filterSignature?: string | null
  retryHints?: unknown
  stats?: JsonRecord
  warning: ConnectorWarning
}

export interface RecordConnectorRunSkippedInput {
  connectorInstanceId: string
  mode: string
  reason?: string | null
  skippedAt: string
}

export interface MarkConnectorRunFailedInput {
  connectorRunId: string
  completedAt: string
  retryHints?: unknown
  warning: ConnectorWarning
}

export interface MarkConnectorRunRunningInput {
  connectorRunId: string
  startedAt: string
}

export interface RecoverInterruptedConnectorRunsInput {
  completedAt: string
}

export interface UpdateConnectorRunProgressInput {
  connectorRunId: string
  stats: JsonRecord
}

export interface CompleteConnectorRunInput {
  completedAt: string
  connectorRunId: string
  status: ConnectorRunTerminalStatus
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

export interface ConnectorInstanceRecord {
  id: string
  connectorId: string
  connectorVersion: string
  displayName: string
  enabled: boolean
  auth: ConnectorAuthReference[]
  config: unknown
  filters: unknown
  createdAt: string
  updatedAt: string
}

export interface ConnectorRunRecord {
  id: string
  connectorInstanceId: string
  mode: string
  status: string
  startedAt: string
  completedAt: string | null
  coverageStartedAt: string | null
  coverageEndedAt: string | null
  config: unknown
  filters: unknown
  filterSignature: string
  observationCount: number
  warningCount: number
  stats: unknown
  warnings: unknown
  retryHints: unknown
}

export interface ConnectorCheckpointRecord {
  connectorInstanceId: string
  filterSignature: string
  checkpoint: unknown
  schemaVersion: string
  coverageStartedAt: string | null
  coverageEndedAt: string | null
}

export interface ConnectorObservationRecord extends ConnectorObservationInput {
  id: string
  connectorInstanceId: string
  connectorRunId: string
  sourceMetadata: JsonRecord
  sourcingFindingId: null
  createdAt: string
  updatedAt: string
}

export interface ConnectorStatusSummaryRecord extends ConnectorInstanceRecord {
  latestRun: ConnectorRunRecord | null
}

export interface ListConnectorRunsInput {
  connectorInstanceId: string
  status?: string
  mode?: string
  limit?: number
  offset?: number
}

export interface ListConnectorRunsResult {
  items: ConnectorRunRecord[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

export interface ListConnectorCheckpointsInput {
  connectorInstanceId: string
  filterSignature?: string
}

export interface ListConnectorObservationsInput {
  connectorInstanceId: string
  connectorRunId?: string
}
