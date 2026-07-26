import { describe, expect, it } from 'vitest'
import { ValedictorianHttpError } from '@sparxie/sdk'
import {
  availableConnectorSchedulingCapability as availableSchedulingCapability,
  createLocalValedictorianClient,
  createScheduleHttpFixtureConnector as fixtureConnector,
  createStaticConnectorRegistry,
  onlyScheduleWorkspace,
  readScheduleHttpJson as readJson,
  scheduleWorkspaceHttpClient,
  useScheduleHttpFixture,
  type ScheduleHttpFixture,
} from './local-server.connector-schedules.http-fixture'

describe('local server connector schedule capability', () => {
  const fixture = useScheduleHttpFixture()

  it('reports connector scheduling unavailable by default', async () => {
    const server = await fixture.start({
      client: await createLocalValedictorianClient({
        pgliteDataPath: fixture.createPgliteDataPath(),
      }),
    })

    await expect(fetch(`${server.url}/v1/capabilities`).then(readJson)).resolves.toMatchObject({
      connectorScheduling: { available: false },
    })
  })

  it('rejects schedule upsert with typed unavailable error and no persisted schedule', async () => {
    const workspaceId = 'schedule-unavailable-ws'
    const pgliteDataPath = fixture.createPgliteDataPath()
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

    const { workspace: httpClient } = await fixture.startWorkspaceServer({
      client: localClient,
      workspaceId,
      resolveWorkspaceClient: onlyScheduleWorkspace(workspaceId, localClient),
    })

    const error = await httpClient.connectors.schedules.upsert({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: null,
      state: 'enabled',
      cadence: { kind: 'interval', everyMinutes: 60 },
      timezone: 'UTC',
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ValedictorianHttpError)
    expect(error).toMatchObject({
      status: 503,
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
    const pgliteDataPath = fixture.createPgliteDataPath()
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

    const { workspace: httpClient } = await fixture.startWorkspaceServer({
      client: localClient,
      workspaceId,
      resolveWorkspaceClient: onlyScheduleWorkspace(workspaceId, localClient),
    })

    const error = await httpClient.connectors.schedules.pause({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: 'rev-missing',
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ValedictorianHttpError)
    expect(error).toMatchObject({
      status: 503,
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
    const pgliteDataPath = fixture.createPgliteDataPath()
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

    const { workspace: httpClient } = await fixture.startWorkspaceServer({
      client: localClient,
      workspaceId,
      resolveWorkspaceClient: onlyScheduleWorkspace(workspaceId, localClient),
    })

    const error = await httpClient.connectors.schedules.dispatchDue({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: 'rev-missing',
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ValedictorianHttpError)
    expect(error).toMatchObject({
      status: 503,
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
    const pgliteDataPath = fixture.createPgliteDataPath()
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

    const server = await fixture.start({
      client: localClient,
      resolveWorkspaceClient: async () => localClient,
      // Runtime contradiction attempt: must not override the client-owned capability.
      ...({ connectorScheduling: { available: false } } as object),
    } as Parameters<ScheduleHttpFixture['start']>[0])
    const httpClient = scheduleWorkspaceHttpClient(server, workspaceId)

    await expect(fetch(`${server.url}/v1/capabilities`).then(readJson)).resolves.toMatchObject({
      connectorScheduling: localClient.connectorScheduling,
    })
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
