import { createJobrightConnector } from '@sparxie/valedictorian-connectors-jobright'
import {
  createStaticConnectorRegistry,
  type LocalConnectorRegistry,
} from '../../core/connector.registry'

export function createDefaultLocalConnectorRegistry(): LocalConnectorRegistry {
  return createStaticConnectorRegistry([
    createJobrightConnector({ fetch: globalThis.fetch }),
  ])
}
