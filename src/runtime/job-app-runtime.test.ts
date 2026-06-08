import { describe, expect, it, vi } from 'vitest'
import type { JobAppClient } from 'sparxie'
import { createJobAppRuntime, resolveJobAppRuntimeConfig } from './job-app-runtime'

function createClient(name: string): JobAppClient {
  return {
    applications: {
      get: vi.fn(async () => null),
      list: vi.fn(async () => ({
        hasMore: false,
        items: [],
        limit: 50,
        offset: 0,
        total: 0,
      })),
      updateStatus: vi.fn(async () => {
        throw new Error(`${name} status update not implemented in test`)
      }),
    },
    scores: {
      record: vi.fn(async () => undefined),
    },
  } as unknown as JobAppClient
}

describe('job app runtime config', () => {
  it('defaults to local desktop mode without starting an HTTP server', () => {
    expect(
      resolveJobAppRuntimeConfig({
        env: {},
        userDataPath: '/Users/test/Library/Application Support/Job App',
      }),
    ).toEqual({
      apiHost: '127.0.0.1',
      apiPort: 4317,
      apiToken: undefined,
      apiUrl: 'http://127.0.0.1:4317',
      mode: 'local-desktop',
      sqlitePath: '/Users/test/Library/Application Support/Job App/job-app.sqlite',
    })
  })

  it('defaults the SQLite database path to the workspace data folder when present', () => {
    expect(
      resolveJobAppRuntimeConfig({
        env: {},
        userDataPath: '/Users/test/Library/Application Support/Job App',
        workspaceDataPath: '/Users/test/Job Search/.job-automation',
      }),
    ).toMatchObject({
      sqlitePath: '/Users/test/Job Search/.job-automation/job-app.sqlite',
    })
  })

  it('honors local shared, remote, and path overrides', () => {
    expect(
      resolveJobAppRuntimeConfig({
        env: {
          JOB_APP_API_HOST: '0.0.0.0',
          JOB_APP_API_PORT: '9999',
          JOB_APP_API_TOKEN: 'local-token',
          JOB_APP_MODE: 'local-shared',
          JOB_APP_SQLITE_PATH: '/tmp/job-app.sqlite',
        },
        userDataPath: '/unused',
      }),
    ).toMatchObject({
      apiHost: '0.0.0.0',
      apiPort: 9999,
      apiToken: 'local-token',
      apiUrl: 'http://0.0.0.0:9999',
      mode: 'local-shared',
      sqlitePath: '/tmp/job-app.sqlite',
    })

    expect(
      resolveJobAppRuntimeConfig({
        env: {
          JOB_APP_API_TOKEN: 'remote-token',
          JOB_APP_API_URL: 'https://hosted.job-app.test',
          JOB_APP_MODE: 'remote',
        },
        userDataPath: '/unused',
      }),
    ).toMatchObject({
      apiToken: 'remote-token',
      apiUrl: 'https://hosted.job-app.test',
      mode: 'remote',
    })
  })

  it('uses saved settings when env vars are absent', () => {
    expect(
      resolveJobAppRuntimeConfig({
        env: {},
        settings: {
          apiToken: 'saved-token',
          localApiHost: '0.0.0.0',
          localApiPort: 7777,
          remoteApiUrl: 'https://saved.job-app.test',
          runtimeMode: 'local-shared',
          showAdvancedFilters: true,
        },
        userDataPath: '/Users/test/Library/Application Support/Job App',
      }),
    ).toEqual({
      apiHost: '0.0.0.0',
      apiPort: 7777,
      apiToken: 'saved-token',
      apiUrl: 'http://0.0.0.0:7777',
      mode: 'local-shared',
      sqlitePath: '/Users/test/Library/Application Support/Job App/job-app.sqlite',
    })

    expect(
      resolveJobAppRuntimeConfig({
        env: {},
        settings: {
          apiToken: 'remote-token',
          localApiHost: '127.0.0.1',
          localApiPort: 4317,
          remoteApiUrl: 'https://remote.job-app.test',
          runtimeMode: 'remote',
          showAdvancedFilters: false,
        },
        userDataPath: '/unused',
      }),
    ).toMatchObject({
      apiToken: 'remote-token',
      apiUrl: 'https://remote.job-app.test',
      mode: 'remote',
    })
  })

  it('lets env vars override saved settings', () => {
    expect(
      resolveJobAppRuntimeConfig({
        env: {
          JOB_APP_API_HOST: '127.0.0.2',
          JOB_APP_API_PORT: '9999',
          JOB_APP_API_TOKEN: 'env-token',
          JOB_APP_API_URL: 'https://env.job-app.test',
          JOB_APP_MODE: 'remote',
        },
        settings: {
          apiToken: 'saved-token',
          localApiHost: '0.0.0.0',
          localApiPort: 7777,
          remoteApiUrl: 'https://saved.job-app.test',
          runtimeMode: 'local-shared',
          showAdvancedFilters: true,
        },
        userDataPath: '/unused',
      }),
    ).toMatchObject({
      apiHost: '127.0.0.2',
      apiPort: 9999,
      apiToken: 'env-token',
      apiUrl: 'https://env.job-app.test',
      mode: 'remote',
    })
  })
})

describe('job app runtime creation', () => {
  it('uses a local client without an HTTP server in local desktop mode', async () => {
    const localClient = createClient('local')
    const createLocalClient = vi.fn(() => localClient)
    const createHttpClient = vi.fn(() => createClient('http'))
    const startServer = vi.fn()

    const runtime = await createJobAppRuntime({
      config: resolveJobAppRuntimeConfig({
        env: {},
        userDataPath: '/tmp/job-app-user-data',
      }),
      createHttpClient,
      createLocalClient,
      startServer,
    })

    expect(runtime.client).toBe(localClient)
    expect(createLocalClient).toHaveBeenCalledWith({
      sqlitePath: '/tmp/job-app-user-data/job-app.sqlite',
    })
    expect(createHttpClient).not.toHaveBeenCalled()
    expect(startServer).not.toHaveBeenCalled()
    await runtime.close()
  })

  it('starts a local HTTP server only in local shared mode', async () => {
    const localClient = createClient('local')
    const server = { close: vi.fn(async () => undefined), url: 'http://127.0.0.1:9999' }
    const startServer = vi.fn(async () => server)

    const runtime = await createJobAppRuntime({
      config: resolveJobAppRuntimeConfig({
        env: {
          JOB_APP_API_PORT: '9999',
          JOB_APP_API_TOKEN: 'local-token',
          JOB_APP_MODE: 'local-shared',
        },
        userDataPath: '/tmp/job-app-user-data',
      }),
      createHttpClient: vi.fn(() => createClient('http')),
      createLocalClient: vi.fn(() => localClient),
      startServer,
    })

    expect(runtime.client).toBe(localClient)
    expect(runtime.server).toBe(server)
    expect(startServer).toHaveBeenCalledWith({
      client: localClient,
      host: '127.0.0.1',
      port: 9999,
      token: 'local-token',
    })

    await runtime.close()
    expect(server.close).toHaveBeenCalled()
  })

  it('uses an HTTP client without SQLite or local server in remote mode', async () => {
    const httpClient = createClient('http')
    const createHttpClient = vi.fn(() => httpClient)
    const createLocalClient = vi.fn(() => createClient('local'))
    const startServer = vi.fn()

    const runtime = await createJobAppRuntime({
      config: resolveJobAppRuntimeConfig({
        env: {
          JOB_APP_API_TOKEN: 'remote-token',
          JOB_APP_API_URL: 'https://hosted.job-app.test',
          JOB_APP_MODE: 'remote',
        },
        userDataPath: '/tmp/job-app-user-data',
      }),
      createHttpClient,
      createLocalClient,
      startServer,
    })

    expect(runtime.client).toBe(httpClient)
    expect(createHttpClient).toHaveBeenCalledWith({
      baseUrl: 'https://hosted.job-app.test',
      token: 'remote-token',
    })
    expect(createLocalClient).not.toHaveBeenCalled()
    expect(startServer).not.toHaveBeenCalled()
    await runtime.close()
  })
})
