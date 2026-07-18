import { afterEach, describe, expect, it } from 'vitest'
import { createHttpValedictorianClient } from 'sparxie'
import { createConnectorScheduleRepository } from '../connectors/connector-schedule.repository'
import {
  availableConnectorSchedulingCapability as availableSchedulingCapability,
  createScheduleHttpFixtureConnector as fixtureConnector,
  createScheduleHttpTempDatabasePath as createTempDatabasePath,
  createStaticConnectorRegistry,
  createValedictorianHttpServer,
  type ScheduleHttpServerHandle,
} from '../../server/local-server.connector-schedules.http-fixture'
import {
  createTestLocalValedictorianClient as createLocalValedictorianClient,
  getTestLocalValedictorianDatabase,
} from '../../runtime/local-valedictorian-client.test-harness'
describe('connector schedule immutable revision snapshots', () => {
  let server: ScheduleHttpServerHandle | null = null

  afterEach(async () => {
    await server?.close()
    server = null
  })

  it('retains immutable cadence/timezone/state snapshots across create, update, pause, resume, and delete', async () => {
    const workspaceId = 'schedule-revision-snapshots-ws'
    const pgliteDataPath = createTempDatabasePath()
    let clock = new Date('2026-07-11T12:00:00.000Z')
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
      cadence: { kind: 'interval', everyMinutes: 60 },
      timezone: 'UTC',
    })

    clock = new Date('2026-07-11T12:10:00.000Z')
    const updated = await httpClient.connectors.schedules.upsert({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: created.revision,
      state: 'enabled',
      cadence: { kind: 'interval', everyMinutes: 90 },
      timezone: 'America/New_York',
    })

    clock = new Date('2026-07-11T12:20:00.000Z')
    const paused = await httpClient.connectors.schedules.pause({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: updated.revision,
    })

    clock = new Date('2026-07-11T12:30:00.000Z')
    const resumed = await httpClient.connectors.schedules.resume({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: paused.revision,
    })

    clock = new Date('2026-07-11T12:40:00.000Z')
    await httpClient.connectors.schedules.delete({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: resumed.revision,
    })

    const audit = await httpClient.connectors.schedules.listAudit({
      connectorInstanceId: 'connector-instance-schedule',
      limit: 20,
      offset: 0,
    })
    expect(audit.items.map((event) => event.action)).toEqual([
      'deleted',
      'resumed',
      'paused',
      'upserted',
      'upserted',
    ])

    const scheduleRepository = createConnectorScheduleRepository(
      getTestLocalValedictorianDatabase(localClient),
      () => clock,
    )
    const snapshots = await scheduleRepository.listRevisionSnapshots(created.id)

    expect(snapshots).toEqual([
      expect.objectContaining({
        revision: created.revision,
        scheduleId: created.id,
        state: 'enabled',
        cadence: { kind: 'interval', everyMinutes: 60 },
        timezone: 'UTC',
        createdAt: '2026-07-11T12:00:00.000Z',
      }),
      expect.objectContaining({
        revision: updated.revision,
        scheduleId: created.id,
        state: 'enabled',
        cadence: { kind: 'interval', everyMinutes: 90 },
        timezone: 'America/New_York',
        createdAt: '2026-07-11T12:10:00.000Z',
      }),
      expect.objectContaining({
        revision: paused.revision,
        scheduleId: created.id,
        state: 'paused',
        cadence: { kind: 'interval', everyMinutes: 90 },
        timezone: 'America/New_York',
        createdAt: '2026-07-11T12:20:00.000Z',
      }),
      expect.objectContaining({
        revision: resumed.revision,
        scheduleId: created.id,
        state: 'enabled',
        cadence: { kind: 'interval', everyMinutes: 90 },
        timezone: 'America/New_York',
        createdAt: '2026-07-11T12:30:00.000Z',
      }),
      expect.objectContaining({
        revision: audit.items[0]!.revision,
        scheduleId: created.id,
        state: 'enabled',
        cadence: { kind: 'interval', everyMinutes: 90 },
        timezone: 'America/New_York',
        createdAt: '2026-07-11T12:40:00.000Z',
      }),
    ])

    // Prior snapshots remain exact after later mutations (immutable).
    expect(await scheduleRepository.getRevisionSnapshot(created.revision)).toEqual(
      expect.objectContaining({
        revision: created.revision,
        cadence: { kind: 'interval', everyMinutes: 60 },
        timezone: 'UTC',
        state: 'enabled',
      }),
    )
    expect(await scheduleRepository.getRevisionSnapshot(updated.revision)).toEqual(
      expect.objectContaining({
        revision: updated.revision,
        cadence: { kind: 'interval', everyMinutes: 90 },
        timezone: 'America/New_York',
        state: 'enabled',
      }),
    )

    // Audit events reference durable revision identities that exist as snapshots.
    for (const event of audit.items) {
      expect((await scheduleRepository.getRevisionSnapshot(event.revision))?.revision)
        .toBe(event.revision)
    }
  })
})
