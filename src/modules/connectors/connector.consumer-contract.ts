/**
 * Consumer-shaped connector results (issue #327).
 *
 * What a connector projection hands to a caller: the sparxie contract shapes plus
 * the few app-owned fields the desktop client needs. Connectors owns them because
 * they describe connector data, which lets every record-to-view projection live
 * with the capability that owns the record and keeps persistence rows private.
 */
import type {
  ConnectorObservation,
  ConnectorRunSummary,
  ConnectorStatusSummary,
  CreateConnectorInstanceInput,
  RetryAdvice,
  TriggerConnectorRunInput,
  UpdateConnectorInstanceInput,
  ValedictorianWorkspaceClient,
} from '@sparxie/sdk'
import type { ConnectorAuthMode } from '@sparxie/valedictorian-connectors-core'
import type { AppConnectorAuthGrant, AppConnectorAuthValidationResult } from './connector.runner'
import type { ConnectorStatusListResult, ConnectorStatusView } from './connector.status'

/** Private app-owned execution intent. Not part of Sparxie DTOs. */
export type LocalConnectorExecutionIntent = 'ordinary' | 'deferred_refresh'

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
  lifecycle: 'enabled' | 'disabled'
  auth: LocalConnectorAuthSummary[]
  config: unknown
  filters: unknown
  earliestBackfillDate: string
  createdAt: string
  updatedAt: string
}

export interface LocalConnectorStatusSummary extends Omit<ConnectorStatusView, 'actions' | 'status' | 'warnings'> {
  connectorVersion: string | null
  auth: LocalConnectorAuthSummary[]
  actionRequired: Array<{
    id: string
    kind: 'auth' | 'captcha' | 'configuration' | 'manual_review' | 'rate_limit'
    label: string
    message: string
    severity: 'healthy' | 'warning' | 'blocked'
  }>
  actions: ConnectorStatusSummary['actions']
  status: ConnectorStatusSummary['status']
  warnings: ConnectorStatusSummary['warnings']
}

export type LocalConnectorRunSummary = ConnectorRunSummary & {
  coverage: { start: string | null; end: string | null }
  retryHints: RetryAdvice | null
  stats: unknown
}

export interface LocalConnectorObservationListInput {
  connectorInstanceId: string
  connectorRunId?: string
  limit?: number
  offset?: number
}

/**
 * Private app-owned trigger fields for deferred refresh / retry / normalization.
 * Never leaked through renderer preload or Sparxie public HTTP trigger types.
 */
export type LocalConnectorInternalRunTriggerInput = TriggerConnectorRunInput & {
  /**
   * Private app-owned execution intent. Not part of Sparxie DTOs.
   * `deferred_refresh` preserves Jobright/retry maintenance behavior without persisting catch_up mode.
   */
  executionIntent?: LocalConnectorExecutionIntent
  coverageStartedAt?: string | null
  coverageEndedAt?: string | null
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
  remove: ValedictorianWorkspaceClient['connectors']['remove']
  descriptors: ValedictorianWorkspaceClient['connectors']['descriptors']
  options: ValedictorianWorkspaceClient['connectors']['options']
  inspect(connectorInstanceId: string): Promise<LocalConnectorStatusSummary>
  overview: ValedictorianWorkspaceClient['connectors']['overview']
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
    trigger(input: LocalConnectorInternalRunTriggerInput): Promise<LocalConnectorRunSummary>
  }
  schedules: ValedictorianWorkspaceClient['connectors']['schedules']
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
