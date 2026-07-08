import type {
  ConnectorCoverageWindow,
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
  | 'none'
  | 'api_key'
  | 'bearer_token'
  | 'oauth'
  | 'cookie_jar'
  | 'browser_session'

export interface AppConnectorAuthDeclaration {
  modes: AppConnectorAuthMode[]
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
}

export interface AppConnectorRefreshInput {
  connectorInstanceId: string
  mode: string
  coverage: ConnectorCoverageWindow
  checkpoint?: unknown
  config: Record<string, unknown>
  filters: Record<string, unknown>
}

export type AppConnectorRuntime = Record<string, unknown>

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
}

export interface CreateConnectorRunnerOptions {
  repository: ReturnType<typeof createSqliteConnectorRepository>
  runtime?: AppConnectorRuntime
  now?: () => Date
}

export function createConnectorRunner({
  repository,
  runtime = {},
  now = () => new Date(),
}: CreateConnectorRunnerOptions) {
  return {
    async registerInstance(input: RegisterConnectorInstanceInput) {
      return repository.upsertInstance({
        id: input.id,
        connectorId: input.connector.definition.id,
        connectorVersion: input.connector.definition.version,
        displayName: input.displayName,
        enabled: input.enabled,
        config: input.config,
        filters: input.filters,
        createdAt: input.createdAt,
      })
    },

    async refresh(
      connector: AppJobConnector,
      input: RunConnectorRefreshInput,
    ): Promise<ConnectorRunRecord> {
      const startedAt = input.startedAt ?? now().toISOString()
      const instance = await repository.getInstance(input.connectorInstanceId)

      if (!instance) {
        throw new Error(`Connector instance not found: ${input.connectorInstanceId}`)
      }

      const config = cloneJsonRecord(toJsonRecord(instance.config))
      const filters = cloneJsonRecord(toJsonRecord(instance.filters))
      const runConfig = cloneJsonRecord(config)
      const runFilters = cloneJsonRecord(filters)
      const filterSignature = signatureForFilters(filters)
      const checkpoint = await repository.getCheckpoint({
        connectorInstanceId: input.connectorInstanceId,
        filterSignature,
      })
      const result = await connector.refresh(
        {
          connectorInstanceId: input.connectorInstanceId,
          mode: input.mode,
          coverage: input.coverage,
          config,
          filters,
          ...(checkpoint ? { checkpoint: checkpoint.checkpoint } : {}),
        },
        runtime,
      )
      const completedAt = input.completedAt ?? now().toISOString()

      return repository.recordRefreshResult({
        connectorInstanceId: input.connectorInstanceId,
        mode: input.mode,
        startedAt,
        completedAt,
        config: runConfig,
        filters: runFilters,
        filterSignature,
        result,
      })
    },
  }
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
