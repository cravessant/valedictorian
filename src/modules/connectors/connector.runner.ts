import type {
  ConnectorAuthMode,
  ConnectorAuthReference,
  ConnectorCoverageWindow,
  ConnectorInstanceRecord,
  ConnectorRefreshResultInput,
  ConnectorRunRecord,
  createSqliteConnectorRepository,
} from './connector.repository'

export interface AppJobConnectorDefinition {
  id: string
  version: string
  displayName?: string
  configSchema?: AppConnectorSchemaDeclaration
  filterSchema?: AppConnectorSchemaDeclaration
  auth?: AppConnectorAuthDeclaration
  capabilities?: AppConnectorCapabilityDeclaration
  checkpoint?: AppConnectorCheckpointDeclaration
  politeness?: AppConnectorPolitenessDefaults
}

export interface AppConnectorSchemaDeclaration {
  version: string
  schema: Record<string, unknown>
}

export type AppConnectorAuthMode =
  ConnectorAuthMode

export interface AppConnectorAuthDeclaration {
  modes: AppConnectorAuthMode[]
  requirements?: AppConnectorAuthRequirement[]
}

export interface AppConnectorAuthRequirement {
  id: string
  mode: AppConnectorAuthMode
  label?: string
  required?: boolean
}

export interface AppConnectorCapabilityDeclaration {
  fetchesPublicPages?: boolean
  resolvesIntermediaryLinks?: boolean
  usesBrowserSession?: boolean
  supportsIncrementalRefresh?: boolean
  supportsFiltering?: boolean
}

export interface AppConnectorCheckpointDeclaration {
  schemaVersion: string
}

export interface AppConnectorPolitenessDefaults {
  concurrency?: number
  minDelayMs?: number
  maxDelayMs?: number
  maxRequestsPerRun?: number
  maxBackfillDays?: number
}

export interface AppConnectorRefreshInput {
  connectorInstanceId: string
  mode: string
  coverage: ConnectorCoverageWindow
  checkpoint?: unknown
  config: Record<string, unknown>
  filters: Record<string, unknown>
  budget?: AppConnectorRunBudget
}

export interface AppConnectorRunBudget {
  concurrency?: number
  minDelayMs?: number
  maxDelayMs?: number
  maxRequestsPerRun?: number
}

export type AppConnectorAuthGrantStatus =
  | 'ready'
  | 'missing'
  | 'expired'
  | 'action_required'

export interface AppConnectorAuthGrant {
  id: string
  mode: AppConnectorAuthMode
  status: AppConnectorAuthGrantStatus
  secretKey?: string
  sessionKey?: string
  value?: string
  sessionId?: string
  expiresAt?: string
  reason?: string
}

export interface AppConnectorAuthResolveInput {
  id: string
  mode?: AppConnectorAuthMode
}

export interface AppConnectorAuthRuntime {
  resolve(input: AppConnectorAuthResolveInput): Promise<AppConnectorAuthGrant>
}

export type AppConnectorRuntime = Record<string, unknown> & {
  auth: AppConnectorAuthRuntime
}

export interface AppConnectorSecretResolver {
  revealSecret(key: string): Promise<{ key: string; value: string } | null>
}

export interface AppConnectorBrowserSessionResolver {
  resolve(reference: ConnectorAuthReference): Promise<AppConnectorAuthGrant>
}

export interface AppConnectorAuthHost {
  browserSessions?: AppConnectorBrowserSessionResolver
  secrets?: AppConnectorSecretResolver
}

export interface AppJobConnector {
  definition: AppJobConnectorDefinition
  refresh(
    input: AppConnectorRefreshInput,
    runtime: AppConnectorRuntime,
  ): Promise<ConnectorRefreshResultInput>
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
  connectorInstanceId: string
  mode: string
  coverage: ConnectorCoverageWindow
  startedAt?: string
  completedAt?: string
  budget?: AppConnectorRunBudget
}

export interface RunConnectorCatchUpInput {
  connectorInstanceId: string
  now?: string
  startedAt?: string
  completedAt?: string
  policy?: Partial<AppConnectorRunPolicy>
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
  runtime?: Record<string, unknown>
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
  now = () => new Date(),
}: CreateConnectorRunnerOptions) {
  async function runRefresh(
    connector: AppJobConnector,
    input: RunConnectorRefreshInput,
    instance?: ConnectorInstanceRecord,
  ): Promise<ConnectorRunRecord> {
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
    const sensitiveValues = new Set<string>()
    const result = await connector.refresh(
      {
        connectorInstanceId: input.connectorInstanceId,
        mode: input.mode,
        coverage: input.coverage,
        config,
        filters,
        ...(input.budget ? { budget: input.budget } : {}),
        ...(checkpoint ? { checkpoint: checkpoint.checkpoint } : {}),
      },
      createRunRuntime(
        runtime,
        connectorInstance.auth,
        connector.definition.auth?.requirements ?? [],
        auth,
        sensitiveValues,
      ),
    )
    const safeResult = redactRefreshResult(result, sensitiveValues)
    const completedAt = input.completedAt ?? now().toISOString()

    return repository.recordRefreshResult({
      connectorInstanceId: input.connectorInstanceId,
      mode: input.mode,
      startedAt,
      completedAt,
      config: runConfig,
      filters: runFilters,
      filterSignature,
      result: safeResult,
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
        createdAt: input.createdAt,
      })
    },

    async refresh(
      connector: AppJobConnector,
      input: RunConnectorRefreshInput,
    ): Promise<ConnectorRunRecord> {
      return runRefresh(connector, input)
    },

    async catchUp(
      connector: AppJobConnector,
      input: RunConnectorCatchUpInput,
    ): Promise<ConnectorRunRecord> {
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

      return runRefresh(
        connector,
        {
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
        instance,
      )
    },
  }
}

function createRunRuntime(
  runtime: Record<string, unknown>,
  authReferences: ConnectorAuthReference[],
  authRequirements: AppConnectorAuthRequirement[],
  authHost: AppConnectorAuthHost | undefined,
  sensitiveValues: Set<string>,
): AppConnectorRuntime {
  return {
    ...runtime,
    auth: {
      async resolve(input) {
        return resolveAuthGrant(
          input,
          authReferences,
          authRequirements,
          authHost,
          sensitiveValues,
        )
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
    referenceMode === 'cookie_jar'
  ) {
    return resolveSecretGrant(reference, authHost, sensitiveValues)
  }

  if (authHost?.browserSessions) {
    const grant = sanitizeBrowserSessionGrant(
      reference,
      await authHost.browserSessions.resolve(browserSessionReference(reference)),
      sensitiveValues,
    )

    return grant
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

function browserSessionReference(reference: ConnectorAuthReference): ConnectorAuthReference {
  return {
    id: reference.id,
    mode: reference.mode,
    ...(reference.label === undefined ? {} : { label: reference.label }),
    ...(reference.sessionKey === undefined ? {} : { sessionKey: reference.sessionKey }),
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
  result: ConnectorRefreshResultInput,
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
  politeness: AppConnectorPolitenessDefaults | undefined,
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
