import type { ConnectorAuthGrant, ConnectorAuthMode, ConnectorAuthReference,
  ConnectorAuthRequirement,
  ConnectorAuthResolveInput,
  ConnectorAuthValidationInput,
  ConnectorAuthValidationResult,
  ConnectorAuthValidationStatus,
  ConnectorCoverageWindow,
  ConnectorCancellationRuntime,
  ConnectorDefinition,
  ConnectorDelayRuntime,
  ConnectorRefreshInput,
  ConnectorRefreshMode,
  ConnectorRefreshResult,
  ConnectorRuntime,
  ConnectorProgressRuntime,
  ConnectorProgressSnapshot,
  ConnectorNormalizationInput,
  JobConnector,
} from '@sparxie/valedictorian-connectors-core'
import { z } from 'zod'
import type {
  FieldResolutionOutcome,
  RawSourceIntakeReceipt,
  RawSourceOccurrenceReceipt,
  RawSourceRecordInput,
  ResolverCapability,
} from 'sparxie'
import { connectorRunSummarySchema, retryAdviceSchema, sourceOperationOutcomeSchema } from 'sparxie'
import type {
  ConnectorCheckpointPayload,
  ConnectorInstanceRecord,
  ConnectorRefreshResultInput,
  ConnectorRunRecord,
  ConnectorRunTerminalStatus,
  createSqliteConnectorRepository,
} from './connector.repository'
import { inclusiveCoverageStartFromEarliestBackfillDate } from './connector.earliest-backfill'
import * as connectorCheckpointSignatureModule from './connector.checkpoint-signature'
import { restoreUnacquiredJobrightV5RetryEntries } from './connector.jobright-checkpoint-merge'
import {
  createBoundConnectorDataRuntime,
  type AcquiredNormalizationReplayIdentity,
} from './connector.runner.bound-data-runtime'
import type { createSourceExecutionGovernor } from '../source-execution/source-execution-governor'
import { createSourceSessionExecutor } from '../source-execution/source-session-executor'
import { finalizeReconnectValidation } from './connector.auth-validation-finalization'
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
export interface AppConnectorRawSourceHost {
  ingest(record: RawSourceRecordInput): Promise<RawSourceIntakeReceipt>
}
export interface AppConnectorNormalizationHost {
  run(
    input: ConnectorNormalizationInput,
    context: {
      acquiredRetryWork?: {
        acquisitionRunId: string
        executionScopeId: string
        retryWorkId: string
      }
      connectorRunId: string
      deferAcquiredRetryCompletion?: boolean
      enabledCapabilities: readonly ResolverCapability[]
      triggerOccurrence?: RawSourceOccurrenceReceipt | null
    },
  ): Promise<FieldResolutionOutcome[]>
  release?(connectorRunId: string): void
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
  acquiredNormalizationReplay?: AcquiredNormalizationReplayIdentity
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
  acquiredNormalizationReplay?: AcquiredNormalizationReplayIdentity
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
export interface CreateConnectorRunnerOptions {
  auth?: AppConnectorAuthHost
  normalization?: AppConnectorNormalizationHost
  rawSource?: AppConnectorRawSourceHost
  repository: ReturnType<typeof createSqliteConnectorRepository>
  sourceExecutionGovernor?: ReturnType<typeof createSourceExecutionGovernor>
  runtime?: AppConnectorRuntimePorts
  workspaceId: string
  now?: () => Date
}
const REDACTED_SECRET_VALUE = '[redacted-secret]'
export function createConnectorRunner({
  auth,
  normalization,
  rawSource,
  repository,
  sourceExecutionGovernor,
  runtime = {},
  workspaceId,
  now = () => new Date(),
}: CreateConnectorRunnerOptions) {
  const sessionExecutor = sourceExecutionGovernor
    ? createSourceSessionExecutor({ governor: sourceExecutionGovernor, now })
    : null
  async function runRefresh(
    connector: AppJobConnector,
    input: RunConnectorRefreshInput,
    instance?: ConnectorInstanceRecord,
    options: { checkpointPersistence?: 'deferred' | 'immediate' } = {},
  ): Promise<AppConnectorRefreshRecord> {
    const startedAt = input.startedAt ?? now().toISOString()
    const connectorInstance = instance ?? await repository.getInstance(input.connectorInstanceId)
    if (!connectorInstance) {
      throw new Error(`Connector instance not found: ${input.connectorInstanceId}`)
    }
    const config = cloneJsonRecord(toJsonRecord(connectorInstance.config))
    const filters = cloneJsonRecord(toJsonRecord(connectorInstance.filters))
    const runConfig = cloneJsonRecord(config)
    const runFilters = cloneJsonRecord(filters)
    const filterSignature = checkpointSignatureForConnector(connector, filters)
    const checkpoint = await repository.getCheckpoint({
      connectorInstanceId: input.connectorInstanceId,
      filterSignature,
    })
    const sensitiveValues = new Set<string>()
    const authRequirements = connector.definition.auth?.requirements ?? []
    const runRuntime = createRunRuntime(
      runtime,
      connectorInstance.auth,
      authRequirements,
      auth,
      sensitiveValues,
      connectorInstance.executionScopeId,
      sessionExecutor,
      false,
      input.connectorRunId
        ? createPersistedProgressRuntime(repository, input.connectorRunId, now, runtime.progress)
        : runtime.progress,
      input.connectorRunId
        ? createBoundConnectorDataRuntime({
            acquiredNormalizationReplay: input.acquiredNormalizationReplay,
            connector,
            connectorInstanceId: connectorInstance.id,
            connectorRunId: input.connectorRunId,
            executionScopeId: connectorInstance.executionScopeId,
            normalization,
            rawSource,
            workspaceId,
          })
        : undefined,
    )
    let result: AppConnectorRefreshResult
    try {
      const refreshInput = {
        connectorInstanceId: input.connectorInstanceId,
        executionScopeId: connectorInstance.executionScopeId,
        workspaceId,
        mode: input.mode,
        coverage: input.coverage,
        config,
        filters,
        ...(input.checkpointOverride !== undefined
          ? { checkpoint: input.checkpointOverride }
          : checkpoint
            ? { checkpoint: checkpoint.checkpoint }
            : {}),
        ...(input.observations ? { observations: input.observations } : {}),
      }
      result = await connector.refresh(refreshInput, runRuntime)
      assertConnectorRefreshResult(result, connectorInstance.executionScopeId)
      if (result.operationOutcome?.kind === 'scope_rate_limited') {
        if (result.operationOutcome.executionScopeId !== connectorInstance.executionScopeId) {
          throw new Error('Connector returned rate-limit evidence for a different execution scope')
        }
        if (!sourceExecutionGovernor) throw new Error('Source execution governor is required')
        sourceExecutionGovernor.blockScope(connectorInstance.executionScopeId, {
          now: now().toISOString(), retryAfter: result.operationOutcome.retryAt,
        })
      }
    } finally {
      if (input.connectorRunId) {
        normalization?.release?.(input.connectorRunId)
      }
    }
    const safeResult = withRunProgressStats(
      dedupeRefreshWarnings(redactRefreshResult(result, sensitiveValues)),
    )
    const nextCheckpoint = input.restoreUnacquiredJobrightRetryEntries
      ? restoreUnacquiredJobrightV5RetryEntries({
          acquiredProviderRecordId: input.restoreUnacquiredJobrightRetryEntries.acquiredProviderRecordId,
          originalCheckpoint: input.restoreUnacquiredJobrightRetryEntries.originalCheckpoint,
          returned: safeResult.nextCheckpoint,
        })
      : safeResult.nextCheckpoint
    const completedAt = input.completedAt ?? now().toISOString()
    const run = await repository.recordRefreshResult({
      connectorRunId: input.connectorRunId,
      connectorInstanceId: input.connectorInstanceId,
      mode: input.mode,
      startedAt,
      completedAt,
      config: runConfig,
      filters: runFilters,
      filterSignature,
      checkpointPersistence: options.checkpointPersistence,
      preserveAcquiredNormalizationWork: Boolean(input.acquiredNormalizationReplay),
      result: {
        ...safeResult,
        status: terminalConnectorRunStatus(safeResult.status),
        nextCheckpoint,
      },
    })
    return {
      checkpoint: {
        connectorInstanceId: input.connectorInstanceId,
        filterSignature,
        checkpoint: nextCheckpoint,
        coverage: safeResult.coverage,
        savedAt: completedAt,
      },
      run,
      terminalStatus: terminalConnectorRunStatus(safeResult.status),
    }
  }
  async function prepareCatchUpRefresh(
    _connector: AppJobConnector,
    input: RunConnectorCatchUpInput,
  ): Promise<{
    instance: ConnectorInstanceRecord
    refreshInput: RunConnectorRefreshInput
  }> {
    const instance = await repository.getInstance(input.connectorInstanceId)
    if (!instance) {
      throw new Error(`Connector instance not found: ${input.connectorInstanceId}`)
    }
    const end = parseIsoDate(input.now ?? now().toISOString(), 'catch-up now')
    const coverageStart = input.coverageStartedAt === undefined
      ? inclusiveCoverageStartFromEarliestBackfillDate(instance.earliestBackfillDate)
      : parseIsoDate(input.coverageStartedAt, 'catch-up coverage start').toISOString()
    return {
      instance,
      refreshInput: {
        connectorRunId: input.connectorRunId,
        connectorInstanceId: input.connectorInstanceId,
        mode: 'catch_up',
        coverage: {
          start: coverageStart,
          end: end.toISOString(),
        },
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        ...(input.observations ? { observations: input.observations } : {}),
        ...(input.checkpointOverride !== undefined
          ? { checkpointOverride: input.checkpointOverride }
          : {}),
        ...(input.restoreUnacquiredJobrightRetryEntries
          ? { restoreUnacquiredJobrightRetryEntries: input.restoreUnacquiredJobrightRetryEntries }
          : {}),
        ...(input.acquiredNormalizationReplay
          ? { acquiredNormalizationReplay: input.acquiredNormalizationReplay }
          : {}),
      },
    }
  }
  async function validateAuth(
    connector: AppJobConnector,
    input: ValidateConnectorAuthInput,
  ): Promise<AppConnectorAuthValidationResult> {
    const connectorInstance = await repository.getInstance(input.connectorInstanceId)
    if (!connectorInstance) {
      throw new Error(`Connector instance not found: ${input.connectorInstanceId}`)
    }
    if (typeof connector.validateAuth !== 'function') {
      return {
        connectorInstanceId: input.connectorInstanceId,
        message: 'Connector auth validation is not supported.',
        reason: 'validate_auth_unsupported',
        status: 'unsupported',
      }
    }
    const sensitiveValues = new Set<string>()
    const authRequirements = connector.definition.auth?.requirements ?? []
    const initialGeneration = sourceExecutionGovernor?.getScope(connectorInstance.executionScopeId).authGeneration ?? 0
    let reconnectRefreshInvoked = false
    const reconnectLease = sourceExecutionGovernor?.acquireReconnectLease(connectorInstance.executionScopeId, {
      leaseMs: 60_000, now: now().toISOString(),
    })
    if (sourceExecutionGovernor && !reconnectLease) {
      return {
        connectorInstanceId: input.connectorInstanceId,
        message: authValidationMessage('retryable', 'jobright_auth_request_failed'),
        reason: 'jobright_auth_request_failed',
        status: 'retryable',
      }
    }
    const runRuntime = createRunRuntime(runtime, connectorInstance.auth, authRequirements, auth,
      sensitiveValues, connectorInstance.executionScopeId, sessionExecutor, true, runtime.progress,
      undefined, reconnectLease?.token, () => { reconnectRefreshInvoked = true })
    let result: ConnectorAuthValidationResult
    try {
      result = await connector.validateAuth(
        {
          connectorInstanceId: input.connectorInstanceId,
          executionScopeId: connectorInstance.executionScopeId,
          workspaceId,
        },
        runRuntime,
      )
    } catch (error) {
      if (isSecureStorageUnavailableError(error)) {
        sourceExecutionGovernor?.finishReconnectValidation(connectorInstance.executionScopeId, {
          now: now().toISOString(), reason: 'secure_storage_unavailable', status: 'action_required',
          token: reconnectLease!.token,
        })
        return {
          connectorInstanceId: input.connectorInstanceId,
          message: authValidationMessage('failed', 'secure_storage_unavailable'),
          reason: 'secure_storage_unavailable',
          status: 'failed',
        }
      }
      sourceExecutionGovernor?.finishReconnectValidation(connectorInstance.executionScopeId, {
        now: now().toISOString(), reason: 'validate_auth_failed', status: 'action_required',
        token: reconnectLease!.token,
      })
      return {
        connectorInstanceId: input.connectorInstanceId,
        message: 'Connector auth validation failed.',
        reason: 'validate_auth_failed',
        status: 'failed',
      }
    }
    const sanitized = sanitizeAuthValidationResult(input.connectorInstanceId, result, sensitiveValues)
    return finalizeReconnectValidation({
      governor: sourceExecutionGovernor, initialGeneration, now: now().toISOString(),
      refreshInvoked: reconnectRefreshInvoked, result: sanitized,
      scopeId: connectorInstance.executionScopeId, token: reconnectLease?.token,
    })
  }
  return {
    async registerInstance(input: RegisterConnectorInstanceInput) {
      return repository.upsertInstance({
        id: input.id,
        connectorId: input.connector.definition.id,
        connectorVersion: input.connector.definition.version,
        displayName: input.displayName,
        enabled: input.enabled,
        auth: input.auth,
        config: input.config,
        filters: input.filters,
        earliestBackfillDate: input.earliestBackfillDate,
        createdAt: input.createdAt,
      })
    },
    async refresh(
      connector: AppJobConnector,
      input: RunConnectorRefreshInput,
    ): Promise<ConnectorRunRecord> {
      return (await runRefresh(connector, input)).run
    },
    async refreshWithDeferredCheckpoint(
      connector: AppJobConnector,
      input: RunConnectorRefreshInput,
    ): Promise<AppConnectorRefreshRecord> {
      return runRefresh(connector, input, undefined, {
        checkpointPersistence: 'deferred',
      })
    },
    async catchUp(
      connector: AppJobConnector,
      input: RunConnectorCatchUpInput,
    ): Promise<ConnectorRunRecord> {
      const { instance, refreshInput } = await prepareCatchUpRefresh(connector, input)
      return (await runRefresh(connector, refreshInput, instance)).run
    },
    async catchUpWithDeferredCheckpoint(
      connector: AppJobConnector,
      input: RunConnectorCatchUpInput,
    ): Promise<AppConnectorRefreshRecord> {
      const { instance, refreshInput } = await prepareCatchUpRefresh(connector, input)
      return runRefresh(
        connector,
        refreshInput,
        instance,
        {
          checkpointPersistence: 'deferred',
        },
      )
    },
    validateAuth,
  }
}
function dedupeRefreshWarnings(result: ConnectorRefreshResultInput): ConnectorRefreshResultInput {
  const seen = new Set<string>()
  return {
    ...result,
    warnings: result.warnings.filter((warning) => {
      const identity = `${warning.code}\u0000${warning.message}`
      if (seen.has(identity)) return false
      seen.add(identity)
      return true
    }),
  }
}
const allowedAuthValidationStatuses = new Set<ConnectorAuthValidationStatus>([
  'ready',
  'missing',
  'expired',
  'action_required',
  'rate_limited',
  'retryable',
  'failed',
  'cancelled',
  'invocation_timeout',
])
const allowedAuthValidationReasons = new Set([
  'auth_validation_failed',
  'jobright_auth_ready',
  'jobright_auth_request_failed',
  'jobright_auth_required',
  'jobright_login_rejected',
  'jobright_login_retryable',
  'jobright_login_schema_invalid',
  'jobright_newinfo_logined_missing',
  'jobright_newinfo_retryable',
  'jobright_newinfo_schema_invalid',
  'jobright_not_logged_in',
  'jobright_rate_limited',
  'jobright_session_cookie_missing',
  'secret_missing',
  'secret_reference_missing',
  'secure_storage_unavailable',
  'username_password_malformed',
  'username_password_missing',
  'validate_auth_failed',
  'validate_auth_unsupported',
])
function sanitizeAuthValidationResult(
  connectorInstanceId: string,
  result: ConnectorAuthValidationResult,
  sensitiveValues: Set<string>,
): AppConnectorAuthValidationResult {
  const status = allowedAuthValidationStatuses.has(result.status)
    ? result.status
    : 'failed'
  const rawReason = typeof result.reason === 'string' ? result.reason : undefined
  const redactedReason = rawReason === undefined
    ? undefined
    : redactSensitiveString(rawReason, sensitiveValues)
  const reason = redactedReason && allowedAuthValidationReasons.has(redactedReason)
    ? redactedReason
    : status === 'ready'
      ? 'jobright_auth_ready'
      : 'auth_validation_failed'
  return {
    connectorInstanceId,
    message: authValidationMessage(status, reason),
    reason,
    status,
  }
}
function isSecureStorageUnavailableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  if ('code' in error && (error as { code?: unknown }).code === 'secure_storage_unavailable') {
    return true
  }
  return error instanceof Error && error.message.includes('secure_storage_unavailable')
}
function authValidationMessage(
  status: AppConnectorAuthValidationStatus,
  reason: string,
): string {
  if (status === 'ready') {
    return 'Connector credentials are verified and ready.'
  }
  if (reason === 'secure_storage_unavailable') {
    return 'Secure storage is unavailable. Enable platform encryption, then try again.'
  }
  if (status === 'missing' || reason === 'secret_missing' || reason === 'secret_reference_missing' || reason === 'username_password_missing') {
    return 'Connector credentials are missing. Save email and password, then validate again.'
  }
  if (status === 'expired' || reason === 'jobright_not_logged_in') {
    return 'Connector session expired. Update credentials and validate again.'
  }
  if (status === 'rate_limited' || reason === 'jobright_rate_limited') {
    return 'Jobright rate limited the auth request. Retry later.'
  }
  if (status === 'retryable' || reason === 'jobright_login_retryable' || reason === 'jobright_newinfo_retryable' || reason === 'jobright_auth_request_failed') {
    return 'Temporary Jobright request failure. Retry validation.'
  }
  if (status === 'cancelled') return 'Connector auth validation was cancelled.'
  if (status === 'invocation_timeout') return 'Connector auth validation timed out.'
  if (
    status === 'action_required'
    || reason === 'jobright_login_rejected'
    || reason === 'username_password_malformed'
    || reason === 'jobright_auth_required'
  ) {
    return 'Connector credentials were rejected. Update email and password, then validate again.'
  }
  if (status === 'unsupported') {
    return 'Connector auth validation is not supported.'
  }
  return 'Connector auth validation failed.'
}
function terminalConnectorRunStatus(value: unknown): ConnectorRunTerminalStatus {
  if (
    value === 'cancelled' ||
    value === 'failed' ||
    value === 'skipped'
  ) {
    return value
  }
  if (value === 'completed') return value
  throw new Error(`Invalid connector refresh status: ${String(value)}`)
}
function assertConnectorRefreshStatus(value: unknown): asserts value is ConnectorRunTerminalStatus {
  terminalConnectorRunStatus(value)
}
const connectorRefreshEnvelopeSchema = z.object({
  observations: z.array(z.unknown()),
  nextCheckpoint: z.object({ checkpoint: z.unknown(), schemaVersion: z.string().min(1).max(128) }).strict(),
  coverage: z.object({ start: z.iso.datetime({ offset: true }), end: z.iso.datetime({ offset: true }) }).strict(),
  stats: z.object({ observations: z.number().int().nonnegative() }).passthrough(),
  warnings: z.array(z.object({ code: z.string().min(1).max(128), message: z.string().min(1).max(2048) }).strict()),
  status: z.enum(['completed', 'failed', 'cancelled', 'skipped']),
  retryHints: z.unknown().optional(),
  operationOutcome: z.unknown(),
  synchronization: z.unknown(),
}).strict()
function assertConnectorRefreshResult(
  value: unknown,
  executionScopeId: import('sparxie').SourceExecutionScopeId,
): asserts value is ConnectorRefreshResult {
  if (!isRecord(value)) throw new Error('Invalid connector refresh result')
  assertConnectorRefreshStatus(value.status)
  if (!('synchronization' in value)) throw new Error('Invalid connector refresh synchronization')
  if (!connectorRefreshEnvelopeSchema.safeParse(value).success) throw new Error('Invalid connector refresh result')
  if (value.retryHints !== undefined && value.retryHints !== null && !retryAdviceSchema.safeParse(value.retryHints).success) {
    throw new Error('Invalid connector refresh retry advice')
  }
  if (value.operationOutcome !== null && !sourceOperationOutcomeSchema.safeParse(value.operationOutcome).success) {
    throw new Error('Invalid connector refresh operation outcome')
  }
  if (isRecord(value.operationOutcome)
    && (value.operationOutcome.kind === 'authentication_expired' || value.operationOutcome.kind === 'scope_rate_limited')
    && value.operationOutcome.executionScopeId !== executionScopeId) {
    throw new Error('Invalid connector refresh operation outcome scope')
  }
  assertConnectorRefreshSynchronization(value.synchronization, value.status, executionScopeId)
  assertConnectorRefreshOperationConsistency(value.operationOutcome, value.synchronization)
}
function assertConnectorRefreshSynchronization(
  value: unknown,
  status: ConnectorRunTerminalStatus,
  executionScopeId: import('sparxie').SourceExecutionScopeId,
): asserts value is ConnectorRefreshResult['synchronization'] {
  if (!isRecord(value) || !connectorRunSummarySchema.safeParse({
    id: 'connector-refresh-validation', connectorInstanceId: 'connector-refresh-validation',
    executionScopeId, status, filterSignature: 'connector-refresh-validation', observationCount: 0,
    warningCount: 0, warnings: [], newestFrontier: value.newestFrontier,
    historicalBackfill: value.historicalBackfill, pendingResolutionCount: value.pendingResolutionCount,
    outcome: value.outcome, startedAt: '2000-01-01T00:00:00.000Z',
    completedAt: '2000-01-01T00:00:00.000Z', mode: 'manual', scheduleOccurrence: null,
  }).success) throw new Error('Invalid connector refresh synchronization')
}
function assertConnectorRefreshOperationConsistency(
  operationOutcome: unknown,
  synchronization: ConnectorRefreshResult['synchronization'],
) {
  const synchronizationOutcome = synchronization.outcome
  const requiredSynchronizationKind = isRecord(operationOutcome)
    ? operationOutcome.kind === 'scope_rate_limited'
      ? 'cooling_down'
      : operationOutcome.kind === 'authentication_expired'
        ? 'action_required'
        : null
    : null
  const synchronizationRequiresOperation = synchronizationOutcome.kind === 'cooling_down'
    || synchronizationOutcome.kind === 'action_required'
  if (requiredSynchronizationKind !== null
    && (synchronizationOutcome.kind !== requiredSynchronizationKind
      || !sameScopeOperation(operationOutcome, synchronizationOutcome.operation))) {
    throw new Error('Inconsistent connector refresh operation outcome')
  }
  if (synchronizationRequiresOperation
    && !sameScopeOperation(operationOutcome, synchronizationOutcome.operation)) {
    throw new Error('Inconsistent connector refresh operation outcome')
  }
}
function sameScopeOperation(left: unknown, right: unknown) {
  if (!isRecord(left) || !isRecord(right) || left.kind !== right.kind) return false
  if (left.kind === 'authentication_expired') {
    return left.executionScopeId === right.executionScopeId
      && left.requestRefresh === right.requestRefresh
  }
  if (left.kind === 'scope_rate_limited') {
    return left.executionScopeId === right.executionScopeId
      && left.retryAt === right.retryAt
      && left.serverMinimumDelayMs === right.serverMinimumDelayMs
  }
  return false
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
const connectorRunProgressMetricKeys = [
  'attempted',
  'authRequired',
  'discovered',
  'eligible',
  'failed',
  'failures',
  'resolved',
] as const
function withRunProgressStats(
  result: ConnectorRefreshResultInput,
): ConnectorRefreshResultInput {
  const checkpoint = toJsonRecord(result.nextCheckpoint.checkpoint)
  const checkpointStats: Record<string, number> = {}
  for (const key of connectorRunProgressMetricKeys) {
    const value = checkpoint[key]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      checkpointStats[key] = value
    }
  }
  return {
    ...result,
    stats: {
      ...checkpointStats,
      ...result.stats,
    },
  }
}
function createRunRuntime(
  runtime: AppConnectorRuntimePorts,
  authReferences: ConnectorAuthReference[],
  authRequirements: ConnectorAuthRequirement[],
  authHost: AppConnectorAuthHost | undefined,
  sensitiveValues: Set<string>,
  executionScopeId: import('sparxie').SourceExecutionScopeId,
  sessionExecutor: ReturnType<typeof createSourceSessionExecutor> | null,
  allowActionRequiredRefresh: boolean,
  progress: ConnectorProgressRuntime | undefined,
  dataRuntime?: Pick<AppConnectorRuntime, 'normalization' | 'rawSourceIntake'>,
  reconnectToken?: string,
  onReconnectRefresh?: () => void,
): AppConnectorRuntime {
  const grants = new Map<string, Promise<AppConnectorAuthGrant>>()
  let establishing = 0
  return {
    ...runtime,
    ...dataRuntime,
    ...(progress ? { progress } : {}),
    auth: {
      async resolve(input) {
        if (establishing === 0 && sessionExecutor) {
          const session = sessionExecutor.resolve(executionScopeId)
          if (session.status === 'ready') {
            const reference = authReferences.find((candidate) => candidate.id === input.id)
            return { id: input.id, mode: input.mode ?? reference?.mode ?? 'none', status: 'ready', sessionId: session.sessionId }
          }
        }
        const cacheKey = `${input.id}\u0000${input.mode ?? ''}`
        const cached = grants.get(cacheKey)
        if (cached) {
          return await cached
        }
        const grant = resolveAuthGrant(
          input,
          authReferences,
          authRequirements,
          authHost,
          sensitiveValues,
        )
        grants.set(cacheKey, grant)
        try {
          const resolved = await grant
          return resolved
        } catch (error) {
          grants.delete(cacheKey)
          throw error
        }
      },
      async refresh(input, establish) {
        if (input.executionScopeId !== executionScopeId) {
          return { status: 'failed', reason: 'source_execution_scope_mismatch' }
        }
        if (!sessionExecutor) return { status: 'failed', reason: 'source_session_host_unavailable' }
        const establishSession = async () => {
          establishing += 1
          grants.clear()
          try { return await establish() } finally { establishing -= 1; grants.clear() }
        }
        return reconnectToken
          ? (onReconnectRefresh?.(), sessionExecutor.reconnect(executionScopeId, establishSession, reconnectToken))
          : sessionExecutor.refresh(executionScopeId, establishSession, { allowActionRequired: allowActionRequiredRefresh })
      },
    },
  }
}
const connectorProgressCountKeys = [
  'attempted',
  'discovered',
  'eligible',
  'filtered',
  'resolvedEmployerOrAts',
  'resolvedThirdParty',
  'skipped',
  'unresolved',
] as const
function createPersistedProgressRuntime(
  repository: ReturnType<typeof createSqliteConnectorRepository>,
  connectorRunId: string,
  now: () => Date,
  downstream: ConnectorProgressRuntime | undefined,
): ConnectorProgressRuntime {
  return {
    async report(snapshot) {
      await repository.updateRunProgress({
        connectorRunId,
        stats: sanitizeProgressSnapshot(snapshot, now().toISOString()),
      })
      await downstream?.report(snapshot)
    },
  }
}
function sanitizeProgressSnapshot(
  snapshot: ConnectorProgressSnapshot,
  lastProgressAt: string,
): Record<string, unknown> {
  const counts: Record<string, number> = {}
  for (const key of connectorProgressCountKeys) {
    const value = snapshot.counts[key]
    counts[key] = typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0, Math.floor(value))
      : 0
  }
  return {
    ...counts,
    lastProgressAt,
    stage: snapshot.stage,
    wait: snapshot.wait
      ? {
          maxDelayMs: Math.max(0, Math.floor(snapshot.wait.maxDelayMs)),
          minDelayMs: Math.max(0, Math.floor(snapshot.wait.minDelayMs)),
          reason: snapshot.wait.reason === 'jobright_resolution'
            ? 'jobright_resolution'
            : 'connector_pacing',
        }
      : null,
  }
}
async function resolveAuthGrant(
  input: AppConnectorAuthResolveInput,
  authReferences: ConnectorAuthReference[],
  authRequirements: AppConnectorAuthRequirement[],
  authHost: AppConnectorAuthHost | undefined,
  sensitiveValues: Set<string>,
): Promise<AppConnectorAuthGrant> {
  const reference = authReferences.find(
    (authReference) =>
      authReference.id === input.id &&
      (input.mode === undefined || authReference.mode === input.mode),
  )
  const requirement = authRequirements.find(
    (authRequirement) =>
      authRequirement.id === input.id &&
      (input.mode === undefined || authRequirement.mode === input.mode),
  )
  const mode = input.mode ?? reference?.mode ?? requirement?.mode
  if (mode === 'none') {
    return {
      id: input.id,
      mode,
      status: 'ready',
    }
  }
  if (!reference) {
    return {
      id: input.id,
      mode: mode ?? 'none',
      reason: 'auth_reference_missing',
      status: 'missing',
    }
  }
  return resolveSecretGrant(reference, authHost, sensitiveValues)
}
async function resolveSecretGrant(
  reference: ConnectorAuthReference,
  authHost: AppConnectorAuthHost | undefined,
  sensitiveValues: Set<string>,
): Promise<AppConnectorAuthGrant> {
  if (!reference.secretKey) {
    return {
      id: reference.id,
      mode: reference.mode,
      reason: 'secret_reference_missing',
      status: 'missing',
    }
  }
  const secret = await authHost?.secrets?.revealSecret(reference.secretKey)
  if (!secret) {
    return {
      id: reference.id,
      mode: reference.mode,
      reason: 'secret_missing',
      secretKey: reference.secretKey,
      status: 'missing',
    }
  }
  if (secret.value.length > 0) {
    sensitiveValues.add(secret.value)
  }
  return {
    id: reference.id,
    mode: reference.mode,
    secretKey: reference.secretKey,
    status: 'ready',
    value: secret.value,
  }
}
function redactRefreshResult(
  result: AppConnectorRefreshResult,
  sensitiveValues: Set<string>,
): ConnectorRefreshResultInput {
  if (sensitiveValues.size === 0) {
    return result
  }
  return redactSensitiveValue(result, sensitiveValues) as ConnectorRefreshResultInput
}
function redactSensitiveValue(value: unknown, sensitiveValues: Set<string>): unknown {
  if (typeof value === 'string') {
    return redactSensitiveString(value, sensitiveValues)
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValue(item, sensitiveValues))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        redactSensitiveValue(item, sensitiveValues),
      ]),
    )
  }
  return value
}
function redactSensitiveString(value: string, sensitiveValues: Set<string>): string {
  let next = value
  const sortedSensitiveValues = [...sensitiveValues].sort(
    (left, right) => right.length - left.length,
  )
  for (const sensitiveValue of sortedSensitiveValues) {
    next = next.split(sensitiveValue).join(REDACTED_SECRET_VALUE)
  }
  return next
}
function parseIsoDate(value: string, label: string): Date {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid connector ${label}: ${value}`)
  }
  return date
}
function toJsonRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return value as Record<string, unknown>
}
function cloneJsonRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(stableJsonStringify(value)) as Record<string, unknown>
}
function checkpointSignatureForConnector(
  connector: AppJobConnector,
  filters: Record<string, unknown>,
): string {
  return connectorCheckpointSignatureModule.connectorCheckpointSignature({
    connectorId: connector.definition.id,
    connectorVersion: connector.definition.version,
    supportsFiltering: connector.definition.capabilities?.supportsFiltering,
    filters,
  })
}
export function isJobrightRawFirstConnector(connector: AppJobConnector): boolean {
  return connectorCheckpointSignatureModule.isJobrightProviderStateSignature({
    connectorId: connector.definition.id,
    connectorVersion: connector.definition.version,
    supportsFiltering: connector.definition.capabilities?.supportsFiltering,
  })
}
function stableJsonStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(',')}]`
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJsonStringify(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}
