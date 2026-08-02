import { describe, expect, it } from 'vitest'
import { completedConnectorRefreshContract } from '@sparxie/valedictorian-local-runtime/testing/modules/connectors/public/connector.refresh-result.test-helpers'
import type { AppJobConnector } from '@sparxie/valedictorian-local-runtime/testing/modules/connectors/ports/connector.runner-contracts'
import {
  availableConnectorSchedulingCapability,
  createScheduleHttpTempDatabasePath,
  createStaticConnectorRegistry,
} from '../server/local-server.connector-schedules.http-fixture'
import { createTestLocalValedictorianClient as createLocalValedictorianClient } from './local-valedictorian-client.test-harness'
import { createLocalScheduler } from '@sparxie/valedictorian-local-runtime/runtime'

describe('local connector capture retry scheduling', () => {
  it('wakes for durable provider-fetch retry work before the next connector cadence', async () => {
    let clock = new Date('2026-07-15T12:00:00.000Z')
    const timers: Array<{ callback: () => void; delayMs: number }> = []
    const scheduler = createLocalScheduler({
      now: () => clock,
      setTimeout(callback, delayMs) {
        timers.push({ callback, delayMs })
        return timers.length - 1
      },
      clearTimeout() {
        // no-op deterministic timer cancellation
      },
    })
    let refreshCalls = 0
    const connector: AppJobConnector = {
      definition: { id: 'fixture.jobs', version: '0.0.0-fixture' },
      async refresh(input) {
        refreshCalls += 1
        const base = {
          ...completedConnectorRefreshContract(input.coverage.start.slice(0, 10)),
          coverage: input.coverage,
          nextCheckpoint: {
            checkpoint: { refreshCalls },
            schemaVersion: 'fixture-checkpoint@1',
          },
          observations: [],
          stats: { observations: 0 },
          warnings: [],
        }
        if (refreshCalls > 1) return base
        return {
          ...base,
          retryHints: {
            state: 'scheduled' as const,
            reason: 'operation_timeout' as const,
            attempt: 1,
            maxAttempts: 3,
            lastAttemptAt: clock.toISOString(),
            computedDelayMs: 60_000,
            serverMinimumDelayMs: null,
            nextAttemptAt: '2026-07-15T12:16:00.000Z',
            horizonAt: '2026-07-15T13:15:00.000Z',
          },
          synchronization: {
            newestFrontier: { state: 'advancing' as const },
            historicalBackfill: {
              state: 'advancing' as const,
              boundary: { earliestDate: input.coverage.start.slice(0, 10) },
            },
            pendingResolutionCount: 0,
            outcome: { kind: 'yielded' as const, reason: 'operation_timeout' as const },
          },
        }
      },
    }
    const client = await createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([connector]),
      connectorScheduling: availableConnectorSchedulingCapability,
      now: () => clock,
      onScheduledWorkChanged: () => scheduler.signal(),
      registerScheduledWorkSource: (source) => scheduler.register(source),
      seedDataMode: 'none',
      pgliteDataPath: createScheduleHttpTempDatabasePath(),
      workspaceId: 'capture-retry-workspace',
    })
    await client.connectors.create({
      id: 'capture-retry-connector',
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      displayName: 'Capture retry connector',
      enabled: true,
      earliestBackfillDate: '2026-07-01',
    })
    const schedule = await client.connectors.schedules.upsert({
      connectorInstanceId: 'capture-retry-connector',
      expectedRevision: null,
      state: 'enabled',
      cadence: { kind: 'interval', everyMinutes: 15 },
      timezone: 'UTC',
    })

    clock = new Date(schedule.nextEligibleAt)
    scheduler.start()
    await scheduler.whenIdle()

    expect(refreshCalls).toBe(1)
    expect(timers.at(-1)?.delayMs).toBe(60_000)

    clock = new Date('2026-07-15T12:16:00.000Z')
    timers.at(-1)?.callback()
    await scheduler.whenIdle()

    expect(refreshCalls).toBe(2)
    const runs = await client.connectors.runs.list({
      connectorInstanceId: 'capture-retry-connector',
    })
    expect(runs.items).toHaveLength(2)
    expect(runs.items[0]).toMatchObject({
      retryHints: null,
      outcome: { kind: 'caught_up' },
    })
  })
})
