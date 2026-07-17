import path from 'node:path'
import {
  createHttpValedictorianClient,
  defaultValedictorianApiBaseUrl,
  type HttpValedictorianClientOptions,
  type ValedictorianClient,
  type ValedictorianWorkspaceClient,
} from 'sparxie'
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
import type { LocalWorkspaceManager } from '../server/local-workspaces'
import { defaultAppSettings, type AppSettings } from '../settings/app-settings'
import type { SecretCodec } from '../modules/secrets/secret.codec'
import { isSecretCodecAvailable } from '../modules/secrets/secret.codec'
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
  mode: ValedictorianRuntimeMode
  referenceTrackerPath?: string
  seedDataMode: ValedictorianSeedDataMode
  sqlitePath: string
  workspaceId?: string
}

export interface ValedictorianRuntime {
  client: ValedictorianWorkspaceClient
  connectors: LocalValedictorianClient['connectors'] | null
  close: () => Promise<void>
  stopScheduler: () => Promise<void>
  server: Pick<StartedValedictorianHttpServer, 'close' | 'url'> | null
  restartServer: (() => Promise<Pick<StartedValedictorianHttpServer, 'close' | 'url'>>) | null
}

export interface CreateValedictorianRuntimeOptions {
  config: ValedictorianRuntimeConfig
  createConnectorPorts?: (workspaceId?: string) => DefaultLocalConnectorPorts
  createHttpClient?: (options: HttpValedictorianClientOptions) => ValedictorianClient
  createLocalClient?: (options: LocalValedictorianClientOptions) => LocalValedictorianClient
  createScheduler?: (options?: LocalSchedulerOptions) => LocalScheduler
  connectorRunRecovery?: ConnectorRunRecoveryLifecycle
  deferServerStart?: boolean
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
  const apiPort = parsePort(env.VALEDICTORIAN_API_PORT ?? String(settings.localApiPort))
  const defaultApiUrl = `http://${apiHost}:${apiPort}`

  return {
    apiHost,
    apiPort,
    apiToken: readNonEmptyEnvironmentApiToken(env) ?? (apiToken || undefined),
    apiUrl:
      env.VALEDICTORIAN_API_URL ??
      (mode === 'remote' ? settings.remoteApiUrl || defaultValedictorianApiBaseUrl : defaultApiUrl),
    mode,
    referenceTrackerPath: env.VALEDICTORIAN_REFERENCE_TRACKER_PATH,
    seedDataMode: readSeedDataMode(env.VALEDICTORIAN_SEED_DATA),
    sqlitePath:
      env.VALEDICTORIAN_SQLITE_PATH ?? path.join(workspaceDataPath ?? userDataPath, 'valedictorian.sqlite'),
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
      close: async () => undefined,
      stopScheduler: async () => undefined,
      restartServer: null,
      server: null,
    }
  }

  const connectorPorts = createConnectorPorts(config.workspaceId)
  const scheduler = createScheduler(schedulerOptions)
  const effectiveConnectorRunRecovery = connectorRunRecovery ?? workspaceManager?.connectorRunRecovery
  const localSecretResolutionEnabled =
    config.mode === 'local-shared'
    && Boolean(config.apiToken)
    && isSecretCodecAvailable(secretCodec)

  const client = createLocalClient({
    ...(effectiveConnectorRunRecovery === undefined
      ? {}
      : { connectorRunRecovery: effectiveConnectorRunRecovery }),
    connectorRuntime: connectorPorts.connectorRuntime,
    connectorScheduling: config.mode === 'local-desktop'
      ? localDesktopConnectorSchedulingCapability
      : undefined,
    localSecretResolutionEnabled,
    onScheduledWorkChanged: () => scheduler.signal(),
    referenceTrackerPath: config.referenceTrackerPath,
    seedDataMode: config.seedDataMode,
    ...(secretCodec === undefined ? {} : { secretCodec }),
    sqlitePath: config.sqlitePath,
    registerScheduledWorkSource: (source) => scheduler.register(source),
    ...(config.workspaceId === undefined ? {} : { workspaceId: config.workspaceId }),
  })

  const serverOptions: CreateValedictorianHttpServerOptions = {
    client,
    host: config.apiHost,
    localSecretResolutionEnabled,
    port: config.mode === 'local-desktop' ? 0 : config.apiPort,
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

  let server = deferServerStart ? null : await startServer(serverOptions)

  if (config.mode === 'local-desktop') {
    scheduler.start()
  }

  return {
    client,
    connectors: client.connectors,
    close: async () => {
      await scheduler.stop()
      await server?.close()
    },
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

function parsePort(value: string | undefined) {
  if (!value) {
    return 4317
  }

  const port = Number(value)

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid VALEDICTORIAN_API_PORT: ${value}`)
  }

  return port
}
