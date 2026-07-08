import { describe, expect, it } from 'vitest'
import { sourcingFindings } from '../../db/schema'
import { createDrizzleDatabase, createInMemoryDatabase, migrateDatabase } from '../../db/sqlite'
import { createSqliteConnectorRepository } from './connector.repository'

describe('SQLite connector repository', () => {
  it('records a fixture connector refresh into app-owned connector state', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)

    await repository.upsertInstance({
      id: 'connector-instance-fixture',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture jobs',
      enabled: true,
      config: { fixture: true },
      createdAt: '2026-07-08T15:00:00.000Z',
    })

    const run = await repository.recordRefreshResult({
      connectorInstanceId: 'connector-instance-fixture',
      mode: 'manual',
      startedAt: '2026-07-08T16:00:00.000Z',
      completedAt: '2026-07-08T16:00:01.000Z',
      result: {
        coverage: {
          start: '2026-07-01T00:00:00.000Z',
          end: '2026-07-08T16:00:00.000Z',
        },
        stats: {
          observations: 1,
          resolved: 1,
        },
        warnings: [
          {
            code: 'fixture.warning',
            message: 'Fixture warning for host persistence coverage.',
          },
        ],
        retryHints: {
          retryAfter: null,
        },
        nextCheckpoint: {
          checkpoint: {
            cursor: 'fixture:2026-07-08T16:00:00.000Z',
          },
          schemaVersion: 'fixture-checkpoint@1',
        },
        observations: [
          {
            connectorId: 'fixture.jobs',
            connectorVersion: '0.0.0-fixture',
            sourceRecordKey: 'fixture.jobs:software-engineering-intern',
            observedAt: '2026-07-08T16:00:00.000Z',
            companyName: 'Example Robotics',
            roleTitle: 'Software Engineering Intern',
            locationRaw: 'Remote',
            descriptionText: 'Build fixture robots and connector proofs.',
            pay: null,
            links: {
              source: 'https://example.test/jobs/software-engineering-intern',
              intermediary: null,
              official: 'https://example.test/apply/software-engineering-intern',
            },
            resolution: {
              status: 'resolved',
              method: 'fixture',
              reason: null,
            },
            dedupeKeys: [
              'official:https://example.test/apply/software-engineering-intern',
              'source:fixture.jobs:software-engineering-intern',
            ],
            sourceMetadata: {
              fixture: true,
            },
            evidence: [
              {
                type: 'fixture',
                capturedAt: '2026-07-08T16:00:00.000Z',
                sourceUrl: 'https://example.test/jobs/software-engineering-intern',
              },
            ],
          },
        ],
      },
    })

    expect(run).toMatchObject({
      connectorInstanceId: 'connector-instance-fixture',
      mode: 'manual',
      status: 'completed',
      coverageStartedAt: '2026-07-01T00:00:00.000Z',
      coverageEndedAt: '2026-07-08T16:00:00.000Z',
      observationCount: 1,
      warningCount: 1,
      stats: {
        observations: 1,
        resolved: 1,
      },
    })

    await expect(repository.getCheckpoint('connector-instance-fixture')).resolves.toEqual({
      connectorInstanceId: 'connector-instance-fixture',
      checkpoint: {
        cursor: 'fixture:2026-07-08T16:00:00.000Z',
      },
      schemaVersion: 'fixture-checkpoint@1',
      coverageStartedAt: '2026-07-01T00:00:00.000Z',
      coverageEndedAt: '2026-07-08T16:00:00.000Z',
    })

    await expect(
      repository.listObservations({ connectorInstanceId: 'connector-instance-fixture' }),
    ).resolves.toEqual([
      expect.objectContaining({
        connectorInstanceId: 'connector-instance-fixture',
        connectorRunId: run.id,
        connectorId: 'fixture.jobs',
        connectorVersion: '0.0.0-fixture',
        sourceRecordKey: 'fixture.jobs:software-engineering-intern',
        companyName: 'Example Robotics',
        roleTitle: 'Software Engineering Intern',
        links: {
          source: 'https://example.test/jobs/software-engineering-intern',
          intermediary: null,
          official: 'https://example.test/apply/software-engineering-intern',
        },
        resolution: {
          status: 'resolved',
          method: 'fixture',
          reason: null,
        },
        dedupeKeys: [
          'official:https://example.test/apply/software-engineering-intern',
          'source:fixture.jobs:software-engineering-intern',
        ],
        evidence: [
          {
            type: 'fixture',
            capturedAt: '2026-07-08T16:00:00.000Z',
            sourceUrl: 'https://example.test/jobs/software-engineering-intern',
          },
        ],
      }),
    ])
    expect(database.select().from(sourcingFindings).all()).toHaveLength(0)
  })
})
