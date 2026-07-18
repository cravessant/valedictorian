import { afterEach, describe, expect, it } from 'vitest'
import {
  createHttpValedictorianClient,
  ValedictorianHttpError,
} from 'sparxie'
import {
  availableConnectorSchedulingCapability as availableSchedulingCapability,
  createLocalValedictorianClient,
  createScheduleHttpFixtureConnector as fixtureConnector,
  createScheduleHttpTempDatabasePath as createTempDatabasePath,
  createStaticConnectorRegistry,
  createValedictorianHttpServer,
  readScheduleHttpJson as readJson,
  type ScheduleHttpServerHandle,
} from './local-server.connector-schedules.http-fixture'

describe('local server connector schedule capability', () => {
  let server: ScheduleHttpServerHandle | null = null

  afterEach(async () => {
    await server?.close()
    server = null
  })

  it('reports connector scheduling unavailable by default', async () => {
    server = await createValedictorianHttpServer({
      client: await createLocalValedictorianClient({ pgliteDataPath: createTempDatabasePath() }),
      host: '127.0.0.1',
      port: 0,
    })

    await expect(fetch(`${server.url}/v1/capabilities`).then(readJson)).resolves.toMatchObject({
      connectorScheduling: { available: false },
    })
  })

  it('rejects schedule upsert with typed unavailable error and no persisted schedule', async () => {
    const workspaceId = 'schedule-unavailable-ws'
    const pgliteDataPath = createTempDatabasePath()
    const localClient = await createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([fixtureConnector()]),
      seedDataMode: 'none',
      pgliteDataPath,
      workspaceId,
    })

    await localClient.connectors.create({
      id: 'connector-instance-schedule',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture Jobs',
      enabled: true,
    })

    server = await createValedictorianHttpServer({
      client: localClient,
      host: '127.0.0.1',
      port: 0,
      resolveWorkspaceClient: async (id) => {
        if (id !== workspaceId) {
          throw new Error(`Unexpected workspace: ${id}`)
        }
        return localClient
      },
    })

    const httpClient = createHttpValedictorianClient({ baseUrl: server.url }).forWorkspace(workspaceId)

    const error = await httpClient.connectors.schedules.upsert({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: null,
      state: 'enabled',
      cadence: { kind: 'interval', everyMinutes: 60 },
      timezone: 'UTC',
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ValedictorianHttpError)
    expect(error).toMatchObject({
      status: 400,
      body: {
        code: 'connector_scheduling_unavailable',
        message: expect.stringMatching(/unavailable/i),
      },
    })

    await expect(
      httpClient.connectors.schedules.get('connector-instance-schedule'),
    ).resolves.toBeNull()
  })

  it('rejects schedule pause with typed unavailable error and no persisted schedule', async () => {
    const workspaceId = 'schedule-pause-unavailable-ws'
    const pgliteDataPath = createTempDatabasePath()
    const localClient = await createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([fixtureConnector()]),
      seedDataMode: 'none',
      pgliteDataPath,
      workspaceId,
    })

    await localClient.connectors.create({
      id: 'connector-instance-schedule',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture Jobs',
      enabled: true,
    })

    server = await createValedictorianHttpServer({
      client: localClient,
      host: '127.0.0.1',
      port: 0,
      resolveWorkspaceClient: async (id) => {
        if (id !== workspaceId) {
          throw new Error(`Unexpected workspace: ${id}`)
        }
        return localClient
      },
    })

    const httpClient = createHttpValedictorianClient({ baseUrl: server.url }).forWorkspace(workspaceId)

    const error = await httpClient.connectors.schedules.pause({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: 'rev-missing',
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ValedictorianHttpError)
    expect(error).toMatchObject({
      status: 400,
      body: {
        code: 'connector_scheduling_unavailable',
        message: expect.stringMatching(/unavailable/i),
      },
    })

    await expect(
      httpClient.connectors.schedules.get('connector-instance-schedule'),
    ).resolves.toBeNull()
  })

  it('rejects schedule dispatchDue with typed unavailable error and no persisted schedule', async () => {
    const workspaceId = 'schedule-dispatch-unavailable-ws'
    const pgliteDataPath = createTempDatabasePath()
    const localClient = await createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([fixtureConnector()]),
      seedDataMode: 'none',
      pgliteDataPath,
      workspaceId,
    })

    await localClient.connectors.create({
      id: 'connector-instance-schedule',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture Jobs',
      enabled: true,
    })

    server = await createValedictorianHttpServer({
      client: localClient,
      host: '127.0.0.1',
      port: 0,
      resolveWorkspaceClient: async (id) => {
        if (id !== workspaceId) {
          throw new Error(`Unexpected workspace: ${id}`)
        }
        return localClient
      },
    })

    const httpClient = createHttpValedictorianClient({ baseUrl: server.url }).forWorkspace(workspaceId)

    const error = await httpClient.connectors.schedules.dispatchDue({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: 'rev-missing',
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ValedictorianHttpError)
    expect(error).toMatchObject({
      status: 400,
      body: {
        code: 'connector_scheduling_unavailable',
        message: expect.stringMatching(/unavailable/i),
      },
    })

    await expect(
      httpClient.connectors.schedules.get('connector-instance-schedule'),
    ).resolves.toBeNull()
  })

  it('derives capability reporting from the workspace client so contradictory server injection cannot disagree', async () => {
    const workspaceId = 'schedule-capability-owner-ws'
    const pgliteDataPath = createTempDatabasePath()
    const localClient = await createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([fixtureConnector()]),
      connectorScheduling: availableSchedulingCapability,
      now: () => new Date('2026-07-11T12:00:00.000Z'),
      seedDataMode: 'none',
      pgliteDataPath,
      workspaceId,
    })

    await localClient.connectors.create({
      id: 'connector-instance-schedule',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture Jobs',
      enabled: true,
    })

    expect(localClient.connectorScheduling).toEqual(availableSchedulingCapability)

    server = await createValedictorianHttpServer({
      client: localClient,
      host: '127.0.0.1',
      port: 0,
      resolveWorkspaceClient: async () => localClient,
      // Runtime contradiction attempt: must not override the client-owned capability.
      ...({ connectorScheduling: { available: false } } as object),
    } as Parameters<typeof createValedictorianHttpServer>[0])

    await expect(fetch(`${server.url}/v1/capabilities`).then(readJson)).resolves.toMatchObject({
      connectorScheduling: localClient.connectorScheduling,
    })

    const httpClient = createHttpValedictorianClient({ baseUrl: server.url }).forWorkspace(workspaceId)
    await expect(httpClient.connectors.schedules.upsert({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: null,
      state: 'enabled',
      cadence: { kind: 'interval', everyMinutes: 60 },
      timezone: 'UTC',
    })).resolves.toMatchObject({
      connectorInstanceId: 'connector-instance-schedule',
      state: 'enabled',
    })
  })

})
