import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createHttpValedictorianClient } from 'sparxie'
import {
  availableConnectorSchedulingCapability as availableSchedulingCapability,
  createLocalValedictorianClient,
  createScheduleHttpFixtureConnector as fixtureConnector,
  createScheduleHttpTempDatabasePath as createTempDatabasePath,
  createStaticConnectorRegistry,
  createValedictorianHttpServer,
  type ScheduleHttpServerHandle,
} from './local-server.connector-schedules.http-fixture'

describe('local server connector schedule calendar DST', () => {
  let server: ScheduleHttpServerHandle | null = null

  afterEach(async () => {
    await server?.close()
    server = null
  })

  it('coalesces missed daily nominals across a spring-forward gap using IANA local time', async () => {
    const workspaceId = 'schedule-daily-catch-up-dst-ws'
    const pgliteDataPath = createTempDatabasePath()
    // 2026-03-06 12:00Z = 07:00 EST; daily 02:30 America/New_York.
    let clock = new Date('2026-03-06T12:00:00.000Z')
    const localClient = await createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([fixtureConnector()]),
      connectorScheduling: availableSchedulingCapability,
      now: () => clock,
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
      resolveWorkspaceClient: async () => localClient,
    })
    const httpClient = createHttpValedictorianClient({ baseUrl: server.url }).forWorkspace(workspaceId)

    const created = await httpClient.connectors.schedules.upsert({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: null,
      state: 'enabled',
      cadence: { kind: 'daily', localTime: '02:30' },
      timezone: 'America/New_York',
    })
    // Next local 02:30 is Mar 7 02:30 EST.
    expect(created.nextEligibleAt).toBe('2026-03-07T07:30:00.000Z')

    // Miss Mar 7 02:30 EST, Mar 8 02:30 (gap → 03:00 EDT), and Mar 9 02:30 EDT.
    clock = new Date('2026-03-09T12:00:00.000Z')
    const admitted = await httpClient.connectors.schedules.dispatchDue({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: created.revision,
    })

    expect(admitted).toMatchObject({
      status: 'admitted',
      occurrence: {
        scheduleRevision: created.revision,
        nominalAt: '2026-03-09T06:30:00.000Z',
        admittedMode: 'catch_up',
        outcome: 'completed',
      },
      run: {
        mode: 'catch_up',
        status: 'completed',
      },
    })

    const schedule = await httpClient.connectors.schedules.get('connector-instance-schedule')
    expect(schedule).toMatchObject({
      nextEligibleAt: '2026-03-10T06:30:00.000Z',
      lastOccurrence: {
        nominalAt: '2026-03-09T06:30:00.000Z',
        admittedMode: 'catch_up',
      },
    })

    const runs = await httpClient.connectors.runs.list({
      connectorInstanceId: 'connector-instance-schedule',
      limit: 10,
      offset: 0,
    })
    expect(runs.total).toBe(1)
    expect(runs.items[0]).toMatchObject({
      mode: 'catch_up',
      scheduleOccurrence: {
        nominalAt: '2026-03-09T06:30:00.000Z',
        admittedMode: 'catch_up',
      },
    })
  })

  it('coalesces missed weekly nominals choosing the earlier fall-back overlap instant', async () => {
    const workspaceId = 'schedule-weekly-catch-up-dst-ws'
    const pgliteDataPath = createTempDatabasePath()
    // Sunday 2026-10-25 12:00Z = 08:00 EDT; weekly Sunday 01:30 America/New_York.
    let clock = new Date('2026-10-25T12:00:00.000Z')
    const localClient = await createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([fixtureConnector()]),
      connectorScheduling: availableSchedulingCapability,
      now: () => clock,
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
      resolveWorkspaceClient: async () => localClient,
    })
    const httpClient = createHttpValedictorianClient({ baseUrl: server.url }).forWorkspace(workspaceId)

    const created = await httpClient.connectors.schedules.upsert({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: null,
      state: 'enabled',
      cadence: { kind: 'weekly', dayOfWeek: 7, localTime: '01:30' },
      timezone: 'America/New_York',
    })
    // Next Sunday is Nov 1 fall-back; 01:30 earlier overlap = 05:30Z (EDT).
    expect(created.nextEligibleAt).toBe('2026-11-01T05:30:00.000Z')

    // Miss Nov 1 and Nov 8; coalesce to Nov 8 01:30 EST.
    clock = new Date('2026-11-08T12:00:00.000Z')
    const admitted = await httpClient.connectors.schedules.dispatchDue({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: created.revision,
    })

    expect(admitted).toMatchObject({
      status: 'admitted',
      occurrence: {
        scheduleRevision: created.revision,
        nominalAt: '2026-11-08T06:30:00.000Z',
        admittedMode: 'catch_up',
        outcome: 'completed',
      },
      run: {
        mode: 'catch_up',
        status: 'completed',
      },
    })

    const schedule = await httpClient.connectors.schedules.get('connector-instance-schedule')
    expect(schedule).toMatchObject({
      nextEligibleAt: '2026-11-15T06:30:00.000Z',
      lastOccurrence: {
        nominalAt: '2026-11-08T06:30:00.000Z',
        admittedMode: 'catch_up',
      },
    })
  })

  it('admits a daily spring-forward gap nominal at the first valid local instant after the gap', async () => {
    const workspaceId = 'schedule-daily-spring-forward-ws'
    const pgliteDataPath = createTempDatabasePath()
    let clock = new Date('2026-03-07T12:00:00.000Z')
    const localClient = await createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([fixtureConnector()]),
      connectorScheduling: availableSchedulingCapability,
      now: () => clock,
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
      resolveWorkspaceClient: async () => localClient,
    })
    const httpClient = createHttpValedictorianClient({ baseUrl: server.url }).forWorkspace(workspaceId)

    const created = await httpClient.connectors.schedules.upsert({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: null,
      state: 'enabled',
      cadence: { kind: 'daily', localTime: '02:30' },
      timezone: 'America/New_York',
    })
    // Mar 8 02:30 does not exist; eligibility is 03:00 EDT.
    expect(created.nextEligibleAt).toBe('2026-03-08T07:00:00.000Z')

    clock = new Date('2026-03-08T07:00:00.000Z')
    const admitted = await httpClient.connectors.schedules.dispatchDue({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: created.revision,
    })

    expect(admitted).toMatchObject({
      status: 'admitted',
      occurrence: {
        nominalAt: '2026-03-08T07:00:00.000Z',
        admittedMode: 'scheduled',
      },
      run: { mode: 'scheduled' },
    })

    const schedule = await httpClient.connectors.schedules.get('connector-instance-schedule')
    expect(schedule).toMatchObject({
      nextEligibleAt: '2026-03-09T06:30:00.000Z',
    })
  })

  it('admits a weekly fall-back overlap nominal at the earlier repeated local instant', async () => {
    const workspaceId = 'schedule-weekly-fall-back-ws'
    const pgliteDataPath = createTempDatabasePath()
    let clock = new Date('2026-10-25T12:00:00.000Z')
    const localClient = await createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([fixtureConnector()]),
      connectorScheduling: availableSchedulingCapability,
      now: () => clock,
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
      resolveWorkspaceClient: async () => localClient,
    })
    const httpClient = createHttpValedictorianClient({ baseUrl: server.url }).forWorkspace(workspaceId)

    const created = await httpClient.connectors.schedules.upsert({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: null,
      state: 'enabled',
      cadence: { kind: 'weekly', dayOfWeek: 7, localTime: '01:30' },
      timezone: 'America/New_York',
    })
    expect(created.nextEligibleAt).toBe('2026-11-01T05:30:00.000Z')

    clock = new Date('2026-11-01T05:30:00.000Z')
    const admitted = await httpClient.connectors.schedules.dispatchDue({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: created.revision,
    })

    expect(admitted).toMatchObject({
      status: 'admitted',
      occurrence: {
        nominalAt: '2026-11-01T05:30:00.000Z',
        admittedMode: 'scheduled',
      },
      run: { mode: 'scheduled' },
    })

    const schedule = await httpClient.connectors.schedules.get('connector-instance-schedule')
    expect(schedule).toMatchObject({
      nextEligibleAt: '2026-11-08T06:30:00.000Z',
    })
  })

  it('does not introduce timer, cron, or startup schedule-scan loops in schedule modules', () => {
    const scheduleModuleDir = path.join(process.cwd(), 'src/modules/connectors')
    const scheduleFiles = fs.readdirSync(scheduleModuleDir)
      .filter((name) => name.startsWith('connector-schedule') && name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .map((name) => path.join(scheduleModuleDir, name))

    const clientSource = fs.readFileSync(
      path.join(process.cwd(), 'src/runtime/local-valedictorian-client.ts'),
      'utf8',
    )
    expect(clientSource).not.toMatch(/startupCatchUp/)
    expect(clientSource).not.toMatch(/executeConnectorStartupCatchUp/)

    const forbidden = /setInterval\s*\(|setTimeout\s*\(|node-cron|cron\.schedule|startupCatchUp/
    for (const filePath of scheduleFiles) {
      const source = fs.readFileSync(filePath, 'utf8')
      expect(source).not.toMatch(forbidden)
    }
  })

})
