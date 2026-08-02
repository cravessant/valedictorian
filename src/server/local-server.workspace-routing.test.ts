import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHttpValedictorianClient } from '@sparxie/sdk'
import { emptyPageInfo } from '../modules/lifecycle-table/lifecycle.test-helpers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStaticConnectorRegistry } from '@sparxie/valedictorian-local-runtime/testing/modules/connectors/core/connector.registry'
import { prepareWorkspaceProfileCapabilities } from '@sparxie/valedictorian-local-runtime/testing/modules/profile/profile.composition'
import { completedConnectorRefreshContract } from '@sparxie/valedictorian-local-runtime/testing/modules/connectors/public/connector.refresh-result.test-helpers'
import type { AppJobConnector } from '@sparxie/valedictorian-local-runtime/testing/modules/connectors/ports/connector.runner-contracts'
import {
  createLocalValedictorianClient as createRuntimeLocalValedictorianClient,
  type LocalValedictorianClient,
} from '@sparxie/valedictorian-local-runtime/local-client'
import { createValedictorianRuntime } from '@sparxie/valedictorian-local-runtime/runtime'
import { initializeWorkspace } from '@sparxie/valedictorian-local-runtime/workspace-runtime'
import { createFileWorkspaceRegistryStore } from '@sparxie/valedictorian-local-runtime/workspace-files'
import { createLocalWorkspaceManager } from '@sparxie/valedictorian-local-runtime/workspace-runtime'
import {
  createBoundaryWorkspaceClient as createBoundaryTestClient,
  createLocalServerHttpTestFixture,
  createTempFilePath,
  readJson,
} from './local-server.http-test-harness'

describe('local Valedictorian HTTP server', () => {
  const fixture = createLocalServerHttpTestFixture()

  beforeEach(() => fixture.setup())
  afterEach(() => fixture.teardown())

  it('serves health and local capabilities', async () => {
    const server = await fixture.start({
      client: createBoundaryTestClient(() => {}),
      host: '127.0.0.1',
      port: 0,
    })

    await expect(fetch(`${server.url}/v1/health`).then(readJson)).resolves.toEqual({ ok: true })
    await expect(fetch(`${server.url}/v1/capabilities`).then(readJson)).resolves.toMatchObject({
      localSqlite: true,
      agentWorkflows: false,
      workflowRuns: true,
      applicationAttempts: true,
      sourcing: false,
      connectors: true,
      hostedSync: false,
    })
  })

  it('serves local API responses with browser CORS headers', async () => {
    const server = await fixture.start({
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
    const server = await fixture.start({
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

  it('routes workspace-scoped canonical application lists through the selected workspace client', async () => {
    const rootClient = createBoundaryTestClient(() => {})
    const workspaceClient = createBoundaryTestClient(() => {})
    const listCalls: unknown[] = []

    workspaceClient.applications.list = async (query?) => {
      listCalls.push(query)
      return { items: [], pageInfo: emptyPageInfo }
    }

    const server = await fixture.start({
      client: rootClient,
      host: '127.0.0.1',
      port: 0,
      resolveWorkspaceClient(workspaceId) {
        expect(workspaceId).toBe('workspace-1')
        return workspaceClient
      },
    })

    const response = await fetch(
      `${server.url}/v1/workspaces/workspace-1/applications?limit=10&offset=0`,
    )

    await expect(readJson(response)).resolves.toEqual({ items: [], pageInfo: emptyPageInfo })
    expect(response.status).toBe(200)
    expect(listCalls).toEqual([{ limit: 10, offset: 0 }])
  })

  it('routes workspace-scoped connector contract requests through the selected workspace client', async () => {
    const rootClient = createBoundaryTestClient(() => {})
    const workspaceClient = createBoundaryTestClient(() => {})
    const calls: unknown[] = []

    // The stubs deliberately answer with payloads the connector contract forbids,
    // so the HTTP admission layer is the only thing that can reject or strip them.
    const admissionProbeConnectors = {
      async list() {
        calls.push(['list'])
        return { items: [{ id: 'connector one', displayName: 'Jobright' }] }
      },
      async create(input: unknown) {
        calls.push(['create', input])
        return { id: 'connector one', displayName: 'Jobright' }
      },
      async update(input: unknown) {
        calls.push(['update', input])
        return { id: 'connector one', displayName: 'Jobright Internships' }
      },
      async inspect(connectorInstanceId: string) {
        calls.push(['inspect', connectorInstanceId])
        return {
          id: connectorInstanceId,
          connectorId: 'jobright.resolver',
          connectorVersion: '1.0.0',
          displayName: 'Jobright',
          enabled: true,
          auth: [{ id: 'jobright-session', configured: false, label: 'Jobright', mode: 'api_key' }],
          actionRequired: [
            {
              id: 'jobright-session',
              kind: 'auth',
              label: 'Reconnect',
              message: 'Reconnect the connector session.',
              severity: 'blocked',
            },
          ],
          actions: [{ id: 'reconnect', label: 'Reconnect' }],
          lastRunAt: '2026-07-08T00:00:00.000Z',
          latestRunId: 'run-auth-required',
          observationCount: 0,
          severity: 'blocked',
          status: 'authentication_required',
          statusLabel: 'Authentication required',
          summary: 'Reconnect the connector session.',
          warningCount: 0,
          warnings: [],
          secretSession: 'must-not-cross-http',
        }
      },
      runs: {
        async trigger(input: unknown) {
          calls.push(['trigger', input])
          return {
            id: 'run-queued',
            connectorInstanceId: 'connector one',
            executionScopeId: 'scope_connector_one',
            mode: 'manual',
            scheduleOccurrence: null,
            status: 'queued',
            filterSignature: 'internships',
            observationCount: 0,
            warningCount: 0,
            warnings: [],
            newestFrontier: { state: 'not_started' },
            historicalBackfill: { state: 'not_started', boundary: { earliestDate: '2026-07-01' } },
            pendingResolutionCount: 0,
            lifecycleCounts: {
              version: 'connector-run-lifecycle-counts/v1',
              source: 'live_current',
              scope: {
                kind: 'connector_run',
                connectorRunId: 'run-queued',
                executionScopeId: 'scope_connector_one',
              },
              provider: {
                returnedRows: 0, validRecords: 0, invalidRecords: 0,
                sourceDuplicates: 0, capturedRecords: 0, occurrenceCount: 0,
                captureShortfall: 0, unclassifiedRows: 0,
                invariant: 'reconciled', gaps: [],
              },
              destination: {
                normalized: 0, resolvedEmployerOrAts: 0, resolvedThirdParty: 0,
                unresolved: 0, pending: 0, gateRejected: 0, unclassified: 0,
                invariant: 'reconciled',
              },
              opportunity: {
                opportunitiesCreated: 0, existingJobMatches: 0, notFit: 0,
                rejected: 0, actionableReview: 0, unclassified: 0,
                invariant: 'reconciled',
              },
            },
            outcome: { kind: 'in_progress' },
            startedAt: '2026-07-08T00:00:00.000Z',
            completedAt: null,
            coverage: { start: null, end: null },
            retryHints: { token: 'must-not-cross-http' },
            stats: { session: 'must-not-cross-http' },
            secretSession: 'must-not-cross-http',
          }
        },
      },
      observations: {
        async list(input: unknown) {
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
    workspaceClient.connectors
      = admissionProbeConnectors as unknown as LocalValedictorianClient['connectors']

    const server = await fixture.start({
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
            mode: 'api_key',
            secretKey: 'workspace-session',
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
    const inspected = await readJson(inspectResponse) as Record<string, unknown>
    expect(inspected).toMatchObject({
      actionRequired: [{ kind: 'auth' }],
      auth: [{ configured: false, id: 'jobright-session', mode: 'api_key' }],
      status: 'authentication_required',
    })
    expect(inspected).not.toHaveProperty('secretSession')
    expect(triggerResponse.status).toBe(200)
    const triggered = await readJson(triggerResponse) as Record<string, unknown>
    expect(triggered).toMatchObject({
      connectorInstanceId: 'connector one',
      id: 'run-queued',
      lifecycleCounts: { source: 'live_current' },
      status: 'queued',
    })
    expect(triggered).not.toHaveProperty('coverage')
    expect(triggered).not.toHaveProperty('retryHints')
    expect(triggered).not.toHaveProperty('stats')
    expect(triggered).not.toHaveProperty('secretSession')
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
              mode: 'api_key',
              secretKey: 'workspace-session',
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
    const server = await fixture.start({
      client: createBoundaryTestClient(() => {}),
      host: '127.0.0.1',
      port: 0,
    })

    const response = await fetch(`${server.url}/v1/applications`)

    expect(response.status).toBe(404)
    await expect(readJson(response)).resolves.toEqual({ message: 'Not found' })
  })

  it('lists registered local workspaces from the registry', async () => {
    const registryStore = createFileWorkspaceRegistryStore(createTempFilePath('workspaces.json'))
    await registryStore.markOpened(
      {
        id: 'workspace-1',
        name: 'Summer Search',
        path: '/Users/keni/Summer Search',
      },
      new Date('2026-06-12T10:00:00.000Z'),
    )

    const server = await fixture.start({
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

  it('auto-loads workspace data and isolates canonical Captures by workspace', async () => {
    const rootA = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-workspace-a-'))
    const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-workspace-b-'))
    const workspaceA = initializeWorkspace(rootA, { createId: () => 'capture-a' })
    const workspaceB = initializeWorkspace(rootB, { createId: () => 'capture-b' })
    const manager = createLocalWorkspaceManager({
      registryStore: createFileWorkspaceRegistryStore(createTempFilePath('workspaces.json')),
      seedDataMode: 'none',
    })
    await manager.open({ path: workspaceA.rootPath })
    await manager.open({ path: workspaceB.rootPath })
    const server = await fixture.start({
      client: createBoundaryTestClient(() => {}),
      host: '127.0.0.1',
      port: 0,
      workspaceManager: manager,
    })

    const root = createHttpValedictorianClient({ baseUrl: server.url })
    const created = await root.forWorkspace(workspaceA.id).captures.create({
      evidenceMode: 'reported',
      adapter: { id: 'manual', kind: 'manual', version: '1.0.0' },
      observedAt: '2026-07-10T12:00:00.000Z',
      providerRecordId: 'workspace-a-capture',
      providerSchema: 'manual@1',
      payload: { company: 'A', title: 'Intern' },
      evidence: [],
    })
    expect(created.status).toBe('succeeded')
    if (created.status !== 'succeeded') throw new Error('Expected Capture creation')
    await expect(root.forWorkspace(workspaceA.id).captures.get(created.resource.id))
      .resolves.toMatchObject({ id: created.resource.id })
    await expect(root.forWorkspace(workspaceB.id).captures.get(created.resource.id))
      .resolves.toBeNull()
    await manager.close()
  })

  it('opens an existing folder as a registered local workspace', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-http-open-'))
    const registryStore = createFileWorkspaceRegistryStore(createTempFilePath('workspaces.json'))

    const server = await fixture.start({
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
    const registryStore = createFileWorkspaceRegistryStore(createTempFilePath('workspaces.json'))

    const server = await fixture.start({
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

  it('returns the IPC active connector run when the workspace HTTP surface attaches late', async () => {
    const workspaceId = 'workspace-connector-surfaces'
    const connectorInstanceId = 'connector-instance-surfaces'
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-surfaces-'))
    const workspace = initializeWorkspace(workspaceRoot, { createId: () => workspaceId })
    const registryStore = createFileWorkspaceRegistryStore(createTempFilePath('workspaces.json'))
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
            ...completedConnectorRefreshContract(input.coverage.start.slice(0, 10)),
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
      prepareWorkspaceCapabilities: prepareWorkspaceProfileCapabilities,
      registryStore,
    })

    await workspaceManager.open({ path: workspaceRoot })

    const runtime = await createValedictorianRuntime({
      config: {
        apiHost: '127.0.0.1',
        apiPort: 0,
        apiUrl: 'http://127.0.0.1:0',
        mode: 'local-desktop',
        profilePath: workspace.profilePath,
        seedDataMode: 'none',
        pgliteDataPath: workspace.pgliteDataPath,
        workspaceId,
      },
      createLocalClient: createClient,
      prepareWorkspaceCapabilities: prepareWorkspaceProfileCapabilities,
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

    const internalTrigger = {
      connectorInstanceId,
      coverageStartedAt: '2026-07-08T17:00:00.000Z',
      coverageEndedAt: '2026-07-08T18:00:00.000Z',
      mode: 'manual' as const,
    }
    const ipcRunPromise = connectors.runs.trigger(internalTrigger)

    await vi.waitFor(() => {
      expect(refreshCount).toBe(1)
    })

    let httpRun: Record<string, unknown> | undefined
    const httpRunPromise = fetch(
      `${runtime.server.url}/v1/workspaces/${workspaceId}/connectors/${connectorInstanceId}/runs`,
      {
        body: JSON.stringify({ mode: 'manual' }),
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

  it('reopens a canonical workspace through its real path after closing a symlink-owned runtime', async () => {
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
    const registryStore = createFileWorkspaceRegistryStore(createTempFilePath('workspaces.json'))
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
            ...completedConnectorRefreshContract(input.coverage.start.slice(0, 10)),
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
      prepareWorkspaceCapabilities: prepareWorkspaceProfileCapabilities,
      registryStore,
    })
    const createRuntime = (workspace: typeof workspaceAAlias) => createValedictorianRuntime({
      config: {
        apiHost: '127.0.0.1',
        apiPort: 0,
        apiUrl: 'http://127.0.0.1:0',
        mode: 'local-desktop',
        profilePath: workspace.profilePath,
        seedDataMode: 'none',
        pgliteDataPath: workspace.pgliteDataPath,
        workspaceId: workspace.id,
      },
      createLocalClient: createClient,
      prepareWorkspaceCapabilities: prepareWorkspaceProfileCapabilities,
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
    expect(fs.realpathSync(workspaceAAlias.pgliteDataPath)).toBe(
      fs.realpathSync(workspaceAReal.pgliteDataPath),
    )
    releaseRefresh?.()
    const firstResult = await firstRunPromise
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

    const reopenedResult = await reopenedConnectors.runs.trigger(triggerInput)
    await reopenedRuntime.close()

    expect(refreshCount).toBe(2)
    expect(firstResult).toMatchObject({ status: 'completed' })
    expect(reopenedResult).toMatchObject({ status: 'completed' })
    expect(reopenedResult.id).not.toBe(firstResult.id)
  })

  it('resolves local workspace clients without scheduling startup connector work', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-http-client-'))
    const registryStore = createFileWorkspaceRegistryStore(createTempFilePath('workspaces.json'))
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
