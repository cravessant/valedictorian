import { describe, expect, it, vi } from 'vitest'
import type { ValedictorianClient, ValedictorianWorkspaceClient } from 'sparxie'
import { createValedictorianRuntime, resolveValedictorianRuntimeConfig } from './valedictorian-runtime'

function createWorkspaceClient(name: string): ValedictorianWorkspaceClient {
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
  } as unknown as ValedictorianWorkspaceClient
}

function createRootClient(
  workspaceClient: ValedictorianWorkspaceClient,
  forWorkspace = vi.fn(() => workspaceClient),
): ValedictorianClient {
  return {
    capabilities: {
      get: vi.fn(async () => ({
        agentWorkflows: false,
        billing: false,
        hostedSync: false,
        localSqlite: false,
        multiWorkspace: true,
      })),
    },
    forWorkspace,
    health: {
      get: vi.fn(async () => ({ ok: true })),
    },
    workspaces: {
      create: vi.fn(),
      list: vi.fn(),
      open: vi.fn(),
    },
  } as unknown as ValedictorianClient
}

describe('Valedictorian runtime config', () => {
  it('defaults to local desktop mode without starting an HTTP server', () => {
    expect(
      resolveValedictorianRuntimeConfig({
        env: {},
        userDataPath: '/Users/test/Library/Application Support/Valedictorian',
      }),
    ).toEqual({
      apiHost: '127.0.0.1',
      apiPort: 4317,
      apiToken: undefined,
      apiUrl: 'http://127.0.0.1:4317',
      mode: 'local-desktop',
      referenceTrackerPath: undefined,
      seedDataMode: 'none',
      sqlitePath: '/Users/test/Library/Application Support/Valedictorian/valedictorian.sqlite',
      workspaceId: undefined,
    })
  })

  it('defaults the SQLite database path to the workspace data folder when present', () => {
    expect(
      resolveValedictorianRuntimeConfig({
        env: {},
        userDataPath: '/Users/test/Library/Application Support/Valedictorian',
        workspaceDataPath: '/Users/test/Job Search/.valedictorian',
      }),
    ).toMatchObject({
      sqlitePath: '/Users/test/Job Search/.valedictorian/valedictorian.sqlite',
    })
  })

  it('honors local shared, remote, and path overrides', () => {
    expect(
      resolveValedictorianRuntimeConfig({
        env: {
          VALEDICTORIAN_API_HOST: '0.0.0.0',
          VALEDICTORIAN_API_PORT: '9999',
          VALEDICTORIAN_API_TOKEN: 'local-token',
          VALEDICTORIAN_MODE: 'local-shared',
          VALEDICTORIAN_SEED_DATA: 'sample',
          VALEDICTORIAN_SQLITE_PATH: '/tmp/valedictorian.sqlite',
        },
        userDataPath: '/unused',
      }),
    ).toMatchObject({
      apiHost: '0.0.0.0',
      apiPort: 9999,
      apiToken: 'local-token',
      apiUrl: 'http://0.0.0.0:9999',
      mode: 'local-shared',
      referenceTrackerPath: undefined,
      seedDataMode: 'sample',
      sqlitePath: '/tmp/valedictorian.sqlite',
    })

    expect(
      resolveValedictorianRuntimeConfig({
        env: {
          VALEDICTORIAN_API_TOKEN: 'remote-token',
          VALEDICTORIAN_API_URL: 'https://hosted.valedictorian.test',
          VALEDICTORIAN_MODE: 'remote',
        },
        userDataPath: '/unused',
      }),
    ).toMatchObject({
      apiToken: 'remote-token',
      apiUrl: 'https://hosted.valedictorian.test',
      mode: 'remote',
      seedDataMode: 'none',
    })
  })

  it('uses saved settings when env vars are absent', () => {
    expect(
      resolveValedictorianRuntimeConfig({
        env: {},
        settings: {
          apiToken: 'saved-token',
          localApiHost: '0.0.0.0',
          localApiPort: 7777,
          remoteApiUrl: 'https://saved.valedictorian.test',
          runtimeMode: 'local-shared',
          showAdvancedFilters: true,
        },
        userDataPath: '/Users/test/Library/Application Support/Valedictorian',
      }),
    ).toEqual({
      apiHost: '0.0.0.0',
      apiPort: 7777,
      apiToken: 'saved-token',
      apiUrl: 'http://0.0.0.0:7777',
      mode: 'local-shared',
      referenceTrackerPath: undefined,
      seedDataMode: 'none',
      sqlitePath: '/Users/test/Library/Application Support/Valedictorian/valedictorian.sqlite',
      workspaceId: undefined,
    })

    expect(
      resolveValedictorianRuntimeConfig({
        env: {},
        settings: {
          apiToken: 'remote-token',
          localApiHost: '127.0.0.1',
          localApiPort: 4317,
          remoteApiUrl: 'https://remote.valedictorian.test',
          runtimeMode: 'remote',
          showAdvancedFilters: false,
        },
        userDataPath: '/unused',
      }),
    ).toMatchObject({
      apiToken: 'remote-token',
      apiUrl: 'https://remote.valedictorian.test',
      mode: 'remote',
      seedDataMode: 'none',
    })
  })

  it('lets env vars override saved settings', () => {
    expect(
      resolveValedictorianRuntimeConfig({
        env: {
          VALEDICTORIAN_API_HOST: '127.0.0.2',
          VALEDICTORIAN_API_PORT: '9999',
          VALEDICTORIAN_API_TOKEN: 'env-token',
          VALEDICTORIAN_API_URL: 'https://env.valedictorian.test',
          VALEDICTORIAN_MODE: 'remote',
        },
        settings: {
          apiToken: 'saved-token',
          localApiHost: '0.0.0.0',
          localApiPort: 7777,
          remoteApiUrl: 'https://saved.valedictorian.test',
          runtimeMode: 'local-shared',
          showAdvancedFilters: true,
        },
        userDataPath: '/unused',
      }),
    ).toMatchObject({
      apiHost: '127.0.0.2',
      apiPort: 9999,
      apiToken: 'env-token',
      apiUrl: 'https://env.valedictorian.test',
      mode: 'remote',
      seedDataMode: 'none',
    })
  })
})

describe('Valedictorian runtime creation', () => {
  it('starts a local HTTP server in local desktop mode', async () => {
    const localClient = createWorkspaceClient('local')
    const server = { close: vi.fn(async () => undefined), url: 'http://127.0.0.1:4317' }
    const createLocalClient = vi.fn(() => localClient)
    const createHttpClient = vi.fn(() => createRootClient(createWorkspaceClient('http')))
    const startServer = vi.fn(async () => server)

    const runtime = await createValedictorianRuntime({
      config: resolveValedictorianRuntimeConfig({
        env: {},
        userDataPath: '/tmp/valedictorian-user-data',
      }),
      createHttpClient,
      createLocalClient,
      startServer,
    })

    expect(runtime.client).toBe(localClient)
    expect(createLocalClient).toHaveBeenCalledWith({
      connectorAuth: {
        browserSessions: {
          resolve: expect.any(Function),
        },
      },
      connectorRuntime: {
        browserSession: {
          resolveLink: expect.any(Function),
        },
        delay: {
          wait: expect.any(Function),
        },
      },
      referenceTrackerPath: undefined,
      seedDataMode: 'none',
      sqlitePath: '/tmp/valedictorian-user-data/valedictorian.sqlite',
    })
    expect(createHttpClient).not.toHaveBeenCalled()
    expect(runtime.server).toBe(server)
    expect(startServer).toHaveBeenCalledWith({
      client: localClient,
      host: '127.0.0.1',
      port: 4317,
    })
    await runtime.close()
    expect(server.close).toHaveBeenCalled()
  })

  it('starts a local HTTP server in local shared mode without app-level auth', async () => {
    const localClient = createWorkspaceClient('local')
    const server = { close: vi.fn(async () => undefined), url: 'http://127.0.0.1:9999' }
    const startServer = vi.fn(async () => server)

    const runtime = await createValedictorianRuntime({
      config: resolveValedictorianRuntimeConfig({
        env: {
          VALEDICTORIAN_API_PORT: '9999',
          VALEDICTORIAN_API_TOKEN: 'local-token',
          VALEDICTORIAN_MODE: 'local-shared',
        },
        userDataPath: '/tmp/valedictorian-user-data',
      }),
      createHttpClient: vi.fn(() => createRootClient(createWorkspaceClient('http'))),
      createLocalClient: vi.fn(() => localClient),
      startServer,
    })

    expect(runtime.client).toBe(localClient)
    expect(runtime.server).toBe(server)
    expect(runtime.connectors).toBe(localClient.connectors)
    expect(startServer).toHaveBeenCalledTimes(1)
    expect(
      (startServer.mock.calls[0]?.[0].client as typeof localClient),
    ).toBe(localClient)
    expect(startServer).toHaveBeenCalledWith({
      client: localClient,
      host: '127.0.0.1',
      port: 9999,
    })

    await runtime.close()
    expect(server.close).toHaveBeenCalled()
  })

  it('passes a local workspace manager to the local HTTP server', async () => {
    const localClient = createWorkspaceClient('local')
    const server = { close: vi.fn(async () => undefined), url: 'http://127.0.0.1:4317' }
    const workspaceManager = {
      create: vi.fn(),
      list: vi.fn(),
      open: vi.fn(),
      resolveClient: vi.fn(),
    }
    const startServer = vi.fn(async () => server)

    const runtime = await createValedictorianRuntime({
      config: resolveValedictorianRuntimeConfig({
        env: {},
        userDataPath: '/tmp/valedictorian-user-data',
      }),
      createLocalClient: vi.fn(() => localClient),
      startServer,
      workspaceManager,
    })

    expect(startServer).toHaveBeenCalledWith({
      client: localClient,
      host: '127.0.0.1',
      port: 4317,
      workspaceManager,
    })

    await runtime.close()
    expect(server.close).toHaveBeenCalled()
  })

  it('uses an HTTP client without SQLite or local server in remote mode', async () => {
    const workspaceClient = createWorkspaceClient('http')
    const forWorkspace = vi.fn(() => workspaceClient)
    const httpClient = createRootClient(workspaceClient, forWorkspace)
    const createHttpClient = vi.fn(() => httpClient)
    const createLocalClient = vi.fn(() => createWorkspaceClient('local'))
    const startServer = vi.fn()

    const runtime = await createValedictorianRuntime({
      config: resolveValedictorianRuntimeConfig({
        env: {
          VALEDICTORIAN_API_TOKEN: 'remote-token',
          VALEDICTORIAN_API_URL: 'https://hosted.valedictorian.test',
          VALEDICTORIAN_MODE: 'remote',
        },
        userDataPath: '/tmp/valedictorian-user-data',
        workspaceId: 'workspace-1',
      }),
      createHttpClient,
      createLocalClient,
      startServer,
    })

    expect(runtime.client).toBe(workspaceClient)
    expect(forWorkspace).toHaveBeenCalledWith('workspace-1')
    expect(createHttpClient).toHaveBeenCalledWith({
      baseUrl: 'https://hosted.valedictorian.test',
      token: 'remote-token',
    })
    expect(createLocalClient).not.toHaveBeenCalled()
    expect(startServer).not.toHaveBeenCalled()
    await runtime.close()
  })
})
