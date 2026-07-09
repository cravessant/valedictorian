import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ValedictorianWorkspaceClient } from 'sparxie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLocalValedictorianClient as createRuntimeLocalValedictorianClient } from '../runtime/local-valedictorian-client'
import { initializeWorkspace } from '../workspace/workspace.initializer'
import { createFileWorkspaceRegistryStore } from '../workspace/workspace.registry'
import { createLocalWorkspaceManager } from './local-workspaces'
import { createValedictorianHttpServer, type StartedValedictorianHttpServer } from './local-server'

function createTempSqlitePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-server-')), 'valedictorian.sqlite')
}

function createLocalValedictorianClient(options: Parameters<typeof createRuntimeLocalValedictorianClient>[0]) {
  return createRuntimeLocalValedictorianClient({
    seedDataMode: 'sample',
    ...options,
  })
}

async function readJson(response: Response) {
  return (await response.json()) as unknown
}

function createBoundaryTestClient(onCreate: () => void): ValedictorianWorkspaceClient {
  return {
    applications: {
      async archive() {},
      async create() {
        onCreate()
        throw new Error('client create should not be called')
      },
      events: {
        async list() {
          throw new Error('not implemented')
        },
      },
      attempts: {
        async complete() {
          throw new Error('not implemented')
        },
        async list() {
          throw new Error('not implemented')
        },
        async start() {
          throw new Error('not implemented')
        },
        async step() {
          throw new Error('not implemented')
        },
      },
      async get() {
        return null
      },
      links: {
        async create() {
          throw new Error('not implemented')
        },
        async update() {
          throw new Error('not implemented')
        },
      },
      async list() {
        throw new Error('not implemented')
      },
      notes: {
        async append() {
          throw new Error('not implemented')
        },
      },
      async update() {
        throw new Error('not implemented')
      },
      async updateStatus() {
        throw new Error('not implemented')
      },
      workflow: {
        async update() {
          throw new Error('not implemented')
        },
      },
    },
    actionQueue: {
      async list() {
        throw new Error('not implemented')
      },
    },
    policy: {
      config: {
        async get() {
          throw new Error('not implemented')
        },
        async reset() {
          throw new Error('not implemented')
        },
        async update() {
          throw new Error('not implemented')
        },
      },
      evidence: {
        async list() {
          throw new Error('not implemented')
        },
        async record() {
          throw new Error('not implemented')
        },
      },
      evaluate: {
        async application() {
          throw new Error('not implemented')
        },
        async runWindow() {
          throw new Error('not implemented')
        },
        async sourcingCandidate() {
          throw new Error('not implemented')
        },
      },
    },
    runs: {
      async complete() {
        throw new Error('not implemented')
      },
      async list() {
        throw new Error('not implemented')
      },
      async start() {
        throw new Error('not implemented')
      },
      async step() {
        throw new Error('not implemented')
      },
    },
    scores: {
      async record() {},
    },
    sourcing: {
      candidates: {
        async process() {
          throw new Error('not implemented')
        },
      },
      findings: {
        async create() {
          throw new Error('not implemented')
        },
        async decide() {
          throw new Error('not implemented')
        },
        async list() {
          throw new Error('not implemented')
        },
        async promote() {
          throw new Error('not implemented')
        },
        async update() {
          throw new Error('not implemented')
        },
      },
    },
  } as unknown as ValedictorianWorkspaceClient
}

describe('local Valedictorian HTTP server', () => {
  let server: StartedValedictorianHttpServer | null = null
  const originalReferenceTrackerPath = process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH

  beforeEach(() => {
    process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH = path.join(
      os.tmpdir(),
      'valedictorian-missing-reference-tracker.md',
    )
  })

  afterEach(async () => {
    await server?.close()
    server = null
    if (originalReferenceTrackerPath === undefined) {
      delete process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH
    } else {
      process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH = originalReferenceTrackerPath
    }
  })

  it('serves health and local capabilities', async () => {
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
    })

    await expect(fetch(`${server.url}/v1/health`).then(readJson)).resolves.toEqual({ ok: true })
    await expect(fetch(`${server.url}/v1/capabilities`).then(readJson)).resolves.toMatchObject({
      localSqlite: true,
      agentWorkflows: false,
      workflowRuns: true,
      applicationAttempts: true,
      sourcing: true,
      connectors: true,
      hostedSync: false,
    })
  })

  it('serves local API responses with browser CORS headers', async () => {
    server = await createValedictorianHttpServer({
      client: createBoundaryTestClient(() => {}),
      host: '127.0.0.1',
      port: 0,
    })

    const response = await fetch(`${server.url}/v1/health`, {
      headers: { origin: 'http://localhost:5173' },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('access-control-allow-headers')).toContain('authorization')
    await expect(readJson(response)).resolves.toEqual({ ok: true })
  })

  it('answers browser CORS preflight requests', async () => {
    server = await createValedictorianHttpServer({
      client: createBoundaryTestClient(() => {}),
      host: '127.0.0.1',
      port: 0,
    })

    const response = await fetch(`${server.url}/v1/workspaces/workspace-1/applications`, {
      headers: {
        'access-control-request-headers': 'authorization, content-type',
        'access-control-request-method': 'GET',
        origin: 'http://localhost:5173',
      },
      method: 'OPTIONS',
    })

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('access-control-allow-methods')).toContain('OPTIONS')
  })

  it('routes workspace-scoped application lists through the selected workspace client', async () => {
    const rootClient = createBoundaryTestClient(() => {})
    const workspaceClient = createBoundaryTestClient(() => {})
    const listCalls: unknown[] = []

    workspaceClient.applications.list = async (query) => {
      listCalls.push(query)
      return { hasMore: false, items: [], limit: 10, offset: 0, total: 0 }
    }

    server = await createValedictorianHttpServer({
      client: rootClient,
      host: '127.0.0.1',
      port: 0,
      resolveWorkspaceClient(workspaceId) {
        expect(workspaceId).toBe('workspace-1')
        return workspaceClient
      },
    })

    const response = await fetch(
      `${server.url}/v1/workspaces/workspace-1/applications?status=queued&limit=10&offset=0`,
    )

    await expect(readJson(response)).resolves.toEqual({
      hasMore: false,
      items: [],
      limit: 10,
      offset: 0,
      total: 0,
    })
    expect(response.status).toBe(200)
    expect(listCalls).toEqual([{ limit: 10, offset: 0, status: 'queued' }])
  })

  it('routes workspace-scoped connector contract requests through the selected workspace client', async () => {
    const rootClient = createBoundaryTestClient(() => {})
    const workspaceClient = createBoundaryTestClient(() => {}) as ValedictorianWorkspaceClient & {
      connectors: {
        list(): Promise<unknown>
        create(input: unknown): Promise<unknown>
        update(input: unknown): Promise<unknown>
        inspect(connectorInstanceId: string): Promise<unknown>
        runs: {
          trigger(input: unknown): Promise<unknown>
        }
        observations: {
          list(input: unknown): Promise<unknown>
        }
      }
    }
    const calls: unknown[] = []

    workspaceClient.connectors = {
      async list() {
        calls.push(['list'])
        return { items: [{ id: 'connector one', displayName: 'Jobright' }] }
      },
      async create(input) {
        calls.push(['create', input])
        return { id: 'connector one', displayName: 'Jobright' }
      },
      async update(input) {
        calls.push(['update', input])
        return { id: 'connector one', displayName: 'Jobright Internships' }
      },
      async inspect(connectorInstanceId) {
        calls.push(['inspect', connectorInstanceId])
        return {
          id: connectorInstanceId,
          auth: [{ id: 'jobright-session', configured: false, label: 'Jobright', mode: 'browser_session' }],
          actionRequired: [
            {
              id: 'jobright-session',
              kind: 'auth',
              label: 'Reconnect',
              message: 'Reconnect the connector session.',
              severity: 'blocked',
            },
          ],
          status: 'auth_required',
        }
      },
      runs: {
        async trigger(input) {
          calls.push(['trigger', input])
          return {
            id: 'run-queued',
            connectorInstanceId: 'connector one',
            mode: 'manual',
            status: 'queued',
          }
        },
      },
      observations: {
        async list(input) {
          calls.push(['observations', input])
          return { hasMore: false, items: [], limit: 10, offset: 0, total: 0 }
        },
      },
    }

    server = await createValedictorianHttpServer({
      client: rootClient,
      host: '127.0.0.1',
      port: 0,
      resolveWorkspaceClient(workspaceId) {
        expect(workspaceId).toBe('workspace-1')
        return workspaceClient
      },
    })

    const listResponse = await fetch(`${server.url}/v1/workspaces/workspace-1/connectors`)
    const createResponse = await fetch(`${server.url}/v1/workspaces/workspace-1/connectors`, {
      body: JSON.stringify({
        id: 'connector one',
        connectorId: 'jobright.resolver',
        connectorVersion: '0.1.0',
        displayName: 'Jobright',
        enabled: true,
        auth: [
          {
            id: 'jobright-session',
            label: 'Jobright session',
            mode: 'browser_session',
            sessionKey: 'workspace-session',
          },
        ],
        config: {
          publicFeedUrl: 'https://jobright.test/feed.json',
        },
        filters: {
          roleKeywords: ['intern'],
        },
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    const updateResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-1/connectors/connector%20one`,
      {
        body: JSON.stringify({
          displayName: 'Jobright Internships',
          enabled: false,
          filters: {
            roleKeywords: ['new grad'],
          },
        }),
        headers: { 'content-type': 'application/json' },
        method: 'PATCH',
      },
    )
    const inspectResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-1/connectors/connector%20one/status`,
    )
    const triggerResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-1/connectors/connector%20one/runs`,
      {
        body: JSON.stringify({
          coverageStartedAt: '2026-07-01T00:00:00.000Z',
          coverageEndedAt: '2026-07-08T00:00:00.000Z',
          filterSignature: 'internships',
          mode: 'manual',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      },
    )
    const observationsResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-1/connectors/connector%20one/observations?connectorRunId=run-1&limit=10`,
    )

    expect(listResponse.status).toBe(200)
    await expect(readJson(listResponse)).resolves.toEqual({
      items: [{ id: 'connector one', displayName: 'Jobright' }],
    })
    expect(createResponse.status).toBe(200)
    await expect(readJson(createResponse)).resolves.toEqual({
      id: 'connector one',
      displayName: 'Jobright',
    })
    expect(updateResponse.status).toBe(200)
    await expect(readJson(updateResponse)).resolves.toEqual({
      id: 'connector one',
      displayName: 'Jobright Internships',
    })
    expect(inspectResponse.status).toBe(200)
    await expect(readJson(inspectResponse)).resolves.toMatchObject({
      actionRequired: [{ kind: 'auth' }],
      auth: [{ configured: false, id: 'jobright-session', mode: 'browser_session' }],
      status: 'auth_required',
    })
    expect(triggerResponse.status).toBe(200)
    await expect(readJson(triggerResponse)).resolves.toMatchObject({
      connectorInstanceId: 'connector one',
      id: 'run-queued',
      status: 'queued',
    })
    expect(observationsResponse.status).toBe(200)
    await expect(readJson(observationsResponse)).resolves.toEqual({
      hasMore: false,
      items: [],
      limit: 10,
      offset: 0,
      total: 0,
    })
    expect(calls).toEqual([
      ['list'],
      [
        'create',
        {
          id: 'connector one',
          connectorId: 'jobright.resolver',
          connectorVersion: '0.1.0',
          displayName: 'Jobright',
          enabled: true,
          auth: [
            {
              id: 'jobright-session',
              label: 'Jobright session',
              mode: 'browser_session',
              sessionKey: 'workspace-session',
            },
          ],
          config: {
            publicFeedUrl: 'https://jobright.test/feed.json',
          },
          filters: {
            roleKeywords: ['intern'],
          },
        },
      ],
      [
        'update',
        {
          connectorInstanceId: 'connector one',
          displayName: 'Jobright Internships',
          enabled: false,
          filters: {
            roleKeywords: ['new grad'],
          },
        },
      ],
      ['inspect', 'connector one'],
      [
        'trigger',
        {
          connectorInstanceId: 'connector one',
          coverageStartedAt: '2026-07-01T00:00:00.000Z',
          coverageEndedAt: '2026-07-08T00:00:00.000Z',
          filterSignature: 'internships',
          mode: 'manual',
        },
      ],
      [
        'observations',
        {
          connectorInstanceId: 'connector one',
          connectorRunId: 'run-1',
          limit: 10,
        },
      ],
    ])
  })

  it('does not expose old unscoped domain routes', async () => {
    server = await createValedictorianHttpServer({
      client: createBoundaryTestClient(() => {}),
      host: '127.0.0.1',
      port: 0,
    })

    const response = await fetch(`${server.url}/v1/applications`)

    expect(response.status).toBe(404)
    await expect(readJson(response)).resolves.toEqual({ message: 'Not found' })
  })

  it('lists registered local workspaces from the registry', async () => {
    const registryStore = createFileWorkspaceRegistryStore(createTempSqlitePath())
    await registryStore.markOpened(
      {
        id: 'workspace-1',
        name: 'Summer Search',
        path: '/Users/keni/Summer Search',
      },
      new Date('2026-06-12T10:00:00.000Z'),
    )

    server = await createValedictorianHttpServer({
      client: createBoundaryTestClient(() => {}),
      host: '127.0.0.1',
      port: 0,
      workspaceManager: createLocalWorkspaceManager({ registryStore }),
    })

    const response = await fetch(`${server.url}/v1/workspaces`)

    await expect(readJson(response)).resolves.toEqual({
      items: [
        {
          id: 'workspace-1',
          lastOpenedAt: '2026-06-12T10:00:00.000Z',
          latestError: null,
          name: 'Summer Search',
          open: true,
          path: '/Users/keni/Summer Search',
          source: 'local',
        },
      ],
    })
  })

  it('opens an existing folder as a registered local workspace', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-http-open-'))
    const registryStore = createFileWorkspaceRegistryStore(createTempSqlitePath())

    server = await createValedictorianHttpServer({
      client: createBoundaryTestClient(() => {}),
      host: '127.0.0.1',
      port: 0,
      workspaceManager: createLocalWorkspaceManager({
        createId: () => 'workspace-opened',
        now: () => new Date('2026-06-12T11:00:00.000Z'),
        registryStore,
      }),
    })

    const response = await fetch(`${server.url}/v1/workspaces/open`, {
      body: JSON.stringify({ path: workspaceRoot }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })

    await expect(readJson(response)).resolves.toEqual({
      id: 'workspace-opened',
      lastOpenedAt: '2026-06-12T11:00:00.000Z',
      latestError: null,
      name: path.basename(workspaceRoot),
      open: true,
      path: workspaceRoot,
      source: 'local',
    })
    await expect(registryStore.get()).resolves.toMatchObject({
      lastOpenedWorkspaceId: 'workspace-opened',
      workspaces: {
        'workspace-opened': {
          id: 'workspace-opened',
          path: workspaceRoot,
        },
      },
    })
  })

  it('creates a workspace at a new path and registers it', async () => {
    const parentPath = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-http-create-parent-'))
    const workspaceRoot = path.join(parentPath, 'Created Search')
    const registryStore = createFileWorkspaceRegistryStore(createTempSqlitePath())

    server = await createValedictorianHttpServer({
      client: createBoundaryTestClient(() => {}),
      host: '127.0.0.1',
      port: 0,
      workspaceManager: createLocalWorkspaceManager({
        createId: () => 'workspace-created',
        now: () => new Date('2026-06-12T12:00:00.000Z'),
        registryStore,
      }),
    })

    const response = await fetch(`${server.url}/v1/workspaces/create`, {
      body: JSON.stringify({ path: workspaceRoot }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })

    await expect(readJson(response)).resolves.toEqual({
      id: 'workspace-created',
      lastOpenedAt: '2026-06-12T12:00:00.000Z',
      latestError: null,
      name: 'Created Search',
      open: true,
      path: workspaceRoot,
      source: 'local',
    })
    expect(fs.existsSync(path.join(workspaceRoot, '.valedictorian', 'manifest.json'))).toBe(true)
    await expect(registryStore.get()).resolves.toMatchObject({
      lastOpenedWorkspaceId: 'workspace-created',
    })
  })

  it('auto-loads registered workspace data for workspace-scoped domain routes', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-http-load-'))
    const registryStore = createFileWorkspaceRegistryStore(createTempSqlitePath())
    const workspaceManager = createLocalWorkspaceManager({
      createId: () => 'workspace-loaded',
      now: () => new Date('2026-06-12T13:00:00.000Z'),
      registryStore,
      seedDataMode: 'sample',
    })
    await workspaceManager.open({ path: workspaceRoot })

    server = await createValedictorianHttpServer({
      client: createBoundaryTestClient(() => {}),
      host: '127.0.0.1',
      port: 0,
      workspaceManager,
    })

    const response = await fetch(
      `${server.url}/v1/workspaces/workspace-loaded/applications?status=needs_user_info&limit=25&offset=0`,
    )
    const payload = (await readJson(response)) as {
      items: Array<{ companyName: string; status: string }>
      total: number
    }

    expect(response.status).toBe(200)
    expect(payload.total).toBe(1)
    expect(payload.items[0]).toMatchObject({
      companyName: 'Astranis Space Technologies',
      status: 'needs_user_info',
    })
  })

  it('passes the explicit workspace id into local workspace clients', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-http-client-'))
    const registryStore = createFileWorkspaceRegistryStore(createTempSqlitePath())
    const clientOptions: Array<Parameters<typeof createRuntimeLocalValedictorianClient>[0]> = []
    const workspaceManager = createLocalWorkspaceManager({
      createClient(options) {
        clientOptions.push(options)
        return createBoundaryTestClient(() => {})
      },
      createId: () => 'workspace-client',
      registryStore,
    })

    await workspaceManager.open({ path: workspaceRoot })
    await workspaceManager.resolveClient('workspace-client')

    expect(clientOptions).toMatchObject([
      {
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
        runConnectorStartupCatchUp: true,
        workspaceId: 'workspace-client',
      },
    ])
  })

  it('blocks opening a workspace when its manifest id is registered to a different path', async () => {
    const firstRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-http-collision-a-'))
    const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-http-collision-b-'))
    const firstWorkspace = initializeWorkspace(firstRoot, {
      createId: () => 'workspace-collision',
    })
    initializeWorkspace(secondRoot, {
      createId: () => 'workspace-collision',
    })
    const registryStore = createFileWorkspaceRegistryStore(createTempSqlitePath())
    await registryStore.markOpened({
      id: firstWorkspace.id,
      name: firstWorkspace.name,
      path: firstWorkspace.rootPath,
    })

    server = await createValedictorianHttpServer({
      client: createBoundaryTestClient(() => {}),
      host: '127.0.0.1',
      port: 0,
      workspaceManager: createLocalWorkspaceManager({ registryStore }),
    })

    const response = await fetch(`${server.url}/v1/workspaces/open`, {
      body: JSON.stringify({ path: secondRoot }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })

    expect(response.status).toBe(409)
    await expect(readJson(response)).resolves.toEqual({
      message:
        'Workspace id workspace-collision is already registered to a different path. Re-key the workspace to register it here.',
    })
    await expect(registryStore.get()).resolves.toMatchObject({
      lastOpenedWorkspaceId: 'workspace-collision',
      workspaces: {
        'workspace-collision': {
          path: firstRoot,
        },
      },
    })
  })

  it('re-keys a colliding workspace manifest when explicitly requested', async () => {
    const firstRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-http-rekey-a-'))
    const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-http-rekey-b-'))
    const firstWorkspace = initializeWorkspace(firstRoot, {
      createId: () => 'workspace-collision',
      now: new Date('2026-06-12T09:00:00.000Z'),
    })
    initializeWorkspace(secondRoot, {
      createId: () => 'workspace-collision',
      now: new Date('2026-06-12T09:30:00.000Z'),
    })
    const manifestPath = path.join(secondRoot, '.valedictorian', 'manifest.json')
    const manifestBeforeRekey = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<
      string,
      unknown
    >
    const registryStore = createFileWorkspaceRegistryStore(createTempSqlitePath())
    await registryStore.markOpened({
      id: firstWorkspace.id,
      name: firstWorkspace.name,
      path: firstWorkspace.rootPath,
    })

    server = await createValedictorianHttpServer({
      client: createBoundaryTestClient(() => {}),
      host: '127.0.0.1',
      port: 0,
      workspaceManager: createLocalWorkspaceManager({
        createId: () => 'workspace-rekeyed',
        now: () => new Date('2026-06-12T14:00:00.000Z'),
        registryStore,
      }),
    })

    const response = await fetch(`${server.url}/v1/workspaces/open`, {
      body: JSON.stringify({ path: secondRoot, rekey: true }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })

    await expect(readJson(response)).resolves.toMatchObject({
      id: 'workspace-rekeyed',
      path: secondRoot,
    })
    expect(JSON.parse(fs.readFileSync(manifestPath, 'utf8'))).toEqual({
      ...manifestBeforeRekey,
      id: 'workspace-rekeyed',
    })
    await expect(registryStore.get()).resolves.toMatchObject({
      lastOpenedWorkspaceId: 'workspace-rekeyed',
      workspaces: {
        'workspace-collision': {
          path: firstRoot,
        },
        'workspace-rekeyed': {
          path: secondRoot,
        },
      },
    })
  })

  it('records and clears a workspace latest error around backend load attempts', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-http-error-'))
    const registryStore = createFileWorkspaceRegistryStore(createTempSqlitePath())
    const workspaceManager = createLocalWorkspaceManager({
      createId: () => 'workspace-error',
      now: () => new Date('2026-06-12T15:00:00.000Z'),
      registryStore,
      seedDataMode: 'sample',
    })
    await workspaceManager.open({ path: workspaceRoot })
    fs.rmSync(workspaceRoot, { force: true, recursive: true })

    server = await createValedictorianHttpServer({
      client: createBoundaryTestClient(() => {}),
      host: '127.0.0.1',
      port: 0,
      workspaceManager,
    })

    const failingResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-error/applications?limit=1`,
    )

    expect(failingResponse.status).toBe(400)
    await expect(fetch(`${server.url}/v1/workspaces`).then(readJson)).resolves.toMatchObject({
      items: [
        {
          id: 'workspace-error',
          latestError: {
            at: '2026-06-12T15:00:00.000Z',
            message: `Workspace path does not exist: ${workspaceRoot}`,
          },
        },
      ],
    })

    initializeWorkspace(workspaceRoot, { createId: () => 'workspace-error' })

    const successfulResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-error/applications?limit=1`,
    )

    expect(successfulResponse.status).toBe(200)
    await expect(fetch(`${server.url}/v1/workspaces`).then(readJson)).resolves.toMatchObject({
      items: [
        {
          id: 'workspace-error',
          latestError: null,
        },
      ],
    })
  })

  it('exposes write-only workspace secrets and explicit sensitive profile details over HTTP', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-http-secrets-'))
    const registryStore = createFileWorkspaceRegistryStore(createTempSqlitePath())
    const workspaceManager = createLocalWorkspaceManager({
      createId: () => 'workspace-secrets',
      registryStore,
      secretCodec: {
        decrypt(value) {
          return value.replace(/^enc:/, '')
        },
        encrypt(value) {
          return `enc:${value}`
        },
      },
    })
    await workspaceManager.open({ path: workspaceRoot })

    server = await createValedictorianHttpServer({
      client: createBoundaryTestClient(() => {}),
      host: '127.0.0.1',
      port: 0,
      workspaceManager,
    })

    const secretResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-secrets/secrets/greenhouse_password`,
      {
        body: JSON.stringify({
          kind: 'password',
          label: 'Greenhouse',
          value: 'correct horse battery staple',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      },
    )
    const secretPayload = (await readJson(secretResponse)) as Record<string, unknown>
    const listResponse = await fetch(`${server.url}/v1/workspaces/workspace-secrets/secrets`)
    const listPayload = (await readJson(listResponse)) as { items: Array<Record<string, unknown>> }
    const revealResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-secrets/secrets/greenhouse_password`,
    )

    expect(secretResponse.status).toBe(200)
    expect(secretPayload).toMatchObject({
      key: 'greenhouse_password',
      kind: 'password',
      label: 'Greenhouse',
    })
    expect(secretPayload).not.toHaveProperty('value')
    expect(listPayload.items[0]).toMatchObject({
      key: 'greenhouse_password',
      kind: 'password',
      label: 'Greenhouse',
    })
    expect(listPayload.items[0]).not.toHaveProperty('value')
    expect(revealResponse.status).toBe(404)

    const sensitiveUpdateResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-secrets/profile/sensitive`,
      {
        body: JSON.stringify({ disabilityStatus: 'No', ssnLast4: '5125' }),
        headers: { 'content-type': 'application/json' },
        method: 'PATCH',
      },
    )
    const sensitiveGetResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-secrets/profile/sensitive`,
    )

    await expect(readJson(sensitiveUpdateResponse)).resolves.toMatchObject({
      disabilityStatus: 'No',
      ssnLast4: '5125',
    })
    await expect(readJson(sensitiveGetResponse)).resolves.toMatchObject({
      disabilityStatus: 'No',
      ssnLast4: '5125',
    })

    const deleteResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-secrets/secrets/greenhouse_password`,
      { method: 'DELETE' },
    )
    const emptyListResponse = await fetch(`${server.url}/v1/workspaces/workspace-secrets/secrets`)

    expect(deleteResponse.status).toBe(200)
    await expect(readJson(emptyListResponse)).resolves.toEqual({ items: [] })
  })

  it('lists and gets applications with auth, filters, and pagination', async () => {
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
      token: 'server-token',
    })

    const listResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-1/applications?status=needs_user_info&minScore=6&source=linkedin&limit=25&offset=0`,
      { headers: { authorization: 'Bearer server-token' } },
    )
    const listPayload = (await readJson(listResponse)) as {
      items: Array<{ companyName: string; id: string; status: string }>
      total: number
    }

    expect(listResponse.status).toBe(200)
    expect(listPayload.total).toBe(1)
    expect(listPayload.items[0]).toMatchObject({
      companyName: 'Astranis Space Technologies',
      status: 'needs_user_info',
    })

    const getResponse = await fetch(`${server.url}/v1/workspaces/workspace-1/applications/${listPayload.items[0].id}`, {
      headers: { authorization: 'Bearer server-token' },
    })

    await expect(readJson(getResponse)).resolves.toMatchObject({
      id: listPayload.items[0].id,
      companyName: 'Astranis Space Technologies',
    })
  })

  it('lists action queue rows with auth, action bucket filtering, and pagination', async () => {
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
      token: 'server-token',
    })

    const actionQueueResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-1/action-queue?actionBucket=apply_now&limit=25&offset=0`,
      { headers: { authorization: 'Bearer server-token' } },
    )
    const actionQueuePayload = (await readJson(actionQueueResponse)) as {
      items: Array<{ actionBucket: string; companyName: string; id: string }>
      total: number
    }

    expect(actionQueueResponse.status).toBe(200)
    expect(actionQueuePayload.total).toBe(1)
    expect(actionQueuePayload.items[0]).toMatchObject({
      id: 'application-versant-platform',
      companyName: 'Versant Media',
      actionBucket: 'apply_now',
    })
  })

  it('serves profile update, read, and non-secret agent context routes', async () => {
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
      token: 'server-token',
    })

    const updateResponse = await fetch(`${server.url}/v1/workspaces/workspace-1/profile`, {
      body: JSON.stringify({
        answers: [
          {
            answer: 'LinkedIn',
            includeInAgentContext: true,
            key: 'how heard',
            label: 'How I heard about the role',
            questionPattern: 'How did you hear about us?',
          },
          {
            answer: 'Private.',
            includeInAgentContext: false,
            key: 'private',
            label: 'Private',
            questionPattern: 'Sensitive question',
          },
        ],
        email: 'kenny@example.com',
        fullName: 'Kenny Lin',
      }),
      headers: {
        authorization: 'Bearer server-token',
        'content-type': 'application/json',
      },
      method: 'PATCH',
    })

    expect(updateResponse.status).toBe(200)
    await expect(readJson(updateResponse)).resolves.toMatchObject({
      answers: [
        expect.objectContaining({ key: 'how_heard' }),
        expect.objectContaining({ key: 'private' }),
      ],
      email: 'kenny@example.com',
      fullName: 'Kenny Lin',
    })

    await expect(
      fetch(`${server.url}/v1/workspaces/workspace-1/profile`, {
        headers: { authorization: 'Bearer server-token' },
      }).then(readJson),
    ).resolves.toMatchObject({
      email: 'kenny@example.com',
      fullName: 'Kenny Lin',
    })
    await expect(
      fetch(`${server.url}/v1/workspaces/workspace-1/profile/agent-context`, {
        headers: { authorization: 'Bearer server-token' },
      }).then(readJson),
    ).resolves.toEqual({
      answers: [
        {
          answer: 'LinkedIn',
          category: null,
          includeInAgentContext: true,
          key: 'how_heard',
          label: 'How I heard about the role',
          questionPattern: 'How did you hear about us?',
        },
      ],
      basics: {
        email: 'kenny@example.com',
        fullName: 'Kenny Lin',
      },
      education: [],
    })
  })

  it('serves workflow runs and sourcing findings routes', async () => {
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
      token: 'server-token',
    })

    const runResponse = await fetch(`${server.url}/v1/workspaces/workspace-1/runs`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer server-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        runType: 'sourcing',
        actorType: 'agent',
        actorName: 'codex',
        sourceName: 'LinkedIn',
        summary: 'Started sourcing.',
      }),
    })
    const run = (await readJson(runResponse)) as { id: string }

    expect(runResponse.status).toBe(200)
    expect(run).toMatchObject({ id: expect.any(String) })

    const findingResponse = await fetch(`${server.url}/v1/workspaces/workspace-1/sourcing/findings`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer server-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        workflowRunId: run.id,
        sourceName: 'LinkedIn',
        companyName: 'Delta Labs',
        roleTitle: 'Software Engineering Intern',
        roleKind: 'internship',
        country: 'US',
        workMode: 'remote',
        timingMode: 'dates',
        startDate: '2027-05-15',
        endDate: '2027-09-01',
        officialUrl: 'https://jobs.example.com/delta',
        priorityScore: 7,
        priorityBand: 'high',
      }),
    })
    const finding = (await readJson(findingResponse)) as { id: string; sourceId: string }

    expect(findingResponse.status).toBe(200)
    expect(finding).toMatchObject({
      term: 'Summer 2027 / Fall 2027',
      terms: [
        { season: 'summer', year: 2027 },
        { season: 'fall', year: 2027 },
      ],
      timingMode: 'dates',
      startDate: '2027-05-15',
      endDate: '2027-09-01',
    })

    await expect(
      fetch(`${server.url}/v1/workspaces/workspace-1/runs?runType=sourcing&status=in_progress&sourceId=${finding.sourceId}`, {
        headers: { authorization: 'Bearer server-token' },
      }).then(readJson),
    ).resolves.toMatchObject({ total: 1, items: [{ id: run.id }] })
    await expect(
      fetch(`${server.url}/v1/workspaces/workspace-1/sourcing/findings?workflowRunId=${run.id}&sourceId=${finding.sourceId}&mergeStatus=new`, {
        headers: { authorization: 'Bearer server-token' },
      }).then(readJson),
    ).resolves.toMatchObject({ total: 1, items: [{ id: finding.id }] })

    const blockedFindingResponse = await fetch(`${server.url}/v1/workspaces/workspace-1/sourcing/findings`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer server-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        workflowRunId: run.id,
        sourceName: 'LinkedIn',
        companyName: 'Human Labs',
        roleTitle: 'Frontend Engineering Intern',
        roleKind: 'internship',
        country: 'US',
        workMode: 'remote',
      }),
    })
    const blockedFinding = (await readJson(blockedFindingResponse)) as { id: string }

    const mergedCreateResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-1/sourcing/findings`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer server-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          workflowRunId: run.id,
          sourceName: 'LinkedIn',
          companyName: 'Manual Merge Labs',
          roleTitle: 'Software Engineering Intern',
          roleKind: 'internship',
          country: 'US',
          workMode: 'remote',
          sourceUrl: 'https://linkedin.com/jobs/view/manual-merge-labs',
          priorityScore: 8,
          priorityBand: 'high',
          mergeStatus: 'merged',
        }),
      },
    )

    expect(mergedCreateResponse.status).toBe(400)
    await expect(readJson(mergedCreateResponse)).resolves.toEqual({
      message: 'Sourcing findings can only be marked merged by promotion.',
    })

    const mixedTimingResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-1/sourcing/findings`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer server-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          workflowRunId: run.id,
          sourceName: 'LinkedIn',
          companyName: 'Mixed Timing Labs',
          roleTitle: 'Software Engineering Intern',
          roleKind: 'internship',
          country: 'US',
          workMode: 'remote',
          term: 'Fall 2027',
          startDate: '2027-09-01',
          sourceUrl: 'https://linkedin.com/jobs/view/mixed-timing-labs',
        }),
      },
    )

    expect(mixedTimingResponse.status).toBe(400)
    await expect(readJson(mixedTimingResponse)).resolves.toEqual({
      message: 'Date-based timing cannot include term or terms input.',
    })

    const mergedUpdateResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-1/sourcing/findings/${blockedFinding.id}`,
      {
        method: 'PATCH',
        headers: {
          authorization: 'Bearer server-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ mergeStatus: 'merged' }),
      },
    )

    expect(mergedUpdateResponse.status).toBe(400)
    await expect(readJson(mergedUpdateResponse)).resolves.toEqual({
      message: 'Sourcing findings can only be marked merged by promotion.',
    })

    const duplicateNotesResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-1/sourcing/findings/${blockedFinding.id}`,
      {
        method: 'PATCH',
        headers: {
          authorization: 'Bearer server-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ duplicateNotes: 'Looks duplicated.' }),
      },
    )

    expect(duplicateNotesResponse.status).toBe(400)
    await expect(readJson(duplicateNotesResponse)).resolves.toEqual({
      message:
        'duplicateNotes is generated by duplicate detection; use dispositionReason or mergeNotes for manual notes.',
    })

    await expect(
      fetch(`${server.url}/v1/workspaces/workspace-1/sourcing/findings/${blockedFinding.id}`, {
        method: 'PATCH',
        headers: {
          authorization: 'Bearer server-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sourceUrl:
            'https://linkedin.com/jobs/view/human-labs?currentJobId=123&trackingId=abc&utm_source=agent',
          priorityScore: 4,
          priorityBand: 'skip',
          fitNotes: 'Below the current sourcing cutoff.',
        }),
      }).then(readJson),
    ).resolves.toMatchObject({
      fitNotes: 'Below the current sourcing cutoff.',
      mergeStatus: 'below_cutoff',
      priorityScore: 4,
      sourceUrl:
        'https://linkedin.com/jobs/view/human-labs?currentJobId=123&trackingId=abc&utm_source=agent',
    })

    await expect(
      fetch(`${server.url}/v1/workspaces/workspace-1/sourcing/findings/${blockedFinding.id}/decide`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer server-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          mergeStatus: 'blocked',
          mergeNotes: 'Needs user decision on sponsorship.',
          policyBlocker: 'needs_user_decision',
        }),
      }).then(readJson),
    ).resolves.toMatchObject({
      dispositionReason: 'Needs user decision on sponsorship.',
      id: blockedFinding.id,
      mergeNotes: 'Needs user decision on sponsorship.',
      mergeStatus: 'blocked',
      policyBlocker: 'needs_user_decision',
    })

    const promotedFinding = (await fetch(
      `${server.url}/v1/workspaces/workspace-1/sourcing/findings/${finding.id}/promote`,
      {
        method: 'POST',
        headers: { authorization: 'Bearer server-token' },
      },
    ).then(readJson)) as { id: string; mergedApplicationId: string; mergeStatus: string }

    expect(promotedFinding).toMatchObject({
      id: finding.id,
      mergeStatus: 'merged',
      mergedApplicationId: expect.any(String),
    })
    await expect(
      fetch(
        `${server.url}/v1/workspaces/workspace-1/sourcing/findings?workflowRunId=${run.id}&mergeStatus=merged`,
        {
          headers: { authorization: 'Bearer server-token' },
        },
      ).then(readJson),
    ).resolves.toMatchObject({
      total: 1,
      items: [{ id: finding.id, mergedApplicationId: promotedFinding.mergedApplicationId }],
    })

    const candidateResponse = await fetch(`${server.url}/v1/workspaces/workspace-1/sourcing/candidates/process`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer server-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        workflowRunId: run.id,
        sourceId: finding.sourceId,
        companyName: 'Echo Health',
        roleTitle: 'Data Engineering Intern',
        roleKind: 'internship',
        country: 'US',
        workMode: 'remote',
        officialUrl: 'https://jobs.example.com/echo',
        score: {
          score: 8,
          band: 'high',
          roleRelevance: 3,
          careerSignal: 2,
          cityWorkMode: 2,
          compensationLogistics: 1,
          penalties: [],
          rationale: 'Strong fit.',
          rubricVersion: 'server-test',
        },
        cutoffScore: 7,
      }),
    })

    expect(candidateResponse.status).toBe(200)
    await expect(readJson(candidateResponse)).resolves.toMatchObject({
      companyName: 'Echo Health',
      mergeStatus: 'merged',
      mergedApplicationId: expect.any(String),
    })
  })

  it('returns a bad request for invalid action queue buckets', async () => {
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
      token: 'server-token',
    })

    const response = await fetch(
      `${server.url}/v1/workspaces/workspace-1/action-queue?actionBucket=random`,
      {
        headers: { authorization: 'Bearer server-token' },
      },
    )

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      message: 'Invalid action queue bucket: random',
    })
  })

  it('serves policy config, evidence, and scheduler-ready evaluation endpoints', async () => {
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
      token: 'server-token',
    })

    await expect(
      fetch(`${server.url}/v1/workspaces/workspace-1/policy/config`, {
        headers: { authorization: 'Bearer server-token' },
      }).then(readJson),
    ).resolves.toMatchObject({
      scoring: {
        applyCutoff: 6,
      },
    })

    await expect(
      fetch(`${server.url}/v1/workspaces/workspace-1/policy/config`, {
        method: 'PATCH',
        headers: {
          authorization: 'Bearer server-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          scoring: {
            applyCutoff: 7,
          },
        }),
      }).then(readJson),
    ).resolves.toMatchObject({
      scoring: {
        applyCutoff: 7,
      },
    })

    const evidence = (await fetch(`${server.url}/v1/workspaces/workspace-1/policy/evidence`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer server-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        subjectType: 'application',
        subjectId: 'application-versant-platform',
        tag: 'explicit_user_approval',
        source: 'user',
        note: 'Approved.',
      }),
    }).then(readJson)) as { id: string }

    expect(evidence).toMatchObject({ id: expect.any(String) })
    await expect(
      fetch(
        `${server.url}/v1/workspaces/workspace-1/policy/evidence?subjectType=application&subjectId=application-versant-platform`,
        {
          headers: { authorization: 'Bearer server-token' },
        },
      ).then(readJson),
    ).resolves.toEqual([expect.objectContaining({ id: evidence.id })])

    await expect(
      fetch(`${server.url}/v1/workspaces/workspace-1/policy/evaluate/run-window`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer server-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sourceName: 'LinkedIn',
          now: '2026-06-08T18:00:00.000Z',
          previousRunCompletedAt: '2026-06-08T17:00:00.000Z',
          timezone: 'America/New_York',
        }),
      }).then(readJson),
    ).resolves.toMatchObject({
      action: 'recommend_run_window',
      recommendedCoverageStartedAt: '2026-06-08T16:30:00.000Z',
      recommendedCoverageEndedAt: '2026-06-08T18:00:00.000Z',
      status: 'allow',
    })
  })

  it('rejects invalid create mutation input before calling the client', async () => {
    let createCalls = 0
    server = await createValedictorianHttpServer({
      client: createBoundaryTestClient(() => {
        createCalls += 1
      }),
      host: '127.0.0.1',
      port: 0,
    })

    const validBody = {
      companyName: 'Delta Labs',
      roleTitle: 'Software Engineering Intern',
      sourceName: 'LinkedIn',
      roleKind: 'internship',
      country: 'US',
      workMode: 'remote',
      status: 'queued',
      primaryLink: {
        kind: 'official',
        label: 'official',
        url: 'https://jobs.example.com/delta',
      },
    }
    const cases = [
      {
        body: {
          ...validBody,
          roleKind: 'intern',
        },
        message: 'Invalid roleKind: intern',
      },
      {
        body: {
          ...validBody,
          companyName: '   ',
        },
        message: 'companyName is required',
      },
      {
        body: {
          ...validBody,
          primaryLink: undefined,
        },
        message: 'Application creation requires a primaryLink or sourceLink',
      },
      {
        body: {
          ...validBody,
          primaryLink: {
            kind: 'official',
            label: 'official',
            url: 'ftp://jobs.example.com/delta',
          },
        },
        message: 'Invalid application URL: ftp://jobs.example.com/delta',
      },
    ]

    for (const testCase of cases) {
      const response = await fetch(`${server.url}/v1/workspaces/workspace-1/applications`, {
        body: JSON.stringify(testCase.body),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })

      expect(response.status).toBe(400)
      await expect(readJson(response)).resolves.toEqual({
        message: testCase.message,
      })
    }

    expect(createCalls).toBe(0)
  })

  it('rejects invalid workflow mutation input before calling the client', async () => {
    let workflowCalls = 0
    const client = createBoundaryTestClient(() => {})
    client.applications.workflow.update = async () => {
      workflowCalls += 1
      throw new Error('client workflow should not be called')
    }
    server = await createValedictorianHttpServer({
      client,
      host: '127.0.0.1',
      port: 0,
    })

    const response = await fetch(`${server.url}/v1/workspaces/workspace-1/applications/application-1/workflow`, {
      body: JSON.stringify({
        lockStartedAt: 'tomorrow-ish',
      }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      message: 'Invalid lockStartedAt: tomorrow-ish',
    })
    expect(workflowCalls).toBe(0)
  })

  it('rejects invalid attempt completion input before calling the client', async () => {
    let completeCalls = 0
    const client = createBoundaryTestClient(() => {})
    client.applications.attempts.complete = async () => {
      completeCalls += 1
      throw new Error('client attempt completion should not be called')
    }
    server = await createValedictorianHttpServer({
      client,
      host: '127.0.0.1',
      port: 0,
    })

    const response = await fetch(
      `${server.url}/v1/workspaces/workspace-1/applications/application-1/attempts/attempt-1/complete`,
      {
        body: JSON.stringify({
          outcome: 'needs_user_info',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'PATCH',
      },
    )

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      message: 'missingUserInfo is required for needs_user_info attempts',
    })
    expect(completeCalls).toBe(0)
  })

  it('updates application status and records scores through the API', async () => {
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
    })

    const statusResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-1/applications/application-versant-platform/status`,
      {
        body: JSON.stringify({ status: 'submitted', notes: 'Submitted from HTTP test.' }),
        headers: { 'content-type': 'application/json' },
        method: 'PATCH',
      },
    )

    await expect(readJson(statusResponse)).resolves.toMatchObject({
      id: 'application-versant-platform',
      notes: 'Submitted from HTTP test.',
      status: 'submitted',
    })

    const scoreResponse = await fetch(`${server.url}/v1/workspaces/workspace-1/scores`, {
      body: JSON.stringify({
        applicationId: 'application-versant-platform',
        score: 8,
        band: 'high',
        roleRelevance: 3,
        careerSignal: 2,
        cityWorkMode: 2,
        compensationLogistics: 1,
        penalties: [],
        rationale: 'Strong fit.',
        rubricVersion: 'http-test',
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })

    await expect(readJson(scoreResponse)).resolves.toMatchObject({
      applicationId: 'application-versant-platform',
      score: 8,
      band: 'high',
      roleRelevance: 3,
      careerSignal: 2,
      cityWorkMode: 2,
      compensationLogistics: 1,
      penalties: [],
      rationale: 'Strong fit.',
      rubricVersion: 'http-test',
      id: expect.any(String) as string,
      createdAt: expect.any(String) as string,
    })

    const applicationResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-1/applications/application-versant-platform`,
    )

    await expect(readJson(applicationResponse)).resolves.toMatchObject({
      currentPriorityBand: 'high',
      currentPriorityScore: 8,
    })
  })

  it('runs application mutation commands through the API', async () => {
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
    })

    const createResponse = await fetch(`${server.url}/v1/workspaces/workspace-1/applications`, {
      body: JSON.stringify({
        companyName: 'Delta Labs',
        roleTitle: 'Software Engineering Intern',
        sourceName: 'LinkedIn',
        roleKind: 'internship',
        country: 'US',
        workMode: 'remote',
        status: 'queued',
        primaryLink: {
          kind: 'official',
          label: 'official',
          url: 'https://jobs.example.com/delta/software-engineering-intern',
        },
        initialNote: 'Created from HTTP mutation test.',
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    const created = (await readJson(createResponse)) as { id: string }

    expect(createResponse.status).toBe(200)
    expect(created).toMatchObject({
      roleTitle: 'Software Engineering Intern',
      primaryLink: {
        url: 'https://jobs.example.com/delta/software-engineering-intern',
      },
    })

    const updateResponse = await fetch(`${server.url}/v1/workspaces/workspace-1/applications/${created.id}`, {
      body: JSON.stringify({
        locationRaw: 'United States / Remote',
        hasApplied: true,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    })
    await expect(readJson(updateResponse)).resolves.toMatchObject({
      hasApplied: true,
      location: 'United States / Remote',
    })

    const workflowResponse = await fetch(`${server.url}/v1/workspaces/workspace-1/applications/${created.id}/workflow`, {
      body: JSON.stringify({
        missingUserInfo: 'Graduation date confirmation',
        blockerReason: null,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    })
    expect(workflowResponse.status).toBe(200)

    const noteResponse = await fetch(`${server.url}/v1/workspaces/workspace-1/applications/${created.id}/notes`, {
      body: JSON.stringify({ message: 'Reached review page.' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    await expect(readJson(noteResponse)).resolves.toMatchObject({
      notes: 'Reached review page.',
    })

    const linkResponse = await fetch(`${server.url}/v1/workspaces/workspace-1/applications/${created.id}/links`, {
      body: JSON.stringify({
        kind: 'source',
        label: 'LinkedIn',
        url: 'https://www.linkedin.com/jobs/view/delta',
        isPrimary: true,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    const link = (await readJson(linkResponse)) as { id: string }

    expect(linkResponse.status).toBe(200)

    const linkUpdateResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-1/applications/${created.id}/links/${link.id}`,
      {
        body: JSON.stringify({ label: 'LinkedIn Easy Apply' }),
        headers: { 'content-type': 'application/json' },
        method: 'PATCH',
      },
    )
    await expect(readJson(linkUpdateResponse)).resolves.toMatchObject({
      label: 'LinkedIn Easy Apply',
    })

    const linksResponse = await fetch(`${server.url}/v1/workspaces/workspace-1/applications/${created.id}/links?limit=10`)
    const links = (await readJson(linksResponse)) as {
      items: Array<{ id: string; isPrimary: boolean; label: string }>
    }

    expect(linksResponse.status).toBe(200)
    expect(links.items).toMatchObject([
      {
        id: link.id,
        label: 'LinkedIn Easy Apply',
        isPrimary: true,
      },
      {
        label: 'official',
        isPrimary: false,
      },
    ])

    const eventsResponse = await fetch(`${server.url}/v1/workspaces/workspace-1/applications/${created.id}/events?limit=10`)
    const events = (await readJson(eventsResponse)) as {
      items: Array<{ type: string }>
    }

    expect(eventsResponse.status).toBe(200)
    expect(events.items.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'application_created',
        'application_updated',
        'workflow_updated',
        'note',
        'link_created',
        'link_updated',
      ]),
    )

    const archiveResponse = await fetch(`${server.url}/v1/workspaces/workspace-1/applications/${created.id}/archive`, {
      body: JSON.stringify({ note: 'No longer pursuing.' }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    })
    expect(archiveResponse.status).toBe(200)

    const getArchivedResponse = await fetch(`${server.url}/v1/workspaces/workspace-1/applications/${created.id}`)
    expect(getArchivedResponse.status).toBe(404)
  })

  it('runs application attempt commands through the API', async () => {
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
    })

    const startResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-1/applications/application-versant-platform/attempts`,
      {
        body: JSON.stringify({
          actorType: 'agent',
          actorName: 'codex',
          summary: 'Started from HTTP.',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      },
    )
    const attempt = (await readJson(startResponse)) as { id: string }

    expect(startResponse.status).toBe(200)
    expect(attempt).toMatchObject({
      status: 'in_progress',
      steps: [{ type: 'attempt_started' }],
    })

    const stepResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-1/applications/application-versant-platform/attempts/${attempt.id}/steps`,
      {
        body: JSON.stringify({
          type: 'page_verified',
          message: 'Verified contact page.',
          payload: {
            page: 'contact',
          },
          actor: 'agent:codex',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      },
    )

    await expect(readJson(stepResponse)).resolves.toMatchObject({
      sequence: 2,
      type: 'page_verified',
    })

    const completeResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-1/applications/application-versant-platform/attempts/${attempt.id}/complete`,
      {
        body: JSON.stringify({
          outcome: 'needs_user_info',
          summary: 'Needs exact availability dates.',
          missingUserInfo: 'Fall 2026 start and end dates',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'PATCH',
      },
    )

    await expect(readJson(completeResponse)).resolves.toMatchObject({
      status: 'completed',
      outcome: 'needs_user_info',
    })

    const listResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-1/applications/application-versant-platform/attempts?limit=10`,
    )

    await expect(readJson(listResponse)).resolves.toMatchObject({
      total: 1,
      items: [
        {
          id: attempt.id,
          steps: [
            { type: 'attempt_started' },
            { type: 'page_verified' },
            { type: 'attempt_completed' },
          ],
        },
      ],
    })
  })

  it('accepts verification receipt attempt steps and completes submitted attempts through the API', async () => {
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
    })

    const startResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-1/applications/application-versant-platform/attempts`,
      {
        body: JSON.stringify({
          actorType: 'agent',
          actorName: 'codex',
          summary: 'Started from HTTP.',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      },
    )
    const attempt = (await readJson(startResponse)) as { id: string }
    const receiptResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-1/applications/application-versant-platform/attempts/${attempt.id}/steps`,
      {
        body: JSON.stringify({
          type: 'verification_receipt',
          message: 'Final review verification passed.',
          payload: {
            version: 1,
            scope: 'final_review',
            status: 'passed',
            verified: ['resume_attachment', 'contact_info', 'required_answers'],
            unresolved: [],
            evidence: 'Final review page showed resume, contact info, and required answers.',
          },
          actor: 'agent:codex',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      },
    )

    await expect(readJson(receiptResponse)).resolves.toMatchObject({
      sequence: 2,
      type: 'verification_receipt',
    })

    const completeResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-1/applications/application-versant-platform/attempts/${attempt.id}/complete`,
      {
        body: JSON.stringify({
          outcome: 'submitted',
          summary: 'Submitted after final review verification.',
          confirmationText: 'Application submitted',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'PATCH',
      },
    )

    await expect(readJson(completeResponse)).resolves.toMatchObject({
      status: 'completed',
      outcome: 'submitted',
      steps: [
        { type: 'attempt_started' },
        { type: 'verification_receipt' },
        { type: 'attempt_completed' },
      ],
    })
  })

  it('returns useful HTTP statuses for unauthorized and missing resources', async () => {
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
      token: 'server-token',
    })

    const unauthorized = await fetch(`${server.url}/v1/workspaces/workspace-1/applications`)
    const missing = await fetch(`${server.url}/v1/workspaces/workspace-1/applications/missing`, {
      headers: { authorization: 'Bearer server-token' },
    })

    expect(unauthorized.status).toBe(401)
    await expect(readJson(unauthorized)).resolves.toEqual({ message: 'Unauthorized' })
    expect(missing.status).toBe(404)
    await expect(readJson(missing)).resolves.toEqual({ message: 'Application not found: missing' })
  })
})
