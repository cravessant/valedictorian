import type { ConnectorSchedulingCapability } from 'sparxie'
import type { ConnectorRunRecoveryLifecycle } from '../modules/connectors/connector.recovery'
import type { LocalConnectorRegistry } from '../modules/connectors/connector.registry'
import type { AppConnectorRuntimePorts } from '../modules/connectors/connector.runner'
import type { ProfileSecretCodec } from '../modules/profile/profile.repository'
import type { NormalizationResolverRegistry } from '../modules/sourcing/normalization.registry'

export interface LocalValedictorianClientOptions {
  connectorRunRecovery?: ConnectorRunRecoveryLifecycle
  connectorRegistry?: LocalConnectorRegistry
  connectorRuntime?: AppConnectorRuntimePorts
  /** Explicit scheduling capability; shared with server capability reporting when injected. */
  connectorScheduling?: ConnectorSchedulingCapability
  now?: () => Date
  normalizationRegistry?: NormalizationResolverRegistry
  referenceTrackerPath?: string
  seedDataMode?: ValedictorianSeedDataMode
  secretCodec?: ProfileSecretCodec
  sqlitePath: string
  workspaceId?: string
}

export type ValedictorianSeedDataMode = 'none' | 'sample' | 'reference-tracker'
