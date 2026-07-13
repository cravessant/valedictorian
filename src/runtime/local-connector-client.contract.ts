import type { ConnectorObservation, ConnectorRunSummary, ConnectorSchedulingCapability, ConnectorStatusSummary, CreateConnectorInstanceInput, RetryAdvice, UpdateConnectorInstanceInput, ValedictorianWorkspaceClient } from 'sparxie'
import type { AppConnectorAuthGrant, AppConnectorAuthValidationResult } from '../modules/connectors/connector.runner'
import type { ConnectorAuthMode } from '../modules/connectors/connector.repository'
import type { ConnectorStatusListResult, ConnectorStatusView } from '../modules/connectors/connector.status'
import type { LocalConnectorExecutionIntent } from './local-connector-execution-intent'

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

/** Public ordinary trigger input — Sparxie manual-only mode, with private local execution intent. */
export interface LocalConnectorRunTriggerInput {
  connectorInstanceId: string
  mode?: 'manual'
  /**
   * Private app-owned execution intent. Not part of Sparxie DTOs.
   * `deferred_refresh` preserves Jobright/retry maintenance behavior without persisting catch_up mode.
   */
  executionIntent?: LocalConnectorExecutionIntent
  coverageStartedAt?: string | null
  coverageEndedAt?: string | null
  filterSignature?: string | null
  filters?: unknown
  reason?: string | null
  dryRun?: boolean
}

/**
 * Private app-owned execution intent for non-schedule maintenance work
 * (Jobright deferred refresh, retry-ledger, normalization catch-up).
 * Never persisted as public connector-run mode and never leaked through Sparxie DTOs.
 */

export type LocalConnectorInternalRunTriggerInput = LocalConnectorRunTriggerInput

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
    trigger(input: LocalConnectorRunTriggerInput): Promise<LocalConnectorRunSummary>
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

export type LocalValedictorianClient = ValedictorianWorkspaceClient & {
  connectors: LocalConnectorClient
  /** Authoritative scheduling capability for reporting and schedule enforcement. */
  connectorScheduling: ConnectorSchedulingCapability
}
