import type {
  ConnectorCoverageWindow,
  ConnectorRefreshResultInput,
  ConnectorRunRecord,
  createSqliteConnectorRepository,
} from './connector.repository'

export interface AppJobConnectorDefinition {
  id: string
  version: string
}

export interface AppConnectorRefreshInput {
  connectorInstanceId: string
  mode: string
  coverage: ConnectorCoverageWindow
  checkpoint?: unknown
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
        createdAt: input.createdAt,
      })
    },

    async refresh(
      connector: AppJobConnector,
      input: RunConnectorRefreshInput,
    ): Promise<ConnectorRunRecord> {
      const startedAt = input.startedAt ?? now().toISOString()
      const checkpoint = await repository.getCheckpoint(input.connectorInstanceId)
      const result = await connector.refresh(
        {
          connectorInstanceId: input.connectorInstanceId,
          mode: input.mode,
          coverage: input.coverage,
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
        result,
      })
    },
  }
}
