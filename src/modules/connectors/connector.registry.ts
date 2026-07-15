import { createJobrightConnector } from '@sparxie/valedictorian-connectors-jobright'
import type { AppJobConnector } from './connector.runner'

export interface LocalConnectorRegistry {
  get(connectorId: string): AppJobConnector | null
  getVersion(connectorId: string, connectorVersion: string): AppJobConnector | null
  list(): readonly AppJobConnector[]
}

export function createStaticConnectorRegistry(
  connectors: AppJobConnector[],
): LocalConnectorRegistry {
  const installedConnectors = Object.freeze([...connectors])
  const connectorsById = new Map(installedConnectors.map((connector) => [
    connector.definition.id,
    connector,
  ]))

  return {
    get(connectorId) {
      return connectorsById.get(connectorId) ?? null
    },
    getVersion(connectorId, connectorVersion) {
      const connector = connectorsById.get(connectorId)
      return connector?.definition.version === connectorVersion ? connector : null
    },
    list() {
      return installedConnectors
    },
  }
}

export function createDefaultLocalConnectorRegistry(): LocalConnectorRegistry {
  return createStaticConnectorRegistry([
    createJobrightConnector({ fetch: globalThis.fetch }),
  ])
}
