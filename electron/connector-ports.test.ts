import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createJobrightConnector } from '@sparxie/valedictorian-connectors-jobright'
import { describe, expect, it, vi } from 'vitest'
import { createStaticConnectorRegistry } from '../src/modules/connectors/connector.registry'
import type {
  AppConnectorAuthHost,
  AppConnectorRuntimePorts,
} from '../src/modules/connectors/connector.runner'
import {
  createLocalValedictorianClient,
  type LocalValedictorianClient,
} from '../src/runtime/local-valedictorian-client'
import { createElectronConnectorPorts, type ElectronConnectorWindowOptions } from './connector-ports'

describe('Electron connector ports', () => {
  it('opens a persistent Jobright login window before marking browser-session auth ready', async () => {
    const windows: FakeConnectorWindow[] = []
    const ports = createElectronConnectorPorts({
      createBrowserWindow(options) {
        const window = new FakeConnectorWindow(options)
        windows.push(window)
        return window
      },
      sessionNamespace: 'workspace-1',
    })

    const pendingGrant = ports.connectorAuth.browserSessions?.resolve({
      id: 'jobright',
      label: 'Jobright browser session',
      mode: 'browser_session',
      sessionKey: 'jobright-browser-session',
    })

    expect(windows).toHaveLength(1)
    expect(windows[0]?.options.show).toBe(true)
    expect(windows[0]?.options.webPreferences.partition).toBe(
      'persist:valedictorian-connector-workspace-1-jobright-browser-session',
    )
    expect(windows[0]?.loadedUrls).toEqual(['https://jobright.ai/login'])

    windows[0]?.emitClosed()

    await expect(pendingGrant).resolves.toEqual({
      id: 'jobright',
      mode: 'browser_session',
      sessionId: 'jobright-browser-session',
      sessionKey: 'jobright-browser-session',
      status: 'ready',
    })
  })

  it('resolves a Jobright intermediary URL through the persistent browser session', async () => {
    const windows: FakeConnectorWindow[] = []
    const ports = createElectronConnectorPorts({
      createBrowserWindow(options) {
        const window = new FakeConnectorWindow(options, {
          officialUrl: 'https://example.com/jobs/software-engineering-intern',
          status: 'resolved',
        })
        windows.push(window)
        return window
      },
      sessionNamespace: 'workspace-1',
    })

    await expect(ports.connectorRuntime.browserSession?.resolveLink({
      sessionId: 'jobright-browser-session',
      source: 'jobright',
      url: 'https://jobright.ai/jobs/info/job-123',
    })).resolves.toEqual({
      method: 'electron_browser_session',
      officialUrl: 'https://example.com/jobs/software-engineering-intern',
      status: 'resolved',
    })

    expect(windows).toHaveLength(1)
    expect(windows[0]?.options.show).toBe(false)
    expect(windows[0]?.options.webPreferences.partition).toBe(
      'persist:valedictorian-connector-workspace-1-jobright-browser-session',
    )
    expect(windows[0]?.loadedUrls).toEqual(['https://jobright.ai/jobs/info/job-123'])
    expect(windows[0]?.closed).toBe(true)
  })

  it('bounds a stalled hidden Jobright navigation and reports auth required', async () => {
    vi.useFakeTimers()
    const windows: FakeConnectorWindow[] = []

    try {
      const ports = createElectronConnectorPorts({
        createBrowserWindow(options) {
          const window = new StalledConnectorWindow(options)
          windows.push(window)
          return window
        },
        navigationTimeoutMs: 1_000,
        sessionNamespace: 'workspace-1',
      })
      const pendingResolution = ports.connectorRuntime.browserSession?.resolveLink({
        sessionId: 'jobright-browser-session',
        source: 'jobright',
        url: 'https://jobright.ai/jobs/info/stalled-job',
      })

      await vi.advanceTimersByTimeAsync(1_000)

      await expect(pendingResolution).resolves.toEqual({
        method: 'electron_browser_session',
        officialUrl: null,
        reason: 'browser_session_navigation_timed_out',
        status: 'auth_required',
      })
      expect(windows).toHaveLength(1)
      expect(windows[0]?.options.show).toBe(false)
      expect(windows[0]?.closed).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('bounds a stalled hidden Jobright script and reports auth required', async () => {
    vi.useFakeTimers()
    const windows: FakeConnectorWindow[] = []

    try {
      const ports = createElectronConnectorPorts({
        createBrowserWindow(options) {
          const window = new FakeConnectorWindow(
            options,
            new Promise<never>(() => undefined),
          )
          windows.push(window)
          return window
        },
        navigationTimeoutMs: 1_000,
        sessionNamespace: 'workspace-1',
      })
      let resolution: unknown
      void ports.connectorRuntime.browserSession?.resolveLink({
        sessionId: 'jobright-browser-session',
        source: 'jobright',
        url: 'https://jobright.ai/jobs/info/stalled-script-job',
      }).then((value) => {
        resolution = value
      })

      await vi.advanceTimersByTimeAsync(1_000)

      expect(resolution).toEqual({
        method: 'electron_browser_session',
        officialUrl: null,
        reason: 'browser_session_script_timed_out',
        status: 'auth_required',
      })
      expect(windows).toHaveLength(1)
      expect(windows[0]?.options.show).toBe(false)
      expect(windows[0]?.closed).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports auth required when the hidden Jobright window cannot be created', async () => {
    const attemptedWindowOptions: ElectronConnectorWindowOptions[] = []
    const ports = createElectronConnectorPorts({
      createBrowserWindow(options) {
        attemptedWindowOptions.push(options)
        throw new Error('hidden Jobright window construction failed')
      },
      sessionNamespace: 'workspace-1',
    })

    await expect(ports.connectorRuntime.browserSession?.resolveLink({
      sessionId: 'jobright-browser-session',
      source: 'jobright',
      url: 'https://jobright.ai/jobs/info/window-construction-failure',
    })).resolves.toEqual({
      method: 'electron_browser_session',
      officialUrl: null,
      reason: 'browser_session_resolution_failed',
      status: 'auth_required',
    })
    expect(attemptedWindowOptions).toHaveLength(1)
    expect(attemptedWindowOptions[0]?.show).toBe(false)
  })

  it('finishes an auth-blocked multi-job refresh without opening visible auth windows', async () => {
    const feedUrl = 'https://jobright.test/public-feed'
    const windows: FakeConnectorWindow[] = []
    const connector = createFixtureJobrightConnector(feedUrl)
    const ports = createElectronConnectorPorts({
      createBrowserWindow(options) {
        const window = new FakeConnectorWindow(options, {
          reason: 'browser_session_action_required',
          status: 'auth_required',
        })
        windows.push(window)

        if (options.show) {
          queueMicrotask(() => window.emitClosed())
        }

        return window
      },
      sessionNamespace: 'workspace-1',
    })
    const client = createJobrightTestClient({
      connectorAuth: ports.connectorAuth,
      connector,
      connectorRuntime: {
        ...ports.connectorRuntime,
        delay: immediateDelay,
      },
    })

    await registerJobrightFixture({
      client,
      connector,
      connectorInstanceId: 'jobright-default',
      feedUrl,
      sessionKey: 'jobright-browser-session',
    })

    const { run, status } = await runJobrightFixture(client, 'jobright-default')

    expect(windows.filter((window) => window.options.show)).toHaveLength(0)
    expect(windows).toHaveLength(1)
    expect(run).toMatchObject({
      connectorInstanceId: 'jobright-default',
      observationCount: 3,
      retryHints: {
        authRequired: 3,
      },
    })
    expect(run.completedAt).not.toBeNull()
    expect(status).toMatchObject({
      actionRequired: [
        expect.objectContaining({
          kind: 'auth',
          label: 'Reconnect',
        }),
      ],
      status: 'auth_required',
    })
  })

  it('fails closed and persists Reconnect when hidden Jobright resolution rejects', async () => {
    const feedUrl = 'https://jobright.test/rejected-resolution-feed'
    const windows: FakeConnectorWindow[] = []
    const connector = createFixtureJobrightConnector(feedUrl)
    const ports = createElectronConnectorPorts({
      createBrowserWindow(options) {
        const window = new FailingConnectorWindow(options)
        windows.push(window)
        return window
      },
      sessionNamespace: 'workspace-1',
    })
    const client = createJobrightTestClient({
      connectorAuth: ports.connectorAuth,
      connector,
      connectorRuntime: {
        ...ports.connectorRuntime,
        delay: immediateDelay,
      },
    })

    await registerJobrightFixture({
      client,
      connector,
      connectorInstanceId: 'jobright-rejected-resolution',
      feedUrl,
      sessionKey: 'jobright-browser-session',
    })

    const { persistedRuns, run, status } = await runJobrightFixture(
      client,
      'jobright-rejected-resolution',
    )

    expect(windows.filter((window) => window.options.show)).toHaveLength(0)
    expect(windows).toHaveLength(1)
    expect(run).toMatchObject({
      completedAt: '2026-07-09T16:00:00.000Z',
      observationCount: 3,
      retryHints: {
        authRequired: 3,
      },
    })
    expect(persistedRuns).toMatchObject({
      items: [expect.objectContaining({ id: run.id })],
      total: 1,
    })
    expect(status).toMatchObject({
      actionRequired: [
        expect.objectContaining({ kind: 'auth', label: 'Reconnect' }),
      ],
      status: 'auth_required',
    })
  })

  it('circuits window-construction failure and persists Reconnect for three jobs', async () => {
    const feedUrl = 'https://jobright.test/window-construction-failure-feed'
    const attemptedWindowOptions: ElectronConnectorWindowOptions[] = []
    const connector = createFixtureJobrightConnector(feedUrl)
    const ports = createElectronConnectorPorts({
      createBrowserWindow(options) {
        attemptedWindowOptions.push(options)
        throw new Error('hidden Jobright window construction failed')
      },
      sessionNamespace: 'workspace-1',
    })
    const client = createJobrightTestClient({
      connectorAuth: ports.connectorAuth,
      connector,
      connectorRuntime: {
        ...ports.connectorRuntime,
        delay: immediateDelay,
      },
    })

    await registerJobrightFixture({
      client,
      connector,
      connectorInstanceId: 'jobright-window-construction-failure',
      feedUrl,
      sessionKey: 'jobright-browser-session',
    })

    const { persistedRuns, run, status } = await runJobrightFixture(
      client,
      'jobright-window-construction-failure',
    )

    expect(attemptedWindowOptions).toHaveLength(1)
    expect(attemptedWindowOptions[0]?.show).toBe(false)
    expect(run).toMatchObject({
      completedAt: '2026-07-09T16:00:00.000Z',
      observationCount: 3,
      retryHints: {
        authRequired: 3,
      },
    })
    expect(persistedRuns).toMatchObject({
      items: [expect.objectContaining({ id: run.id })],
      total: 1,
    })
    expect(status).toMatchObject({
      actionRequired: [
        expect.objectContaining({ kind: 'auth', label: 'Reconnect' }),
      ],
      status: 'auth_required',
    })
  })

  it('fails closed and persists Reconnect when the run resolver rejects directly', async () => {
    const feedUrl = 'https://jobright.test/direct-resolver-rejection-feed'
    let resolverAttempts = 0
    const connector = createFixtureJobrightConnector(feedUrl)
    const client = createJobrightTestClient({
      connector,
      connectorRuntime: {
        browserSession: {
          async resolveLink() {
            resolverAttempts += 1
            throw new Error('direct browser-session resolver rejection')
          },
        },
        delay: immediateDelay,
      },
    })

    await registerJobrightFixture({
      client,
      connector,
      connectorInstanceId: 'jobright-direct-resolver-rejection',
      feedUrl,
      sessionKey: 'jobright-browser-session',
    })

    const { persistedRuns, run, status } = await runJobrightFixture(
      client,
      'jobright-direct-resolver-rejection',
    )

    expect(resolverAttempts).toBe(1)
    expect(run).toMatchObject({
      completedAt: '2026-07-09T16:00:00.000Z',
      observationCount: 3,
      retryHints: {
        authRequired: 3,
      },
    })
    expect(persistedRuns).toMatchObject({
      items: [expect.objectContaining({ id: run.id })],
      total: 1,
    })
    expect(status).toMatchObject({
      actionRequired: [
        expect.objectContaining({ kind: 'auth', label: 'Reconnect' }),
      ],
      status: 'auth_required',
    })
  })

  it('retains known-unusable auth across a later empty-feed run without reconnect', async () => {
    const feedUrl = 'https://jobright.test/two-run-unusable-session-feed'
    let feedRequests = 0
    let resolverAttempts = 0
    const connector = createJobrightConnector({
      fetch: async (input) => {
        const requestedUrl = typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url

        if (requestedUrl !== feedUrl) {
          return new Response('', { status: 404 })
        }

        feedRequests += 1
        return new Response(JSON.stringify(
          feedRequests === 1
            ? [{ companyName: 'Acme', jobId: 'job-1', roleTitle: 'Software Intern' }]
            : [],
        ), {
          headers: { 'content-type': 'application/json' },
        })
      },
      now: () => '2026-07-09T16:00:00.000Z',
    })
    const client = createJobrightTestClient({
      connector,
      connectorRuntime: {
        browserSession: {
          async resolveLink() {
            resolverAttempts += 1
            return {
              reason: 'browser_session_action_required',
              status: 'auth_required',
            }
          },
        },
        delay: immediateDelay,
      },
    })

    await registerJobrightFixture({
      client,
      connector,
      connectorInstanceId: 'jobright-two-run-unusable-session',
      feedUrl,
      sessionKey: 'jobright-browser-session',
    })

    const first = await runJobrightFixture(client, 'jobright-two-run-unusable-session')
    const second = await runJobrightFixture(client, 'jobright-two-run-unusable-session')
    const instances = await client.connectors.list()

    expect(feedRequests).toBe(1)
    expect(resolverAttempts).toBe(1)
    expect(first.run).toMatchObject({
      observationCount: 1,
      retryHints: { authRequired: 1 },
    })
    expect(first.status).toMatchObject({
      actionRequired: [expect.objectContaining({ kind: 'auth', label: 'Reconnect' })],
      status: 'auth_required',
    })
    expect(second.run).toMatchObject({
      observationCount: 0,
      retryHints: {
        authRequired: 1,
        reason: 'browser_session_action_required',
      },
      status: 'partial_success',
    })
    expect(second.persistedRuns).toMatchObject({ total: 2 })
    expect(second.status).toMatchObject({
      actionRequired: [expect.objectContaining({ kind: 'auth', label: 'Reconnect' })],
      status: 'auth_required',
    })
    expect(instances.items[0]?.auth).toEqual([
      expect.objectContaining({ configured: false, id: 'jobright' }),
    ])
  })

  it('persists an actionable terminal run when the Jobright session handle is missing', async () => {
    const feedUrl = 'https://jobright.test/missing-session-feed'
    const windows: FakeConnectorWindow[] = []
    const connector = createFixtureJobrightConnector(feedUrl)
    const ports = createElectronConnectorPorts({
      createBrowserWindow(options) {
        const window = new FakeConnectorWindow(options)
        windows.push(window)
        return window
      },
      sessionNamespace: 'workspace-1',
    })
    const client = createJobrightTestClient({
      connectorAuth: ports.connectorAuth,
      connector,
      connectorRuntime: {
        ...ports.connectorRuntime,
        delay: immediateDelay,
      },
    })

    await registerJobrightFixture({
      client,
      connector,
      connectorInstanceId: 'jobright-missing-session',
      feedUrl,
    })

    const { persistedRuns, run, status } = await runJobrightFixture(
      client,
      'jobright-missing-session',
    )

    expect(windows).toHaveLength(0)
    expect(run).toMatchObject({
      completedAt: '2026-07-09T16:00:00.000Z',
      observationCount: 0,
      retryHints: {
        authRequired: 1,
      },
      status: 'partial_success',
    })
    expect(persistedRuns).toMatchObject({
      items: [
        expect.objectContaining({
          id: run.id,
          completedAt: '2026-07-09T16:00:00.000Z',
        }),
      ],
      total: 1,
    })
    expect(status).toMatchObject({
      actionRequired: [
        expect.objectContaining({ kind: 'auth', label: 'Reconnect' }),
      ],
      status: 'auth_required',
    })
  })

  it('preflights a missing Jobright session before an empty feed with no browser fallback', async () => {
    const feedUrl = 'https://jobright.test/empty-feed'
    const windows: FakeConnectorWindow[] = []
    let feedRequests = 0
    const connector = createJobrightConnector({
      fetch: async () => {
        feedRequests += 1
        return new Response('[]', {
          headers: { 'content-type': 'application/json' },
        })
      },
      now: () => '2026-07-09T16:00:00.000Z',
    })
    const ports = createElectronConnectorPorts({
      createBrowserWindow(options) {
        const window = new FakeConnectorWindow(options)
        windows.push(window)
        return window
      },
      sessionNamespace: 'workspace-1',
    })
    const client = createJobrightTestClient({
      connectorAuth: ports.connectorAuth,
      connector,
      connectorRuntime: ports.connectorRuntime,
    })

    await registerJobrightFixture({
      client,
      connector,
      connectorInstanceId: 'jobright-empty-feed-missing-session',
      feedUrl,
    })

    const { persistedRuns, run, status } = await runJobrightFixture(
      client,
      'jobright-empty-feed-missing-session',
    )

    expect(feedRequests).toBe(0)
    expect(windows).toHaveLength(0)
    expect(run).toMatchObject({
      completedAt: '2026-07-09T16:00:00.000Z',
      observationCount: 0,
      retryHints: {
        authRequired: 1,
        reason: 'browser_session_action_required',
      },
      status: 'partial_success',
    })
    expect(persistedRuns).toMatchObject({
      items: [expect.objectContaining({ id: run.id })],
      total: 1,
    })
    expect(status).toMatchObject({
      actionRequired: [
        expect.objectContaining({ kind: 'auth', label: 'Reconnect' }),
      ],
      status: 'auth_required',
    })
  })

  it('persists an actionable terminal run after explicit Jobright login is cancelled', async () => {
    const feedUrl = 'https://jobright.test/cancelled-session-feed'
    const browserResolutionInputs: unknown[] = []
    const connector = createFixtureJobrightConnector(feedUrl)
    const client = createJobrightTestClient({
      connectorAuth: {
        browserSessions: {
          async resolve(reference) {
            return {
              id: reference.id,
              mode: reference.mode,
              reason: 'browser_session_login_cancelled',
              status: 'action_required',
            }
          },
        },
      },
      connector,
      connectorRuntime: {
        browserSession: {
          async resolveLink(input) {
            browserResolutionInputs.push(input)
            return {
              reason: 'browser_session_action_required',
              status: 'auth_required',
            }
          },
        },
        delay: immediateDelay,
      },
    })

    await registerJobrightFixture({
      client,
      connector,
      connectorInstanceId: 'jobright-cancelled-session',
      feedUrl,
      sessionKey: 'cancelled-jobright-session',
    })

    const reconnect = await client.connectors.status.reconnect({
      connectorInstanceId: 'jobright-cancelled-session',
    })
    const instances = await client.connectors.list()
    const { persistedRuns, run, status } = await runJobrightFixture(
      client,
      'jobright-cancelled-session',
    )

    expect(reconnect).toMatchObject({
      grants: [
        {
          id: 'jobright',
          reason: 'browser_session_login_cancelled',
          status: 'action_required',
        },
      ],
      status: 'action_required',
    })
    expect(instances.items[0]?.auth).toEqual([
      expect.objectContaining({
        configured: false,
        id: 'jobright',
      }),
    ])
    expect(browserResolutionInputs).toHaveLength(0)
    expect(run).toMatchObject({
      completedAt: '2026-07-09T16:00:00.000Z',
      observationCount: 0,
      retryHints: {
        authRequired: 1,
      },
      status: 'partial_success',
    })
    expect(persistedRuns).toMatchObject({
      items: [
        expect.objectContaining({
          id: run.id,
          completedAt: '2026-07-09T16:00:00.000Z',
        }),
      ],
      total: 1,
    })
    expect(status).toMatchObject({
      actionRequired: [
        expect.objectContaining({ kind: 'auth', label: 'Reconnect' }),
      ],
      status: 'auth_required',
    })
  })
})

type FixtureJobrightConnector = ReturnType<typeof createJobrightConnector>

function createFixtureJobrightConnector(feedUrl: string): FixtureJobrightConnector {
  return createJobrightConnector({
    fetch: createJobrightFixtureFetch(feedUrl),
    now: () => '2026-07-09T16:00:00.000Z',
  })
}

function createJobrightTestClient({
  connector,
  connectorAuth,
  connectorRuntime,
}: {
  connector: FixtureJobrightConnector
  connectorAuth?: AppConnectorAuthHost
  connectorRuntime?: AppConnectorRuntimePorts
}): LocalValedictorianClient {
  return createLocalValedictorianClient({
    connectorAuth,
    connectorRegistry: createStaticConnectorRegistry([connector]),
    connectorRuntime,
    now: () => new Date('2026-07-09T16:00:00.000Z'),
    sqlitePath: createTempSqlitePath(),
    workspaceId: 'workspace-1',
  })
}

async function registerJobrightFixture({
  client,
  connector,
  connectorInstanceId,
  feedUrl,
  sessionKey,
}: {
  client: LocalValedictorianClient
  connector: FixtureJobrightConnector
  connectorInstanceId: string
  feedUrl: string
  sessionKey?: string
}) {
  await client.connectors.create({
    id: connectorInstanceId,
    connectorId: connector.definition.id,
    connectorVersion: connector.definition.version,
    displayName: `Jobright ${connectorInstanceId}`,
    enabled: true,
    auth: [
      {
        id: 'jobright',
        label: 'Jobright browser session',
        mode: 'browser_session',
        ...(sessionKey ? { sessionKey } : {}),
      },
    ],
    config: { publicFeedUrl: feedUrl },
    filters: {
      maxResolutionCount: 3,
      roleTerms: ['intern'],
    },
  })
}

async function runJobrightFixture(
  client: LocalValedictorianClient,
  connectorInstanceId: string,
) {
  const run = await client.connectors.runs.trigger({
    connectorInstanceId,
    coverageStartedAt: '2026-07-09T15:00:00.000Z',
    coverageEndedAt: '2026-07-09T16:00:00.000Z',
    mode: 'manual',
  })
  const persistedRuns = await client.connectors.runs.list({ connectorInstanceId })
  const status = await client.connectors.inspect(connectorInstanceId)

  return { persistedRuns, run, status }
}

const immediateDelay = {
  async wait() {
    return 0
  },
}

function createJobrightFixtureFetch(feedUrl: string): typeof fetch {
  return async (input) => {
    const requestedUrl = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url

    if (requestedUrl === feedUrl) {
      return new Response(JSON.stringify([
        { companyName: 'Acme', jobId: 'job-1', roleTitle: 'Software Intern' },
        { companyName: 'Beta', jobId: 'job-2', roleTitle: 'Platform Intern' },
        { companyName: 'Gamma', jobId: 'job-3', roleTitle: 'Security Intern' },
      ]), {
        headers: { 'content-type': 'application/json' },
      })
    }

    return new Response('', { status: 404 })
  }
}

function createTempSqlitePath() {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-jobright-')),
    'valedictorian.sqlite',
  )
}

class FakeConnectorWindow {
  readonly loadedUrls: string[] = []
  readonly webContents: FakeConnectorWebContents
  closed = false
  private readonly listeners = new Map<string, Array<() => void>>()
  private destroyed = false

  constructor(
    readonly options: ElectronConnectorWindowOptions,
    scriptResult: unknown = null,
  ) {
    this.webContents = new FakeConnectorWebContents(scriptResult)
  }

  async loadURL(url: string) {
    this.loadedUrls.push(url)
    this.webContents.currentUrl = url
  }

  on(event: string, listener: () => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
  }

  close() {
    this.closed = true
    this.emitClosed()
  }

  isDestroyed() {
    return this.destroyed
  }

  emitClosed() {
    this.closed = true
    this.destroyed = true
    for (const listener of this.listeners.get('closed') ?? []) {
      listener()
    }
  }
}

class StalledConnectorWindow extends FakeConnectorWindow {
  override async loadURL(url: string): Promise<never> {
    this.loadedUrls.push(url)
    return new Promise<never>(() => undefined)
  }
}

class FailingConnectorWindow extends FakeConnectorWindow {
  override async loadURL(url: string): Promise<never> {
    this.loadedUrls.push(url)
    throw new Error('hidden Jobright resolution failed')
  }
}

class FakeConnectorWebContents {
  currentUrl = 'about:blank'

  constructor(private readonly scriptResult: unknown) {}

  getURL() {
    return this.currentUrl
  }

  async executeJavaScript<T = unknown>() {
    return this.scriptResult as T
  }
}
