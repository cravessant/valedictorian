import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createHttpValedictorianClient,
  triggerConnectorRunInputSchema,
} from 'sparxie'
import { registerConnectorsIpc } from '../ipc/connectors.ipc'
import { createConnectorsPreloadApi } from '../ipc/connectors.preload'
import { createStaticConnectorRegistry } from '../modules/connectors/connector.registry'
import type { AppJobConnector } from '../modules/connectors/connector.runner'
import { createLocalValedictorianClient } from './local-valedictorian-client.test-harness'
import {
  createScheduleHttpTempDatabasePath,
  createValedictorianHttpServer,
  type ScheduleHttpServerHandle,
} from './local-server.connector-schedules.http-fixture'

const CLOCK = '2026-07-13T15:00:00.000Z'
const WORKSPACE_ID = 'public-trigger-parity'

describe('public manual connector trigger parity', () => {
  let server: ScheduleHttpServerHandle | null = null

  afterEach(async () => {
    await server?.close()
    server = null
  })

  it('rejects raw HTTP coverageEndedAt before run creation while the released client succeeds', async () => {
    const surfaces = await createPublicSurfaces()
    server = surfaces.server
    const { http, local } = surfaces
    const publicTrigger = { connectorInstanceId: 'parity-fixture', mode: 'manual' as const }

    const rejected = await fetch(
      `${server.url}/v1/workspaces/${WORKSPACE_ID}/connectors/parity-fixture/runs`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'manual',
          coverageEndedAt: CLOCK,
        }),
      },
    )
    expect(rejected.status).toBe(400)
    await expect(rejected.json()).resolves.toEqual({ message: 'The request is invalid.' })
    await expect(local.connectors.runs.list({
      connectorInstanceId: 'parity-fixture',
    })).resolves.toMatchObject({ items: [], total: 0 })

    await expect(http.connectors.runs.trigger(publicTrigger)).resolves.toMatchObject({
      connectorInstanceId: 'parity-fixture',
      mode: 'manual',
      status: 'completed',
    })
    await expect(local.connectors.runs.list({
      connectorInstanceId: 'parity-fixture',
    })).resolves.toMatchObject({
      total: 1,
      items: [{ coverage: { end: CLOCK } }],
    })
  })

  it('keeps HTTP and IPC public manual success aligned without private coverage fields', async () => {
    const surfaces = await createPublicSurfaces()
    server = surfaces.server
    const { http, ipc, local } = surfaces
    const trigger = { connectorInstanceId: 'parity-fixture', mode: 'manual' as const }

    expect(() => triggerConnectorRunInputSchema.parse({
      ...trigger,
      coverageEndedAt: CLOCK,
    })).toThrow(/unrecognized_keys|Unrecognized key/i)

    await expect(http.connectors.runs.trigger(trigger)).resolves.toMatchObject({
      connectorInstanceId: 'parity-fixture',
      mode: 'manual',
      status: 'completed',
    })
    await expect(ipc.runs.trigger(trigger)).resolves.toMatchObject({
      connectorInstanceId: 'parity-fixture',
      mode: 'manual',
      status: 'completed',
    })
    await expect(local.connectors.runs.list({
      connectorInstanceId: 'parity-fixture',
    })).resolves.toMatchObject({
      total: 2,
      items: [
        { coverage: { end: CLOCK } },
        { coverage: { end: CLOCK } },
      ],
    })
  })

  it('keeps HTTP and IPC disabled-connector failures aligned for the public trigger shape', async () => {
    const surfaces = await createPublicSurfaces({ enabled: false })
    server = surfaces.server
    const { http, ipc, local } = surfaces
    const trigger = { connectorInstanceId: 'parity-fixture', mode: 'manual' as const }

    await expect(http.connectors.runs.trigger(trigger)).rejects.toMatchObject({
      status: 409,
      body: null,
    })
    await expect(ipc.runs.trigger(trigger)).rejects.toThrow(
      'Connector instance is disabled: parity-fixture',
    )
    await expect(local.connectors.runs.list({
      connectorInstanceId: 'parity-fixture',
    })).resolves.toMatchObject({ items: [], total: 0 })
  })

  it('keeps a secret-bearing refresh throw out of HTTP responses and diagnostic logging', async () => {
    const canary = 'provider-secret-diagnostic-canary-89'
    const events: unknown[] = []
    const surfaces = await createPublicSurfaces({
      onRequestError(event) {
        events.push(event)
      },
      refresh() {
        throw createHostileAdapterFailure(canary)
      },
    })
    server = surfaces.server
    const trigger = { connectorInstanceId: 'parity-fixture', mode: 'manual' as const }

    const response = await fetch(
      `${server.url}/v1/workspaces/${WORKSPACE_ID}/connectors/parity-fixture/runs`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'connector-refresh-canary-89',
        },
        body: JSON.stringify(trigger),
      },
    )
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({
      code: 'internal_error',
      message: 'An unexpected error occurred.',
      requestId: 'connector-refresh-canary-89',
    })
    expect(JSON.stringify(body)).not.toContain(canary)
    expect(events).toHaveLength(1)
    const logged = events[0] as { error: Error & { statusCode?: number } }
    assertFreshFixedNominal(logged.error, canary)
    await expect(surfaces.local.connectors.runs.list({
      connectorInstanceId: 'parity-fixture',
    })).resolves.toMatchObject({
      total: 1,
      items: [{ status: 'failed' }],
    })
  })

  it('projects a secret-bearing refresh throw to a fixed IPC rejection', async () => {
    const canary = 'provider-secret-diagnostic-canary-89'
    const surfaces = await createPublicSurfaces({
      refresh() {
        throw createHostileAdapterFailure(canary)
      },
    })
    server = surfaces.server
    const trigger = { connectorInstanceId: 'parity-fixture', mode: 'manual' as const }

    let caught: unknown
    try {
      await surfaces.ipc.runs.trigger(trigger)
    } catch (error) {
      caught = error
    }

    assertFreshFixedNominal(caught, canary)
  })

  it('strips hostile adapter diagnostics across direct runner, HTTP logging, and IPC', async () => {
    const canary = 'provider-secret-diagnostic-canary-89'
    const events: unknown[] = []
    const surfaces = await createPublicSurfaces({
      onRequestError(event) {
        events.push(event)
      },
      refresh() {
        throw createHostileAdapterFailure(canary)
      },
    })
    server = surfaces.server
    const trigger = { connectorInstanceId: 'parity-fixture', mode: 'manual' as const }

    let direct: unknown
    try {
      await surfaces.local.connectors.runs.trigger(trigger)
    } catch (error) {
      direct = error
    }
    assertFreshFixedNominal(direct, canary)

    const response = await fetch(
      `${server.url}/v1/workspaces/${WORKSPACE_ID}/connectors/parity-fixture/runs`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'connector-integrated-canary-89',
        },
        body: JSON.stringify(trigger),
      },
    )
    expect(response.status).toBe(500)
    expect(JSON.stringify(await response.json())).not.toContain(canary)
    expect(events).toHaveLength(1)
    assertFreshFixedNominal((events[0] as { error: Error }).error, canary)

    let ipcCaught: unknown
    try {
      await surfaces.ipc.runs.trigger(trigger)
    } catch (error) {
      ipcCaught = error
    }
    assertFreshFixedNominal(ipcCaught, canary)
  })

  it('returns the same active run on concurrent public HTTP and IPC triggers', async () => {
    let releaseRefresh: (() => void) | undefined
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve
    })
    const surfaces = await createPublicSurfaces({ waitForRefresh: refreshGate })
    server = surfaces.server
    const { http, ipc, local } = surfaces
    const trigger = { connectorInstanceId: 'parity-fixture', mode: 'manual' as const }

    const first = http.connectors.runs.trigger(trigger)
    await vi.waitFor(async () => {
      const listed = await local.connectors.runs.list({
        connectorInstanceId: 'parity-fixture',
      })
      expect(listed.items[0]?.status).toBe('running')
    })

    const activeFromIpc = await ipc.runs.trigger(trigger)
    expect(activeFromIpc).toMatchObject({
      connectorInstanceId: 'parity-fixture',
      status: 'running',
    })
    expect(activeFromIpc).not.toHaveProperty('coverage')
    expect(activeFromIpc).not.toHaveProperty('stats')

    releaseRefresh?.()
    const completed = await first
    expect(completed).toMatchObject({
      id: activeFromIpc.id,
      status: 'completed',
    })
  })
})

async function createPublicSurfaces(options?: {
  enabled?: boolean
  onRequestError?: (event: unknown) => void
  refresh?: AppJobConnector['refresh']
  waitForRefresh?: Promise<void>
}) {
  const connector = createParityConnector({
    refresh: options?.refresh,
    waitForRefresh: options?.waitForRefresh,
  })
  const local = await createLocalValedictorianClient({
    connectorRegistry: createStaticConnectorRegistry([connector]),
    now: () => new Date(CLOCK),
    seedDataMode: 'none',
    pgliteDataPath: createScheduleHttpTempDatabasePath(),
    workspaceId: WORKSPACE_ID,
  })
  await local.connectors.create({
    id: 'parity-fixture',
    connectorId: connector.definition.id,
    connectorVersion: connector.definition.version,
    displayName: 'Parity fixture',
    enabled: options?.enabled ?? true,
    earliestBackfillDate: '2026-07-01',
  })

  const started = await createValedictorianHttpServer({
    client: local,
    host: '127.0.0.1',
    port: 0,
    ...(options?.onRequestError ? { onRequestError: options.onRequestError } : {}),
    resolveWorkspaceClient: async () => local,
  })
  const http = createHttpValedictorianClient({ baseUrl: started.url })
    .forWorkspace(WORKSPACE_ID)

  const handlers = new Map<string, (_event: unknown, input?: unknown) => Promise<unknown>>()
  registerConnectorsIpc(local.connectors, {
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
  })
  const ipc = createConnectorsPreloadApi({
    invoke(channel, input) {
      return handlers.get(channel)!({}, input)
    },
  })

  return { http, ipc, local, server: started }
}

function createParityConnector(options?: {
  refresh?: AppJobConnector['refresh']
  waitForRefresh?: Promise<void>
}): AppJobConnector {
  return {
    definition: { id: 'fixture.jobs', version: '1.0.0' },
    async refresh(input, runtime) {
      if (options?.refresh) {
        return options.refresh(input, runtime)
      }
      if (options?.waitForRefresh) {
        await options.waitForRefresh
      }
      return {
        observations: [],
        nextCheckpoint: { checkpoint: {}, schemaVersion: 'fixture@1' },
        coverage: input.coverage,
        stats: { observations: 0 },
        warnings: [],
        status: 'completed',
        retryHints: null,
        operationOutcome: null,
        synchronization: {
          newestFrontier: { state: 'caught_up' },
          historicalBackfill: {
            state: 'caught_up',
            boundary: { earliestDate: input.coverage.start.slice(0, 10) },
          },
          pendingResolutionCount: 0,
          outcome: { kind: 'caught_up' },
        },
      }
    },
  }
}

function createHostileAdapterFailure(secret: string) {
  const failure = new Error(secret, { cause: new Error(`nested-${secret}`) })
  Object.assign(failure, {
    detail: secret,
    providerBody: { token: secret },
    nested: { diagnostic: secret },
  })
  return failure
}

function assertFreshFixedNominal(caught: unknown, secret: string) {
  expect(caught).toMatchObject({
    name: 'ConnectorExecutionError',
    message: 'Connector execution failed.',
    statusCode: 500,
  })
  expect(caught).toBeInstanceOf(Error)
  expect((caught as Error).cause).toBeUndefined()
  expect(Object.getOwnPropertyNames(caught as object)).toEqual([
    'stack',
    'message',
    'statusCode',
    'name',
  ])
  expect(Reflect.ownKeys(caught as object)).toEqual([
    'stack',
    'message',
    'statusCode',
    'name',
  ])
  expect(JSON.stringify(caught, Object.getOwnPropertyNames(caught as object))).not.toContain(secret)
  expect(String(caught)).not.toContain(secret)
}
