import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createLocalValedictorianClient as createRuntimeLocalValedictorianClient } from './local-valedictorian-client'
import { createDrizzleDatabase, createFileDatabase } from '../db/sqlite'
import { createSqliteConnectorRepository } from '../modules/connectors/connector.repository'
import { completedConnectorRefreshContract } from '../modules/connectors/connector-refresh-result.test-helpers'
import { createStaticConnectorRegistry } from '../modules/connectors/connector.registry'
import type { AppJobConnector } from '../modules/connectors/connector.runner'
import { resolveDatabaseFilePath } from '../workspace/workspace.paths'

function createTempDatabasePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-coverage-')), 'pglite')
}

function createCoverageFixtureConnector(refresh: AppJobConnector['refresh']): AppJobConnector {
  return {
    definition: {
      id: 'fixture.coverage',
      version: '1.0.0',
      displayName: 'Coverage fixture',
      capabilities: {
        fetchesPublicPages: false,
        resolvesIntermediaryLinks: false,
        supportsFiltering: false,
        supportsIncrementalRefresh: true,
      },
      checkpoint: { schemaVersion: 'fixture-checkpoint@1' },
    },
    refresh,
  }
}

describe('runtime connector coverage from earliest backfill date', () => {
  it('records and invokes the same anchored coverage start for manual, catch-up, and edited dates', async () => {
    const pgliteDataPath = createTempDatabasePath()
    const coverages: Array<{ mode: string; start: string | null; end: string | null }> = []
    const connector = createCoverageFixtureConnector(async (input) => {
      coverages.push({
        mode: input.mode,
        start: input.coverage.start,
        end: input.coverage.end,
      })
      return {
        ...completedConnectorRefreshContract(input.coverage.start.slice(0, 10)),
        observations: [],
        nextCheckpoint: { checkpoint: { cursor: input.mode }, schemaVersion: 'fixture-checkpoint@1' },
        coverage: input.coverage,
        stats: { observations: 0, stopReason: 'target_met' },
        warnings: [],
        status: 'completed',
        retryHints: null,
      }
    })
    const client = createRuntimeLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([connector]),
      now: () => new Date('2026-07-11T18:00:00.000Z'),
      seedDataMode: 'none',
      pgliteDataPath,
    })
    const repository = createSqliteConnectorRepository(
      createDrizzleDatabase(createFileDatabase(resolveDatabaseFilePath(pgliteDataPath))),
    )
    await repository.upsertInstance({
      id: 'coverage-instance',
      connectorId: 'fixture.coverage',
      connectorVersion: '1.0.0',
      displayName: 'Coverage instance',
      enabled: true,
      createdAt: '2026-07-11T12:00:00.000Z',
    })

    const manual = await client.connectors.runs.trigger({
      connectorInstanceId: 'coverage-instance',
      mode: 'manual',
      coverageEndedAt: '2026-07-11T18:00:00.000Z',
      // Intentionally wrong caller start; host must use persisted earliest midnight.
      coverageStartedAt: '2026-07-11T17:00:00.000Z',
    })
    expect(manual).toMatchObject({
      status: 'completed',
      coverage: {
        start: '2026-07-04T00:00:00.000Z',
        end: '2026-07-11T18:00:00.000Z',
      },
    })

    const catchUp = await client.connectors.runs.trigger({
      connectorInstanceId: 'coverage-instance',
      mode: 'manual', executionIntent: 'deferred_refresh',
      coverageEndedAt: '2026-07-11T19:00:00.000Z',
    })
    expect(catchUp.coverage.start).toBe('2026-07-04T00:00:00.000Z')

    await client.connectors.update({
      connectorInstanceId: 'coverage-instance',
      earliestBackfillDate: '2026-05-01',
    })
    const afterEarlier = await client.connectors.runs.trigger({
      connectorInstanceId: 'coverage-instance',
      mode: 'manual',
      coverageEndedAt: '2026-07-11T20:00:00.000Z',
      coverageStartedAt: '2026-07-11T19:00:00.000Z',
    })
    expect(afterEarlier.coverage.start).toBe('2026-05-01T00:00:00.000Z')

    await client.connectors.update({
      connectorInstanceId: 'coverage-instance',
      earliestBackfillDate: '2026-07-01',
    })
    const afterLater = await client.connectors.runs.trigger({
      connectorInstanceId: 'coverage-instance',
      mode: 'manual', executionIntent: 'deferred_refresh',
      coverageEndedAt: '2026-07-11T21:00:00.000Z',
    })
    expect(afterLater.coverage.start).toBe('2026-07-01T00:00:00.000Z')

    expect(coverages.map((entry) => entry.start)).toEqual([
      '2026-07-04T00:00:00.000Z',
      '2026-07-04T00:00:00.000Z',
      '2026-05-01T00:00:00.000Z',
      '2026-07-01T00:00:00.000Z',
    ])
  })

  it('retains anchored coverage start on queued and preflight-failed rows', async () => {
    const pgliteDataPath = createTempDatabasePath()
    const connector = createCoverageFixtureConnector(async () => {
      throw new Error('refresh exploded')
    })
    const client = createRuntimeLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([connector]),
      now: () => new Date('2026-07-11T18:00:00.000Z'),
      seedDataMode: 'none',
      pgliteDataPath,
    })
    const repository = createSqliteConnectorRepository(
      createDrizzleDatabase(createFileDatabase(resolveDatabaseFilePath(pgliteDataPath))),
    )
    await repository.upsertInstance({
      id: 'failed-coverage',
      connectorId: 'fixture.coverage',
      connectorVersion: '1.0.0',
      displayName: 'Failed coverage',
      enabled: true,
      earliestBackfillDate: '2026-06-01',
      createdAt: '2026-07-11T12:00:00.000Z',
    })

    await expect(client.connectors.runs.trigger({
      connectorInstanceId: 'failed-coverage',
      mode: 'manual',
      coverageEndedAt: '2026-07-11T18:00:00.000Z',
      coverageStartedAt: '2026-07-11T17:00:00.000Z',
    })).rejects.toThrow(/refresh exploded|Connector execution failed/i)

    const runs = await client.connectors.runs.list({
      connectorInstanceId: 'failed-coverage',
      limit: 10,
      offset: 0,
    })
    expect(runs.items[0]).toMatchObject({
      status: 'failed',
      coverage: {
        start: '2026-06-01T00:00:00.000Z',
        end: '2026-07-11T18:00:00.000Z',
      },
    })

    // Create a not-due capture retry to force a skipped/queued retention path.
    await repository.recordRefreshResult({
      connectorInstanceId: 'failed-coverage',
      mode: 'manual',
      startedAt: '2026-07-11T18:01:00.000Z',
      completedAt: '2026-07-11T18:01:01.000Z',
      config: {},
      filters: {},
      filterSignature: 'filters:{}',
      result: {
        ...completedConnectorRefreshContract('2026-06-01'),
        observations: [],
        warnings: [],
        stats: { observations: 0 },
        coverage: {
          start: '2026-06-01T00:00:00.000Z',
          end: '2026-07-11T18:01:00.000Z',
        },
        nextCheckpoint: { checkpoint: {}, schemaVersion: 'fixture-checkpoint@1' },
        retryHints: {
          state: 'scheduled',
          reason: 'rate_limit',
          attempt: 1,
          maxAttempts: 3,
          lastAttemptAt: '2026-07-11T18:01:00.000Z',
          computedDelayMs: 3_600_000,
          nextAttemptAt: '2026-07-11T19:01:00.000Z',
          horizonAt: '2026-07-11T20:01:00.000Z',
        },
      },
    })

    const skipped = await client.connectors.runs.trigger({
      connectorInstanceId: 'failed-coverage',
      mode: 'manual',
      coverageEndedAt: '2026-07-11T18:30:00.000Z',
      coverageStartedAt: '2026-07-11T17:00:00.000Z',
    })
    expect(skipped).toMatchObject({
      status: 'skipped',
      coverage: {
        start: '2026-06-01T00:00:00.000Z',
        end: '2026-07-11T18:30:00.000Z',
      },
    })
  })
})
