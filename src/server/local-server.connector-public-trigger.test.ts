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
  waitForRefresh?: Promise<void>
}) {
  const connector = createParityConnector(options?.waitForRefresh)
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

function createParityConnector(waitForRefresh?: Promise<void>): AppJobConnector {
  return {
    definition: { id: 'fixture.jobs', version: '1.0.0' },
    async refresh(input) {
      if (waitForRefresh) {
        await waitForRefresh
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
