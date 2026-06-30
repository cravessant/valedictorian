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
import type { LocalWorkspaceManager } from '../server/local-workspaces'
import { defaultAppSettings, type AppSettings } from '../settings/app-settings'
import {
  createLocalValedictorianClient,
  type ValedictorianSeedDataMode,
  type LocalValedictorianClientOptions,
} from './local-valedictorian-client'

export type ValedictorianRuntimeMode = 'local-desktop' | 'local-shared' | 'remote'

export interface ValedictorianRuntimeConfigInput {
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
  close: () => Promise<void>
  server: Pick<StartedValedictorianHttpServer, 'close' | 'url'> | null
}

export interface CreateValedictorianRuntimeOptions {
  config: ValedictorianRuntimeConfig
  createHttpClient?: (options: HttpValedictorianClientOptions) => ValedictorianClient
  createLocalClient?: (options: LocalValedictorianClientOptions) => ValedictorianWorkspaceClient
  startServer?: (
    options: CreateValedictorianHttpServerOptions,
  ) => Promise<Pick<StartedValedictorianHttpServer, 'close' | 'url'>>
  workspaceManager?: LocalWorkspaceManager
}

export function resolveValedictorianRuntimeConfig({
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
    apiToken: (env.VALEDICTORIAN_API_TOKEN ?? settings.apiToken) || undefined,
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
  createHttpClient = createHttpValedictorianClient,
  createLocalClient = createLocalValedictorianClient,
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
      close: async () => undefined,
      server: null,
    }
  }

  const client = createLocalClient({
    referenceTrackerPath: config.referenceTrackerPath,
    seedDataMode: config.seedDataMode,
    sqlitePath: config.sqlitePath,
  })

  const serverOptions: CreateValedictorianHttpServerOptions = {
    client,
    host: config.apiHost,
    port: config.apiPort,
  }

  if (workspaceManager) {
    serverOptions.workspaceManager = workspaceManager
  }

  const server = await startServer(serverOptions)

  return {
    client,
    close: () => server.close(),
    server,
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
