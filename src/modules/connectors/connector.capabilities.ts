import type {
  InstalledConnectorDescriptor,
  InstalledConnectorDescriptorsListResult,
} from '@sparxie/sdk'
import {
  installedConnectorDescriptorSchema,
  installedConnectorDescriptorsListResultSchema,
} from '@sparxie/sdk'
import type { AppJobConnector } from './connector.runner'
import type { LocalConnectorRegistry } from './connector.registry'

export function projectInstalledConnectorDescriptor(
  connector: AppJobConnector,
): InstalledConnectorDescriptor {
  const definition = connector.definition
  return installedConnectorDescriptorSchema.parse({
    connectorId: definition.id,
    connectorVersion: definition.version,
    displayName: definition.displayName ?? definition.id,
    ...(definition.configSchema ? { configSchema: clonePlainData(definition.configSchema) } : {}),
    ...(definition.filterSchema ? { filterSchema: clonePlainData(definition.filterSchema) } : {}),
    ...(definition.dynamicOptions
      ? { dynamicOptions: projectDynamicOptions(definition.dynamicOptions) }
      : {}),
  })
}

export function listInstalledConnectorDescriptors(
  registry: LocalConnectorRegistry,
): InstalledConnectorDescriptorsListResult {
  return installedConnectorDescriptorsListResultSchema.parse({
    items: registry.list().map(projectInstalledConnectorDescriptor),
  })
}

function projectDynamicOptions(
  declaration: NonNullable<AppJobConnector['definition']['dynamicOptions']>,
) {
  return {
    protocolVersion: declaration.protocolVersion,
    version: declaration.version,
    sources: declaration.sources.map((source) => ({
      id: source.id,
      version: source.version,
      label: source.label,
      valueSchema: clonePlainData(source.valueSchema),
      display: clonePlainData(source.display),
      operations: clonePlainData(source.operations),
      ...(source.dependencies ? { dependencies: clonePlainData(source.dependencies) } : {}),
    })),
    bindings: declaration.bindings.map((binding) => ({ ...binding })),
  }
}

function clonePlainData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clonePlainData)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
      key,
      clonePlainData(nested),
    ]))
  }
  return value
}
