import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { completedConnectorRefreshContract } from '@sparxie/valedictorian-local-runtime/testing/modules/connectors/public/connector.refresh-result.test-helpers'
import type { AppJobConnector } from '@sparxie/valedictorian-local-runtime/testing/modules/connectors/ports/connector.runner-contracts'
import {
  availableConnectorSchedulingCapability,
  createScheduleHttpTempDatabasePath,
  createStaticConnectorRegistry,
} from '../server/local-server.connector-schedules.http-fixture'
import {
  createTestLocalValedictorianClient as createLocalValedictorianClient,
  getTestLocalValedictorianDatabase,
} from './local-valedictorian-client.test-harness'
import type { LocalScheduledWorkSource } from '@sparxie/valedictorian-local-runtime/scheduling'

describe('local connector capture retry guards', () => {
  it('does not advertise due retry work while its execution scope requires action', async () => {
    let clock = new Date('2026-07-15T12:00:00.000Z')
    const pgliteDataPath = createScheduleHttpTempDatabasePath()
    const sources = new Map<string, LocalScheduledWorkSource>()
    const connector: AppJobConnector = {
      definition: { id: 'fixture.jobs', version: '0.0.0-fixture' },
      async refresh(input) {
        const base = {
          ...completedConnectorRefreshContract(input.coverage.start.slice(0, 10)),
          coverage: input.coverage,
          nextCheckpoint: { checkpoint: {}, schemaVersion: 'fixture-checkpoint@1' },
          observations: [], stats: { observations: 0 }, warnings: [],
        }
        return {
          ...base,
          retryHints: {
            state: 'scheduled' as const, reason: 'operation_timeout' as const,
            attempt: 1, maxAttempts: 3, lastAttemptAt: clock.toISOString(),
            computedDelayMs: 60_000, serverMinimumDelayMs: null,
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
      registerScheduledWorkSource: (source) => sources.set(source.id, source),
      seedDataMode: 'none', pgliteDataPath, workspaceId: 'retry-guard-workspace',
    })
    await client.connectors.create({
      id: 'retry-guard-connector', connectorId: connector.definition.id,
      connectorVersion: connector.definition.version, displayName: 'Retry guard', enabled: true,
    })
    const schedule = await client.connectors.schedules.upsert({
      connectorInstanceId: 'retry-guard-connector', expectedRevision: null,
      state: 'enabled', cadence: { kind: 'interval', everyMinutes: 15 }, timezone: 'UTC',
    })
    clock = new Date(schedule.nextEligibleAt)
    await sources.get('connector-schedules')!.runDue()

    const database = getTestLocalValedictorianDatabase(client)
    await database.execute(sql`update source_execution_scopes set status='cooldown', blocked_until='2026-07-15T12:20:00.000Z'`)
    await expect(sources.get('connector-capture-retries')!.nextDueAt())
      .resolves.toBe('2026-07-15T12:20:00.000Z')
    await database.execute(sql`update source_execution_scopes set status='action_required', blocked_until=null`)
    clock = new Date('2026-07-15T12:16:00.000Z')

    await expect(sources.get('connector-capture-retries')!.nextDueAt()).resolves.toBeNull()
  })

  it('blocks a due retry behind an active manual run without self-signalling a hot loop', async () => {
    let clock = new Date('2026-07-15T12:00:00.000Z')
    const pgliteDataPath = createScheduleHttpTempDatabasePath()
    const sources = new Map<string, LocalScheduledWorkSource>()
    let signalCalls = 0
    let refreshCalls = 0
    let announceManual: (() => void) | undefined
    let releaseManual: (() => void) | undefined
    const manualStarted = new Promise<void>((resolve) => { announceManual = resolve })
    const manualGate = new Promise<void>((resolve) => { releaseManual = resolve })
    const connector: AppJobConnector = {
      definition: { id: 'fixture.jobs', version: '0.0.0-fixture' },
      async refresh(input) {
        refreshCalls += 1
        if (refreshCalls === 2) {
          announceManual?.()
          await manualGate
        }
        const base = {
          ...completedConnectorRefreshContract(input.coverage.start.slice(0, 10)),
          coverage: input.coverage,
          nextCheckpoint: { checkpoint: { refreshCalls }, schemaVersion: 'fixture-checkpoint@1' },
          observations: [], stats: { observations: 0 }, warnings: [],
        }
        if (refreshCalls > 1) return base
        return {
          ...base,
          retryHints: {
            state: 'scheduled' as const, reason: 'operation_timeout' as const,
            attempt: 1, maxAttempts: 3, lastAttemptAt: '2026-07-15T12:15:00.000Z',
            computedDelayMs: 60_000, serverMinimumDelayMs: null,
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
      onScheduledWorkChanged() {
        signalCalls += 1
        for (const source of sources.values()) source.onSignal?.()
      },
      registerScheduledWorkSource: (source) => sources.set(source.id, source),
      seedDataMode: 'none', pgliteDataPath, workspaceId: 'retry-collision-workspace',
    })
    await client.connectors.create({
      id: 'retry-collision-connector', connectorId: connector.definition.id,
      connectorVersion: connector.definition.version, displayName: 'Retry collision', enabled: true,
    })
    const schedule = await client.connectors.schedules.upsert({
      connectorInstanceId: 'retry-collision-connector', expectedRevision: null,
      state: 'enabled', cadence: { kind: 'interval', everyMinutes: 15 }, timezone: 'UTC',
    })
    clock = new Date(schedule.nextEligibleAt)
    await sources.get('connector-schedules')!.runDue()
    const database = getTestLocalValedictorianDatabase(client)
    await database.execute(sql`update connector_capture_work set status='completed', next_eligible_at=null`)

    const manualRun = client.connectors.runs.trigger({
      connectorInstanceId: 'retry-collision-connector',
    })
    await manualStarted
    await database.execute(sql`update connector_capture_work set status='scheduled', next_eligible_at='2026-07-15T12:16:00.000Z'`)
    clock = new Date('2026-07-15T12:16:00.000Z')
    const signalsBeforeRetry = signalCalls

    await sources.get('connector-capture-retries')!.runDue()

    expect(signalCalls).toBe(signalsBeforeRetry)
    await expect(sources.get('connector-capture-retries')!.nextDueAt()).resolves.toBeNull()
    releaseManual?.()
    await manualRun
  })
})
