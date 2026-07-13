import { afterEach, describe, expect, it } from 'vitest'
import { createHttpValedictorianClient } from 'sparxie'
import { completedConnectorRefreshContract } from '../modules/connectors/connector-refresh-result.test-helpers'
import {
  availableConnectorSchedulingCapability as availableSchedulingCapability,
  createLocalValedictorianClient,
  createScheduleHttpFixtureConnector as fixtureConnector,
  createScheduleHttpTempSqlitePath as createTempSqlitePath,
  createStaticConnectorRegistry,
  createValedictorianHttpServer,
  type ScheduleHttpServerHandle,
} from './local-server.connector-schedules.http-fixture'

describe('local server connector schedule dispatch', () => {
  let server: ScheduleHttpServerHandle | null = null

  afterEach(async () => {
    await server?.close()
    server = null
  })

  it('executes an admitted due run exactly once through the shared connector path to a terminal result', async () => {
    const workspaceId = 'schedule-dispatch-execute-ws'
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
                ...completedConnectorRefreshContract(input.coverage.start.slice(0, 10)),
                coverage: input.coverage,
              nextCheckpoint: {
                checkpoint: { cursor: 'scheduled-1' },
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

    const created = await httpClient.connectors.schedules.upsert({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: null,
      state: 'enabled',
      cadence: { kind: 'interval', everyMinutes: 60 },
      timezone: 'UTC',
    })

    clock = new Date('2026-07-11T13:00:00.000Z')
    const admitted = await httpClient.connectors.schedules.dispatchDue({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: created.revision,
    })

    expect(admitted).toMatchObject({
      status: 'admitted',
      occurrence: {
        scheduleId: created.id,
        scheduleRevision: created.revision,
        nominalAt: '2026-07-11T13:00:00.000Z',
        admittedMode: 'scheduled',
        outcome: 'completed',
        connectorRunId: expect.any(String),
      },
      run: {
        mode: 'scheduled',
        status: 'completed',
        completedAt: expect.any(String),
      },
    })
    if (admitted.status !== 'admitted') {
      throw new Error('expected admitted')
    }
    expect(admitted.run.id).toBe(admitted.occurrence.connectorRunId)
    expect(refreshCalls).toBe(1)

    const runs = await httpClient.connectors.runs.list({
      connectorInstanceId: 'connector-instance-schedule',
      limit: 10,
      offset: 0,
    })
    expect(runs.total).toBe(1)
    expect(runs.items[0]).toMatchObject({
      id: admitted.run.id,
      mode: 'scheduled',
      status: 'completed',
      scheduleOccurrence: {
        scheduleId: created.id,
        scheduleRevision: created.revision,
        occurrenceId: admitted.occurrence.id,
        nominalAt: '2026-07-11T13:00:00.000Z',
        admittedMode: 'scheduled',
      },
    })

    const occurrences = await httpClient.connectors.schedules.listOccurrences({
      connectorInstanceId: 'connector-instance-schedule',
      limit: 10,
      offset: 0,
    })
    expect(occurrences.items[0]).toMatchObject({
      id: admitted.occurrence.id,
      outcome: 'completed',
      connectorRunId: admitted.run.id,
    })
  })

  it('admits one due scheduled occurrence with exact run provenance and future eligibility', async () => {
    const workspaceId = 'schedule-dispatch-due-ws'
    const sqlitePath = createTempSqlitePath()
    let clock = new Date('2026-07-11T12:00:00.000Z')
    const localClient = createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([fixtureConnector()]),
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

    const created = await httpClient.connectors.schedules.upsert({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: null,
      state: 'enabled',
      cadence: { kind: 'interval', everyMinutes: 60 },
      timezone: 'UTC',
    })
    expect(created.nextEligibleAt).toBe('2026-07-11T13:00:00.000Z')

    clock = new Date('2026-07-11T13:00:00.000Z')
    const admitted = await httpClient.connectors.schedules.dispatchDue({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: created.revision,
    })

    expect(admitted).toMatchObject({
      status: 'admitted',
      occurrence: {
        scheduleId: created.id,
        scheduleRevision: created.revision,
        nominalAt: '2026-07-11T13:00:00.000Z',
        idempotencyKey: `${created.revision}:2026-07-11T13:00:00.000Z`,
        admittedMode: 'scheduled',
        outcome: 'completed',
      },
      run: {
        mode: 'scheduled',
        status: 'completed',
      },
    })
    if (admitted.status !== 'admitted') {
      throw new Error('expected admitted')
    }
    expect(admitted.occurrence.connectorRunId).toBe(admitted.run.id)

    const schedule = await httpClient.connectors.schedules.get('connector-instance-schedule')
    expect(schedule).toMatchObject({
      nextEligibleAt: '2026-07-11T14:00:00.000Z',
      lastOccurrence: expect.objectContaining({
        id: admitted.occurrence.id,
        admittedMode: 'scheduled',
        outcome: 'completed',
      }),
      lastRun: expect.objectContaining({
        id: admitted.run.id,
        mode: 'scheduled',
        status: 'completed',
      }),
    })

    const runs = await httpClient.connectors.runs.list({
      connectorInstanceId: 'connector-instance-schedule',
      limit: 10,
      offset: 0,
    })
    expect(runs.items[0]).toMatchObject({
      id: admitted.run.id,
      mode: 'scheduled',
      status: 'completed',
      scheduleOccurrence: {
        scheduleId: created.id,
        scheduleRevision: created.revision,
        occurrenceId: admitted.occurrence.id,
        nominalAt: '2026-07-11T13:00:00.000Z',
        admittedMode: 'scheduled',
        idempotencyKey: `${created.revision}:2026-07-11T13:00:00.000Z`,
      },
    })
  })

  it('returns the same admitted occurrence for repeated dispatch of the same revision and nominal', async () => {
    const workspaceId = 'schedule-idempotent-ws'
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
                ...completedConnectorRefreshContract(input.coverage.start.slice(0, 10)),
                coverage: input.coverage,
              nextCheckpoint: {
                checkpoint: { cursor: 'idempotent-1' },
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

    const created = await httpClient.connectors.schedules.upsert({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: null,
      state: 'enabled',
      cadence: { kind: 'interval', everyMinutes: 60 },
      timezone: 'UTC',
    })

    clock = new Date('2026-07-11T13:00:00.000Z')
    const first = await httpClient.connectors.schedules.dispatchDue({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: created.revision,
    })
    const second = await httpClient.connectors.schedules.dispatchDue({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: created.revision,
    })
    const concurrent = await Promise.all([
      httpClient.connectors.schedules.dispatchDue({
        connectorInstanceId: 'connector-instance-schedule',
        expectedRevision: created.revision,
      }),
      httpClient.connectors.schedules.dispatchDue({
        connectorInstanceId: 'connector-instance-schedule',
        expectedRevision: created.revision,
      }),
    ])

    expect(first).toMatchObject({
      status: 'admitted',
      occurrence: { outcome: 'completed' },
      run: { status: 'completed' },
    })
    expect(second).toEqual(first)
    expect(concurrent[0]).toEqual(first)
    expect(concurrent[1]).toEqual(first)
    expect(refreshCalls).toBe(1)

    const runs = await httpClient.connectors.runs.list({
      connectorInstanceId: 'connector-instance-schedule',
      limit: 10,
      offset: 0,
    })
    expect(runs.total).toBe(1)
  })

  it('defers due dispatch when an active connector run exists without consuming the occurrence', async () => {
    const workspaceId = 'schedule-deferred-active-ws'
    const sqlitePath = createTempSqlitePath()
    let clock = new Date('2026-07-11T12:00:00.000Z')
    let releaseRefresh: (() => void) | undefined
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve
    })

    const localClient = createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([
        {
          definition: { id: 'fixture.jobs', version: '0.0.0-fixture' },
          async refresh(input) {
            await refreshGate
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

    const created = await localClient.connectors.schedules.upsert({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: null,
      state: 'enabled',
      cadence: { kind: 'interval', everyMinutes: 60 },
      timezone: 'UTC',
    })

    const activeTrigger = localClient.connectors.runs.trigger({
      connectorInstanceId: 'connector-instance-schedule',
      mode: 'manual',
      coverageEndedAt: clock.toISOString(),
    })

    let activeVisible = false
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const runs = await localClient.connectors.runs.list({
        connectorInstanceId: 'connector-instance-schedule',
        limit: 10,
        offset: 0,
      })
      if (runs.items.some((run) => run.status === 'queued' || run.status === 'running')) {
        activeVisible = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(activeVisible).toBe(true)

    clock = new Date('2026-07-11T13:00:00.000Z')
    const deferred = await localClient.connectors.schedules.dispatchDue({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: created.revision,
    })

    expect(deferred).toMatchObject({
      status: 'deferred_active',
      activeRunId: expect.any(String),
    })

    const schedule = await localClient.connectors.schedules.get('connector-instance-schedule')
    expect(schedule).toMatchObject({
      nextEligibleAt: created.nextEligibleAt,
      lastOccurrence: null,
      revision: created.revision,
    })

    releaseRefresh?.()
    await activeTrigger
  })

  it('coalesces multiple missed interval nominals into one catch_up admission', async () => {
    const workspaceId = 'schedule-catch-up-coalesce-ws'
    const sqlitePath = createTempSqlitePath()
    let clock = new Date('2026-07-11T12:00:00.000Z')
    const localClient = createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([fixtureConnector()]),
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

    const created = await httpClient.connectors.schedules.upsert({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: null,
      state: 'enabled',
      cadence: { kind: 'interval', everyMinutes: 60 },
      timezone: 'UTC',
    })
    expect(created.nextEligibleAt).toBe('2026-07-11T13:00:00.000Z')

    // Miss 13:00, 14:00, and 15:00; dispatch at 15:30 → one catch_up at most recent due nominal 15:00.
    clock = new Date('2026-07-11T15:30:00.000Z')
    const admitted = await httpClient.connectors.schedules.dispatchDue({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: created.revision,
    })

    expect(admitted).toMatchObject({
      status: 'admitted',
      occurrence: {
        scheduleRevision: created.revision,
        nominalAt: '2026-07-11T15:00:00.000Z',
        admittedMode: 'catch_up',
        outcome: 'completed',
        connectorRunId: expect.any(String),
        idempotencyKey: `${created.revision}:2026-07-11T15:00:00.000Z`,
      },
      run: {
        mode: 'catch_up',
        status: 'completed',
        id: expect.any(String),
      },
    })
    if (admitted.status !== 'admitted') {
      throw new Error(`Expected admitted, got ${admitted.status}`)
    }
    expect(admitted.run.id).toBe(admitted.occurrence.connectorRunId)

    const schedule = await httpClient.connectors.schedules.get('connector-instance-schedule')
    expect(schedule).toMatchObject({
      nextEligibleAt: '2026-07-11T16:00:00.000Z',
      lastOccurrence: {
        nominalAt: '2026-07-11T15:00:00.000Z',
        admittedMode: 'catch_up',
        outcome: 'completed',
      },
      lastRun: {
        id: admitted.run.id,
        mode: 'catch_up',
        status: 'completed',
      },
    })

    const runs = await httpClient.connectors.runs.list({
      connectorInstanceId: 'connector-instance-schedule',
      limit: 10,
      offset: 0,
    })
    expect(runs.total).toBe(1)
    expect(runs.items[0]).toMatchObject({
      id: admitted.run.id,
      mode: 'catch_up',
      status: 'completed',
      scheduleOccurrence: {
        scheduleId: created.id,
        scheduleRevision: created.revision,
        occurrenceId: admitted.occurrence.id,
        nominalAt: '2026-07-11T15:00:00.000Z',
        admittedMode: 'catch_up',
        idempotencyKey: `${created.revision}:2026-07-11T15:00:00.000Z`,
      },
    })
  })

  it('advances eligibility without admitting when all missed nominals are outside the catch-up horizon', async () => {
    const workspaceId = 'schedule-horizon-expired-ws'
    const sqlitePath = createTempSqlitePath()
    let clock = new Date('2026-07-11T12:00:00.000Z')
    const limitedHorizon: typeof availableSchedulingCapability = {
      ...availableSchedulingCapability,
      maximumCatchUpAgeMinutes: 30,
    }
    const localClient = createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([fixtureConnector()]),
      connectorScheduling: limitedHorizon,
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

    const created = await httpClient.connectors.schedules.upsert({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: null,
      state: 'enabled',
      cadence: { kind: 'interval', everyMinutes: 60 },
      timezone: 'UTC',
    })
    expect(created.nextEligibleAt).toBe('2026-07-11T13:00:00.000Z')

    // Miss 13:00, 14:00, 15:00; at 15:59 with 30-minute horizon all are expired.
    clock = new Date('2026-07-11T15:59:00.000Z')
    const result = await httpClient.connectors.schedules.dispatchDue({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: created.revision,
    })

    expect(result).toMatchObject({
      status: 'not_due',
      nextEligibleAt: '2026-07-11T16:00:00.000Z',
    })

    const schedule = await httpClient.connectors.schedules.get('connector-instance-schedule')
    expect(schedule).toMatchObject({
      nextEligibleAt: '2026-07-11T16:00:00.000Z',
      lastOccurrence: null,
      lastRun: null,
      revision: created.revision,
    })

    const runs = await httpClient.connectors.runs.list({
      connectorInstanceId: 'connector-instance-schedule',
      limit: 10,
      offset: 0,
    })
    expect(runs.total).toBe(0)
  })

  it('returns paused without consuming a due occurrence or advancing eligibility', async () => {
    const workspaceId = 'schedule-dispatch-paused-ws'
    const sqlitePath = createTempSqlitePath()
    let clock = new Date('2026-07-11T12:00:00.000Z')
    const localClient = createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([fixtureConnector()]),
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
    const result = await httpClient.connectors.schedules.dispatchDue({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: paused.revision,
    })

    expect(result).toEqual({ status: 'paused' })

    const schedule = await httpClient.connectors.schedules.get('connector-instance-schedule')
    expect(schedule).toMatchObject({
      state: 'paused',
      nextEligibleAt: created.nextEligibleAt,
      lastOccurrence: null,
      revision: paused.revision,
    })

    const runs = await httpClient.connectors.runs.list({
      connectorInstanceId: 'connector-instance-schedule',
      limit: 10,
      offset: 0,
    })
    expect(runs.total).toBe(0)
  })

  it('returns connector_disabled without consuming a due occurrence or advancing eligibility', async () => {
    const workspaceId = 'schedule-dispatch-disabled-ws'
    const sqlitePath = createTempSqlitePath()
    let clock = new Date('2026-07-11T12:00:00.000Z')
    const localClient = createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([fixtureConnector()]),
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

    const created = await httpClient.connectors.schedules.upsert({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: null,
      state: 'enabled',
      cadence: { kind: 'interval', everyMinutes: 60 },
      timezone: 'UTC',
    })

    await httpClient.connectors.update({
      connectorInstanceId: 'connector-instance-schedule',
      enabled: false,
    })

    clock = new Date('2026-07-11T13:00:00.000Z')
    const result = await httpClient.connectors.schedules.dispatchDue({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: created.revision,
    })

    expect(result).toEqual({ status: 'connector_disabled' })

    const schedule = await httpClient.connectors.schedules.get('connector-instance-schedule')
    expect(schedule).toMatchObject({
      state: 'enabled',
      nextEligibleAt: created.nextEligibleAt,
      lastOccurrence: null,
      revision: created.revision,
    })

    const runs = await httpClient.connectors.runs.list({
      connectorInstanceId: 'connector-instance-schedule',
      limit: 10,
      offset: 0,
    })
    expect(runs.total).toBe(0)
  })

  it('preserves an already active connector run when the schedule is paused', async () => {
    const workspaceId = 'schedule-pause-preserves-active-ws'
    const sqlitePath = createTempSqlitePath()
    let clock = new Date('2026-07-11T12:00:00.000Z')
    let releaseRefresh: (() => void) | undefined
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve
    })

    const localClient = createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([
        {
          definition: { id: 'fixture.jobs', version: '0.0.0-fixture' },
          async refresh(input) {
            await refreshGate
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

    const created = await localClient.connectors.schedules.upsert({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: null,
      state: 'enabled',
      cadence: { kind: 'interval', everyMinutes: 60 },
      timezone: 'UTC',
    })

    const activeTrigger = localClient.connectors.runs.trigger({
      connectorInstanceId: 'connector-instance-schedule',
      mode: 'manual',
      coverageEndedAt: clock.toISOString(),
    })

    let activeRunId: string | null = null
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const runs = await localClient.connectors.runs.list({
        connectorInstanceId: 'connector-instance-schedule',
        limit: 10,
        offset: 0,
      })
      const active = runs.items.find((run) => run.status === 'queued' || run.status === 'running')
      if (active) {
        activeRunId = active.id
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(activeRunId).toEqual(expect.any(String))

    clock = new Date('2026-07-11T13:05:00.000Z')
    const paused = await localClient.connectors.schedules.pause({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: created.revision,
    })
    expect(paused.state).toBe('paused')

    const activeAfter = await localClient.connectors.runs.list({
      connectorInstanceId: 'connector-instance-schedule',
      limit: 10,
      offset: 0,
    })
    expect(activeAfter.items[0]).toMatchObject({
      id: activeRunId,
      mode: 'manual',
    })
    expect(['queued', 'running']).toContain(activeAfter.items[0]?.status)

    const deferred = await localClient.connectors.schedules.dispatchDue({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: paused.revision,
    })
    expect(deferred).toEqual({ status: 'paused' })

    releaseRefresh?.()
    await activeTrigger
  })

})
