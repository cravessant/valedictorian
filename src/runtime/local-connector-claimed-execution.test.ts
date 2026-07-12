import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDrizzleDatabase, createFileDatabase, migrateDatabase } from '../db/sqlite'
import { createSqliteConnectorRepository } from '../modules/connectors/connector.repository'
import { createStaticConnectorRegistry } from '../modules/connectors/connector.registry'
import { createConnectorRunner } from '../modules/connectors/connector.runner'
import { executeClaimedConnectorRun } from './local-connector-claimed-execution'

function createTempSqlitePath() {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-claimed-exec-')),
    'valedictorian.sqlite',
  )
}

describe('shared claimed connector run executor', () => {
  it('marks the claimed run failed when registry preflight cannot resolve the connector', async () => {
    const sqlitePath = createTempSqlitePath()
    const sqlite = createFileDatabase(sqlitePath)
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
    const sqlitePath = createTempSqlitePath()
    const sqlite = createFileDatabase(sqlitePath)
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
