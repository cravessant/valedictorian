import { afterEach, describe, expect, it } from 'vitest'
import { createHttpValedictorianClient } from 'sparxie'
import { completedConnectorRefreshContract } from '../modules/connectors/connector-refresh-result.test-helpers'
import {
  availableConnectorSchedulingCapability as availableSchedulingCapability,
  createLocalValedictorianClient,
  createScheduleHttpTempDatabasePath as createTempDatabasePath,
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
    const pgliteDataPath = createTempDatabasePath()
    let clock = new Date('2026-07-11T12:00:00.000Z')
    let refreshCalls = 0
    const localClient = await createLocalValedictorianClient({
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
        idempotencyKey: `${created.revision}:2026-07-11T13:00:00.000Z`,
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

    const repeated = await httpClient.connectors.schedules.dispatchDue({
      connectorInstanceId: 'connector-instance-schedule',
      expectedRevision: created.revision,
    })
    expect(repeated).toEqual(admitted)
    expect(refreshCalls).toBe(1)
  })
})
