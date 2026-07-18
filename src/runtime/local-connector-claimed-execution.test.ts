import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDrizzleDatabase, createFileDatabase, migrateDatabase } from '../db/sqlite'
import { createSqliteConnectorRepository } from '../modules/connectors/connector.repository'
import { createStaticConnectorRegistry } from '../modules/connectors/connector.registry'
import { createConnectorRunner } from '../modules/connectors/connector.runner'
import { executeClaimedConnectorRun } from './local-connector-claimed-execution'
import { resolveDatabaseFilePath } from '../workspace/workspace.paths'

function createTempDatabasePath() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-claimed-exec-'))
}

describe('shared claimed connector run executor', () => {
  it('reconciles a trusted package upgrade before executing an already-claimed run', async () => {
    const pgliteDataPath = createTempDatabasePath()
    const sqlite = createFileDatabase(resolveDatabaseFilePath(pgliteDataPath))
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const connectorRepository = createSqliteConnectorRepository(database)
    const now = () => new Date('2026-07-13T16:00:00.000Z')
    await connectorRepository.upsertInstance({
      id: 'claimed-upgrade',
      connectorId: 'fixture.upgrade',
      connectorVersion: '1.0.0',
      displayName: 'Claimed upgrade',
      enabled: true,
      auth: [{ id: 'fixture', mode: 'api_key', secretKey: 'fixture-reference' }],
      config: { pageSize: 20 },
      filters: { role: 'intern' },
      earliestBackfillDate: '2026-07-01',
      createdAt: '2026-07-11T12:00:00.000Z',
    })
    await connectorRepository.recordCheckpoint({
      connectorInstanceId: 'claimed-upgrade',
      filterSignature: 'filters:{"role":"intern"}',
      checkpoint: { checkpoint: { cursor: 60 }, schemaVersion: 'fixture-checkpoint@1' },
      coverage: { start: '2026-07-01T00:00:00.000Z', end: '2026-07-12T16:00:00.000Z' },
      savedAt: '2026-07-12T16:00:00.000Z',
    })
    const queued = (await connectorRepository.recordRunRequest({
      connectorInstanceId: 'claimed-upgrade',
      mode: 'catch_up',
      startedAt: '2026-07-13T16:00:00.000Z',
      coverageStartedAt: '2026-07-01T00:00:00.000Z',
      coverageEndedAt: '2026-07-13T16:00:00.000Z',
      filterSignature: 'filters:{"role":"intern"}',
      filters: { role: 'intern' },
    })).run
    await connectorRepository.claimQueuedRunToRunning({
      connectorRunId: queued.id,
      startedAt: '2026-07-13T16:00:00.000Z',
    })

    let receivedCheckpoint: unknown
    let upgradeReplayCount = 0
    const connector = {
      definition: {
        id: 'fixture.upgrade',
        version: '2.0.0',
        checkpoint: { schemaVersion: 'fixture-checkpoint@1' },
      },
      async refresh(input) {
        receivedCheckpoint = input.checkpoint
        return {
          coverage: input.coverage,
          nextCheckpoint: { checkpoint: { cursor: 80 }, schemaVersion: 'fixture-checkpoint@1' },
          observations: [],
          operationOutcome: null,
          retryHints: null,
          status: 'completed' as const,
          stats: { observations: 0 },
          synchronization: {
            newestFrontier: { state: 'caught_up' as const },
            historicalBackfill: {
              state: 'caught_up' as const,
              boundary: { earliestDate: input.coverage.start.slice(0, 10) },
            },
            pendingResolutionCount: 0,
            outcome: { kind: 'caught_up' as const },
          },
          warnings: [],
        }
      },
    }

    await expect(executeClaimedConnectorRun({
      connectorRegistry: createStaticConnectorRegistry([connector]),
      connectorRepository,
      connectorRunner: createConnectorRunner({
        repository: connectorRepository,
        workspaceId: 'workspace-fixture',
        now,
      }),
      connectorRunId: queued.id,
      coverageEndedAt: '2026-07-13T16:00:00.000Z',
      mode: 'catch_up',
      now,
      replayConnectorUpgrade: async () => {
        upgradeReplayCount += 1
        return completedUpgradeReplay()
      },
      startedAt: '2026-07-13T16:00:00.000Z',
    })).resolves.toMatchObject({ id: queued.id, status: 'completed' })
    expect(upgradeReplayCount).toBe(1)
    expect(receivedCheckpoint).toEqual({ cursor: 60 })
    await expect(connectorRepository.getInstance('claimed-upgrade')).resolves.toMatchObject({
      id: 'claimed-upgrade',
      connectorVersion: '2.0.0',
      enabled: true,
      auth: [{ id: 'fixture', mode: 'api_key', secretKey: 'fixture-reference' }],
      config: { pageSize: 20 },
      filters: { role: 'intern' },
      earliestBackfillDate: '2026-07-01',
    })
    sqlite.close()
  })

  it('marks the claimed run failed when registry preflight cannot resolve the connector', async () => {
    const pgliteDataPath = createTempDatabasePath()
    const sqlite = createFileDatabase(resolveDatabaseFilePath(pgliteDataPath))
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const connectorRepository = createSqliteConnectorRepository(database)
    const now = () => new Date('2026-07-11T13:00:00.000Z')

    await connectorRepository.upsertInstance({
      id: 'connector-instance-fixture',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture Jobs',
      enabled: true,
      createdAt: '2026-07-11T12:00:00.000Z',
    })

    const queued = (await connectorRepository.recordRunRequest({
      connectorInstanceId: 'connector-instance-fixture',
      mode: 'manual',
      startedAt: '2026-07-11T13:00:00.000Z',
      coverageStartedAt: '2026-07-04T00:00:00.000Z',
      coverageEndedAt: '2026-07-11T13:00:00.000Z',
      filterSignature: 'filters:{}',
      filters: {},
    })).run

    const claim = await connectorRepository.claimQueuedRunToRunning({
      connectorRunId: queued.id,
      startedAt: '2026-07-11T13:00:00.000Z',
    })
    expect(claim.claimed).toBe(true)

    await expect(executeClaimedConnectorRun({
      connectorRegistry: createStaticConnectorRegistry([]),
      connectorRepository,
      connectorRunner: createConnectorRunner({
        repository: connectorRepository,
        workspaceId: 'workspace-fixture',
        now,
      }),
      connectorRunId: queued.id,
      coverageEndedAt: '2026-07-11T13:00:00.000Z',
      mode: 'manual',
      now,
      replayConnectorUpgrade: completedUpgradeReplay,
      startedAt: '2026-07-11T13:00:00.000Z',
    })).rejects.toThrow(/Unsupported connector id/)

    const failed = await connectorRepository.getRun(queued.id)
    expect(failed).toMatchObject({
      id: queued.id,
      status: 'failed',
    })
    expect(JSON.stringify(failed?.warnings ?? [])).not.toMatch(/Unsupported connector/i)
    sqlite.close()
  })

  it('marks the claimed run failed when connector refresh throws', async () => {
    const pgliteDataPath = createTempDatabasePath()
    const sqlite = createFileDatabase(resolveDatabaseFilePath(pgliteDataPath))
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const connectorRepository = createSqliteConnectorRepository(database)
    const now = () => new Date('2026-07-11T13:00:00.000Z')

    await connectorRepository.upsertInstance({
      id: 'connector-instance-fixture',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture Jobs',
      enabled: true,
      createdAt: '2026-07-11T12:00:00.000Z',
    })

    const queued = (await connectorRepository.recordRunRequest({
      connectorInstanceId: 'connector-instance-fixture',
      mode: 'manual',
      startedAt: '2026-07-11T13:00:00.000Z',
      coverageStartedAt: '2026-07-04T00:00:00.000Z',
      coverageEndedAt: '2026-07-11T13:00:00.000Z',
      filterSignature: 'filters:{}',
      filters: {},
    })).run

    await connectorRepository.claimQueuedRunToRunning({
      connectorRunId: queued.id,
      startedAt: '2026-07-11T13:00:00.000Z',
    })

    await expect(executeClaimedConnectorRun({
      connectorRegistry: createStaticConnectorRegistry([
        {
          definition: { id: 'fixture.jobs', version: '0.0.0-fixture' },
          async refresh() {
            throw new Error('refresh boom with secret detail')
          },
        },
      ]),
      connectorRepository,
      connectorRunner: createConnectorRunner({
        repository: connectorRepository,
        workspaceId: 'workspace-fixture',
        now,
      }),
      connectorRunId: queued.id,
      coverageEndedAt: '2026-07-11T13:00:00.000Z',
      mode: 'manual',
      now,
      replayConnectorUpgrade: completedUpgradeReplay,
      startedAt: '2026-07-11T13:00:00.000Z',
    })).rejects.toThrow(/refresh boom/)

    const failed = await connectorRepository.getRun(queued.id)
    expect(failed).toMatchObject({
      id: queued.id,
      status: 'failed',
    })
    expect(JSON.stringify(failed)).not.toMatch(/secret detail/)
    sqlite.close()
  })
})

async function completedUpgradeReplay() {
  return {
    replayId: 'fixture-upgrade-replay',
    acceptedAt: '2026-07-13T16:00:00.000Z',
    completedAt: '2026-07-13T16:00:00.000Z',
    matchedRawRevisionIds: [],
    status: 'completed' as const,
    items: [],
  }
}
