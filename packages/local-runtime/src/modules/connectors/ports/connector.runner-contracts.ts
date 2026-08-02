import type {
  ConnectorAuthGrant,
  ConnectorAuthMode,
  ConnectorAuthReference,
  ConnectorAuthRequirement,
  ConnectorAuthResolveInput,
  ConnectorAuthValidationInput,
  ConnectorAuthValidationResult,
  ConnectorAuthValidationStatus,
  ConnectorCancellationRuntime,
  ConnectorCoverageWindow,
  ConnectorDefinition,
  ConnectorDelayRuntime,
  ConnectorProgressRuntime,
  ConnectorRefreshInput,
  ConnectorRefreshMode,
  ConnectorRefreshResult,
  ConnectorRuntime,
  JobConnector,
} from '@sparxie/valedictorian-connectors-core'
import type {
  ConnectorCheckpointPayload,
  ConnectorInstanceRecord,
  ConnectorRunRecord,
  ConnectorRunTerminalStatus,
} from './connector.repository.port.js'

export type AppJobConnectorDefinition = ConnectorDefinition
export type AppConnectorAuthMode = ConnectorAuthMode
export type AppConnectorAuthRequirement = ConnectorAuthRequirement
export type AppConnectorRefreshInput = ConnectorRefreshInput
export type AppConnectorRefreshResult = ConnectorRefreshResult
export type AppConnectorAuthGrant = ConnectorAuthGrant
export type AppConnectorAuthResolveInput = ConnectorAuthResolveInput
export type AppConnectorRuntime = ConnectorRuntime
export interface AppConnectorSecretResolver {
  revealSecret(key: string): Promise<{ key: string; value: string } | null>
}
export interface AppConnectorAuthHost {
  secrets?: AppConnectorSecretResolver
}
export type AppConnectorRuntimePorts = {
  cancellation?: ConnectorCancellationRuntime
  delay?: ConnectorDelayRuntime
  progress?: ConnectorProgressRuntime
}
export interface AppJobConnector extends Omit<JobConnector, 'refresh' | 'validateAuth'> {
  refresh(
    input: AppConnectorRefreshInput,
    runtime: AppConnectorRuntime,
  ): Promise<AppConnectorRefreshResult>
  validateAuth?(
    input: ConnectorAuthValidationInput,
    runtime: AppConnectorRuntime,
  ): Promise<ConnectorAuthValidationResult>
}
export interface ValidateConnectorAuthInput {
  connectorInstanceId: string
}
export type AppConnectorAuthValidationStatus = ConnectorAuthValidationStatus | 'unsupported'
export interface AppConnectorAuthValidationResult {
  connectorInstanceId: string
  message: string
  reason: string
  status: AppConnectorAuthValidationStatus
}
export interface RegisterConnectorInstanceInput {
  id: string
  connector: AppJobConnector
  displayName: string
  enabled: boolean
  auth?: ConnectorAuthReference[]
  config?: Record<string, unknown>
  filters?: Record<string, unknown>
  earliestBackfillDate?: string
  createdAt?: string
}
export interface RunConnectorRefreshInput {
  connectorRunId?: string
  connectorInstanceId: string
  mode: ConnectorRefreshMode
  coverage: ConnectorCoverageWindow
  startedAt?: string
  completedAt?: string
  observations?: AppConnectorRefreshInput['observations']
  checkpointOverride?: unknown
  restoreUnacquiredJobrightRetryEntries?: {
    acquiredProviderRecordId: string
    originalCheckpoint: unknown
  }
  signal?: AbortSignal
}
export interface RunConnectorCatchUpInput {
  connectorRunId?: string
  connectorInstanceId: string
  coverageStartedAt?: string
  now?: string
  startedAt?: string
  completedAt?: string
  observations?: AppConnectorRefreshInput['observations']
  checkpointOverride?: unknown
  restoreUnacquiredJobrightRetryEntries?: {
    acquiredProviderRecordId: string
    originalCheckpoint: unknown
  }
  signal?: AbortSignal
}
export interface AppConnectorPendingCheckpoint {
  connectorInstanceId: string
  filterSignature: string
  checkpoint: ConnectorCheckpointPayload
  coverage: ConnectorCoverageWindow
  savedAt: string
}
export interface AppConnectorRefreshRecord {
  checkpoint: AppConnectorPendingCheckpoint
  run: ConnectorRunRecord
  terminalStatus: ConnectorRunTerminalStatus
}

export interface ConnectorRunner {
  registerInstance(input: RegisterConnectorInstanceInput): Promise<ConnectorInstanceRecord>
  registerInstanceIfAbsent(input: RegisterConnectorInstanceInput): Promise<ConnectorInstanceRecord>
  refresh(
    connector: AppJobConnector,
    input: RunConnectorRefreshInput,
  ): Promise<ConnectorRunRecord>
  refreshWithDeferredCheckpoint(
    connector: AppJobConnector,
    input: RunConnectorRefreshInput,
  ): Promise<AppConnectorRefreshRecord>
  catchUp(
    connector: AppJobConnector,
    input: RunConnectorCatchUpInput,
  ): Promise<ConnectorRunRecord>
  catchUpWithDeferredCheckpoint(
    connector: AppJobConnector,
    input: RunConnectorCatchUpInput,
  ): Promise<AppConnectorRefreshRecord>
  validateAuth(
    connector: AppJobConnector,
    input: ValidateConnectorAuthInput,
  ): Promise<AppConnectorAuthValidationResult>
}
