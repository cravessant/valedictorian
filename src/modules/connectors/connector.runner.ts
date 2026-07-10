import type {
  ConnectorAuthGrant,
  ConnectorAuthMode,
  ConnectorAuthReference,
  ConnectorAuthRequirement,
  ConnectorAuthResolveInput,
  ConnectorBrowserSessionRuntime,
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
export type AppConnectorAuthRuntime = ConnectorRuntime['auth']
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

export interface AppConnectorBrowserSessionResolver {
  resolve(reference: ConnectorAuthReference): Promise<AppConnectorAuthGrant>
  validate?(reference: ConnectorAuthReference): Promise<AppConnectorAuthGrant>
}

export interface AppConnectorAuthHost {
  browserSessions?: AppConnectorBrowserSessionResolver
  secrets?: AppConnectorSecretResolver
}

export type AppConnectorRuntimePorts = {
  browserSession?: ConnectorBrowserSessionRuntime
  delay?: ConnectorDelayRuntime
}

export interface AppJobConnector extends Omit<JobConnector, 'refresh'> {
  refresh(
    input: AppConnectorRefreshInput,
    runtime: AppConnectorRuntime,
  ): Promise<AppConnectorRefreshResult>
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
    const authBlocker = await preflightBrowserSessionAuth(authRequirements, runRuntime.auth)
    const result = authBlocker
      ? createAuthRequiredRefreshResult({
        authBlocker,
        checkpoint,
        checkpointSchemaVersion: connector.definition.checkpoint?.schemaVersion,
        coverage: input.coverage,
      })
      : await connector.refresh(
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

    if (refreshRequiresBrowserSessionReconnect(result)) {
      const invalidatedAuth = connectorInstance.auth.map((reference) => {
        if (reference.mode !== 'browser_session' || !reference.sessionKey) {
          return reference
        }

        const invalidatedReference = { ...reference }
        delete invalidatedReference.sessionKey
        return invalidatedReference
      })

      if (invalidatedAuth.some((reference, index) => reference !== connectorInstance.auth[index])) {
        await repository.upsertInstance({
          id: connectorInstance.id,
          connectorId: connectorInstance.connectorId,
          connectorVersion: connectorInstance.connectorVersion,
          displayName: connectorInstance.displayName,
          enabled: connectorInstance.enabled,
          auth: invalidatedAuth,
          config: runConfig,
          filters: runFilters,
          createdAt: connectorInstance.createdAt,
        })
      }
    }

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
  }
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

function refreshRequiresBrowserSessionReconnect(result: AppConnectorRefreshResult): boolean {
  if (result.observations.some((observation) => observation.resolution.status === 'auth_required')) {
    return true
  }

  if (result.warnings.some((warning) => warning.code.startsWith('auth.'))) {
    return true
  }

  if (!result.retryHints || typeof result.retryHints !== 'object' || Array.isArray(result.retryHints)) {
    return false
  }

  const authRequired = (result.retryHints as Record<string, unknown>).authRequired

  return authRequired === true || (typeof authRequired === 'number' && authRequired > 0)
}

async function preflightBrowserSessionAuth(
  authRequirements: ConnectorAuthRequirement[],
  authRuntime: AppConnectorAuthRuntime,
): Promise<AppConnectorAuthGrant | null> {
  for (const requirement of authRequirements) {
    if (requirement.mode !== 'browser_session') {
      continue
    }

    const grant = await authRuntime.resolve({
      id: requirement.id,
      mode: requirement.mode,
    })

    if (grant.status !== 'ready' || !grant.sessionId) {
      return grant
    }
  }

  return null
}

function createAuthRequiredRefreshResult({
  authBlocker,
  checkpoint,
  checkpointSchemaVersion,
  coverage,
}: {
  authBlocker: AppConnectorAuthGrant
  checkpoint: ConnectorCheckpointPayload | null
  checkpointSchemaVersion: string | undefined
  coverage: ConnectorCoverageWindow
}): AppConnectorRefreshResult {
  return {
    coverage,
    nextCheckpoint: checkpoint
      ? {
        checkpoint: checkpoint.checkpoint,
        schemaVersion: checkpoint.schemaVersion,
      }
      : {
        checkpoint: { authRequired: true },
        schemaVersion: checkpointSchemaVersion ?? 'connector-auth-required@1',
      },
    observations: [],
    retryHints: {
      authRequired: 1,
      reason: authBlocker.reason ?? 'browser_session_action_required',
    },
    stats: {
      authRequired: 1,
      observations: 0,
    },
    status: 'partial_success',
    warnings: [
      {
        code: 'auth.required',
        message: 'Connector browser session needs attention.',
      },
    ],
  }
}

function createRunRuntime(
  runtime: AppConnectorRuntimePorts,
  authReferences: ConnectorAuthReference[],
  authRequirements: ConnectorAuthRequirement[],
  authHost: AppConnectorAuthHost | undefined,
  sensitiveValues: Set<string>,
): AppConnectorRuntime {
  const browserSession = createRunBrowserSessionRuntime(runtime.browserSession)
  const grants = new Map<string, Promise<AppConnectorAuthGrant>>()

  return {
    ...runtime,
    ...(browserSession ? { browserSession } : {}),
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

function createRunBrowserSessionRuntime(
  browserSession: ConnectorBrowserSessionRuntime | undefined,
): ConnectorBrowserSessionRuntime | undefined {
  if (!browserSession) {
    return undefined
  }

  let authRequiredResult: Awaited<ReturnType<ConnectorBrowserSessionRuntime['resolveLink']>> | null = null

  return {
    async resolveLink(input) {
      if (authRequiredResult) {
        return authRequiredResult
      }

      let result: Awaited<ReturnType<ConnectorBrowserSessionRuntime['resolveLink']>>

      try {
        result = await browserSession.resolveLink(input)
      } catch {
        result = {
          method: 'connector_browser_session',
          officialUrl: null,
          reason: 'browser_session_resolution_failed',
          status: 'auth_required',
        }
      }

      if (result.status === 'auth_required') {
        authRequiredResult = {
          status: 'auth_required',
          officialUrl: null,
          ...(result.method === undefined ? {} : { method: result.method }),
          ...(result.reason === undefined ? {} : { reason: result.reason }),
        }
      }

      return result
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
    referenceMode === 'cookie_jar'
  ) {
    return resolveSecretGrant(reference, authHost, sensitiveValues)
  }

  if (reference.sessionKey) {
    if (!authHost?.browserSessions?.validate) {
      return {
        id: reference.id,
        mode: referenceMode,
        reason: 'browser_session_verification_required',
        status: 'action_required',
      }
    }

    return sanitizeBrowserSessionGrant(
      reference,
      await authHost.browserSessions.validate(reference),
      sensitiveValues,
    )
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

function sanitizeBrowserSessionGrant(
  reference: ConnectorAuthReference,
  grant: AppConnectorAuthGrant,
  sensitiveValues: Set<string>,
): AppConnectorAuthGrant {
  trackSensitiveGrantValue(grant, sensitiveValues)

  const sessionKey = reference.sessionKey ?? grant.sessionKey
  const sanitizedGrant: AppConnectorAuthGrant = {
    id: reference.id,
    mode: reference.mode,
    status: grant.status,
    ...(grant.expiresAt === undefined ? {} : { expiresAt: grant.expiresAt }),
    ...(grant.reason === undefined ? {} : { reason: grant.reason }),
    ...(grant.sessionId === undefined ? {} : { sessionId: grant.sessionId }),
    ...(sessionKey === undefined ? {} : { sessionKey }),
  }

  trackSensitiveGrantValue(sanitizedGrant, sensitiveValues)

  return sanitizedGrant
}

function trackSensitiveGrantValue(
  grant: AppConnectorAuthGrant,
  sensitiveValues: Set<string>,
): void {
  addSensitiveValue(grant.value, sensitiveValues)
  addSensitiveValue(grant.sessionId, sensitiveValues)
  addSensitiveValue(grant.sessionKey, sensitiveValues)
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

function addSensitiveValue(value: string | undefined, sensitiveValues: Set<string>): void {
  if (value !== undefined && value.length > 0) {
    sensitiveValues.add(value)
  }
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
