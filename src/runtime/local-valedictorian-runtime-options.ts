import type { ConnectorSchedulingCapability } from 'sparxie'
import type { ConnectorRunRecoveryLifecycle } from '../modules/connectors/connector.recovery'
import type { LocalConnectorRegistry } from '../modules/connectors/connector.registry'
import type { AppConnectorRuntimePorts } from '../modules/connectors/connector.runner'
import type { SecretCodec } from '../modules/secrets/secret.codec'
import type { NormalizationResolverRegistry } from '../modules/sourcing/normalization.registry'
import type { DrizzleDatabase } from '../db/sqlite'
import type { ProfileService } from '../modules/profile/profile.service'
import type { SecretService } from '../modules/secrets/secret.service'
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
  secretCodec?: SecretCodec
  /** Explicit local secret-resolution capability policy for this workspace client. */
  localSecretResolutionEnabled?: boolean
  profilePath?: string
  profileService?: ProfileService
  secretService?: SecretService
  sqlitePath: string
  workspaceId?: string
}

export type ValedictorianSeedDataMode = 'none' | 'sample' | 'reference-tracker'
