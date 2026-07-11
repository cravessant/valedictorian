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


describe('runtime local Valedictorian client', () => {
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

  it('runs one startup catch-up pass for enabled registered connector instances', async () => {
    const sqlitePath = createTempSqlitePath()
    const client = createRuntimeLocalValedictorianClient({
      connectorRegistry: {
        get(connectorId) {
          return connectorId === 'fixture.jobs'
            ? fixtureConnector({
              observedAt: '2026-07-09T15:30:00.000Z',
            })
            : null
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
    await connectorRepository.upsertInstance({
      id: 'connector-instance-disabled',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Disabled Fixture Jobs',
      enabled: false,
      createdAt: '2026-07-08T15:00:00.000Z',
    })
    await connectorRepository.upsertInstance({
      id: 'connector-instance-unsupported',
      connectorId: 'fixture.unsupported',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Unsupported Fixture Jobs',
      enabled: true,
      createdAt: '2026-07-08T15:00:00.000Z',
    })

    const result = await client.connectors.runs.startupCatchUp()
    const enabledRuns = await client.connectors.runs.list({
      connectorInstanceId: 'connector-instance-enabled',
    })
    const disabledRuns = await client.connectors.runs.list({
      connectorInstanceId: 'connector-instance-disabled',
    })

    expect(result.runs).toHaveLength(1)
    expect(result.runs[0]).toMatchObject({
      connectorInstanceId: 'connector-instance-enabled',
      coverage: {
        end: '2026-07-09T16:00:00.000Z',
        start: '2026-07-01T15:00:00.000Z',
      },
      mode: 'catch_up',
      status: 'completed',
    })
    expect(result.skipped).toEqual([
      {
        connectorInstanceId: 'connector-instance-disabled',
        reason: 'disabled',
      },
      {
        connectorInstanceId: 'connector-instance-unsupported',
        reason: 'unsupported_connector',
      },
    ])
    expect(enabledRuns.total).toBe(1)
    expect(disabledRuns.total).toBe(0)
    sqlite.close()
  })

  it('does not duplicate startup catch-up work when the startup hook is invoked twice', async () => {
    const sqlitePath = createTempSqlitePath()
    const client = createRuntimeLocalValedictorianClient({
      connectorRegistry: {
        get(connectorId) {
          return connectorId === 'fixture.jobs'
            ? fixtureConnector({
              observedAt: '2026-07-09T15:30:00.000Z',
            })
            : null
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
      id: 'connector-instance-fixture',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture Jobs',
      enabled: true,
      createdAt: '2026-07-08T15:00:00.000Z',
    })

    const first = await client.connectors.runs.startupCatchUp()
    const second = await client.connectors.runs.startupCatchUp()
    const runs = await client.connectors.runs.list({
      connectorInstanceId: 'connector-instance-fixture',
    })

    expect(first.runs).toHaveLength(1)
    expect(second).toEqual(first)
    expect(runs.total).toBe(1)
    sqlite.close()
  })
})

function fixtureConnector({
  additionalCompanyNames = [],
  companyName = 'Example Robotics',
  observedAt,
  throwOnRefresh = false,
  waitForRefresh,
}: {
  additionalCompanyNames?: string[]
  companyName?: string
  observedAt: string
  throwOnRefresh?: boolean
  waitForRefresh?: Promise<void>
}): AppJobConnector {
  return {
    definition: {
      id: 'fixture.jobs',
      version: '0.0.0-fixture',
    },
    async refresh(input) {
      await waitForRefresh

      if (throwOnRefresh) {
        throw new Error('Fixture connector refresh failed')
      }
      const observations = [companyName, ...additionalCompanyNames].map((observationCompanyName, index) => {
        const slug = index === 0
          ? 'software-engineering-intern'
          : `software-engineering-intern-${index + 1}`

        return {
          connectorId: 'fixture.jobs',
          connectorVersion: '0.0.0-fixture',
          sourceRecordKey: `fixture.jobs:${slug}`,
          observedAt,
          companyName: observationCompanyName,
          roleTitle: 'Software Engineering Intern',
          locationRaw: 'Remote',
          descriptionText: 'Build fixture robots and connector proofs.',
          pay: null,
          links: {
            source: `https://example.test/jobs/${slug}`,
            intermediary: null,
            official: `https://jobs.example.com/apply/${slug}`,
          },
          resolution: {
            status: 'resolved',
            method: 'fixture',
            reason: null,
          },
          dedupeKeys: [`official:https://jobs.example.com/apply/${slug}`],
          sourceMetadata: {
            fixture: true,
            destinationClass: 'employer_or_ats',
          },
          evidence: [
            {
              type: 'fixture',
              capturedAt: observedAt,
              sourceUrl: `https://example.test/jobs/${slug}`,
            },
          ],
        }
      })

      return {
        coverage: input.coverage,
        nextCheckpoint: {
          checkpoint: {
            cursor: `fixture:${observedAt}`,
          },
          schemaVersion: 'fixture-checkpoint@1',
        },
        observations,
        stats: {
          observations: observations.length,
        },
        warnings: [],
      }
    },
  }
}
