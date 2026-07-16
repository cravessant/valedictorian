import type { ConnectorSchedulingCapability } from 'sparxie'
import type { ConnectorRunRecoveryLifecycle } from '../modules/connectors/connector.recovery'
import type { LocalConnectorRegistry } from '../modules/connectors/connector.registry'
import type { AppConnectorRuntimePorts } from '../modules/connectors/connector.runner'
import type { ProfileSecretCodec } from '../modules/profile/profile.repository'
import type { NormalizationResolverRegistry } from '../modules/sourcing/normalization.registry'
import type { DrizzleDatabase } from '../db/sqlite'
import type { LocalScheduledWorkSource } from './local-scheduler'

export interface LocalValedictorianClientOptions {
  connectorRunRecovery?: ConnectorRunRecoveryLifecycle
  connectorRegistry?: LocalConnectorRegistry
  connectorRuntime?: AppConnectorRuntimePorts
  /** Explicit scheduling capability; shared with server capability reporting when injected. */
  connectorScheduling?: ConnectorSchedulingCapability
  now?: () => Date
  onScheduledWorkChanged?: () => void
  registerScheduledWorkSource?: (source: LocalScheduledWorkSource) => void
  normalizationRegistry?: NormalizationResolverRegistry
  projectCanonicalCandidate?: (
    transaction: Parameters<Parameters<DrizzleDatabase['transaction']>[0]>[0],
    candidateId: string,
    rawRevisionId: string,
  ) => string
  referenceTrackerPath?: string
  seedDataMode?: ValedictorianSeedDataMode
  secretCodec?: ProfileSecretCodec
  sqlitePath: string
  workspaceId?: string
}

export type ValedictorianSeedDataMode = 'none' | 'sample' | 'reference-tracker'
