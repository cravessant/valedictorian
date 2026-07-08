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
      filters: { roleKeywords: ['intern'] },
      createdAt: '2026-07-08T15:00:00.000Z',
    })

    const run = await repository.recordRefreshResult({
      connectorInstanceId: 'connector-instance-fixture',
      mode: 'manual',
      startedAt: '2026-07-08T16:00:00.000Z',
      completedAt: '2026-07-08T16:00:01.000Z',
      config: { fixture: true },
      filters: { roleKeywords: ['intern'] },
      filterSignature: 'filters:{"roleKeywords":["intern"]}',
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
      config: { fixture: true },
      filters: { roleKeywords: ['intern'] },
      filterSignature: 'filters:{"roleKeywords":["intern"]}',
      stats: {
        observations: 1,
        resolved: 1,
      },
    })

    await expect(
      repository.getCheckpoint({
        connectorInstanceId: 'connector-instance-fixture',
        filterSignature: 'filters:{"roleKeywords":["intern"]}',
      }),
    ).resolves.toEqual({
      connectorInstanceId: 'connector-instance-fixture',
      filterSignature: 'filters:{"roleKeywords":["intern"]}',
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

  it('keeps checkpoint scopes separate when filters change on the same connector instance', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)

    await repository.upsertInstance({
      id: 'connector-instance-filtered',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Filtered fixture jobs',
      enabled: true,
      config: { listUrl: 'https://example.test/jobs' },
      filters: { roleKeywords: ['intern'] },
      createdAt: '2026-07-08T15:00:00.000Z',
    })

    await repository.recordRefreshResult({
      connectorInstanceId: 'connector-instance-filtered',
      mode: 'manual',
      startedAt: '2026-07-08T16:00:00.000Z',
      completedAt: '2026-07-08T16:00:01.000Z',
      config: { listUrl: 'https://example.test/jobs' },
      filters: { roleKeywords: ['intern'] },
      filterSignature: 'filters:{"roleKeywords":["intern"]}',
      result: emptyConnectorRefreshResult({
        checkpoint: { cursor: 'intern-cursor' },
        coverage: {
          start: '2026-07-01T00:00:00.000Z',
          end: '2026-07-08T16:00:00.000Z',
        },
      }),
    })

    await repository.upsertInstance({
      id: 'connector-instance-filtered',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Filtered fixture jobs',
      enabled: true,
      config: { listUrl: 'https://example.test/jobs' },
      filters: { roleKeywords: ['new grad'] },
    })

    await repository.recordRefreshResult({
      connectorInstanceId: 'connector-instance-filtered',
      mode: 'manual',
      startedAt: '2026-07-08T17:00:00.000Z',
      completedAt: '2026-07-08T17:00:01.000Z',
      config: { listUrl: 'https://example.test/jobs' },
      filters: { roleKeywords: ['new grad'] },
      filterSignature: 'filters:{"roleKeywords":["new grad"]}',
      result: emptyConnectorRefreshResult({
        checkpoint: { cursor: 'new-grad-cursor' },
        coverage: {
          start: '2026-07-08T16:00:00.000Z',
          end: '2026-07-08T17:00:00.000Z',
        },
      }),
    })

    await expect(repository.getInstance('connector-instance-filtered')).resolves.toMatchObject({
      config: { listUrl: 'https://example.test/jobs' },
      filters: { roleKeywords: ['new grad'] },
    })
    await expect(
      repository.getCheckpoint({
        connectorInstanceId: 'connector-instance-filtered',
        filterSignature: 'filters:{"roleKeywords":["intern"]}',
      }),
    ).resolves.toMatchObject({
      filterSignature: 'filters:{"roleKeywords":["intern"]}',
      checkpoint: { cursor: 'intern-cursor' },
    })
    await expect(
      repository.getCheckpoint({
        connectorInstanceId: 'connector-instance-filtered',
        filterSignature: 'filters:{"roleKeywords":["new grad"]}',
      }),
    ).resolves.toMatchObject({
      filterSignature: 'filters:{"roleKeywords":["new grad"]}',
      checkpoint: { cursor: 'new-grad-cursor' },
    })
  })

  it('normalizes connector auth references before persisting instance state', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)

    await repository.upsertInstance({
      id: 'connector-instance-auth',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Auth fixture jobs',
      enabled: true,
      auth: [
        {
          id: ' internlist ',
          mode: 'api_key',
          label: ' InternList API key ',
          secretKey: ' internlist_api_key ',
          sessionKey: 'wrong_session_key',
          value: 'il-secret',
        } as never,
        {
          id: ' jobright ',
          mode: 'browser_session',
          secretKey: 'wrong_secret_key',
          sessionKey: ' workspace_session_1 ',
        } as never,
      ],
      createdAt: '2026-07-08T15:00:00.000Z',
    })

    const instance = await repository.getInstance('connector-instance-auth')

    expect(instance).toMatchObject({
      auth: [
        {
          id: 'internlist',
          mode: 'api_key',
          label: 'InternList API key',
          secretKey: 'internlist_api_key',
        },
        {
          id: 'jobright',
          mode: 'browser_session',
          sessionKey: 'workspace_session_1',
        },
      ],
    })
    expect(JSON.stringify(instance)).not.toContain('il-secret')
    expect(JSON.stringify(instance)).not.toContain('wrong_secret_key')
    expect(JSON.stringify(instance)).not.toContain('wrong_session_key')
  })

  it('persists partial-success connector runs with retry hints', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)

    await repository.upsertInstance({
      id: 'connector-instance-partial',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Partial fixture jobs',
      enabled: true,
      createdAt: '2026-07-08T15:00:00.000Z',
    })

    const run = await repository.recordRefreshResult({
      connectorInstanceId: 'connector-instance-partial',
      mode: 'catch_up',
      startedAt: '2026-07-08T16:00:00.000Z',
      completedAt: '2026-07-08T16:00:01.000Z',
      config: {},
      filters: {},
      filterSignature: 'filters:{}',
      result: {
        ...emptyConnectorRefreshResult({
          checkpoint: { cursor: 'partial-cursor' },
          coverage: {
            start: '2026-07-08T15:00:00.000Z',
            end: '2026-07-08T15:05:00.000Z',
          },
        }),
        status: 'partial_success',
        retryHints: {
          reason: 'budget_exhausted',
        },
      },
    })

    expect(run).toMatchObject({
      status: 'partial_success',
      retryHints: {
        reason: 'budget_exhausted',
      },
    })
  })
})

function emptyConnectorRefreshResult({
  checkpoint,
  coverage,
}: {
  checkpoint: unknown
  coverage: { start: string; end: string }
}) {
  return {
    coverage,
    stats: {
      observations: 0,
    },
    warnings: [],
    nextCheckpoint: {
      checkpoint,
      schemaVersion: 'fixture-checkpoint@1',
    },
    observations: [],
  }
}
