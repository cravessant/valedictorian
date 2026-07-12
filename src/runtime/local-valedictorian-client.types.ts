import type {
  ConnectorObservation,
  CreateConnectorInstanceInput,
  RetryAdvice,
  UpdateConnectorInstanceInput,
  ValedictorianWorkspaceClient,
} from 'sparxie'
import type { ConnectorRunRecoveryLifecycle } from '../modules/connectors/connector.recovery'
import type { LocalConnectorRegistry } from '../modules/connectors/connector.registry'
import type {
  AppConnectorAuthGrant,
  AppConnectorAuthValidationResult,
  AppConnectorRuntimePorts,
} from '../modules/connectors/connector.runner'
import type { ConnectorAuthMode } from '../modules/connectors/connector.repository'
import type { ConnectorStatusListResult, ConnectorStatusView, ConnectorStatusWarningView } from '../modules/connectors/connector.status'
import type { ProfileSecretCodec } from '../modules/profile/profile.repository'
import type { NormalizationResolverRegistry } from '../modules/sourcing/normalization.registry'

export interface LocalValedictorianClientOptions {
  connectorRunRecovery?: ConnectorRunRecoveryLifecycle
  connectorRegistry?: LocalConnectorRegistry
  connectorRuntime?: AppConnectorRuntimePorts
  now?: () => Date
  normalizationRegistry?: NormalizationResolverRegistry
  referenceTrackerPath?: string
  seedDataMode?: ValedictorianSeedDataMode
  secretCodec?: ProfileSecretCodec
  sqlitePath: string
  workspaceId?: string
}

export type ValedictorianSeedDataMode = 'none' | 'sample' | 'reference-tracker'

export interface LocalConnectorAuthSummary {
  id: string
  mode: ConnectorAuthMode
  label: string | null
  configured: boolean
}

export interface LocalConnectorInstanceSummary {
  id: string
  connectorId: string
  connectorVersion: string
  displayName: string
  enabled: boolean
  auth: LocalConnectorAuthSummary[]
  config: unknown
  filters: unknown
  earliestBackfillDate: string
  createdAt: string
  updatedAt: string
}

export interface LocalConnectorStatusSummary extends ConnectorStatusView {
  connectorVersion: string | null
  auth: LocalConnectorAuthSummary[]
  actionRequired: Array<{
    id: string
    kind: 'auth' | 'captcha' | 'configuration' | 'manual_review' | 'rate_limit'
    label: string
    message: string
    severity: 'healthy' | 'warning' | 'blocked'
  }>
}

export interface LocalConnectorRunSummary {
  id: string
  connectorInstanceId: string
  mode: string
  status: string
  coverage: {
    start: string | null
    end: string | null
  }
  filterSignature: string
  observationCount: number
  warningCount: number
  stats: unknown
  warnings: ConnectorStatusWarningView[]
  retryHints: RetryAdvice | null
  startedAt: string
  completedAt: string | null
}

export interface LocalConnectorObservationListInput {
  connectorInstanceId: string
  connectorRunId?: string
  limit?: number
  offset?: number
}

export interface LocalConnectorRunTriggerInput {
  connectorInstanceId: string
  mode?: 'manual' | 'scheduled' | 'catch_up'
  coverageStartedAt?: string | null
  coverageEndedAt?: string | null
  filterSignature?: string | null
  filters?: unknown
  reason?: string | null
  dryRun?: boolean
}

export interface LocalConnectorStartupCatchUpResult {
  runs: LocalConnectorRunSummary[]
  skipped: Array<{
    connectorInstanceId: string
    reason: 'disabled' | 'execution_failed' | 'unsupported_connector'
  }>
}

export interface LocalConnectorStatusActionInput {
  connectorInstanceId: string
}

export interface LocalConnectorSkipActionInput extends LocalConnectorStatusActionInput {
  reason?: string | null
}

export interface LocalConnectorAuthGrantSummary {
  id: string
  mode: ConnectorAuthMode
  status: AppConnectorAuthGrant['status']
  expiresAt?: string
  reason?: string
}

export interface LocalConnectorReconnectActionResult {
  action: 'reconnect'
  connectorInstanceId: string
  grants: LocalConnectorAuthGrantSummary[]
  message: string
  reason?: string
  status: AppConnectorAuthValidationResult['status'] | AppConnectorAuthGrant['status'] | 'unsupported'
}

export interface LocalConnectorSkipActionResult {
  action: 'skip'
  connectorInstanceId: string
  message: string
  run: LocalConnectorRunSummary
  status: 'skipped'
}

export interface LocalConnectorClient {
  list(): Promise<{ items: LocalConnectorInstanceSummary[] }>
  create(input: CreateConnectorInstanceInput): Promise<LocalConnectorInstanceSummary>
  update(input: UpdateConnectorInstanceInput): Promise<LocalConnectorInstanceSummary>
  inspect(connectorInstanceId: string): Promise<LocalConnectorStatusSummary>
  runs: {
    list(input: {
      connectorInstanceId: string
      status?: string
      mode?: string
      limit?: number
      offset?: number
    }): Promise<{
      items: LocalConnectorRunSummary[]
      total: number
      limit: number
      offset: number
      hasMore: boolean
    }>
    startupCatchUp(): Promise<LocalConnectorStartupCatchUpResult>
    trigger(input: LocalConnectorRunTriggerInput): Promise<LocalConnectorRunSummary>
  }
  checkpoints: {
    list(input: { connectorInstanceId: string; filterSignature?: string }): Promise<{
      items: Array<{
        connectorInstanceId: string
        filterSignature: string
        checkpoint: unknown
        schemaVersion: string
        coverage: {
          start: string | null
          end: string | null
        }
      }>
    }>
  }
  observations: {
    list(input: LocalConnectorObservationListInput): Promise<{
      items: ConnectorObservation[]
      total: number
      limit: number
      offset: number
      hasMore: boolean
    }>
  }
  status: {
    list(): Promise<ConnectorStatusListResult>
    reconnect(input: LocalConnectorStatusActionInput): Promise<LocalConnectorReconnectActionResult>
    skip(input: LocalConnectorSkipActionInput): Promise<LocalConnectorSkipActionResult>
  }
}

export type LocalValedictorianClient = ValedictorianWorkspaceClient & {
  connectors: LocalConnectorClient
}
