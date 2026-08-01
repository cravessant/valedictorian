import type {
  ConnectorAuthReference,
  ConnectorAuthValidationResult,
  ConnectorCaptureEnvelope,
  ConnectorCaptureReceipt,
  ConnectorCoverageWindow,
  ConnectorDelayInput,
  ConnectorProgressSnapshot,
  ConnectorRefreshMode,
  ConnectorRefreshResult,
  ConnectorRefreshStatus,
  FieldResolutionOutcome,
  JobConnector,
  JobObservation,
  ResolverDeclaration,
  RetryAdvice,
} from "@sparxie/valedictorian-connectors-core"
import type { ConnectorRunCoverageWindow } from "./result-sanitizers.js"

export type ConnectorInstanceRecord = {
  id: string
  connectorId: string
  connectorVersion: string
  workspaceId: string
  displayName: string
  enabled: boolean
  auth?: ConnectorAuthReference[]
  config?: unknown
  filters?: unknown
  createdAt: string
}

export type ConnectorRunRecord = {
  id: string
  startedAt: string
  completedAt: string
  connectorInstanceId: string
  workspaceId: string
  mode: ConnectorRefreshMode
  status: ConnectorRefreshStatus | "failed"
  coverage: ConnectorRunCoverageWindow
  config: unknown
  filters: unknown
  filterSignature: string
  stats: ConnectorRefreshResult["stats"]
  warnings: ConnectorRefreshResult["warnings"]
  retryHints: RetryAdvice | null
  synchronization: ConnectorRefreshResult["synchronization"]
}

export type ConnectorCheckpointRecord = {
  connectorInstanceId: string
  filterSignature: string
  checkpoint: unknown
  schemaVersion: string
}

export type HostObservationRecord = JobObservation & {
  connectorInstanceId: string
}

export type InMemoryConnectorHostSnapshot = {
  instances: ConnectorInstanceRecord[]
  runs: ConnectorRunRecord[]
  checkpoints: ConnectorCheckpointRecord[]
  observations: HostObservationRecord[]
  captures: InMemoryCaptureRecord[]
  normalizations: InMemoryNormalizationRecord[]
  providerFieldResolutions: InMemoryNormalizationRecord[]
}

export type InMemoryCaptureRecord = ConnectorCaptureEnvelope & {
  receipt: ConnectorCaptureReceipt
}

export type InMemoryNormalizationRecord = {
  captureRevisionId: string
  resolver: ResolverDeclaration
  outcomes: FieldResolutionOutcome[]
}

export type InMemoryConnectorHostRefreshRequest = {
  connectorInstanceId: string
  workspaceId: string
  mode: ConnectorRefreshMode
  coverage: ConnectorCoverageWindow
  signal?: AbortSignal
}

export type InMemoryConnectorHostValidateAuthRequest = {
  connectorInstanceId: string
  workspaceId: string
}

export type InMemoryConnectorHost = {
  registerInstance: (instance: ConnectorInstanceRecord) => void
  refresh: (
    connector: JobConnector,
    request: InMemoryConnectorHostRefreshRequest,
  ) => Promise<ConnectorRunRecord>
  validateAuth: (
    connector: JobConnector,
    request: InMemoryConnectorHostValidateAuthRequest,
  ) => Promise<ConnectorAuthValidationResult>
  resolveProviderFields: (
    connector: JobConnector,
    captureRevisionId: string,
  ) => FieldResolutionOutcome[]
  snapshot: () => InMemoryConnectorHostSnapshot
}

export type InMemoryConnectorHostOptions = {
  authSessions?: Record<string, {
    expiresAt?: string
    generation: number
    sessionId: string
  }>
  delay?: (input: ConnectorDelayInput) => number | Promise<number>
  progress?: (
    snapshot: ConnectorProgressSnapshot,
  ) => void | Promise<void>
  secrets?: Record<string, string>
  now?: () => string
  onCapture?: (
    envelope: ConnectorCaptureEnvelope,
  ) => void | Promise<void>
}
