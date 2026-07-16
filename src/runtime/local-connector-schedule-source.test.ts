import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ConnectorScheduleSummary, ConnectorSchedulingCapability } from 'sparxie'
import { createLocalValedictorianClient } from './local-valedictorian-client'
import { createLocalScheduler, type LocalScheduledWorkSource } from './local-scheduler'
import type { AppJobConnector } from '../modules/connectors/connector.runner'
import { completedConnectorRefreshContract } from '../modules/connectors/connector-refresh-result.test-helpers'
import { createConnectorScheduleWorkSource } from '../modules/connectors/connector-schedule.source'

const availableSchedulingCapability: Extract<ConnectorSchedulingCapability, { available: true }> = {
  available: true,
  supportedCadences: ['interval', 'daily', 'weekly'],
  minimumIntervalMinutes: 15,
  maximumCatchUpAgeMinutes: 24 * 60,
  timezoneModel: 'iana',
  missedOccurrencePolicy: 'coalesce_one',
}

describe('local connector schedule source', () => {
  it('waits for an active dispatch to settle without starting later due work after shutdown', async () => {
    let now = new Date('2026-07-15T12:00:00.000Z')
    const timers: Array<() => void> = []
    const dispatches: string[] = []
    let markFirstStarted: (() => void) | undefined
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve
    })
    let releaseFirst: (() => void) | undefined
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const schedules = [
      createScheduleSummary('first-due-connector', '2026-07-15T12:01:00.000Z'),
      createScheduleSummary('second-due-connector', '2026-07-15T12:01:00.000Z'),
    ]
    const source = createConnectorScheduleWorkSource({
      dispatchDue: async ({ connectorInstanceId }) => {
        dispatches.push(connectorInstanceId)
        if (connectorInstanceId === 'first-due-connector') {
          markFirstStarted?.()
          await firstGate
        }
        return { status: 'connector_disabled' }
      },
      listSchedules: () => schedules,
      now: () => now,
    })
    const scheduler = createLocalScheduler({
      now: () => now,
      setTimeout(callback) {
        timers.push(callback)
        return timers.length - 1
      },
      clearTimeout() {
        // stale callbacks are rejected by the scheduler generation guard
      },
    })
    scheduler.register(source)
    scheduler.start()
    await scheduler.whenIdle()

    expect(timers).toHaveLength(1)
    now = new Date('2026-07-15T12:01:00.000Z')
    timers[0]?.()
    await firstStarted

    let stopped = false
    const stopPromise = Promise.resolve(scheduler.stop()).then(() => {
      stopped = true
    })
    await Promise.resolve()
    expect(stopped).toBe(false)

    releaseFirst?.()
    await stopPromise
    await scheduler.whenIdle()
    timers[0]?.()

    expect(dispatches).toEqual(['first-due-connector'])
  })

  it('does not re-block due work when a signal arrives during deferred dispatch', async () => {
    const schedule = createScheduleSummary(
      'deferred-signal-connector',
      '2026-07-15T12:00:00.000Z',
    )
    let markDispatchStarted: (() => void) | undefined
    const dispatchStarted = new Promise<void>((resolve) => {
      markDispatchStarted = resolve
    })
    let releaseDispatch: (() => void) | undefined
    const dispatchGate = new Promise<void>((resolve) => {
      releaseDispatch = resolve
    })
    const source = createConnectorScheduleWorkSource({
      dispatchDue: async () => {
        markDispatchStarted?.()
        await dispatchGate
        return { status: 'deferred_active', activeRunId: 'active-run' }
      },
      listSchedules: () => [schedule],
      now: () => new Date('2026-07-15T12:00:00.000Z'),
    })

    const runPromise = source.runDue()
    await dispatchStarted
    source.onSignal?.()
    releaseDispatch?.()
    await runPromise

    await expect(source.nextDueAt()).resolves.toBe(schedule.nextEligibleAt)
  })

  it('discovers and executes a due persisted connector schedule through the existing dispatch path', async () => {
    const sqlitePath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-scheduler-source-')),
      'valedictorian.sqlite',
    )
    let clock = new Date('2026-07-15T11:00:00.000Z')
    let refreshCalls = 0
    let source: LocalScheduledWorkSource | undefined
    const client = createLocalValedictorianClient({
      connectorRegistry: {
        get(connectorId) {
          return connectorId === 'fixture.jobs' ? fixtureConnector(() => { refreshCalls += 1 }) : null
        },
      },
      connectorScheduling: availableSchedulingCapability,
      now: () => clock,
      registerScheduledWorkSource(candidate) {
        if (candidate.id === 'connector-schedules') source = candidate
      },
      seedDataMode: 'none',
      sqlitePath,
      workspaceId: 'scheduler-source-workspace',
    })

    await client.connectors.create({
      id: 'scheduler-source-connector',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture jobs',
      enabled: true,
    })
    const schedule = await client.connectors.schedules.upsert({
      connectorInstanceId: 'scheduler-source-connector',
      expectedRevision: null,
      state: 'enabled',
      cadence: { kind: 'interval', everyMinutes: 15 },
      timezone: 'UTC',
    })

    expect(source).toBeDefined()
    clock = new Date(schedule.nextEligibleAt)
    await source!.runDue()

    expect(refreshCalls).toBe(1)
  })

  it('retries a due schedule after a concurrent manual run releases the single-flight guard', async () => {
    const sqlitePath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-scheduler-collision-')),
      'valedictorian.sqlite',
    )
    let clock = new Date('2026-07-15T11:00:00.000Z')
    let refreshCalls = 0
    let releaseManual: (() => void) | undefined
    let markManualStarted: (() => void) | undefined
    const manualStarted = new Promise<void>((resolve) => {
      markManualStarted = resolve
    })
    const manualGate = new Promise<void>((resolve) => {
      releaseManual = resolve
    })
    const timers: Array<() => void> = []
    const scheduler = createLocalScheduler({
      now: () => clock,
      setTimeout(callback) {
        timers.push(callback)
        return timers.length - 1
      },
      clearTimeout() {
        // no-op deterministic timer cancellation
      },
    })
    let source: LocalScheduledWorkSource | undefined
    const client = createLocalValedictorianClient({
      connectorRegistry: {
        get(connectorId) {
          return connectorId === 'fixture.jobs'
            ? fixtureConnector(async () => {
              refreshCalls += 1
              if (refreshCalls === 1) {
                markManualStarted?.()
                await manualGate
              }
            })
            : null
        },
      },
      connectorScheduling: availableSchedulingCapability,
      now: () => clock,
      onScheduledWorkChanged: () => scheduler.signal(),
      registerScheduledWorkSource(candidate) {
        source = candidate
        scheduler.register(candidate)
      },
      seedDataMode: 'none',
      sqlitePath,
      workspaceId: 'scheduler-collision-workspace',
    })

    await client.connectors.create({
      id: 'scheduler-collision-connector',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture jobs',
      enabled: true,
    })
    const schedule = await client.connectors.schedules.upsert({
      connectorInstanceId: 'scheduler-collision-connector',
      expectedRevision: null,
      state: 'enabled',
      cadence: { kind: 'interval', everyMinutes: 15 },
      timezone: 'UTC',
    })
    clock = new Date(schedule.nextEligibleAt)

    const manualRun = client.connectors.runs.trigger({
      connectorInstanceId: 'scheduler-collision-connector',
      mode: 'manual',
    })
    await manualStarted
    scheduler.start()
    await scheduler.whenIdle()
    expect(refreshCalls).toBe(1)

    releaseManual?.()
    await manualRun
    await scheduler.whenIdle()

    expect(source).toBeDefined()
    expect(refreshCalls).toBe(2)
  })

  it('wakes blocked due work when a disabled connector is re-enabled', async () => {
    const sqlitePath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-scheduler-reenable-')),
      'valedictorian.sqlite',
    )
    let clock = new Date('2026-07-15T11:00:00.000Z')
    let refreshCalls = 0
    const scheduler = createLocalScheduler({ now: () => clock })
    const client = createLocalValedictorianClient({
      connectorRegistry: {
        get(connectorId) {
          return connectorId === 'fixture.jobs'
            ? fixtureConnector(() => { refreshCalls += 1 })
            : null
        },
      },
      connectorScheduling: availableSchedulingCapability,
      now: () => clock,
      onScheduledWorkChanged: () => scheduler.signal(),
      registerScheduledWorkSource: (candidate) => scheduler.register(candidate),
      seedDataMode: 'none',
      sqlitePath,
      workspaceId: 'scheduler-reenable-workspace',
    })

    await client.connectors.create({
      id: 'scheduler-reenable-connector',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture jobs',
      enabled: true,
    })
    const schedule = await client.connectors.schedules.upsert({
      connectorInstanceId: 'scheduler-reenable-connector',
      expectedRevision: null,
      state: 'enabled',
      cadence: { kind: 'interval', everyMinutes: 15 },
      timezone: 'UTC',
    })
    clock = new Date(schedule.nextEligibleAt)
    await client.connectors.update({
      connectorInstanceId: 'scheduler-reenable-connector',
      enabled: false,
    })

    scheduler.start()
    await scheduler.whenIdle()
    expect(refreshCalls).toBe(0)

    await client.connectors.update({
      connectorInstanceId: 'scheduler-reenable-connector',
      enabled: true,
    })
    await scheduler.whenIdle()

    expect(refreshCalls).toBe(1)
  })

  it('coalesces missed cadence intervals into one catch-up run after reopening', async () => {
    const sqlitePath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-scheduler-reopen-')),
      'valedictorian.sqlite',
    )
    let clock = new Date('2026-07-15T11:00:00.000Z')
    let refreshCalls = 0
    const connectorRegistry = {
      get(connectorId: string) {
        return connectorId === 'fixture.jobs'
          ? fixtureConnector(() => { refreshCalls += 1 })
          : null
      },
    }
    const initialClient = createLocalValedictorianClient({
      connectorRegistry,
      connectorScheduling: availableSchedulingCapability,
      now: () => clock,
      seedDataMode: 'none',
      sqlitePath,
      workspaceId: 'scheduler-reopen-workspace',
    })

    await initialClient.connectors.create({
      id: 'scheduler-reopen-connector',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture jobs',
      enabled: true,
    })
    const schedule = await initialClient.connectors.schedules.upsert({
      connectorInstanceId: 'scheduler-reopen-connector',
      expectedRevision: null,
      state: 'enabled',
      cadence: { kind: 'interval', everyMinutes: 15 },
      timezone: 'UTC',
    })
    expect(schedule.nextEligibleAt).toBe('2026-07-15T11:15:00.000Z')

    // The app remains closed while several configured intervals elapse.
    clock = new Date('2026-07-15T12:01:00.000Z')
    const scheduler = createLocalScheduler({ now: () => clock })
    const reopenedClient = createLocalValedictorianClient({
      connectorRegistry,
      connectorScheduling: availableSchedulingCapability,
      now: () => clock,
      onScheduledWorkChanged: () => scheduler.signal(),
      registerScheduledWorkSource: (candidate) => scheduler.register(candidate),
      seedDataMode: 'none',
      sqlitePath,
      workspaceId: 'scheduler-reopen-workspace',
    })

    scheduler.start()
    await scheduler.whenIdle()

    expect(refreshCalls).toBe(1)
    const runs = await reopenedClient.connectors.runs.list({
      connectorInstanceId: 'scheduler-reopen-connector',
      mode: 'catch_up',
    })
    expect(runs.items).toHaveLength(1)
    expect(runs.items[0]).toMatchObject({
      mode: 'catch_up',
      status: 'completed',
    })
    const occurrences = await reopenedClient.connectors.schedules.listOccurrences({
      connectorInstanceId: 'scheduler-reopen-connector',
      limit: 10,
      offset: 0,
    })
    expect(occurrences.items).toHaveLength(1)
    expect(occurrences.items[0]).toMatchObject({
      admittedMode: 'catch_up',
      outcome: 'completed',
    })
  })

  it('continues cadence after Capture backfill reaches the configured date without redoing checkpoint work', async () => {
    const sqlitePath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-scheduler-complete-')),
      'valedictorian.sqlite',
    )
    let clock = new Date('2026-07-15T11:00:00.000Z')
    let refreshCalls = 0
    const checkpoints: unknown[] = []
    const timers: Array<() => void> = []
    const scheduler = createLocalScheduler({
      now: () => clock,
      setTimeout(callback) {
        timers.push(callback)
        return timers.length - 1
      },
      clearTimeout() {
        // no-op deterministic timer cancellation
      },
    })
    const client = createLocalValedictorianClient({
      connectorRegistry: {
        get(connectorId) {
          if (connectorId !== 'fixture.jobs') return null
          return {
            definition: { id: 'fixture.jobs', version: '0.0.0-fixture' },
            async refresh(input, runtime) {
              refreshCalls += 1
              checkpoints.push(input.checkpoint)
              await runtime.rawSourceIntake?.capture({
                observedAt: clock.toISOString(),
                providerRecordId: `accepted-capture-${refreshCalls}`,
                providerSchema: 'fixture-provider@1',
                payload: {
                  companyName: `Captured company ${refreshCalls}`,
                  roleTitle: `Captured role ${refreshCalls}`,
                },
                evidence: [],
              })
              const complete = refreshCalls >= 2
              return {
                ...completedConnectorRefreshContract(input.coverage.start.slice(0, 10)),
                coverage: input.coverage,
                nextCheckpoint: {
                  checkpoint: { cursor: `cursor-${refreshCalls}` },
                  schemaVersion: 'fixture-checkpoint@1',
                },
                observations: [],
                stats: { observations: 0 },
                warnings: [],
                synchronization: {
                  newestFrontier: { state: complete ? 'caught_up' : 'advancing' },
                  historicalBackfill: {
                    state: complete ? 'boundary_reached' : 'advancing',
                    boundary: { earliestDate: input.coverage.start.slice(0, 10) },
                  },
                  pendingResolutionCount: complete ? 5 : 0,
                  outcome: complete
                    ? { kind: 'boundary_exhausted' }
                    : { kind: 'yielded', reason: 'invocation_budget' },
                },
              }
            },
          }
        },
      },
      connectorScheduling: availableSchedulingCapability,
      now: () => clock,
      onScheduledWorkChanged: () => scheduler.signal(),
      registerScheduledWorkSource: (candidate) => scheduler.register(candidate),
      seedDataMode: 'none',
      sqlitePath,
      workspaceId: 'scheduler-complete-workspace',
    })

    await client.connectors.create({
      id: 'scheduler-complete-connector',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture jobs',
      enabled: true,
      earliestBackfillDate: '2026-07-01',
    })
    const schedule = await client.connectors.schedules.upsert({
      connectorInstanceId: 'scheduler-complete-connector',
      expectedRevision: null,
      state: 'enabled',
      cadence: { kind: 'interval', everyMinutes: 15 },
      timezone: 'UTC',
    })
    clock = new Date(schedule.nextEligibleAt)
    scheduler.start()
    await scheduler.whenIdle()
    expect(refreshCalls).toBe(1)

    const afterRun = await client.connectors.schedules.get('scheduler-complete-connector')
    clock = new Date(afterRun!.nextEligibleAt)
    timers.at(-1)?.()
    await scheduler.whenIdle()
    expect(refreshCalls).toBe(2)

    const afterCompletion = await client.connectors.schedules.get('scheduler-complete-connector')
    clock = new Date(afterCompletion!.nextEligibleAt)
    timers.at(-1)?.()
    await scheduler.whenIdle()

    expect(refreshCalls).toBe(3)
    expect(checkpoints).toEqual([
      undefined,
      { cursor: 'cursor-1' },
      { cursor: 'cursor-2' },
    ])

    const runs = await client.connectors.runs.list({
      connectorInstanceId: 'scheduler-complete-connector',
      mode: 'scheduled',
    })
    expect(runs.items).toHaveLength(3)
    expect(runs.items[0]).toMatchObject({
      historicalBackfill: {
        state: 'boundary_reached',
        boundary: { earliestDate: '2026-07-01' },
      },
      outcome: { kind: 'boundary_exhausted' },
      pendingResolutionCount: 5,
    })
    expect(runs.items[1]).toMatchObject({
      historicalBackfill: {
        state: 'boundary_reached',
        boundary: { earliestDate: '2026-07-01' },
      },
      outcome: { kind: 'boundary_exhausted' },
      pendingResolutionCount: 5,
    })
    expect(runs.items[2]).toMatchObject({
      historicalBackfill: { state: 'advancing' },
      outcome: { kind: 'yielded', reason: 'invocation_budget' },
    })

    const persistedCheckpoints = await client.connectors.checkpoints.list({
      connectorInstanceId: 'scheduler-complete-connector',
    })
    expect(persistedCheckpoints.items).toHaveLength(1)
    expect(persistedCheckpoints.items[0]?.checkpoint).toEqual({ cursor: 'cursor-3' })

    const acceptedCaptures = await client.sourcing.rawRecords.list({
      connectorInstanceId: 'scheduler-complete-connector',
      limit: 10,
    })
    expect(acceptedCaptures.items).toHaveLength(3)
    expect(acceptedCaptures.items.map(({ providerRecordId }) => providerRecordId)
      .sort((left, right) => left.localeCompare(right))).toEqual([
      'accepted-capture-1',
      'accepted-capture-2',
      'accepted-capture-3',
    ])
  })
})

function createScheduleSummary(
  connectorInstanceId: string,
  nextEligibleAt: string,
): ConnectorScheduleSummary {
  return {
    id: `${connectorInstanceId}-schedule`,
    connectorInstanceId,
    revision: `${connectorInstanceId}-revision`,
    state: 'enabled',
    cadence: { kind: 'interval', everyMinutes: 15 },
    timezone: 'UTC',
    nextEligibleAt,
    createdAt: '2026-07-15T11:00:00.000Z',
    updatedAt: '2026-07-15T11:00:00.000Z',
    lastOccurrence: null,
    lastRun: null,
  }
}

function fixtureConnector(onRefresh: () => void | Promise<void>): AppJobConnector {
  return {
    definition: {
      id: 'fixture.jobs',
      version: '0.0.0-fixture',
    },
    async refresh(input) {
      await onRefresh()
      return {
        ...completedConnectorRefreshContract(input.coverage.start.slice(0, 10)),
        coverage: input.coverage,
        nextCheckpoint: {
          checkpoint: { cursor: input.coverage.end },
          schemaVersion: 'fixture-checkpoint@1',
        },
        observations: [],
        stats: { observations: 0 },
        warnings: [],
      }
    },
  }
}
