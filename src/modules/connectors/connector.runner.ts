import type {
  ConnectorAuthGrant,
  ConnectorAuthMode,
  ConnectorAuthReference,
  ConnectorAuthRequirement,
  ConnectorAuthResolveInput,
  ConnectorAuthValidationInput,
  ConnectorAuthValidationResult,
  ConnectorAuthValidationStatus,
  ConnectorCoverageWindow,
  ConnectorDefinition,
  ConnectorDelayRuntime,
  ConnectorRefreshInput,
  ConnectorRefreshMode,
  ConnectorRefreshResult,
  ConnectorRuntime,
  JobConnector,
} from '@sparxie/valedictorian-connectors-core'
import type {
  ConnectorCheckpointPayload,
  ConnectorInstanceRecord,
  ConnectorRefreshResultInput,
  ConnectorRunRecord,
  ConnectorRunTerminalStatus,
  createSqliteConnectorRepository,
} from './connector.repository'

export type AppJobConnectorDefinition = ConnectorDefinition
export type AppConnectorAuthMode = ConnectorAuthMode
export type AppConnectorAuthRequirement = ConnectorAuthRequirement
export type AppConnectorRefreshInput = ConnectorRefreshInput
export type AppConnectorRefreshResult = ConnectorRefreshResult & ConnectorRefreshResultInput
export type AppConnectorAuthGrant = ConnectorAuthGrant
export type AppConnectorAuthResolveInput = ConnectorAuthResolveInput
export type AppConnectorRuntime = ConnectorRuntime

export interface AppConnectorRunBudget {
  concurrency?: number
  minDelayMs?: number
  maxDelayMs?: number
  maxRequestsPerRun?: number
}

export interface AppConnectorSecretResolver {
  revealSecret(key: string): Promise<{ key: string; value: string } | null>
}

export interface AppConnectorAuthHost {
  secrets?: AppConnectorSecretResolver
}

export type AppConnectorRuntimePorts = {
  delay?: ConnectorDelayRuntime
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
  createdAt?: string
}

export interface RunConnectorRefreshInput {
  connectorRunId?: string
  connectorInstanceId: string
  mode: ConnectorRefreshMode
  coverage: ConnectorCoverageWindow
  startedAt?: string
  completedAt?: string
  budget?: AppConnectorRunBudget
}

export interface RunConnectorCatchUpInput {
  connectorRunId?: string
  connectorInstanceId: string
  now?: string
  startedAt?: string
  completedAt?: string
  policy?: Partial<AppConnectorRunPolicy>
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

export interface AppConnectorRunPolicy {
  backfillDays: number
  maxBackfillDays: number
  overlapMinutes: number
  concurrency?: number
  minDelayMs?: number
  maxDelayMs?: number
  maxRequestsPerRun?: number
}

export interface CreateConnectorRunnerOptions {
  auth?: AppConnectorAuthHost
  repository: ReturnType<typeof createSqliteConnectorRepository>
  runtime?: AppConnectorRuntimePorts
  workspaceId: string
  now?: () => Date
}

const DEFAULT_BACKFILL_DAYS = 7
const DEFAULT_MAX_BACKFILL_DAYS = 30
const DEFAULT_OVERLAP_MINUTES = 30
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000
const MILLISECONDS_PER_MINUTE = 60 * 1000
const REDACTED_SECRET_VALUE = '[redacted-secret]'

export function createConnectorRunner({
  auth,
  repository,
  runtime = {},
  workspaceId,
  now = () => new Date(),
}: CreateConnectorRunnerOptions) {
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
    const filterSignature = signatureForFilters(filters)
    const checkpoint = await repository.getCheckpoint({
      connectorInstanceId: input.connectorInstanceId,
      filterSignature,
    })
    const budget = input.budget ?? budgetFromPoliteness(
      normalizeRunPolicy(undefined, connector.definition.politeness?.maxBackfillDays),
      connector.definition.politeness,
    )
    const sensitiveValues = new Set<string>()
    const authRequirements = connector.definition.auth?.requirements ?? []
    const runRuntime = createRunRuntime(
      runtime,
      connectorInstance.auth,
      authRequirements,
      auth,
      sensitiveValues,
    )
    const result = await connector.refresh(
      {
        connectorInstanceId: input.connectorInstanceId,
        workspaceId,
        mode: input.mode,
        coverage: input.coverage,
        config,
        filters,
        ...(budget ? { budget } : {}),
        ...(checkpoint ? { checkpoint: checkpoint.checkpoint } : {}),
      },
      runRuntime,
    )

    const safeResult = withRunProgressStats(redactRefreshResult(result, sensitiveValues))
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
      result: safeResult,
    })

    return {
      checkpoint: {
        connectorInstanceId: input.connectorInstanceId,
        filterSignature,
        checkpoint: safeResult.nextCheckpoint,
        coverage: safeResult.coverage,
        savedAt: completedAt,
      },
      run,
      terminalStatus: terminalConnectorRunStatus(safeResult.status),
    }
  }

  async function prepareCatchUpRefresh(
    connector: AppJobConnector,
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
    const createdAt = parseIsoDate(instance.createdAt, 'connector instance createdAt')
    const policy = normalizeRunPolicy(input.policy, connector.definition.politeness?.maxBackfillDays)
    const filters = cloneJsonRecord(toJsonRecord(instance.filters))
    const checkpoint = await repository.getCheckpoint({
      connectorInstanceId: input.connectorInstanceId,
      filterSignature: signatureForFilters(filters),
    })
    const lowerBound = new Date(createdAt.getTime() - policy.backfillDays * MILLISECONDS_PER_DAY)
    const previousCoverageEndedAt = checkpoint?.coverageEndedAt
      ? parseIsoDate(checkpoint.coverageEndedAt, 'checkpoint coverage end')
      : null
    const candidateStart = previousCoverageEndedAt
      ? new Date(previousCoverageEndedAt.getTime() - policy.overlapMinutes * MILLISECONDS_PER_MINUTE)
      : lowerBound
    const coverageStart = candidateStart.getTime() < lowerBound.getTime() ? lowerBound : candidateStart

    return {
      instance,
      refreshInput: {
        connectorRunId: input.connectorRunId,
        connectorInstanceId: input.connectorInstanceId,
        mode: 'catch_up',
        coverage: {
          start: coverageStart.toISOString(),
          end: end.toISOString(),
        },
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        budget: budgetFromPoliteness(policy, connector.definition.politeness),
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
    const runRuntime = createRunRuntime(
      runtime,
      connectorInstance.auth,
      authRequirements,
      auth,
      sensitiveValues,
    )

    let result: ConnectorAuthValidationResult

    try {
      result = await connector.validateAuth(
        {
          connectorInstanceId: input.connectorInstanceId,
          workspaceId,
        },
        runRuntime,
      )
    } catch (error) {
      if (isSecureStorageUnavailableError(error)) {
        return {
          connectorInstanceId: input.connectorInstanceId,
          message: authValidationMessage('failed', 'secure_storage_unavailable'),
          reason: 'secure_storage_unavailable',
          status: 'failed',
        }
      }

      return {
        connectorInstanceId: input.connectorInstanceId,
        message: 'Connector auth validation failed.',
        reason: 'validate_auth_failed',
        status: 'failed',
      }
    }

    return sanitizeAuthValidationResult(input.connectorInstanceId, result, sensitiveValues)
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

const allowedAuthValidationStatuses = new Set<ConnectorAuthValidationStatus>([
  'ready',
  'missing',
  'expired',
  'action_required',
  'rate_limited',
  'retryable',
  'failed',
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
    value === 'partial_success' ||
    value === 'skipped'
  ) {
    return value
  }

  return 'completed'
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

function withRunProgressStats(result: ConnectorRefreshResultInput): ConnectorRefreshResultInput {
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
): AppConnectorRuntime {
  const grants = new Map<string, Promise<AppConnectorAuthGrant>>()

  return {
    ...runtime,
    auth: {
      async resolve(input) {
        const cacheKey = `${input.id}\u0000${input.mode ?? ''}`
        const cached = grants.get(cacheKey)

        if (cached) {
          return cached
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
          return await grant
        } catch (error) {
          grants.delete(cacheKey)
          throw error
        }
      },
    },
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
  const referenceMode = reference.mode

  if (
    referenceMode === 'api_key' ||
    referenceMode === 'bearer_token' ||
    referenceMode === 'oauth' ||
    referenceMode === 'cookie_jar' ||
    referenceMode === 'username_password'
  ) {
    return resolveSecretGrant(reference, authHost, sensitiveValues)
  }

  return {
    id: reference.id,
    mode: referenceMode,
    reason: 'browser_session_action_required',
    status: 'action_required',
  }
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

function budgetFromPoliteness(
  policy: AppConnectorRunPolicy,
  politeness: ConnectorDefinition['politeness'] | undefined,
): AppConnectorRunBudget | undefined {
  const budget: AppConnectorRunBudget = {}
  const concurrency = lowerPositive(policy.concurrency, politeness?.concurrency)
  const minDelayMs = higherPositive(policy.minDelayMs, politeness?.minDelayMs)
  const maxDelayMs = lowerPositive(policy.maxDelayMs, politeness?.maxDelayMs)
  const maxRequestsPerRun = lowerPositive(
    policy.maxRequestsPerRun,
    politeness?.maxRequestsPerRun,
  )

  if (concurrency !== undefined) {
    budget.concurrency = concurrency
  }
  if (minDelayMs !== undefined) {
    budget.minDelayMs = minDelayMs
  }
  if (maxDelayMs !== undefined) {
    budget.maxDelayMs = maxDelayMs
  }
  if (maxRequestsPerRun !== undefined) {
    budget.maxRequestsPerRun = maxRequestsPerRun
  }

  return Object.keys(budget).length > 0 ? budget : undefined
}

function normalizeRunPolicy(
  policy: Partial<AppConnectorRunPolicy> = {},
  connectorMaxBackfillDays?: number,
): AppConnectorRunPolicy {
  const hostMaxBackfillDays = positiveNumber(policy.maxBackfillDays, DEFAULT_MAX_BACKFILL_DAYS)
  const maxBackfillDays = connectorMaxBackfillDays
    ? Math.min(hostMaxBackfillDays, positiveNumber(connectorMaxBackfillDays, hostMaxBackfillDays))
    : hostMaxBackfillDays
  const requestedBackfillDays = positiveNumber(policy.backfillDays, DEFAULT_BACKFILL_DAYS)

  return {
    backfillDays: Math.min(requestedBackfillDays, maxBackfillDays),
    maxBackfillDays,
    overlapMinutes: positiveNumber(policy.overlapMinutes, DEFAULT_OVERLAP_MINUTES),
    concurrency: positiveOptionalNumber(policy.concurrency),
    minDelayMs: positiveOptionalNumber(policy.minDelayMs),
    maxDelayMs: positiveOptionalNumber(policy.maxDelayMs),
    maxRequestsPerRun: positiveOptionalNumber(policy.maxRequestsPerRun),
  }
}

function positiveNumber(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) || value <= 0 ? fallback : value
}

function positiveOptionalNumber(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value) || value <= 0 ? undefined : value
}

function lowerPositive(
  left: number | undefined,
  right: number | undefined,
): number | undefined {
  const values = [left, right].filter((value): value is number => value !== undefined)

  return values.length > 0 ? Math.min(...values) : undefined
}

function higherPositive(
  left: number | undefined,
  right: number | undefined,
): number | undefined {
  const values = [left, right].filter((value): value is number => value !== undefined)

  return values.length > 0 ? Math.max(...values) : undefined
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

function signatureForFilters(filters: Record<string, unknown>): string {
  return `filters:${stableJsonStringify(filters)}`
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
