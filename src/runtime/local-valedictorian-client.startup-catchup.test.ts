import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLocalValedictorianClient as createRuntimeLocalValedictorianClient } from './local-valedictorian-client'
import { createDrizzleDatabase, createFileDatabase } from '../db/sqlite'
import { createSqliteConnectorRepository } from '../modules/connectors/connector.repository'
import type { AppJobConnector } from '../modules/connectors/connector.runner'

function createTempSqlitePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-client-')), 'valedictorian.sqlite')
}

describe('runtime local Valedictorian client deferred refresh', () => {
  const originalReferenceTrackerPath = process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH

  beforeEach(() => {
    process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH = path.join(
      os.tmpdir(),
      'valedictorian-missing-reference-tracker.md',
    )
  })

  afterEach(() => {
    if (originalReferenceTrackerPath === undefined) {
      delete process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH
    } else {
      process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH = originalReferenceTrackerPath
    }
  })

  it('persists deferred_refresh work as public manual mode without schedule provenance or a startup scan API', async () => {
    const sqlitePath = createTempSqlitePath()
    const client = createRuntimeLocalValedictorianClient({
      connectorRegistry: {
        get(connectorId) {
          return connectorId === 'fixture.jobs' ? fixtureConnector() : null
        },
      },
      now: () => new Date('2026-07-09T16:00:00.000Z'),
      seedDataMode: 'none',
      sqlitePath,
    })
    const sqlite = createFileDatabase(sqlitePath)
    const database = createDrizzleDatabase(sqlite)
    const connectorRepository = createSqliteConnectorRepository(database)

    await connectorRepository.upsertInstance({
      id: 'connector-instance-enabled',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Enabled Fixture Jobs',
      enabled: true,
      createdAt: '2026-07-08T15:00:00.000Z',
    })

    expect(client.connectors.runs).not.toHaveProperty('startupCatchUp')

    const run = await client.connectors.runs.trigger({
      connectorInstanceId: 'connector-instance-enabled',
      mode: 'manual',
      executionIntent: 'deferred_refresh',
      coverageEndedAt: '2026-07-09T16:00:00.000Z',
    })

    expect(run).toMatchObject({
      connectorInstanceId: 'connector-instance-enabled',
      mode: 'manual',
      scheduleOccurrence: null,
      status: 'completed',
    })
    sqlite.close()
  })
})

function fixtureConnector(): AppJobConnector {
  return {
    definition: {
      id: 'fixture.jobs',
      version: '0.0.0-fixture',
    },
    async refresh(input) {
      return {
        coverage: input.coverage,
        nextCheckpoint: {
          checkpoint: { cursor: 'fixture-cursor' },
          schemaVersion: 'fixture-checkpoint@1',
        },
        observations: [],
        stats: { observations: 0 },
        warnings: [],
      }
    },
  }
}
