import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ValedictorianWorkspaceClient } from 'sparxie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStaticConnectorRegistry } from '../modules/connectors/connector.registry'
import type { AppJobConnector } from '../modules/connectors/connector.runner'
import { createLocalValedictorianClient as createRuntimeLocalValedictorianClient } from '../runtime/local-valedictorian-client'
import { createValedictorianRuntime } from '../runtime/valedictorian-runtime'
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
          return {
            hasMore: false,
            items: [
              {
                companyName: 'Delta Labs',
                connectorId: 'jobright.resolver',
                connectorVersion: '0.3.0',
                parserVersion: 'jobright-parser@0.3.0',
                observationSchemaVersion: 'job-observation@2',
                roleTitle: 'Software Engineering Intern',
                sourceRecordKey: 'jobright:delta',
              },
            ],
            limit: 10,
            offset: 0,
            total: 1,
          }
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
      items: [
        {
          companyName: 'Delta Labs',
          connectorId: 'jobright.resolver',
          connectorVersion: '0.3.0',
          parserVersion: 'jobright-parser@0.3.0',
          observationSchemaVersion: 'job-observation@2',
          roleTitle: 'Software Engineering Intern',
          sourceRecordKey: 'jobright:delta',
        },
      ],
      limit: 10,
      offset: 0,
      total: 1,
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

  it('returns the IPC active connector run when the workspace HTTP surface attaches late', async () => {
    const workspaceId = 'workspace-connector-surfaces'
    const connectorInstanceId = 'connector-instance-surfaces'
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-surfaces-'))
    const workspace = initializeWorkspace(workspaceRoot, { createId: () => workspaceId })
    const registryStore = createFileWorkspaceRegistryStore(createTempSqlitePath())
    let releaseRefresh: (() => void) | undefined
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve
    })
    let refreshCount = 0
    const connector: AppJobConnector = {
      definition: {
        id: 'fixture.surfaces',
        version: '0.0.0-fixture',
      },
      async refresh(input) {
        refreshCount += 1
        await refreshGate

        return {
          coverage: input.coverage,
          nextCheckpoint: {
            checkpoint: { cursor: input.coverage.end },
            schemaVersion: 'fixture-checkpoint@1',
          },
          observations: [],
          stats: { observations: 0 },
          warnings: [],
        }
      },
    }
    const connectorRegistry = createStaticConnectorRegistry([connector])
    let createdClientCount = 0
    const createClient = (
      options: Parameters<typeof createRuntimeLocalValedictorianClient>[0],
    ) => {
      createdClientCount += 1
      return createRuntimeLocalValedictorianClient({
        ...options,
        connectorRegistry,
        seedDataMode: 'none',
      })
    }
    const workspaceManager = createLocalWorkspaceManager({
      createClient,
      registryStore,
    })

    await workspaceManager.open({ path: workspaceRoot })

    const runtime = await createValedictorianRuntime({
      config: {
        apiHost: '127.0.0.1',
        apiPort: 0,
        apiUrl: 'http://127.0.0.1:0',
        mode: 'local-desktop',
        seedDataMode: 'none',
        sqlitePath: workspace.sqlitePath,
        workspaceId,
      },
      createLocalClient: createClient,
      workspaceManager,
    })
    const connectors = runtime.connectors

    if (!connectors || !runtime.server) {
      await runtime.close()
      throw new Error('Expected local connector and HTTP runtime surfaces')
    }

    await connectors.create({
      id: connectorInstanceId,
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      displayName: 'Surface fixture jobs',
      enabled: true,
    })

    const triggerInput = {
      connectorInstanceId,
      coverageStartedAt: '2026-07-08T17:00:00.000Z',
      coverageEndedAt: '2026-07-08T18:00:00.000Z',
      mode: 'manual' as const,
    }
    const ipcRunPromise = connectors.runs.trigger(triggerInput)

    await vi.waitFor(() => {
      expect(refreshCount).toBe(1)
    })

    let httpRun: Record<string, unknown> | undefined
    const httpRunPromise = fetch(
      `${runtime.server.url}/v1/workspaces/${workspaceId}/connectors/${connectorInstanceId}/runs`,
      {
        body: JSON.stringify(triggerInput),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      },
    ).then(async (response) => {
      const run = await readJson(response) as Record<string, unknown>
      httpRun = run
      return { response, run }
    })
    let regressionError: unknown

    try {
      await vi.waitFor(() => {
        expect(httpRun).toMatchObject({
          connectorInstanceId,
          status: 'running',
        })
      }, { timeout: 250 })
      expect(createdClientCount).toBe(1)
      expect(refreshCount).toBe(1)
    } catch (error) {
      regressionError = error
    } finally {
      releaseRefresh?.()
    }

    const [ipcResult, httpResult] = await Promise.allSettled([ipcRunPromise, httpRunPromise])
    await runtime.close()

    if (regressionError) {
      throw regressionError
    }

    if (ipcResult.status === 'rejected') {
      throw ipcResult.reason
    }

    if (httpResult.status === 'rejected') {
      throw httpResult.reason
    }

    expect(ipcResult.value).toMatchObject({ status: 'completed' })
    expect(httpResult.value).toMatchObject({
      response: { status: 200 },
      run: { id: ipcResult.value.id },
    })
  })

  it('keeps a live connector run owned when its workspace is reopened through the real path after a symlink alias', async () => {
    const workspaceAId = 'workspace-lifecycle-a'
    const workspaceBId = 'workspace-lifecycle-b'
    const connectorInstanceId = 'connector-instance-lifecycle'
    const workspaceAReal = initializeWorkspace(
      fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-lifecycle-a-real-')),
      { createId: () => workspaceAId },
    )
    const workspaceAAliasRoot = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-lifecycle-a-alias-')),
      'workspace',
    )
    fs.symlinkSync(workspaceAReal.rootPath, workspaceAAliasRoot, 'dir')
    const workspaceAAlias = initializeWorkspace(workspaceAAliasRoot)
    const workspaceB = initializeWorkspace(
      fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-lifecycle-b-')),
      { createId: () => workspaceBId },
    )
    const registryStore = createFileWorkspaceRegistryStore(createTempSqlitePath())
    let releaseRefresh: (() => void) | undefined
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve
    })
    let refreshCount = 0
    const connector: AppJobConnector = {
      definition: {
        id: 'fixture.lifecycle',
        version: '0.0.0-fixture',
      },
      async refresh(input) {
        refreshCount += 1
        await refreshGate

        return {
          coverage: input.coverage,
          nextCheckpoint: {
            checkpoint: { cursor: input.coverage.end },
            schemaVersion: 'fixture-checkpoint@1',
          },
          observations: [],
          stats: { observations: 0 },
          warnings: [],
        }
      },
    }
    const connectorRegistry = createStaticConnectorRegistry([connector])
    const createClient = (
      options: Parameters<typeof createRuntimeLocalValedictorianClient>[0],
    ) => createRuntimeLocalValedictorianClient({
      ...options,
      connectorRegistry,
      seedDataMode: 'none',
    })
    const workspaceManager = createLocalWorkspaceManager({
      createClient,
      registryStore,
    })
    const createRuntime = (workspace: typeof workspaceAAlias) => createValedictorianRuntime({
      config: {
        apiHost: '127.0.0.1',
        apiPort: 0,
        apiUrl: 'http://127.0.0.1:0',
        mode: 'local-desktop',
        seedDataMode: 'none',
        sqlitePath: workspace.sqlitePath,
        workspaceId: workspace.id,
      },
      createLocalClient: createClient,
      workspaceManager,
    })

    await workspaceManager.open({ path: workspaceAAlias.rootPath })
    await workspaceManager.open({ path: workspaceB.rootPath })

    const firstRuntime = await createRuntime(workspaceAAlias)
    const firstConnectors = firstRuntime.connectors

    if (!firstConnectors) {
      await firstRuntime.close()
      throw new Error('Expected connector IPC surface for workspace A')
    }

    await firstConnectors.create({
      id: connectorInstanceId,
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      displayName: 'Lifecycle fixture jobs',
      enabled: true,
    })
    const triggerInput = {
      connectorInstanceId,
      coverageStartedAt: '2026-07-08T17:00:00.000Z',
      coverageEndedAt: '2026-07-08T18:00:00.000Z',
      mode: 'manual' as const,
    }
    const firstRunPromise = firstConnectors.runs.trigger(triggerInput)

    await vi.waitFor(() => {
      expect(refreshCount).toBe(1)
    })
    expect(fs.realpathSync(workspaceAAlias.sqlitePath)).toBe(
      fs.realpathSync(workspaceAReal.sqlitePath),
    )
    await firstRuntime.close()

    const secondWorkspaceRuntime = await createRuntime(workspaceB)
    await secondWorkspaceRuntime.close()

    const reopenedRuntime = await createRuntime(workspaceAReal)
    const reopenedConnectors = reopenedRuntime.connectors

    if (!reopenedConnectors) {
      releaseRefresh?.()
      await firstRunPromise.catch(() => undefined)
      await reopenedRuntime.close()
      throw new Error('Expected reopened connector IPC surface for workspace A')
    }

    let reopenedRun: Awaited<typeof firstRunPromise> | undefined
    const reopenedRunPromise = reopenedConnectors.runs.trigger(triggerInput).then((run) => {
      reopenedRun = run
      return run
    })
    let regressionError: unknown

    try {
      await vi.waitFor(() => {
        expect(reopenedRun).toMatchObject({
          connectorInstanceId,
          status: 'running',
        })
      }, { timeout: 250 })
      expect(refreshCount).toBe(1)
    } catch (error) {
      regressionError = error
    } finally {
      releaseRefresh?.()
    }

    const [firstResult, reopenedResult] = await Promise.allSettled([
      firstRunPromise,
      reopenedRunPromise,
    ])
    await reopenedRuntime.close()

    if (regressionError) {
      throw regressionError
    }

    if (firstResult.status === 'rejected') {
      throw firstResult.reason
    }

    if (reopenedResult.status === 'rejected') {
      throw reopenedResult.reason
    }

    expect(firstResult.value).toMatchObject({ status: 'completed' })
    expect(reopenedResult.value.id).toBe(firstResult.value.id)
  })

  it('resolves local workspace clients without scheduling startup connector work', async () => {
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
        connectorRuntime: {
          delay: {
            wait: expect.any(Function),
          },
        },
        workspaceId: 'workspace-client',
      },
    ])
    expect(clientOptions[0]).not.toHaveProperty('connectorAuth')
    expect(clientOptions[0]).not.toHaveProperty('runConnectorStartupCatchUp')
  })

})
