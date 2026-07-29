import type { InstalledConnectorDescriptor } from '@sparxie/sdk'
import { connectorDescriptorMaxSources } from '@sparxie/sdk'
import type { AppJobConnector } from '../ports/connector.runner-contracts'
import {
  ConnectorAdmissionError,
  admitInstalledConnectorDescriptor,
} from './connector.installed-descriptor'

export { ConnectorAdmissionError } from './connector.installed-descriptor'

export interface RegisteredConnector {
  readonly connector: AppJobConnector
  readonly descriptor: InstalledConnectorDescriptor
}

export interface LocalConnectorRegistry {
  get(connectorId: string): RegisteredConnector | null
  getVersion(connectorId: string, connectorVersion: string): RegisteredConnector | null
  list(): readonly RegisteredConnector[]
}

export function createStaticConnectorRegistry(
  connectors: AppJobConnector[],
): LocalConnectorRegistry {
  // The SDK caps the published descriptor list; admission owns that bound now that the
  // capability read model reuses admitted descriptors instead of reparsing the list result.
  if (connectors.length > connectorDescriptorMaxSources) {
    throw new ConnectorAdmissionError(
      '<registry>',
      `installed connector count ${connectors.length} exceeds the supported maximum of ${connectorDescriptorMaxSources}`,
    )
  }
  const registeredConnectors = Object.freeze(connectors.map((connector) => Object.freeze({
    connector,
    descriptor: admitInstalledConnectorDescriptor(connector),
  })))
  const connectorsById = new Map<string, RegisteredConnector>()
  for (const registered of registeredConnectors) {
    const { connectorId, connectorVersion } = registered.descriptor
    if (connectorsById.has(connectorId)) {
      throw new ConnectorAdmissionError(
        `${connectorId}@${connectorVersion}`,
        'connector id is already installed',
      )
    }
    connectorsById.set(connectorId, registered)
  }

  return {
    get(connectorId) {
      return connectorsById.get(connectorId) ?? null
    },
    getVersion(connectorId, connectorVersion) {
      const registered = connectorsById.get(connectorId)
      return registered?.descriptor.connectorVersion === connectorVersion ? registered : null
    },
    list() {
      return registeredConnectors
    },
  }
}
