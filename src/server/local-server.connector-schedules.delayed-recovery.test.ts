import { describe, expect, it } from 'vitest'
import { createPgliteConnectorRepository } from '../modules/connectors/connector.repository'
import {
  CONNECTOR_INSTANCE_ID,
  admitScheduleDueOnly,
  createReopenedScheduleClient,
  openScheduleDatabase,
  seedHourlyScheduleWorkspace,
} from './local-server.connector-schedules.delayed-recovery.helpers'
import { useScheduleHttpFixture } from './local-server.connector-schedules.http-fixture'

describe('local server connector schedule delayed recovery and reconciliation', () => {
  const fixture = useScheduleHttpFixture()

  it('reuses an admitted queued occurrence after later nominals become due instead of deferring forever', async () => {
    const workspaceId = 'schedule-delayed-due-ws'
    const pgliteDataPath = fixture.createPgliteDataPath()
    let clock = new Date('2026-07-11T12:00:00.000Z')
    const initialDatabase = await openScheduleDatabase(pgliteDataPath)

    const { created } = await seedHourlyScheduleWorkspace({
      workspaceId,
      database: initialDatabase.database,
      pgliteDataPath,
      now: () => clock,
    })
    expect(created.nextEligibleAt).toBe('2026-07-11T13:00:00.000Z')

    clock = new Date('2026-07-11T13:00:00.000Z')
    const admittedOnly = await admitScheduleDueOnly({
      database: initialDatabase.database,
      now: () => clock,
      expectedRevision: created.revision,
    })
    expect(admittedOnly).toMatchObject({
      occurrence: {
        nominalAt: '2026-07-11T13:00:00.000Z',
        outcome: 'admitted',
      },
      run: { status: 'queued', mode: 'scheduled' },
    })

    await initialDatabase.close()
    const reopenedDatabase = await openScheduleDatabase(pgliteDataPath)
    const reopened = await createReopenedScheduleClient({
      workspaceId,
      database: reopenedDatabase.database,
      pgliteDataPath,
      now: () => clock,
    })

    clock = new Date('2026-07-11T14:05:00.000Z')
    const { workspace: httpClient } = await fixture.startWorkspaceServer({
      client: reopened.client,
      workspaceId,
    })

    const recovered = await httpClient.connectors.schedules.dispatchDue({
      connectorInstanceId: CONNECTOR_INSTANCE_ID,
      expectedRevision: created.revision,
    })
    expect(recovered).toMatchObject({
      status: 'admitted',
      occurrence: {
        id: admittedOnly.occurrence.id,
        nominalAt: '2026-07-11T13:00:00.000Z',
        outcome: 'completed',
        connectorRunId: admittedOnly.run.id,
      },
      run: {
        id: admittedOnly.run.id,
        status: 'completed',
        mode: 'scheduled',
      },
    })
    expect(reopened.refreshCalls).toBe(1)

    const afterFirst = await httpClient.connectors.runs.list({
      connectorInstanceId: CONNECTOR_INSTANCE_ID,
      limit: 10,
      offset: 0,
    })
    expect(afterFirst.total).toBe(1)

    const repeated = await httpClient.connectors.schedules.dispatchDue({
      connectorInstanceId: CONNECTOR_INSTANCE_ID,
      expectedRevision: created.revision,
    })
    expect(repeated).toMatchObject({
      status: 'admitted',
      occurrence: {
        nominalAt: '2026-07-11T14:00:00.000Z',
        outcome: 'completed',
        admittedMode: 'scheduled',
      },
      run: {
        status: 'completed',
        mode: 'scheduled',
      },
    })
    if (repeated.status !== 'admitted') {
      throw new Error('expected subsequent due admission')
    }
    expect(repeated.occurrence.id).not.toBe(admittedOnly.occurrence.id)
    expect(repeated.run.id).not.toBe(admittedOnly.run.id)
    expect(reopened.refreshCalls).toBe(2)

    const third = await httpClient.connectors.schedules.dispatchDue({
      connectorInstanceId: CONNECTOR_INSTANCE_ID,
      expectedRevision: created.revision,
    })
    expect(third).toEqual(repeated)
    expect(reopened.refreshCalls).toBe(2)

    const history = await httpClient.connectors.schedules.listOccurrences({
      connectorInstanceId: CONNECTOR_INSTANCE_ID,
      limit: 10,
      offset: 0,
    })
    expect(history.total).toBe(2)
    expect(history.items).toEqual([
      expect.objectContaining({
        id: repeated.occurrence.id,
        outcome: 'completed',
        nominalAt: '2026-07-11T14:00:00.000Z',
      }),
      expect.objectContaining({
        id: admittedOnly.occurrence.id,
        outcome: 'completed',
        nominalAt: '2026-07-11T13:00:00.000Z',
      }),
    ])
  })

  it('reconciles a cancelled interrupted schedule run occurrence and admits the next due after reopen', async () => {
    const workspaceId = 'schedule-delayed-running-cancel-ws'
    const pgliteDataPath = fixture.createPgliteDataPath()
    let clock = new Date('2026-07-11T12:00:00.000Z')
    const initialDatabase = await openScheduleDatabase(pgliteDataPath)

    const { created } = await seedHourlyScheduleWorkspace({
      workspaceId,
      database: initialDatabase.database,
      pgliteDataPath,
      now: () => clock,
    })

    clock = new Date('2026-07-11T13:00:00.000Z')
    const admittedOnly = await admitScheduleDueOnly({
      database: initialDatabase.database,
      now: () => clock,
      expectedRevision: created.revision,
    })
    const claim = await createPgliteConnectorRepository(initialDatabase.database).claimQueuedRunToRunning({
      connectorRunId: admittedOnly.run.id,
      startedAt: clock.toISOString(),
    })
    expect(claim.claimed).toBe(true)
    await initialDatabase.close()

    const reopenedDatabase = await openScheduleDatabase(pgliteDataPath)
    const reopened = await createReopenedScheduleClient({
      workspaceId,
      database: reopenedDatabase.database,
      pgliteDataPath,
      now: () => clock,
    })

    const cancelledRuns = await reopened.client.connectors.runs.list({
      connectorInstanceId: CONNECTOR_INSTANCE_ID,
      limit: 10,
      offset: 0,
    })
    expect(cancelledRuns.items[0]).toMatchObject({
      id: admittedOnly.run.id,
      status: 'cancelled',
    })

    const cancelledHistory = await reopened.client.connectors.schedules.listOccurrences({
      connectorInstanceId: CONNECTOR_INSTANCE_ID,
      limit: 10,
      offset: 0,
    })
    expect(cancelledHistory.items[0]).toMatchObject({
      id: admittedOnly.occurrence.id,
      outcome: 'cancelled',
      connectorRunId: admittedOnly.run.id,
    })

    clock = new Date('2026-07-11T14:05:00.000Z')
    const { workspace: httpClient } = await fixture.startWorkspaceServer({
      client: reopened.client,
      workspaceId,
    })

    const nextDue = await httpClient.connectors.schedules.dispatchDue({
      connectorInstanceId: CONNECTOR_INSTANCE_ID,
      expectedRevision: created.revision,
    })
    expect(nextDue).toMatchObject({
      status: 'admitted',
      occurrence: {
        nominalAt: '2026-07-11T14:00:00.000Z',
        outcome: 'completed',
        admittedMode: 'scheduled',
      },
      run: {
        status: 'completed',
        mode: 'scheduled',
      },
    })
    if (nextDue.status !== 'admitted') {
      throw new Error('expected next due admission')
    }
    expect(nextDue.occurrence.id).not.toBe(admittedOnly.occurrence.id)
    expect(nextDue.run.id).not.toBe(admittedOnly.run.id)
    expect(reopened.refreshCalls).toBe(1)

    const history = await httpClient.connectors.schedules.listOccurrences({
      connectorInstanceId: CONNECTOR_INSTANCE_ID,
      limit: 10,
      offset: 0,
    })
    expect(history.total).toBe(2)
    expect(history.items).toEqual([
      expect.objectContaining({
        id: nextDue.occurrence.id,
        outcome: 'completed',
        nominalAt: '2026-07-11T14:00:00.000Z',
      }),
      expect.objectContaining({
        id: admittedOnly.occurrence.id,
        outcome: 'cancelled',
        nominalAt: '2026-07-11T13:00:00.000Z',
      }),
    ])
    expect(history.items.some((item) => item.outcome === 'admitted')).toBe(false)
  })

  it('reuses an admitted queued occurrence after a revision-changing pause/resume instead of deferring forever', async () => {
    const workspaceId = 'schedule-delayed-revision-ws'
    const pgliteDataPath = fixture.createPgliteDataPath()
    let clock = new Date('2026-07-11T12:00:00.000Z')
    const initialDatabase = await openScheduleDatabase(pgliteDataPath)

    const { created } = await seedHourlyScheduleWorkspace({
      workspaceId,
      database: initialDatabase.database,
      pgliteDataPath,
      now: () => clock,
    })

    clock = new Date('2026-07-11T13:00:00.000Z')
    const admittedOnly = await admitScheduleDueOnly({
      database: initialDatabase.database,
      now: () => clock,
      expectedRevision: created.revision,
    })
    expect(admittedOnly.occurrence.scheduleRevision).toBe(created.revision)

    await initialDatabase.close()
    const reopenedDatabase = await openScheduleDatabase(pgliteDataPath)
    const reopened = await createReopenedScheduleClient({
      workspaceId,
      database: reopenedDatabase.database,
      pgliteDataPath,
      now: () => clock,
    })

    const preserved = await reopened.client.connectors.runs.list({
      connectorInstanceId: CONNECTOR_INSTANCE_ID,
      limit: 10,
      offset: 0,
    })
    expect(preserved.items[0]).toMatchObject({
      id: admittedOnly.run.id,
      status: 'queued',
    })

    clock = new Date('2026-07-11T13:05:00.000Z')
    const { workspace: httpClient } = await fixture.startWorkspaceServer({
      client: reopened.client,
      workspaceId,
    })

    const paused = await httpClient.connectors.schedules.pause({
      connectorInstanceId: CONNECTOR_INSTANCE_ID,
      expectedRevision: created.revision,
    })
    expect(paused.revision).not.toBe(created.revision)
    expect(paused.state).toBe('paused')

    const whilePaused = await httpClient.connectors.schedules.dispatchDue({
      connectorInstanceId: CONNECTOR_INSTANCE_ID,
      expectedRevision: paused.revision,
    })
    expect(whilePaused).toEqual({ status: 'paused' })
    expect(reopened.refreshCalls).toBe(0)

    const resumed = await httpClient.connectors.schedules.resume({
      connectorInstanceId: CONNECTOR_INSTANCE_ID,
      expectedRevision: paused.revision,
    })
    expect(resumed.revision).not.toBe(paused.revision)
    expect(resumed.state).toBe('enabled')
    expect(resumed.revision).not.toBe(admittedOnly.occurrence.scheduleRevision)

    clock = new Date('2026-07-11T14:10:00.000Z')
    const recovered = await httpClient.connectors.schedules.dispatchDue({
      connectorInstanceId: CONNECTOR_INSTANCE_ID,
      expectedRevision: resumed.revision,
    })
    expect(recovered).toMatchObject({
      status: 'admitted',
      occurrence: {
        id: admittedOnly.occurrence.id,
        scheduleRevision: created.revision,
        nominalAt: '2026-07-11T13:00:00.000Z',
        outcome: 'completed',
        connectorRunId: admittedOnly.run.id,
      },
      run: {
        id: admittedOnly.run.id,
        status: 'completed',
        mode: 'scheduled',
      },
    })
    expect(reopened.refreshCalls).toBe(1)

    const afterFirst = await httpClient.connectors.runs.list({
      connectorInstanceId: CONNECTOR_INSTANCE_ID,
      limit: 10,
      offset: 0,
    })
    expect(afterFirst.total).toBe(1)

    const later = await httpClient.connectors.schedules.dispatchDue({
      connectorInstanceId: CONNECTOR_INSTANCE_ID,
      expectedRevision: resumed.revision,
    })
    expect(later).toMatchObject({
      status: 'admitted',
      occurrence: {
        scheduleRevision: resumed.revision,
        outcome: 'completed',
        admittedMode: 'scheduled',
      },
      run: {
        status: 'completed',
        mode: 'scheduled',
      },
    })
    if (later.status !== 'admitted') {
      throw new Error('expected later due admission under current revision')
    }
    expect(later.occurrence.id).not.toBe(admittedOnly.occurrence.id)
    expect(later.run.id).not.toBe(admittedOnly.run.id)
    expect(later.occurrence.nominalAt).not.toBe('2026-07-11T13:00:00.000Z')
    expect(reopened.refreshCalls).toBe(2)

    const third = await httpClient.connectors.schedules.dispatchDue({
      connectorInstanceId: CONNECTOR_INSTANCE_ID,
      expectedRevision: resumed.revision,
    })
    expect(third).toEqual(later)
    expect(reopened.refreshCalls).toBe(2)
  })

  it('repairs an admitted occurrence whose linked run is already terminal across reopen before later dispatch', async () => {
    const workspaceId = 'schedule-delayed-stale-terminal-ws'
    const pgliteDataPath = fixture.createPgliteDataPath()
    let clock = new Date('2026-07-11T12:00:00.000Z')
    const initialDatabase = await openScheduleDatabase(pgliteDataPath)

    const { created } = await seedHourlyScheduleWorkspace({
      workspaceId,
      database: initialDatabase.database,
      pgliteDataPath,
      now: () => clock,
    })

    clock = new Date('2026-07-11T13:00:00.000Z')
    const admittedOnly = await admitScheduleDueOnly({
      database: initialDatabase.database,
      now: () => clock,
      expectedRevision: created.revision,
    })

    const repository = createPgliteConnectorRepository(initialDatabase.database)
    const claim = await repository.claimQueuedRunToRunning({
      connectorRunId: admittedOnly.run.id,
      startedAt: clock.toISOString(),
    })
    expect(claim.claimed).toBe(true)
    await repository.markRunFailed({
      connectorRunId: admittedOnly.run.id,
      completedAt: clock.toISOString(),
      retryHints: null,
      warning: {
        code: 'connector.execution_failed',
        message: 'Connector execution failed.',
      },
    })
    await initialDatabase.close()

    const reopenedDatabase = await openScheduleDatabase(pgliteDataPath)
    const reopened = await createReopenedScheduleClient({
      workspaceId,
      database: reopenedDatabase.database,
      pgliteDataPath,
      now: () => clock,
    })

    const repairedHistory = await reopened.client.connectors.schedules.listOccurrences({
      connectorInstanceId: CONNECTOR_INSTANCE_ID,
      limit: 10,
      offset: 0,
    })
    expect(repairedHistory.items[0]).toMatchObject({
      id: admittedOnly.occurrence.id,
      outcome: 'failed',
      connectorRunId: admittedOnly.run.id,
      nominalAt: '2026-07-11T13:00:00.000Z',
    })
    expect(repairedHistory.items.some((item) => item.outcome === 'admitted')).toBe(false)

    const terminalRuns = await reopened.client.connectors.runs.list({
      connectorInstanceId: CONNECTOR_INSTANCE_ID,
      limit: 10,
      offset: 0,
    })
    expect(terminalRuns.items[0]).toMatchObject({
      id: admittedOnly.run.id,
      status: 'failed',
    })

    clock = new Date('2026-07-11T14:05:00.000Z')
    const { workspace: httpClient } = await fixture.startWorkspaceServer({
      client: reopened.client,
      workspaceId,
    })

    const later = await httpClient.connectors.schedules.dispatchDue({
      connectorInstanceId: CONNECTOR_INSTANCE_ID,
      expectedRevision: created.revision,
    })
    expect(later).toMatchObject({
      status: 'admitted',
      occurrence: {
        nominalAt: '2026-07-11T14:00:00.000Z',
        outcome: 'completed',
        admittedMode: 'scheduled',
      },
      run: {
        status: 'completed',
        mode: 'scheduled',
      },
    })
    if (later.status !== 'admitted') {
      throw new Error('expected later due admission')
    }
    expect(later.occurrence.id).not.toBe(admittedOnly.occurrence.id)
    expect(later.run.id).not.toBe(admittedOnly.run.id)
    expect(reopened.refreshCalls).toBe(1)

    const history = await httpClient.connectors.schedules.listOccurrences({
      connectorInstanceId: CONNECTOR_INSTANCE_ID,
      limit: 10,
      offset: 0,
    })
    expect(history.total).toBe(2)
    expect(history.items).toEqual([
      expect.objectContaining({
        id: later.occurrence.id,
        outcome: 'completed',
        nominalAt: '2026-07-11T14:00:00.000Z',
      }),
      expect.objectContaining({
        id: admittedOnly.occurrence.id,
        outcome: 'failed',
        nominalAt: '2026-07-11T13:00:00.000Z',
      }),
    ])
  })

  it('reconciles a same-process admitted occurrence linked to a terminal run before admitting later due work', async () => {
    const workspaceId = 'schedule-delayed-same-process-terminal-ws'
    const pgliteDataPath = fixture.createPgliteDataPath()
    let clock = new Date('2026-07-11T12:00:00.000Z')
    const databaseOwner = await openScheduleDatabase(pgliteDataPath)

    const { created, client } = await seedHourlyScheduleWorkspace({
      workspaceId,
      database: databaseOwner.database,
      pgliteDataPath,
      now: () => clock,
    })

    clock = new Date('2026-07-11T13:00:00.000Z')
    const admittedOnly = await admitScheduleDueOnly({
      database: databaseOwner.database,
      now: () => clock,
      expectedRevision: created.revision,
    })

    const repository = createPgliteConnectorRepository(databaseOwner.database)
    const claim = await repository.claimQueuedRunToRunning({
      connectorRunId: admittedOnly.run.id,
      startedAt: clock.toISOString(),
    })
    expect(claim.claimed).toBe(true)
    await repository.markRunFailed({
      connectorRunId: admittedOnly.run.id,
      completedAt: clock.toISOString(),
      retryHints: null,
      warning: {
        code: 'connector.execution_failed',
        message: 'Connector execution failed.',
      },
    })

    // Same process: no reopen/recovery. Dispatch must self-heal the stale admitted row.
    const { workspace: httpClient } = await fixture.startWorkspaceServer({
      client,
      workspaceId,
    })

    const staleBefore = await httpClient.connectors.schedules.listOccurrences({
      connectorInstanceId: CONNECTOR_INSTANCE_ID,
      limit: 10,
      offset: 0,
    })
    expect(staleBefore.items[0]).toMatchObject({
      id: admittedOnly.occurrence.id,
      outcome: 'admitted',
    })

    clock = new Date('2026-07-11T14:05:00.000Z')
    const healed = await httpClient.connectors.schedules.dispatchDue({
      connectorInstanceId: CONNECTOR_INSTANCE_ID,
      expectedRevision: created.revision,
    })
    expect(healed).toMatchObject({
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

    const afterHeal = await httpClient.connectors.schedules.listOccurrences({
      connectorInstanceId: CONNECTOR_INSTANCE_ID,
      limit: 10,
      offset: 0,
    })
    expect(afterHeal.items[0]).toMatchObject({
      id: admittedOnly.occurrence.id,
      outcome: 'failed',
    })

    const later = await httpClient.connectors.schedules.dispatchDue({
      connectorInstanceId: CONNECTOR_INSTANCE_ID,
      expectedRevision: created.revision,
    })
    expect(later).toMatchObject({
      status: 'admitted',
      occurrence: {
        nominalAt: '2026-07-11T14:00:00.000Z',
        outcome: 'completed',
      },
      run: { status: 'completed', mode: 'scheduled' },
    })
    if (later.status !== 'admitted') {
      throw new Error('expected later due admission')
    }
    expect(later.occurrence.id).not.toBe(admittedOnly.occurrence.id)
    expect(later.run.id).not.toBe(admittedOnly.run.id)
  })
})
