import path from 'node:path'
import {
  createHttpJobAppClient,
  defaultJobAppApiBaseUrl,
  type HttpJobAppClientOptions,
  type JobAppClient,
} from 'sparxie'
import {
  createJobAppHttpServer,
  type CreateJobAppHttpServerOptions,
  type StartedJobAppHttpServer,
} from '../server/local-server'
import { defaultAppSettings, type AppSettings } from '../settings/app-settings'
import {
  createLocalJobAppClient,
  type JobAppSeedDataMode,
  type LocalJobAppClientOptions,
} from './local-job-app-client'

export type JobAppRuntimeMode = 'local-desktop' | 'local-shared' | 'remote'

export interface JobAppRuntimeConfigInput {
  env?: Record<string, string | undefined>
  settings?: AppSettings
  userDataPath: string
  workspaceDataPath?: string
}

export interface JobAppRuntimeConfig {
  apiHost: string
  apiPort: number
  apiToken?: string
  apiUrl: string
  mode: JobAppRuntimeMode
  referenceTrackerPath?: string
  seedDataMode: JobAppSeedDataMode
  sqlitePath: string
}

export interface JobAppRuntime {
  client: JobAppClient
  close: () => Promise<void>
  server: Pick<StartedJobAppHttpServer, 'close' | 'url'> | null
}

export interface CreateJobAppRuntimeOptions {
  config: JobAppRuntimeConfig
  createHttpClient?: (options: HttpJobAppClientOptions) => JobAppClient
  createLocalClient?: (options: LocalJobAppClientOptions) => JobAppClient
  startServer?: (
    options: CreateJobAppHttpServerOptions,
  ) => Promise<Pick<StartedJobAppHttpServer, 'close' | 'url'>>
}

export function resolveJobAppRuntimeConfig({
  env = process.env,
  settings = defaultAppSettings,
  userDataPath,
  workspaceDataPath,
}: JobAppRuntimeConfigInput): JobAppRuntimeConfig {
  const mode = readRuntimeMode(env.JOB_APP_MODE ?? settings.runtimeMode)
  const apiHost = env.JOB_APP_API_HOST ?? settings.localApiHost
  const apiPort = parsePort(env.JOB_APP_API_PORT ?? String(settings.localApiPort))
  const defaultApiUrl = `http://${apiHost}:${apiPort}`

  return {
    apiHost,
    apiPort,
    apiToken: (env.JOB_APP_API_TOKEN ?? settings.apiToken) || undefined,
    apiUrl:
      env.JOB_APP_API_URL ??
      (mode === 'remote' ? settings.remoteApiUrl || defaultJobAppApiBaseUrl : defaultApiUrl),
    mode,
    referenceTrackerPath: env.JOB_APP_REFERENCE_TRACKER_PATH,
    seedDataMode: readSeedDataMode(env.JOB_APP_SEED_DATA),
    sqlitePath: env.JOB_APP_SQLITE_PATH ?? path.join(workspaceDataPath ?? userDataPath, 'job-app.sqlite'),
  }
}

export async function createJobAppRuntime({
  config,
  createHttpClient = createHttpJobAppClient,
  createLocalClient = createLocalJobAppClient,
  startServer = createJobAppHttpServer,
}: CreateJobAppRuntimeOptions): Promise<JobAppRuntime> {
  if (config.mode === 'remote') {
    return {
      client: createHttpClient({
        baseUrl: config.apiUrl,
        token: config.apiToken,
      }),
      close: async () => undefined,
      server: null,
    }
  }

  const client = createLocalClient({
    referenceTrackerPath: config.referenceTrackerPath,
    seedDataMode: config.seedDataMode,
    sqlitePath: config.sqlitePath,
  })

  if (config.mode === 'local-desktop') {
    return {
      client,
      close: async () => undefined,
      server: null,
    }
  }

  const server = await startServer({
    client,
    host: config.apiHost,
    port: config.apiPort,
    token: config.apiToken,
  })

  return {
    client,
    close: () => server.close(),
    server,
  }
}

function readRuntimeMode(value: string | undefined): JobAppRuntimeMode {
  if (!value) {
    return 'local-desktop'
  }

  if (value === 'local-desktop' || value === 'local-shared' || value === 'remote') {
    return value
  }

  throw new Error(`Unsupported Job App runtime mode: ${value}`)
}

function readSeedDataMode(value: string | undefined): JobAppSeedDataMode {
  if (!value) {
    return 'none'
  }

  if (value === 'none' || value === 'sample' || value === 'reference-tracker') {
    return value
  }

  throw new Error(`Unsupported JOB_APP_SEED_DATA mode: ${value}`)
}

function parsePort(value: string | undefined) {
  if (!value) {
    return 4317
  }

  const port = Number(value)

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid JOB_APP_API_PORT: ${value}`)
  }

  return port
}
