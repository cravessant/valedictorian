import type { ConnectorRunSummary, RetryAdvice } from 'sparxie'
import type { ConnectorCoverageWindow, ConnectorCheckpointPayload } from './connector-checkpoint.persistence-types'
import type { ConnectorObservationInput } from './connector-observation.persistence-types'
import type { JsonRecord } from './connector.persistence-json'
import type { AcquiredRetryWork } from './connector-retry-work.identity-types'

export interface ConnectorWarning {
  code: string
  message: string
}

export type ConnectorRunStatus =
  | 'cancelled'
  | 'completed'
  | 'failed'
  | 'queued'
  | 'running'
  | 'skipped'

export type ConnectorRunTerminalStatus = Exclude<ConnectorRunStatus, 'queued' | 'running'>

export interface ConnectorRefreshResultInput {
  observations: ConnectorObservationInput[]
  nextCheckpoint: ConnectorCheckpointPayload
  coverage: ConnectorCoverageWindow
  stats: JsonRecord & { observations: number }
  warnings: ConnectorWarning[]
  status?: ConnectorRunStatus
  retryHints?: RetryAdvice | null
  synchronization?: Pick<ConnectorRunSummary, 'newestFrontier' | 'historicalBackfill' | 'outcome' | 'pendingResolutionCount'>
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
  preserveAcquiredNormalizationWork?: boolean
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
  acquiredWork: AcquiredRetryWork | null
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
  retryHints?: RetryAdvice | null
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
  retryHints?: RetryAdvice | null
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

export interface ConnectorRunRecord {
  id: string
  executionScopeId: string
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
  retryHints: RetryAdvice | null
  synchronization?: unknown
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
