import type { ConnectorSchedulingCapability } from '@sparxie/sdk'
import type {
  AppConnectorRuntimePorts,
  ConnectorRunRecoveryLifecycle,
  LocalConnectorRegistry,
} from '../modules/connectors/public'
import type { PgliteDatabase } from '../db/pglite'
import type { UuidV7Generator } from '../db/uuidv7'
import type { ProfileService } from '../modules/profile/public'
import type { SecretCodec, SecretService } from '../modules/secrets/public'
import type { LocalScheduledWorkSource } from '../modules/scheduling/public'

export interface LocalValedictorianClientOptions {
  /** Caller-owned, already-migrated shared workspace database. */
  database: PgliteDatabase
  connectorRunRecovery?: ConnectorRunRecoveryLifecycle
  connectorRegistry?: LocalConnectorRegistry
  connectorRuntime?: AppConnectorRuntimePorts
  /** Explicit scheduling capability; shared with server capability reporting when injected. */
  connectorScheduling?: ConnectorSchedulingCapability
  now?: () => Date
  onScheduledWorkChanged?: () => void
  registerScheduledWorkSource?: (source: LocalScheduledWorkSource) => void
  referenceTrackerPath?: string
  seedDataMode?: ValedictorianSeedDataMode
  secretCodec?: SecretCodec
  /** Explicit local secret-resolution capability policy for this workspace client. */
  localSecretResolutionEnabled?: boolean
  /** Explicit ID generator for deterministic runtime fixtures and tests. */
  newId?: UuidV7Generator
  profilePath?: string
  profileService?: ProfileService
  secretService?: SecretService
  /** Physical workspace identity used by the recovery lifecycle. */
  pgliteDataPath: string
  workspaceId?: string
}

export type ValedictorianSeedDataMode = 'none' | 'sample' | 'reference-tracker'
