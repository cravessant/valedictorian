import path from 'node:path'
import {
  createHttpValedictorianClient,
  defaultValedictorianApiBaseUrl,
  type HttpValedictorianClientOptions,
  type ValedictorianClient,
} from '@sparxie/sdk'
import {
  createValedictorianHttpServer,
  type CreateValedictorianHttpServerOptions,
  type StartedValedictorianHttpServer,
} from '../server/local-server'
import {
  createDefaultLocalConnectorPorts,
  type DefaultLocalConnectorPorts,
} from '../modules/connectors/connector.runtime-ports'
import { localDesktopConnectorSchedulingCapability } from '../modules/connectors/connector-schedule.capability'
import type { LocalWorkspaceClient } from './local-connector-client.contract'
import type { LocalWorkspaceManager } from '../server/local-workspaces'
import { defaultAppSettings, type AppSettings } from '../settings/app-settings'
import type { SecretCodec } from '../modules/secrets/secret.codec'
import { isSecretCodecAvailable } from '../modules/secrets/secret.codec'
import {
  prepareWorkspaceProfileCapabilities,
  type PreparedWorkspaceProfileCapabilities,
} from '../modules/profile/profile.composition'
import type { ConnectorRunRecoveryLifecycle } from '../modules/connectors/connector.recovery'
import {
  createLocalValedictorianClient,
  type LocalValedictorianClient,
  type ValedictorianSeedDataMode,
  type LocalValedictorianClientOptions,
} from './local-valedictorian-client'
import {
  createLocalScheduler,
  type LocalScheduler,
  type LocalSchedulerOptions,
} from './local-scheduler'
import { readNonEmptyEnvironmentApiToken } from './api-token-resolution'
import type { ProfileService } from '../modules/profile/profile.service'
import type { SecretService } from '../modules/secrets/secret.service'

export type ValedictorianRuntimeMode = 'local-desktop' | 'local-shared' | 'remote'

export interface ValedictorianRuntimeConfigInput {
  apiToken?: string
  env?: Record<string, string | undefined>
  settings?: AppSettings
  userDataPath: string
  workspaceDataPath?: string
  workspaceId?: string
}

export interface ValedictorianRuntimeConfig {
  apiHost: string
  apiPort: number
  apiToken?: string
  apiUrl: string
  /** Isolated validation owns an explicitly allocated loopback port. */
  bindConfiguredApiPort?: true
  mode: ValedictorianRuntimeMode
  profilePath: string
  referenceTrackerPath?: string
  seedDataMode: ValedictorianSeedDataMode
  pgliteDataPath: string
  workspaceId?: string
}

export interface ValedictorianRuntime {
  client: LocalWorkspaceClient
  connectors: LocalValedictorianClient['connectors'] | null
  profileService: ProfileService | null
  secretService: SecretService | null
  close: () => Promise<void>
  stopScheduler: () => Promise<void>
  server: Pick<StartedValedictorianHttpServer, 'close' | 'url'> | null
  restartServer: (() => Promise<Pick<StartedValedictorianHttpServer, 'close' | 'url'>>) | null
}

export interface CreateValedictorianRuntimeOptions {
  config: ValedictorianRuntimeConfig
  createConnectorPorts?: (workspaceId?: string) => DefaultLocalConnectorPorts
  createHttpClient?: (options: HttpValedictorianClientOptions) => ValedictorianClient
  createLocalClient?: (
    options: LocalValedictorianClientOptions,
  ) => Promise<LocalValedictorianClient> | LocalValedictorianClient
  createScheduler?: (options?: LocalSchedulerOptions) => LocalScheduler
  connectorRunRecovery?: ConnectorRunRecoveryLifecycle
  deferServerStart?: boolean
  prepareWorkspaceCapabilities?: typeof prepareWorkspaceProfileCapabilities
  secretCodec?: SecretCodec
  schedulerOptions?: LocalSchedulerOptions
  startServer?: (
    options: CreateValedictorianHttpServerOptions,
  ) => Promise<Pick<StartedValedictorianHttpServer, 'close' | 'url'>>
  workspaceManager?: LocalWorkspaceManager
}

export function resolveValedictorianRuntimeConfig({
  apiToken,
  env = process.env,
  settings = defaultAppSettings,
  userDataPath,
  workspaceDataPath,
  workspaceId,
}: ValedictorianRuntimeConfigInput): ValedictorianRuntimeConfig {
  const mode = readRuntimeMode(env.VALEDICTORIAN_MODE ?? settings.runtimeMode)
  const apiHost = env.VALEDICTORIAN_API_HOST ?? settings.localApiHost
  const apiPort = parsePort(
    env.VALEDICTORIAN_API_PORT ?? String(settings.localApiPort),
    env.VALEDICTORIAN_ISOLATED_VALIDATION === '1',
  )
  const defaultApiUrl = `http://${apiHost}:${apiPort}`

  return {
    apiHost,
    apiPort,
    apiToken: readNonEmptyEnvironmentApiToken(env) ?? (apiToken || undefined),
    apiUrl:
      env.VALEDICTORIAN_API_URL ??
      (mode === 'remote' ? settings.remoteApiUrl || defaultValedictorianApiBaseUrl : defaultApiUrl),
    ...(env.VALEDICTORIAN_ISOLATED_VALIDATION === '1' ? { bindConfiguredApiPort: true as const } : {}),
    mode,
    profilePath:
      env.VALEDICTORIAN_PROFILE_PATH ?? path.join(workspaceDataPath ?? userDataPath, 'profile.json'),
    referenceTrackerPath: env.VALEDICTORIAN_REFERENCE_TRACKER_PATH,
    seedDataMode: readSeedDataMode(env.VALEDICTORIAN_SEED_DATA),
    pgliteDataPath:
      env.VALEDICTORIAN_PGLITE_DATA_PATH ?? path.join(workspaceDataPath ?? userDataPath, 'pglite'),
    workspaceId,
  }
}

export async function createValedictorianRuntime({
  config,
  createConnectorPorts = () => createDefaultLocalConnectorPorts(),
  createHttpClient = createHttpValedictorianClient,
  createLocalClient = createLocalValedictorianClient,
  createScheduler = createLocalScheduler,
  connectorRunRecovery,
  deferServerStart = false,
  prepareWorkspaceCapabilities,
  secretCodec,
  schedulerOptions,
  startServer = createValedictorianHttpServer,
  workspaceManager,
}: CreateValedictorianRuntimeOptions): Promise<ValedictorianRuntime> {
  if (config.mode === 'remote') {
    if (!config.workspaceId) {
      throw new Error('A workspace id is required when VALEDICTORIAN_MODE=remote')
    }

    return {
      client: createHttpClient({
        baseUrl: config.apiUrl,
        token: config.apiToken,
      }).forWorkspace(config.workspaceId),
      connectors: null,
      profileService: null,
      secretService: null,
      close: async () => undefined,
      stopScheduler: async () => undefined,
      restartServer: null,
      server: null,
    }
  }

  const connectorPorts = createConnectorPorts(config.workspaceId)
  const scheduler = createScheduler(schedulerOptions)
  const effectiveConnectorRunRecovery = connectorRunRecovery ?? workspaceManager?.connectorRunRecovery
  const recoveryScope = effectiveConnectorRunRecovery
    ? {
        pgliteDataPath: config.pgliteDataPath,
        workspaceId: config.workspaceId ?? 'local-workspace',
      }
    : null
  const localSecretResolutionEnabled =
    config.mode === 'local-shared'
    && Boolean(config.apiToken)
    && isSecretCodecAvailable(secretCodec)

  const prepareCapabilities = prepareWorkspaceCapabilities
    ?? (createLocalClient === createLocalValedictorianClient
      ? prepareWorkspaceProfileCapabilities
      : null)
  let preparedCapabilities: PreparedWorkspaceProfileCapabilities | null = null
  if (prepareCapabilities) {
    preparedCapabilities = await prepareCapabilities({
      profilePath: config.profilePath,
      secretCodec: secretCodec ?? unavailableRuntimeSecretCodec,
      pgliteDataPath: config.pgliteDataPath,
      workspaceId: config.workspaceId ?? 'local-workspace',
    })
  }

  let capabilitiesDisposed = false
  const disposePreparedCapabilities = async () => {
    if (capabilitiesDisposed) return
    capabilitiesDisposed = true
    await preparedCapabilities?.dispose()
  }
  let client: LocalValedictorianClient
  try {
    client = await createLocalClient({
      ...(preparedCapabilities ? { database: preparedCapabilities.database } : {}),
      ...(effectiveConnectorRunRecovery === undefined
        ? {}
        : { connectorRunRecovery: effectiveConnectorRunRecovery }),
      connectorRuntime: connectorPorts.connectorRuntime,
      connectorScheduling: config.mode === 'local-desktop'
        ? localDesktopConnectorSchedulingCapability
        : undefined,
      localSecretResolutionEnabled,
      profilePath: config.profilePath,
      ...(preparedCapabilities === null
        ? {}
        : {
            profileService: preparedCapabilities.profileService,
            secretService: preparedCapabilities.secretService,
          }),
      onScheduledWorkChanged: () => scheduler.signal(),
      referenceTrackerPath: config.referenceTrackerPath,
      seedDataMode: config.seedDataMode,
      ...(secretCodec === undefined ? {} : { secretCodec }),
      pgliteDataPath: config.pgliteDataPath,
      registerScheduledWorkSource: (source) => scheduler.register(source),
      ...(config.workspaceId === undefined ? {} : { workspaceId: config.workspaceId }),
    } as LocalValedictorianClientOptions)
  } catch (error) {
    if (recoveryScope) effectiveConnectorRunRecovery?.deactivate(recoveryScope)
    await disposePreparedCapabilities()
    throw error
  }

  const serverOptions: CreateValedictorianHttpServerOptions = {
    client,
    host: config.apiHost,
    localSecretResolutionEnabled,
    port: config.mode === 'local-desktop' && !config.bindConfiguredApiPort ? 0 : config.apiPort,
    ...(config.apiToken === undefined ? {} : { token: config.apiToken }),
  }

  if (workspaceManager) {
    serverOptions.workspaceManager = workspaceManager

    if (config.workspaceId) {
      // IPC and HTTP must share the already-recovered client for the active workspace.
      serverOptions.resolveWorkspaceClient = (workspaceId) =>
        workspaceId === config.workspaceId
          ? client
          : workspaceManager.resolveClient(workspaceId)
    }
  }

  let server: Pick<StartedValedictorianHttpServer, 'close' | 'url'> | null
  try {
    server = deferServerStart ? null : await startServer(serverOptions)
  } catch (error) {
    await scheduler.stop()
    if (recoveryScope) effectiveConnectorRunRecovery?.deactivate(recoveryScope)
    await disposePreparedCapabilities()
    throw error
  }

  if (config.mode === 'local-desktop') {
    scheduler.start()
  }

  let closeInflight: Promise<void> | null = null
  const close = () => {
    if (closeInflight) return closeInflight
    closeInflight = (async () => {
      try {
        await scheduler.stop()
        await server?.close()
      } finally {
        try {
          await workspaceManager?.close()
        } finally {
          try {
            await disposePreparedCapabilities()
          } finally {
            if (recoveryScope) effectiveConnectorRunRecovery?.deactivate(recoveryScope)
          }
        }
      }
    })()
    return closeInflight
  }

  return {
    client,
    connectors: client.connectors,
    profileService: preparedCapabilities?.profileService ?? null,
    secretService: preparedCapabilities?.secretService ?? null,
    close,
    stopScheduler: () => scheduler.stop(),
    get server() {
      return server
    },
    async restartServer() {
      server = await startServer(serverOptions)
      return server
    },
  }
}

const unavailableRuntimeSecretCodec: SecretCodec = {
  decrypt() {
    throw new Error('Protected storage is unavailable.')
  },
  encrypt() {
    throw new Error('Protected storage is unavailable.')
  },
  isAvailable: () => false,
}

function readRuntimeMode(value: string | undefined): ValedictorianRuntimeMode {
  if (!value) {
    return 'local-desktop'
  }

  if (value === 'local-desktop' || value === 'local-shared' || value === 'remote') {
    return value
  }

  throw new Error(`Unsupported Valedictorian runtime mode: ${value}`)
}

function readSeedDataMode(value: string | undefined): ValedictorianSeedDataMode {
  if (!value) {
    return 'none'
  }

  if (value === 'none' || value === 'sample' || value === 'reference-tracker') {
    return value
  }

  throw new Error(`Unsupported VALEDICTORIAN_SEED_DATA mode: ${value}`)
}

function parsePort(value: string | undefined, allowZero = false) {
  if (!value) {
    return 4317
  }

  const port = Number(value)

  if (!Number.isInteger(port) || port < (allowZero ? 0 : 1) || port > 65535) {
    throw new Error(`Invalid VALEDICTORIAN_API_PORT: ${value}`)
  }

  return port
}
