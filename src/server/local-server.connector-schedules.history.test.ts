import { afterEach, describe, expect, it } from 'vitest'
import {
  createHttpValedictorianClient,
  MAX_CONNECTOR_SCHEDULE_HISTORY_LIMIT,
} from 'sparxie'
import {
  availableConnectorSchedulingCapability as availableSchedulingCapability,
  createLocalValedictorianClient,
  createScheduleHttpFixtureConnector as fixtureConnector,
  createScheduleHttpTempSqlitePath as createTempSqlitePath,
  createStaticConnectorRegistry,
  createValedictorianHttpServer,
  readScheduleHttpJson as readJson,
  type ScheduleHttpServerHandle,
} from './local-server.connector-schedules.http-fixture'

describe('local server connector schedule occurrence history', () => {
  let server: ScheduleHttpServerHandle | null = null

  afterEach(async () => {
    await server?.close()
    server = null
  })

  it('rejects history limits above the released maximum for audit and occurrences', async () => {
    expect(MAX_CONNECTOR_SCHEDULE_HISTORY_LIMIT).toBe(200)

    const workspaceId = 'schedule-history-limit-ws'
    const sqlitePath = createTempSqlitePath()
    const localClient = createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([fixtureConnector()]),
      connectorScheduling: availableSchedulingCapability,
      now: () => new Date('2026-07-11T12:00:00.000Z'),
      seedDataMode: 'none',
      sqlitePath,
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
      resolveWorkspaceClient: async () => localClient,
    })

    const overLimit = MAX_CONNECTOR_SCHEDULE_HISTORY_LIMIT + 1
    const auditResponse = await fetch(
      `${server.url}/v1/workspaces/${workspaceId}/connectors/connector-instance-schedule/schedule/audit?limit=${overLimit}&offset=0`,
    )
    expect(auditResponse.status).toBe(400)
    expect(await readJson(auditResponse)).toMatchObject({
      message: expect.stringMatching(/limit/i),
    })

    const occurrenceResponse = await fetch(
      `${server.url}/v1/workspaces/${workspaceId}/connectors/connector-instance-schedule/schedule/occurrences?limit=${overLimit}&offset=0`,
    )
    expect(occurrenceResponse.status).toBe(400)
    expect(await readJson(occurrenceResponse)).toMatchObject({
      message: expect.stringMatching(/limit/i),
    })
  })

  it('lists one admitted occurrence with pagination and workspace isolation', async () => {
    const workspaceA = 'schedule-occurrence-list-a'
    const workspaceB = 'schedule-occurrence-list-b'
    const sqliteA = createTempSqlitePath()
    const sqliteB = createTempSqlitePath()
    let clock = new Date('2026-07-11T12:00:00.000Z')

    const clientA = createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([fixtureConnector()]),
      connectorScheduling: availableSchedulingCapability,
      now: () => clock,
      seedDataMode: 'none',
      sqlitePath: sqliteA,
      workspaceId: workspaceA,
    })
    const clientB = createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([fixtureConnector()]),
      connectorScheduling: availableSchedulingCapability,
      now: () => clock,
      seedDataMode: 'none',
      sqlitePath: sqliteB,
      workspaceId: workspaceB,
    })

    await clientA.connectors.create({
      id: 'connector-instance-schedule',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture Jobs A',
      enabled: true,
    })
    await clientB.connectors.create({
      id: 'connector-instance-schedule',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture Jobs B',
      enabled: true,
    })

    server = await createValedictorianHttpServer({
      client: clientA,
      host: '127.0.0.1',
      port: 0,
      resolveWorkspaceClient: async (id) => {
        if (id === workspaceA) return clientA
        if (id === workspaceB) return clientB
        throw new Error(`Unexpected workspace: ${id}`)
      },
    })
    const httpA = createHttpValedictorianClient({ baseUrl: server.url }).forWorkspace(workspaceA)
    const httpB = createHttpValedictorianClient({ baseUrl: server.url }).forWorkspace(workspaceB)

    const createdA = await httpA.connectors.schedules.upsert({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: null,
      state: 'enabled',
      cadence: { kind: 'interval', everyMinutes: 60 },
      timezone: 'UTC',
    })
    const createdB = await httpB.connectors.schedules.upsert({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: null,
      state: 'enabled',
      cadence: { kind: 'interval', everyMinutes: 60 },
      timezone: 'UTC',
    })

    clock = new Date('2026-07-11T13:00:00.000Z')
    const admittedA = await httpA.connectors.schedules.dispatchDue({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: createdA.revision,
    })
    const admittedB = await httpB.connectors.schedules.dispatchDue({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: createdB.revision,
    })
    expect(admittedA).toMatchObject({ status: 'admitted' })
    expect(admittedB).toMatchObject({ status: 'admitted' })
    if (admittedA.status !== 'admitted' || admittedB.status !== 'admitted') {
      throw new Error('expected admissions')
    }

    const page = await httpA.connectors.schedules.listOccurrences({
      connectorInstanceId: 'connector-instance-schedule',
      limit: 1,
      offset: 0,
    })
    expect(page).toMatchObject({
      total: 1,
      limit: 1,
      offset: 0,
      hasMore: false,
    })
    expect(page.items).toEqual([
      expect.objectContaining({
        id: admittedA.occurrence.id,
        scheduleId: createdA.id,
        scheduleRevision: createdA.revision,
        nominalAt: '2026-07-11T13:00:00.000Z',
        connectorRunId: admittedA.run.id,
        admittedMode: 'scheduled',
      }),
    ])

    const pastEnd = await httpA.connectors.schedules.listOccurrences({
      connectorInstanceId: 'connector-instance-schedule',
      limit: 1,
      offset: 1,
    })
    expect(pastEnd).toMatchObject({
      items: [],
      total: 1,
      limit: 1,
      offset: 1,
      hasMore: false,
    })

    const isolated = await httpB.connectors.schedules.listOccurrences({
      connectorInstanceId: 'connector-instance-schedule',
      limit: 10,
      offset: 0,
    })
    expect(isolated).toMatchObject({ total: 1, hasMore: false })
    expect(isolated.items).toEqual([
      expect.objectContaining({
        id: admittedB.occurrence.id,
        scheduleId: createdB.id,
        connectorRunId: admittedB.run.id,
      }),
    ])
    expect(isolated.items.map((item) => item.id)).not.toContain(admittedA.occurrence.id)
  })

  it('lists two historical occurrences for the same connector instance across delete and recreate', async () => {
    const workspaceId = 'schedule-occurrence-history-recreate-ws'
    const sqlitePath = createTempSqlitePath()
    let clock = new Date('2026-07-11T12:00:00.000Z')
    let refreshCalls = 0

    const localClient = createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([
        {
          definition: { id: 'fixture.jobs', version: '0.0.0-fixture' },
          async refresh(input) {
            refreshCalls += 1
            return {
              coverage: input.coverage,
              nextCheckpoint: {
                checkpoint: { cursor: `history-${refreshCalls}` },
                schemaVersion: 'fixture-checkpoint@1',
              },
              observations: [],
              stats: { observations: 0 },
              warnings: [],
            }
          },
        },
      ]),
      connectorScheduling: availableSchedulingCapability,
      now: () => clock,
      seedDataMode: 'none',
      sqlitePath,
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
      resolveWorkspaceClient: async () => localClient,
    })
    const httpClient = createHttpValedictorianClient({ baseUrl: server.url }).forWorkspace(workspaceId)

    const firstSchedule = await httpClient.connectors.schedules.upsert({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: null,
      state: 'enabled',
      cadence: { kind: 'interval', everyMinutes: 60 },
      timezone: 'UTC',
    })

    clock = new Date('2026-07-11T13:00:00.000Z')
    const first = await httpClient.connectors.schedules.dispatchDue({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: firstSchedule.revision,
    })
    expect(first).toMatchObject({
      status: 'admitted',
      occurrence: { outcome: 'completed', scheduleId: firstSchedule.id },
      run: { status: 'completed' },
    })
    if (first.status !== 'admitted') {
      throw new Error('expected first terminal occurrence')
    }

    clock = new Date('2026-07-11T13:10:00.000Z')
    await httpClient.connectors.schedules.delete({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: firstSchedule.revision,
    })

    clock = new Date('2026-07-11T13:20:00.000Z')
    const secondSchedule = await httpClient.connectors.schedules.upsert({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: null,
      state: 'enabled',
      cadence: { kind: 'interval', everyMinutes: 60 },
      timezone: 'UTC',
    })
    expect(secondSchedule.id).not.toBe(firstSchedule.id)

    clock = new Date('2026-07-11T14:20:00.000Z')
    const second = await httpClient.connectors.schedules.dispatchDue({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: secondSchedule.revision,
    })
    expect(second).toMatchObject({
      status: 'admitted',
      occurrence: { outcome: 'completed', scheduleId: secondSchedule.id },
      run: { status: 'completed' },
    })
    if (second.status !== 'admitted') {
      throw new Error('expected second terminal occurrence')
    }

    expect(refreshCalls).toBe(2)

    const history = await httpClient.connectors.schedules.listOccurrences({
      connectorInstanceId: 'connector-instance-schedule',
      limit: 10,
      offset: 0,
    })
    expect(history.total).toBe(2)
    expect(history.items).toEqual([
      expect.objectContaining({
        id: second.occurrence.id,
        scheduleId: secondSchedule.id,
        outcome: 'completed',
        connectorRunId: second.run.id,
      }),
      expect.objectContaining({
        id: first.occurrence.id,
        scheduleId: firstSchedule.id,
        outcome: 'completed',
        connectorRunId: first.run.id,
      }),
    ])
  })
})
