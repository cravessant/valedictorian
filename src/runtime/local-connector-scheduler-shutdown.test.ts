import { describe, expect, it } from 'vitest'
import { completedConnectorRefreshContract } from '../modules/connectors/connector-refresh-result.test-helpers'
import type { AppJobConnector } from '../modules/connectors/connector.runner'
import {
  availableConnectorSchedulingCapability,
  createLocalValedictorianClient,
  createScheduleHttpTempDatabasePath,
  createStaticConnectorRegistry,
} from '../server/local-server.connector-schedules.http-fixture'
import { createLocalScheduler } from './local-scheduler'

describe('local connector scheduler shutdown', () => {
  it('propagates scheduler cancellation into an active connector runtime', async () => {
    let clock = new Date('2026-07-15T12:00:00.000Z')
    const scheduler = createLocalScheduler({ now: () => clock })
    let receivedSignal: AbortSignal | undefined
    let releaseWithoutSignal: (() => void) | undefined
    let announceRefresh: (() => void) | undefined
    const refreshStarted = new Promise<void>((resolve) => {
      announceRefresh = resolve
    })
    const connector: AppJobConnector = {
      definition: { id: 'fixture.jobs', version: '0.0.0-fixture' },
      async refresh(input, runtime) {
        receivedSignal = runtime.cancellation?.signal
        announceRefresh?.()
        await new Promise<void>((resolve) => {
          releaseWithoutSignal = resolve
          receivedSignal?.addEventListener('abort', () => resolve(), { once: true })
        })
        const base = completedConnectorRefreshContract(input.coverage.start.slice(0, 10))
        return {
          ...base,
          coverage: input.coverage,
          nextCheckpoint: { checkpoint: {}, schemaVersion: 'fixture-checkpoint@1' },
          observations: [],
          operationOutcome: null,
          status: receivedSignal?.aborted ? 'cancelled' : 'completed',
          stats: { observations: 0 },
          synchronization: receivedSignal?.aborted
            ? {
                newestFrontier: { state: 'advancing' as const },
                historicalBackfill: {
                  state: 'advancing' as const,
                  boundary: { earliestDate: input.coverage.start.slice(0, 10) },
                },
                pendingResolutionCount: 0,
                outcome: { kind: 'cancelled' as const, reason: 'scheduler_shutdown' },
              }
            : base.synchronization,
          warnings: [],
        }
      },
    }
    const client = createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([connector]),
      connectorScheduling: availableConnectorSchedulingCapability,
      now: () => clock,
      onScheduledWorkChanged: () => scheduler.signal(),
      registerScheduledWorkSource: (source) => scheduler.register(source),
      seedDataMode: 'none',
      pgliteDataPath: createScheduleHttpTempDatabasePath(),
      workspaceId: 'scheduler-shutdown-workspace',
    })
    await client.connectors.create({
      id: 'scheduler-shutdown-connector',
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      displayName: 'Scheduler shutdown connector',
      enabled: true,
    })
    const schedule = await client.connectors.schedules.upsert({
      connectorInstanceId: 'scheduler-shutdown-connector',
      expectedRevision: null,
      state: 'enabled',
      cadence: { kind: 'interval', everyMinutes: 15 },
      timezone: 'UTC',
    })

    clock = new Date(schedule.nextEligibleAt)
    scheduler.start()
    await refreshStarted
    if (!receivedSignal) releaseWithoutSignal?.()

    await scheduler.stop()

    expect(receivedSignal).toBeDefined()
    expect(receivedSignal?.aborted).toBe(true)
  })
})
