import { afterEach, describe, expect, it } from 'vitest'
import {
  createHttpValedictorianClient,
  ValedictorianHttpError,
  type ConnectorSchedulingCapability,
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
import { closeLocalValedictorianClient } from './local-valedictorian-client.test-harness'

describe('local server connector schedule management', () => {
  let server: ScheduleHttpServerHandle | null = null

  afterEach(async () => {
    await server?.close()
    server = null
  })

  it('creates and reads an interval schedule when scheduling capability is injected', async () => {
    const workspaceId = 'schedule-create-ws'
    const pgliteDataPath = createTempDatabasePath()
    const now = () => new Date('2026-07-11T12:00:00.000Z')
    const localClient = await createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([fixtureConnector()]),
      connectorScheduling: availableSchedulingCapability,
      now,
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

    await expect(fetch(`${server.url}/v1/capabilities`).then(readJson)).resolves.toMatchObject({
      connectorScheduling: availableSchedulingCapability,
    })

    const httpClient = createHttpValedictorianClient({ baseUrl: server.url }).forWorkspace(workspaceId)
    const created = await httpClient.connectors.schedules.upsert({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: null,
      state: 'enabled',
      cadence: { kind: 'interval', everyMinutes: 60 },
      timezone: 'UTC',
    })

    expect(created).toMatchObject({
      connectorInstanceId: 'connector-instance-schedule',
      state: 'enabled',
      cadence: { kind: 'interval', everyMinutes: 60 },
      timezone: 'UTC',
      nextEligibleAt: '2026-07-11T13:00:00.000Z',
      lastOccurrence: null,
      lastRun: null,
    })
    expect(created.id).toEqual(expect.any(String))
    expect(created.revision).toEqual(expect.any(String))
    expect(created.revision.length).toBeGreaterThan(0)

    await expect(
      httpClient.connectors.schedules.get('connector-instance-schedule'),
    ).resolves.toEqual(created)
  })

  it('reloads a persisted schedule from the same workspace PGlite data directory', async () => {
    const workspaceId = 'schedule-reload-ws'
    const pgliteDataPath = createTempDatabasePath()
    const now = () => new Date('2026-07-11T12:00:00.000Z')
    const options = {
      connectorRegistry: createStaticConnectorRegistry([fixtureConnector()]),
      connectorScheduling: availableSchedulingCapability,
      now,
      seedDataMode: 'none' as const,
      pgliteDataPath,
      workspaceId,
    }
    const writer = await createLocalValedictorianClient(options)

    await writer.connectors.create({
      id: 'connector-instance-schedule',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture Jobs',
      enabled: true,
    })

    const created = await writer.connectors.schedules.upsert({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: null,
      state: 'enabled',
      cadence: { kind: 'interval', everyMinutes: 30 },
      timezone: 'UTC',
    })
    await closeLocalValedictorianClient(writer)

    const reader = await createLocalValedictorianClient(options)
    await expect(
      reader.connectors.schedules.get('connector-instance-schedule'),
    ).resolves.toEqual(created)
  })

  it('isolates schedules across distinct workspace PGlite data directories', async () => {
    const now = () => new Date('2026-07-11T12:00:00.000Z')
    const first = await createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([fixtureConnector()]),
      connectorScheduling: availableSchedulingCapability,
      now,
      seedDataMode: 'none',
      pgliteDataPath: createTempDatabasePath(),
      workspaceId: 'workspace-a',
    })
    const second = await createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([fixtureConnector()]),
      connectorScheduling: availableSchedulingCapability,
      now,
      seedDataMode: 'none',
      pgliteDataPath: createTempDatabasePath(),
      workspaceId: 'workspace-b',
    })

    await first.connectors.create({
      id: 'shared-connector-id',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Workspace A',
      enabled: true,
    })
    await second.connectors.create({
      id: 'shared-connector-id',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Workspace B',
      enabled: true,
    })

    const created = await first.connectors.schedules.upsert({
      connectorInstanceId: 'shared-connector-id',
      expectedRevision: null,
      state: 'enabled',
      cadence: { kind: 'interval', everyMinutes: 45 },
      timezone: 'UTC',
    })

    await expect(
      first.connectors.schedules.get('shared-connector-id'),
    ).resolves.toEqual(created)
    await expect(
      second.connectors.schedules.get('shared-connector-id'),
    ).resolves.toBeNull()
  })

  it('updates a schedule only with the exact expected revision', async () => {
    const workspaceId = 'schedule-edit-ws'
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

    clock = new Date('2026-07-11T12:30:00.000Z')
    const stale = await httpClient.connectors.schedules.upsert({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: 'not-the-current-revision',
      state: 'enabled',
      cadence: { kind: 'interval', everyMinutes: 90 },
      timezone: 'UTC',
    }).catch((caught: unknown) => caught)

    expect(stale).toBeInstanceOf(ValedictorianHttpError)
    expect(stale).toMatchObject({
      status: 400,
      body: { code: 'stale_schedule_revision' },
    })
    await expect(
      httpClient.connectors.schedules.get('connector-instance-schedule'),
    ).resolves.toEqual(created)

    const updated = await httpClient.connectors.schedules.upsert({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: created.revision,
      state: 'enabled',
      cadence: { kind: 'interval', everyMinutes: 90 },
      timezone: 'UTC',
    })

    expect(updated).toMatchObject({
      id: created.id,
      connectorInstanceId: 'connector-instance-schedule',
      cadence: { kind: 'interval', everyMinutes: 90 },
      nextEligibleAt: '2026-07-11T14:00:00.000Z',
      createdAt: created.createdAt,
    })
    expect(updated.revision).not.toEqual(created.revision)
    expect(updated.updatedAt).toEqual('2026-07-11T12:30:00.000Z')
  })

  it('pauses a schedule with exact revision and appends a sanitized audit event', async () => {
    const workspaceId = 'schedule-pause-ws'
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

    clock = new Date('2026-07-11T12:15:00.000Z')
    const paused = await httpClient.connectors.schedules.pause({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: created.revision,
    })

    expect(paused).toMatchObject({
      id: created.id,
      state: 'paused',
      nextEligibleAt: created.nextEligibleAt,
      cadence: created.cadence,
    })
    expect(paused.revision).not.toEqual(created.revision)

    const audit = await httpClient.connectors.schedules.listAudit({
      connectorInstanceId: 'connector-instance-schedule',
      limit: 50,
      offset: 0,
    })

    expect(audit.total).toBe(2)
    expect(audit.items).toEqual([
      expect.objectContaining({
        scheduleId: created.id,
        actorClass: 'user',
        action: 'paused',
        revision: paused.revision,
        at: '2026-07-11T12:15:00.000Z',
      }),
      expect.objectContaining({
        scheduleId: created.id,
        actorClass: 'user',
        action: 'upserted',
        revision: created.revision,
      }),
    ])
    for (const event of audit.items) {
      expect(event).not.toHaveProperty('email')
      expect(event).not.toHaveProperty('credentials')
      expect(Object.keys(event).sort()).toEqual([
        'action',
        'actorClass',
        'at',
        'id',
        'revision',
        'scheduleId',
      ])
    }
  })

  it('resumes a paused schedule from resume time without catch-up replay', async () => {
    const workspaceId = 'schedule-resume-ws'
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
    const paused = await httpClient.connectors.schedules.pause({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: created.revision,
    })

    clock = new Date('2026-07-11T15:00:00.000Z')
    const resumed = await httpClient.connectors.schedules.resume({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: paused.revision,
    })

    expect(resumed).toMatchObject({
      id: created.id,
      state: 'enabled',
      nextEligibleAt: '2026-07-11T16:00:00.000Z',
      cadence: created.cadence,
    })
    expect(resumed.revision).not.toEqual(paused.revision)

    const audit = await httpClient.connectors.schedules.listAudit({
      connectorInstanceId: 'connector-instance-schedule',
      limit: 10,
      offset: 0,
    })
    expect(audit.items.map((event) => event.action)).toEqual(['resumed', 'paused', 'upserted'])
  })

  it('deletes a schedule with exact revision and keeps sanitized delete audit history', async () => {
    const workspaceId = 'schedule-delete-ws'
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

    clock = new Date('2026-07-11T12:20:00.000Z')
    await httpClient.connectors.schedules.delete({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: created.revision,
    })

    await expect(
      httpClient.connectors.schedules.get('connector-instance-schedule'),
    ).resolves.toBeNull()

    const audit = await httpClient.connectors.schedules.listAudit({
      connectorInstanceId: 'connector-instance-schedule',
      limit: 10,
      offset: 0,
    })
    expect(audit.items).toEqual([
      expect.objectContaining({
        scheduleId: created.id,
        actorClass: 'user',
        action: 'deleted',
        at: '2026-07-11T12:20:00.000Z',
      }),
      expect.objectContaining({
        scheduleId: created.id,
        action: 'upserted',
        revision: created.revision,
      }),
    ])
  })

  it('rejects invalid IANA timezones before persistence with no audit side effects', async () => {
    const workspaceId = 'schedule-invalid-zone-ws'
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

    server = await createValedictorianHttpServer({
      client: localClient,
      host: '127.0.0.1',
      port: 0,
      resolveWorkspaceClient: async () => localClient,
    })
    const httpClient = createHttpValedictorianClient({ baseUrl: server.url }).forWorkspace(workspaceId)

    const response = await fetch(
      `${server.url}/v1/workspaces/${workspaceId}/connectors/connector-instance-schedule/schedule`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expectedRevision: null,
          state: 'enabled',
          cadence: { kind: 'interval', everyMinutes: 60 },
          timezone: 'Not/A_Real_Zone',
        }),
      },
    )
    const body = await readJson(response)

    expect(response.status).toBe(400)
    expect(body).toMatchObject({
      code: 'invalid_timezone',
      message: expect.stringMatching(/timezone|IANA/i),
    })
    await expect(
      httpClient.connectors.schedules.get('connector-instance-schedule'),
    ).resolves.toBeNull()
    await expect(httpClient.connectors.schedules.listAudit({
      connectorInstanceId: 'connector-instance-schedule',
      limit: 10,
      offset: 0,
    })).resolves.toMatchObject({ total: 0, items: [] })
  })

  it('rejects unsupported cadence discriminators with typed invalid_cadence and no persistence', async () => {
    const workspaceId = 'schedule-invalid-cadence-kind-ws'
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

    server = await createValedictorianHttpServer({
      client: localClient,
      host: '127.0.0.1',
      port: 0,
      resolveWorkspaceClient: async () => localClient,
    })
    const httpClient = createHttpValedictorianClient({ baseUrl: server.url }).forWorkspace(workspaceId)

    const response = await fetch(
      `${server.url}/v1/workspaces/${workspaceId}/connectors/connector-instance-schedule/schedule`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expectedRevision: null,
          state: 'enabled',
          cadence: { kind: 'cron', expression: '0 * * * *' },
          timezone: 'UTC',
        }),
      },
    )
    const body = await readJson(response)

    expect(response.status).toBe(400)
    expect(body).toMatchObject({
      code: 'invalid_cadence',
    })
    await expect(
      httpClient.connectors.schedules.get('connector-instance-schedule'),
    ).resolves.toBeNull()
    await expect(httpClient.connectors.schedules.listAudit({
      connectorInstanceId: 'connector-instance-schedule',
      limit: 10,
      offset: 0,
    })).resolves.toMatchObject({ total: 0, items: [] })
  })

  it('rejects intervals below the capability minimum before persistence', async () => {
    const workspaceId = 'schedule-too-frequent-ws'
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

    server = await createValedictorianHttpServer({
      client: localClient,
      host: '127.0.0.1',
      port: 0,
      resolveWorkspaceClient: async () => localClient,
    })
    const httpClient = createHttpValedictorianClient({ baseUrl: server.url }).forWorkspace(workspaceId)

    const error = await httpClient.connectors.schedules.upsert({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: null,
      state: 'enabled',
      cadence: { kind: 'interval', everyMinutes: 5 },
      timezone: 'UTC',
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ValedictorianHttpError)
    expect(error).toMatchObject({
      status: 400,
      body: { code: 'schedule_too_frequent' },
    })
    await expect(
      httpClient.connectors.schedules.get('connector-instance-schedule'),
    ).resolves.toBeNull()
  })

  it('rejects client-supplied server-owned schedule fields before persistence', async () => {
    const workspaceId = 'schedule-spoof-ws'
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

    server = await createValedictorianHttpServer({
      client: localClient,
      host: '127.0.0.1',
      port: 0,
      resolveWorkspaceClient: async () => localClient,
    })
    const httpClient = createHttpValedictorianClient({ baseUrl: server.url }).forWorkspace(workspaceId)

    const response = await fetch(
      `${server.url}/v1/workspaces/${workspaceId}/connectors/connector-instance-schedule/schedule`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expectedRevision: null,
          state: 'enabled',
          cadence: { kind: 'interval', everyMinutes: 60 },
          timezone: 'UTC',
          nextEligibleAt: '2020-01-01T00:00:00.000Z',
          revision: 'spoofed-revision',
          id: 'spoofed-schedule-id',
        }),
      },
    )

    expect(response.status).toBe(400)
    await expect(
      httpClient.connectors.schedules.get('connector-instance-schedule'),
    ).resolves.toBeNull()
    await expect(httpClient.connectors.schedules.listAudit({
      connectorInstanceId: 'connector-instance-schedule',
      limit: 10,
      offset: 0,
    })).resolves.toMatchObject({ total: 0, items: [] })
  })

  it('rejects cadence kinds outside the injected capability before persistence', async () => {
    const workspaceId = 'schedule-invalid-cadence-ws'
    const pgliteDataPath = createTempDatabasePath()
    const limitedCapability: Extract<ConnectorSchedulingCapability, { available: true }> = {
      ...availableSchedulingCapability,
      supportedCadences: ['interval'],
    }
    const localClient = await createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([fixtureConnector()]),
      connectorScheduling: limitedCapability,
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

    server = await createValedictorianHttpServer({
      client: localClient,
      host: '127.0.0.1',
      port: 0,
      resolveWorkspaceClient: async () => localClient,
    })
    const httpClient = createHttpValedictorianClient({ baseUrl: server.url }).forWorkspace(workspaceId)

    const error = await httpClient.connectors.schedules.upsert({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: null,
      state: 'enabled',
      cadence: { kind: 'daily', localTime: '09:00' },
      timezone: 'America/New_York',
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ValedictorianHttpError)
    expect(error).toMatchObject({
      status: 400,
      body: { code: 'invalid_cadence' },
    })
    await expect(
      httpClient.connectors.schedules.get('connector-instance-schedule'),
    ).resolves.toBeNull()
  })

  it('allows recreate after delete while preserving prior sanitized audit history', async () => {
    const workspaceId = 'schedule-delete-recreate-ws'
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

    clock = new Date('2026-07-11T12:20:00.000Z')
    await httpClient.connectors.schedules.delete({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: created.revision,
    })
    await expect(
      httpClient.connectors.schedules.get('connector-instance-schedule'),
    ).resolves.toBeNull()

    clock = new Date('2026-07-11T12:30:00.000Z')
    const recreated = await httpClient.connectors.schedules.upsert({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: null,
      state: 'enabled',
      cadence: { kind: 'interval', everyMinutes: 90 },
      timezone: 'UTC',
    })

    expect(recreated.id).not.toEqual(created.id)
    expect(recreated).toMatchObject({
      cadence: { kind: 'interval', everyMinutes: 90 },
      nextEligibleAt: '2026-07-11T14:00:00.000Z',
    })

    const audit = await httpClient.connectors.schedules.listAudit({
      connectorInstanceId: 'connector-instance-schedule',
      limit: 20,
      offset: 0,
    })
    expect(audit.items.map((event) => event.action)).toEqual([
      'upserted',
      'deleted',
      'upserted',
    ])
    expect(audit.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scheduleId: created.id,
        action: 'deleted',
        at: '2026-07-11T12:20:00.000Z',
      }),
      expect.objectContaining({
        scheduleId: recreated.id,
        action: 'upserted',
        revision: recreated.revision,
        at: '2026-07-11T12:30:00.000Z',
      }),
    ]))
  })

})
