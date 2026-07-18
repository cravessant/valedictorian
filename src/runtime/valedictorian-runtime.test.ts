import { describe, expect, it, vi } from 'vitest'
import type { ValedictorianClient, ValedictorianWorkspaceClient } from 'sparxie'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createConnectorRunRecoveryLifecycle } from '../modules/connectors/connector.recovery'
import { initializeWorkspace } from '../workspace/workspace.initializer'
import { createValedictorianRuntime, resolveValedictorianRuntimeConfig } from './valedictorian-runtime'
import type { LocalScheduler } from './local-scheduler'

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
      profilePath: '/Users/test/Library/Application Support/Valedictorian/profile.json',
      referenceTrackerPath: undefined,
      seedDataMode: 'none',
      pgliteDataPath: '/Users/test/Library/Application Support/Valedictorian/pglite',
      workspaceId: undefined,
    })
  })

  it('defaults the PGlite data directory to the workspace data folder when present', () => {
    expect(
      resolveValedictorianRuntimeConfig({
        env: {},
        userDataPath: '/Users/test/Library/Application Support/Valedictorian',
        workspaceDataPath: '/Users/test/Job Search/.valedictorian',
      }),
    ).toMatchObject({
      profilePath: '/Users/test/Job Search/.valedictorian/profile.json',
      pgliteDataPath: '/Users/test/Job Search/.valedictorian/pglite',
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
          VALEDICTORIAN_PGLITE_DATA_PATH: '/tmp/valedictorian-pglite',
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
      pgliteDataPath: '/tmp/valedictorian-pglite',
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

  it('uses a resolved settings secret when env vars are absent', () => {
    expect(
      resolveValedictorianRuntimeConfig({
        apiToken: 'saved-token',
        env: {},
        settings: {
          apiTokenConfigured: false,
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
      profilePath: '/Users/test/Library/Application Support/Valedictorian/profile.json',
      referenceTrackerPath: undefined,
      seedDataMode: 'none',
      pgliteDataPath: '/Users/test/Library/Application Support/Valedictorian/pglite',
      workspaceId: undefined,
    })

    expect(
      resolveValedictorianRuntimeConfig({
        apiToken: 'remote-token',
        env: {},
        settings: {
          apiTokenConfigured: false,
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
        apiToken: 'saved-token',
        env: {
          VALEDICTORIAN_API_HOST: '127.0.0.2',
          VALEDICTORIAN_API_PORT: '9999',
          VALEDICTORIAN_API_TOKEN: 'env-token',
          VALEDICTORIAN_API_URL: 'https://env.valedictorian.test',
          VALEDICTORIAN_MODE: 'remote',
        },
        settings: {
          apiTokenConfigured: false,
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
  it('prepares and injects shared profile capabilities before serving and disposes them on close', async () => {
    const events: string[] = []
    const localClient = createWorkspaceClient('prepared-local')
    const profileService = { dispose: vi.fn() }
    const secretService = { scope: { workspaceId: 'workspace-prepared' } }
    const dispose = vi.fn(() => events.push('capabilities.dispose'))
    const prepareWorkspaceCapabilities = vi.fn(async () => {
      events.push('capabilities.prepare')
      return { dispose, profileService, secretService }
    })
    const createLocalClient = vi.fn((options: Record<string, unknown>) => {
      expect(options.profileService).toBe(profileService)
      expect(options.secretService).toBe(secretService)
      events.push('client.create')
      return localClient
    })
    const server = {
      close: vi.fn(async () => events.push('server.close')),
      url: 'http://127.0.0.1:4317',
    }

    const runtime = await createValedictorianRuntime({
      config: resolveValedictorianRuntimeConfig({
        env: {},
        userDataPath: '/tmp/valedictorian-profile-prepared',
        workspaceId: 'workspace-prepared',
      }),
      createLocalClient: createLocalClient as never,
      prepareWorkspaceCapabilities: prepareWorkspaceCapabilities as never,
      startServer: vi.fn(async () => {
        events.push('server.start')
        return server
      }),
    })

    expect(events.slice(0, 3)).toEqual([
      'capabilities.prepare',
      'client.create',
      'server.start',
    ])
    expect(runtime.profileService).toBe(profileService)
    expect(runtime.secretService).toBe(secretService)
    await runtime.close()
    await runtime.close()
    expect(events).toContain('capabilities.dispose')
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('disposes prepared capabilities when local server startup fails', async () => {
    const dispose = vi.fn()
    const prepareWorkspaceCapabilities = vi.fn(async () => ({
      dispose,
      profileService: {},
      secretService: {},
    }))

    await expect(createValedictorianRuntime({
      config: resolveValedictorianRuntimeConfig({
        env: {},
        userDataPath: '/tmp/valedictorian-profile-start-failure',
      }),
      createLocalClient: vi.fn(() => createWorkspaceClient('start-failure')),
      prepareWorkspaceCapabilities: prepareWorkspaceCapabilities as never,
      startServer: vi.fn(async () => {
        throw new Error('fixture listener failure')
      }),
    })).rejects.toThrow('fixture listener failure')

    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('starts the local scheduler for desktop runtimes and stops it before closing the server', async () => {
    const localClient = createWorkspaceClient('local')
    const events: string[] = []
    const scheduler: LocalScheduler = {
      register: vi.fn(),
      signal: vi.fn(),
      start: vi.fn(() => events.push('scheduler.start')),
      stop: vi.fn(async () => events.push('scheduler.stop')),
      whenIdle: vi.fn(async () => undefined),
    }
    const server = {
      close: vi.fn(async () => events.push('server.close')),
      url: 'http://127.0.0.1:4317',
    }

    const runtime = await createValedictorianRuntime({
      config: resolveValedictorianRuntimeConfig({
        env: {},
        userDataPath: '/tmp/valedictorian-user-data',
      }),
      createLocalClient: vi.fn(() => localClient),
      createScheduler: vi.fn(() => scheduler),
      startServer: vi.fn(async () => server),
    })

    await runtime.close()
    expect(events).toEqual(['scheduler.start', 'scheduler.stop', 'server.close'])
  })

  it('starts a local HTTP server without scheduling connector catch-up', async () => {
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
    expect(createLocalClient).toHaveBeenCalledWith(expect.objectContaining({
      connectorRuntime: {
        delay: {
          wait: expect.any(Function),
        },
      },
      referenceTrackerPath: undefined,
      seedDataMode: 'none',
      pgliteDataPath: '/tmp/valedictorian-user-data/pglite',
    }))
    expect(createHttpClient).not.toHaveBeenCalled()
    expect(runtime.server).toBe(server)
    expect(startServer).toHaveBeenCalledWith(expect.objectContaining({
      client: localClient,
      host: '127.0.0.1',
      localSecretResolutionEnabled: false,
      port: 0,
    }))
    await runtime.close()
    expect(server.close).toHaveBeenCalled()
  })

  it.each([
    ['local-desktop', 0],
    ['local-shared', 7331],
  ] as const)('defers the first %s listener until supervised startup', async (mode, port) => {
    const server = { close: vi.fn(async () => undefined), url: `http://127.0.0.1:${port}` }
    const startServer = vi.fn(async () => server)
    const runtime = await createValedictorianRuntime({
      config: resolveValedictorianRuntimeConfig({
        env: { VALEDICTORIAN_API_PORT: '7331', VALEDICTORIAN_MODE: mode },
        userDataPath: '/tmp/user-data',
      }),
      createLocalClient: vi.fn(() => createWorkspaceClient('local')),
      deferServerStart: true,
      startServer,
    })

    expect(runtime.server).toBeNull()
    expect(startServer).not.toHaveBeenCalled()
    await runtime.restartServer!()
    expect(startServer).toHaveBeenCalledWith(expect.objectContaining({ port }))
    expect(runtime.server).toBe(server)
  })

  it('restarts only the dynamic desktop listener around the existing local client', async () => {
    const localClient = createWorkspaceClient('local')
    const servers = [
      { close: vi.fn(async () => undefined), url: 'http://127.0.0.1:51001' },
      { close: vi.fn(async () => undefined), url: 'http://127.0.0.1:51002' },
    ]
    const startServer = vi.fn(async () => servers.shift()!)
    const createLocalClient = vi.fn(() => localClient)
    const runtime = await createValedictorianRuntime({
      config: resolveValedictorianRuntimeConfig({ env: {}, userDataPath: '/tmp/user-data' }),
      createLocalClient,
      startServer,
    })

    await runtime.restartServer!()

    expect(createLocalClient).toHaveBeenCalledTimes(1)
    expect(startServer).toHaveBeenCalledTimes(2)
    expect(startServer.mock.calls[1]?.[0].client).toBe(localClient)
    expect(runtime.server?.url).toBe('http://127.0.0.1:51002')
    await runtime.close()
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
    expect(startServer).toHaveBeenCalledWith(expect.objectContaining({
      client: localClient,
      host: '127.0.0.1',
      localSecretResolutionEnabled: false,
      port: 9999,
    }))

    await runtime.close()
    expect(server.close).toHaveBeenCalled()
  })

  it('reuses the active workspace client for HTTP and delegates other workspaces', async () => {
    const localClient = createWorkspaceClient('local')
    const otherWorkspaceClient = createWorkspaceClient('other-workspace')
    const server = { close: vi.fn(async () => undefined), url: 'http://127.0.0.1:4317' }
    const workspaceManager = {
      close: vi.fn(async () => undefined),
      connectorRunRecovery: createConnectorRunRecoveryLifecycle(),
      create: vi.fn(),
      list: vi.fn(),
      open: vi.fn(),
      resolveClient: vi.fn(async () => otherWorkspaceClient),
    }
    const startServer = vi.fn(async () => server)

    const runtime = await createValedictorianRuntime({
      config: resolveValedictorianRuntimeConfig({
        env: {},
        userDataPath: '/tmp/valedictorian-user-data',
        workspaceId: 'workspace-local',
      }),
      createLocalClient: vi.fn(() => localClient),
      startServer,
      workspaceManager,
    })

    expect(startServer).toHaveBeenCalledWith(expect.objectContaining({
      client: localClient,
      host: '127.0.0.1',
      localSecretResolutionEnabled: false,
      port: 0,
      resolveWorkspaceClient: expect.any(Function),
      workspaceManager,
    }))
    const resolveWorkspaceClient = startServer.mock.calls[0]?.[0].resolveWorkspaceClient

    expect(await resolveWorkspaceClient?.('workspace-local')).toBe(localClient)
    expect(await resolveWorkspaceClient?.('workspace-other')).toBe(otherWorkspaceClient)
    expect(workspaceManager.resolveClient).toHaveBeenCalledTimes(1)
    expect(workspaceManager.resolveClient).toHaveBeenCalledWith('workspace-other')

    await runtime.close()
    expect(server.close).toHaveBeenCalled()
  })

  it('uses an HTTP client without SQLite or local server in remote mode', async () => {
    const workspace = initializeWorkspace(
      fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-remote-runtime-')),
    )
    expect(fs.existsSync(workspace.pgliteDataPath)).toBe(false)
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
        workspaceDataPath: workspace.dataPath,
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
    expect(fs.existsSync(workspace.pgliteDataPath)).toBe(false)
    await runtime.close()
  })
})
