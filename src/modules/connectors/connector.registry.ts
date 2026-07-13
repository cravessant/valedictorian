import type { AppJobConnector } from './connector.runner'

export interface LocalConnectorRegistry {
  get(connectorId: string): AppJobConnector | null
}

export function createStaticConnectorRegistry(
  connectors: AppJobConnector[],
): LocalConnectorRegistry {
  const connectorsById = new Map(
    connectors.map((connector) => [connector.definition.id, connector]),
  )

  return {
    get(connectorId) {
      return connectorsById.get(connectorId) ?? null
    },
  }
}

export function createDefaultLocalConnectorRegistry(): LocalConnectorRegistry {
  return createStaticConnectorRegistry([])
}
