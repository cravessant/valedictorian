import type { ConnectorSchedulingCapability } from '@sparxie/sdk'
import type { ConnectorRunRecoveryLifecycle } from '../modules/connectors/connector.recovery'
import type { LocalConnectorRegistry } from '../modules/connectors/connector.registry'
import type { AppConnectorRuntimePorts } from '../modules/connectors/connector.runner'
import type { SecretCodec } from '../modules/secrets/secret.codec'
import type { PgliteDatabase } from '../db/pglite'
import type { UuidV7Generator } from '../db/uuidv7'
import type { ProfileService } from '../modules/profile/profile.service'
import type { SecretService } from '../modules/secrets/secret.service'
import type { LocalScheduledWorkSource } from './local-scheduler'

export interface LocalValedictorianClientOptions {
  /** Caller-owned, already-migrated shared workspace database. */
  database: PgliteDatabase
  connectorRunRecovery?: ConnectorRunRecoveryLifecycle
  connectorRegistry?: LocalConnectorRegistry
  connectorRuntime?: AppConnectorRuntimePorts
  /** Explicit scheduling capability; shared with server capability reporting when injected. */
  connectorScheduling?: ConnectorSchedulingCapability
  deferCompanyCoverageMigration?: boolean
  now?: () => Date
  onScheduledWorkChanged?: () => void
  registerScheduledWorkSource?: (source: LocalScheduledWorkSource) => void
  scheduleCompanyCoverageMigration?: (run: () => Promise<void>) => void
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
