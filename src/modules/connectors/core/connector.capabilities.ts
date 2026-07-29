import type { InstalledConnectorDescriptorsListResult } from '@sparxie/sdk'
import type { LocalConnectorRegistry } from './connector.registry'

export function listInstalledConnectorDescriptors(
  registry: LocalConnectorRegistry,
): InstalledConnectorDescriptorsListResult {
  return { items: registry.list().map((registered) => registered.descriptor) }
}
