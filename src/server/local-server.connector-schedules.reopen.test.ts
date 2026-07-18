import { afterEach, describe, expect, it } from 'vitest'
import { createHttpValedictorianClient } from 'sparxie'
import { admitConnectorScheduleDue } from '../modules/connectors/connector-schedule.dispatch'
import { createConnectorScheduleRepository } from '../modules/connectors/connector-schedule.repository'
import { createPgliteConnectorRepository } from '../modules/connectors/connector.repository'
import { completedConnectorRefreshContract } from '../modules/connectors/connector-refresh-result.test-helpers'
import {
  availableConnectorSchedulingCapability as availableSchedulingCapability,
  createLocalValedictorianClient,
  createScheduleHttpFixtureConnector as fixtureConnector,
  createScheduleHttpTempDatabasePath as createTempDatabasePath,
  createStaticConnectorRegistry,
  createValedictorianHttpServer,
  type ScheduleHttpServerHandle,
} from './local-server.connector-schedules.http-fixture'
import {
  closeLocalValedictorianClient,
  getLocalValedictorianTestDatabase,
} from './local-valedictorian-client.test-harness'

describe('local server connector schedule reopen recovery', () => {
  let server: ScheduleHttpServerHandle | null = null

  afterEach(async () => {
    await server?.close()
    server = null
  })

  it('recovers an admitted queued schedule run across PGlite reopen through public dispatchDue', async () => {
    const workspaceId = 'schedule-reopen-recover-ws'
    const pgliteDataPath = createTempDatabasePath()
    let clock = new Date('2026-07-11T12:00:00.000Z')

    const setupClient = await createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([fixtureConnector()]),
      connectorScheduling: availableSchedulingCapability,
      now: () => clock,
      seedDataMode: 'none',
      pgliteDataPath,
      workspaceId,
    })

    await setupClient.connectors.create({
      id: 'connector-instance-schedule',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture Jobs',
      enabled: true,
      earliestBackfillDate: '2026-06-15',
    })

    const created = await setupClient.connectors.schedules.upsert({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: null,
      state: 'enabled',
      cadence: { kind: 'interval', everyMinutes: 60 },
      timezone: 'UTC',
    })

    clock = new Date('2026-07-11T13:00:00.000Z')
    // Narrow admission seam: durable queued occurrence before CAS claim / connector execution.
    const admittedOnly = await admitConnectorScheduleDue({
      database: getLocalValedictorianTestDatabase(setupClient),
      now: () => clock,
      maximumCatchUpAgeMinutes: availableSchedulingCapability.maximumCatchUpAgeMinutes,
      input: {
        connectorInstanceId: 'connector-instance-schedule',
        expectedRevision: created.revision,
      },
    })
    expect(admittedOnly).toMatchObject({
      status: 'admitted',
      occurrence: { outcome: 'admitted' },
      run: { status: 'queued', mode: 'scheduled' },
    })
    if (admittedOnly.status !== 'admitted') {
      throw new Error('expected admitted queued setup')
    }
    await setupClient.connectors.update({
      connectorInstanceId: 'connector-instance-schedule',
      earliestBackfillDate: '2026-07-01',
    })
    await closeLocalValedictorianClient(setupClient)

    // Process boundary: reopen the same PGlite data directory with a new local client.
    let refreshCalls = 0
    let refreshCoverageStart: string | null = null
    const reopenedClient = await createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([
        {
          definition: { id: 'fixture.jobs', version: '0.0.0-fixture' },
          async refresh(input) {
            refreshCalls += 1
            refreshCoverageStart = input.coverage.start
              return {
                ...completedConnectorRefreshContract(input.coverage.start.slice(0, 10)),
                coverage: input.coverage,
              nextCheckpoint: {
                checkpoint: { cursor: 'recovered-1' },
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
      pgliteDataPath,
      workspaceId,
    })

    const preserved = await reopenedClient.connectors.runs.list({
      connectorInstanceId: 'connector-instance-schedule',
      limit: 10,
      offset: 0,
    })
    expect(preserved).toMatchObject({
      total: 1,
      items: [{
        id: admittedOnly.run.id,
        status: 'queued',
        mode: 'scheduled',
        historicalBackfill: {
          boundary: { earliestDate: '2026-06-15' },
          state: 'not_started',
        },
      }],
    })

    server = await createValedictorianHttpServer({
      client: reopenedClient,
      host: '127.0.0.1',
      port: 0,
      resolveWorkspaceClient: async () => reopenedClient,
    })
    const httpClient = createHttpValedictorianClient({ baseUrl: server.url }).forWorkspace(workspaceId)

    const recovered = await httpClient.connectors.schedules.dispatchDue({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: created.revision,
    })

    expect(recovered).toMatchObject({
      status: 'admitted',
      occurrence: {
        id: admittedOnly.occurrence.id,
        outcome: 'completed',
        connectorRunId: admittedOnly.run.id,
      },
      run: {
        id: admittedOnly.run.id,
        status: 'completed',
        mode: 'scheduled',
      },
    })
    expect(refreshCalls).toBe(1)
    expect(refreshCoverageStart).toBe('2026-06-15T00:00:00.000Z')

    const runs = await httpClient.connectors.runs.list({
      connectorInstanceId: 'connector-instance-schedule',
      limit: 10,
      offset: 0,
    })
    expect(runs.total).toBe(1)
    expect(runs.items[0]).toMatchObject({
      id: admittedOnly.run.id,
      historicalBackfill: { boundary: { earliestDate: '2026-06-15' } },
    })

    const occurrences = await httpClient.connectors.schedules.listOccurrences({
      connectorInstanceId: 'connector-instance-schedule',
      limit: 10,
      offset: 0,
    })
    expect(occurrences.total).toBe(1)
    expect(occurrences.items[0]).toMatchObject({
      id: admittedOnly.occurrence.id,
      outcome: 'completed',
      connectorRunId: admittedOnly.run.id,
    })
  })

  it('cancels a schedule-linked running run on PGlite reopen and never re-executes it', async () => {
    const workspaceId = 'schedule-reopen-running-ws'
    const pgliteDataPath = createTempDatabasePath()
    let clock = new Date('2026-07-11T12:00:00.000Z')

    const setupClient = await createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([fixtureConnector()]),
      connectorScheduling: availableSchedulingCapability,
      now: () => clock,
      seedDataMode: 'none',
      pgliteDataPath,
      workspaceId,
    })

    await setupClient.connectors.create({
      id: 'connector-instance-schedule',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture Jobs',
      enabled: true,
    })

    const created = await setupClient.connectors.schedules.upsert({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: null,
      state: 'enabled',
      cadence: { kind: 'interval', everyMinutes: 60 },
      timezone: 'UTC',
    })

    clock = new Date('2026-07-11T13:00:00.000Z')
    const admitDb = getLocalValedictorianTestDatabase(setupClient)
    const admittedOnly = await admitConnectorScheduleDue({
      database: admitDb,
      now: () => clock,
      maximumCatchUpAgeMinutes: availableSchedulingCapability.maximumCatchUpAgeMinutes,
      input: {
        connectorInstanceId: 'connector-instance-schedule',
        expectedRevision: created.revision,
      },
    })
    if (admittedOnly.status !== 'admitted') {
      throw new Error('expected admitted setup')
    }
    const claim = await createPgliteConnectorRepository(admitDb).claimQueuedRunToRunning({
      connectorRunId: admittedOnly.run.id,
      startedAt: clock.toISOString(),
    })
    expect(claim.claimed).toBe(true)
    await closeLocalValedictorianClient(setupClient)

    let refreshCalls = 0
    const reopenedClient = await createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([
        {
          definition: { id: 'fixture.jobs', version: '0.0.0-fixture' },
          async refresh(input) {
            refreshCalls += 1
              return {
                ...completedConnectorRefreshContract(input.coverage.start.slice(0, 10)),
                coverage: input.coverage,
              nextCheckpoint: { checkpoint: {}, schemaVersion: 'fixture-checkpoint@1' },
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
      pgliteDataPath,
      workspaceId,
    })

    const cancelled = await reopenedClient.connectors.runs.list({
      connectorInstanceId: 'connector-instance-schedule',
      limit: 10,
      offset: 0,
    })
    expect(cancelled.items[0]).toMatchObject({
      id: admittedOnly.run.id,
      status: 'cancelled',
      mode: 'scheduled',
    })

    server = await createValedictorianHttpServer({
      client: reopenedClient,
      host: '127.0.0.1',
      port: 0,
      resolveWorkspaceClient: async () => reopenedClient,
    })
    const httpClient = createHttpValedictorianClient({ baseUrl: server.url }).forWorkspace(workspaceId)

    const reused = await httpClient.connectors.schedules.dispatchDue({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: created.revision,
    })
    expect(reused).toMatchObject({
      status: 'admitted',
      occurrence: {
        id: admittedOnly.occurrence.id,
        connectorRunId: admittedOnly.run.id,
        outcome: 'cancelled',
      },
      run: {
        id: admittedOnly.run.id,
        status: 'cancelled',
      },
    })
    expect(refreshCalls).toBe(0)

    const runs = await httpClient.connectors.runs.list({
      connectorInstanceId: 'connector-instance-schedule',
      limit: 10,
      offset: 0,
    })
    expect(runs.total).toBe(1)
  })

  it('does not revive a terminal failed scheduled occurrence across reopen', async () => {
    const workspaceId = 'schedule-reopen-failed-ws'
    const pgliteDataPath = createTempDatabasePath()
    let clock = new Date('2026-07-11T12:00:00.000Z')

    const setupClient = await createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([fixtureConnector()]),
      connectorScheduling: availableSchedulingCapability,
      now: () => clock,
      seedDataMode: 'none',
      pgliteDataPath,
      workspaceId,
    })

    await setupClient.connectors.create({
      id: 'connector-instance-schedule',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture Jobs',
      enabled: true,
    })

    const created = await setupClient.connectors.schedules.upsert({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: null,
      state: 'enabled',
      cadence: { kind: 'interval', everyMinutes: 60 },
      timezone: 'UTC',
    })

    clock = new Date('2026-07-11T13:00:00.000Z')
    const admitDb = getLocalValedictorianTestDatabase(setupClient)
    const admittedOnly = await admitConnectorScheduleDue({
      database: admitDb,
      now: () => clock,
      maximumCatchUpAgeMinutes: availableSchedulingCapability.maximumCatchUpAgeMinutes,
      input: {
        connectorInstanceId: 'connector-instance-schedule',
        expectedRevision: created.revision,
      },
    })
    if (admittedOnly.status !== 'admitted') {
      throw new Error('expected admitted setup')
    }

    const connectorRepository = createPgliteConnectorRepository(admitDb)
    await connectorRepository.claimQueuedRunToRunning({
      connectorRunId: admittedOnly.run.id,
      startedAt: clock.toISOString(),
    })
    await connectorRepository.markRunFailed({
      connectorRunId: admittedOnly.run.id,
      completedAt: clock.toISOString(),
      retryHints: null,
      warning: {
        code: 'connector.execution_failed',
        message: 'Connector execution failed.',
      },
    })
    await createConnectorScheduleRepository(admitDb, () => clock).markOccurrenceOutcome({
      occurrenceId: admittedOnly.occurrence.id,
      outcome: 'failed',
    })
    await closeLocalValedictorianClient(setupClient)

    let refreshCalls = 0
    const reopenedClient = await createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([
        {
          definition: { id: 'fixture.jobs', version: '0.0.0-fixture' },
          async refresh(input) {
            refreshCalls += 1
              return {
                ...completedConnectorRefreshContract(input.coverage.start.slice(0, 10)),
                coverage: input.coverage,
              nextCheckpoint: { checkpoint: {}, schemaVersion: 'fixture-checkpoint@1' },
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
      pgliteDataPath,
      workspaceId,
    })

    server = await createValedictorianHttpServer({
      client: reopenedClient,
      host: '127.0.0.1',
      port: 0,
      resolveWorkspaceClient: async () => reopenedClient,
    })
    const httpClient = createHttpValedictorianClient({ baseUrl: server.url }).forWorkspace(workspaceId)

    const reused = await httpClient.connectors.schedules.dispatchDue({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: created.revision,
    })
    expect(reused).toMatchObject({
      status: 'admitted',
      occurrence: {
        id: admittedOnly.occurrence.id,
        outcome: 'failed',
        connectorRunId: admittedOnly.run.id,
      },
      run: {
        id: admittedOnly.run.id,
        status: 'failed',
      },
    })
    expect(refreshCalls).toBe(0)

    const runs = await httpClient.connectors.runs.list({
      connectorInstanceId: 'connector-instance-schedule',
      limit: 10,
      offset: 0,
    })
    expect(runs.total).toBe(1)
  })

  it('terminalizes a claimed schedule run when reopened registry cannot provide the connector', async () => {
    const workspaceId = 'schedule-reopen-missing-connector-ws'
    const pgliteDataPath = createTempDatabasePath()
    let clock = new Date('2026-07-11T12:00:00.000Z')

    const setupClient = await createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([fixtureConnector()]),
      connectorScheduling: availableSchedulingCapability,
      now: () => clock,
      seedDataMode: 'none',
      pgliteDataPath,
      workspaceId,
    })

    await setupClient.connectors.create({
      id: 'connector-instance-schedule',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture Jobs',
      enabled: true,
    })

    const created = await setupClient.connectors.schedules.upsert({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: null,
      state: 'enabled',
      cadence: { kind: 'interval', everyMinutes: 60 },
      timezone: 'UTC',
    })

    clock = new Date('2026-07-11T13:00:00.000Z')
    const admittedOnly = await admitConnectorScheduleDue({
      database: getLocalValedictorianTestDatabase(setupClient),
      now: () => clock,
      maximumCatchUpAgeMinutes: availableSchedulingCapability.maximumCatchUpAgeMinutes,
      input: {
        connectorInstanceId: 'connector-instance-schedule',
        expectedRevision: created.revision,
      },
    })
    expect(admittedOnly).toMatchObject({
      status: 'admitted',
      occurrence: { outcome: 'admitted' },
      run: { status: 'queued', mode: 'scheduled' },
    })
    if (admittedOnly.status !== 'admitted') {
      throw new Error('expected admitted queued setup')
    }
    await closeLocalValedictorianClient(setupClient)

    let refreshCalls = 0
    const reopenedClient = await createLocalValedictorianClient({
      // Registry cannot provide the persisted connector id/version.
      connectorRegistry: createStaticConnectorRegistry([]),
      connectorScheduling: availableSchedulingCapability,
      now: () => clock,
      seedDataMode: 'none',
      pgliteDataPath,
      workspaceId,
    })

    server = await createValedictorianHttpServer({
      client: reopenedClient,
      host: '127.0.0.1',
      port: 0,
      resolveWorkspaceClient: async () => reopenedClient,
    })
    const httpClient = createHttpValedictorianClient({ baseUrl: server.url }).forWorkspace(workspaceId)

    const failed = await httpClient.connectors.schedules.dispatchDue({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: created.revision,
    })
    expect(failed).toMatchObject({
      status: 'admitted',
      occurrence: {
        id: admittedOnly.occurrence.id,
        outcome: 'failed',
        connectorRunId: admittedOnly.run.id,
      },
      run: {
        id: admittedOnly.run.id,
        status: 'failed',
      },
    })
    expect(refreshCalls).toBe(0)

    const repeated = await httpClient.connectors.schedules.dispatchDue({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: created.revision,
    })
    expect(repeated).toEqual(failed)

    const runs = await httpClient.connectors.runs.list({
      connectorInstanceId: 'connector-instance-schedule',
      limit: 10,
      offset: 0,
    })
    expect(runs.total).toBe(1)
    expect(runs.items[0]).toMatchObject({
      id: admittedOnly.run.id,
      status: 'failed',
    })
    expect(JSON.stringify(runs.items[0])).not.toMatch(/Unsupported connector|version mismatch/i)

    await server.close()
    server = null
    await closeLocalValedictorianClient(reopenedClient)

    // Later reopen with a valid connector must not revive the terminal failure.
    const revivedClient = await createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([
        {
          definition: { id: 'fixture.jobs', version: '0.0.0-fixture' },
          async refresh(input) {
            refreshCalls += 1
              return {
                ...completedConnectorRefreshContract(input.coverage.start.slice(0, 10)),
                coverage: input.coverage,
              nextCheckpoint: { checkpoint: {}, schemaVersion: 'fixture-checkpoint@1' },
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
      pgliteDataPath,
      workspaceId,
    })

    server = await createValedictorianHttpServer({
      client: revivedClient,
      host: '127.0.0.1',
      port: 0,
      resolveWorkspaceClient: async () => revivedClient,
    })
    const revivedHttp = createHttpValedictorianClient({ baseUrl: server.url }).forWorkspace(workspaceId)

    const stillFailed = await revivedHttp.connectors.schedules.dispatchDue({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: created.revision,
    })
    expect(stillFailed).toMatchObject({
      status: 'admitted',
      occurrence: {
        id: admittedOnly.occurrence.id,
        outcome: 'failed',
        connectorRunId: admittedOnly.run.id,
      },
      run: {
        id: admittedOnly.run.id,
        status: 'failed',
      },
    })
    expect(refreshCalls).toBe(0)
    const finalRuns = await revivedHttp.connectors.runs.list({
      connectorInstanceId: 'connector-instance-schedule',
      limit: 10,
      offset: 0,
    })
    expect(finalRuns.total).toBe(1)
  })

})
