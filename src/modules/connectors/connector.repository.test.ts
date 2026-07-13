import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { sourceExecutionScopes, sourcingFindings } from '../../db/schema'
import { createDrizzleDatabase, createInMemoryDatabase, migrateDatabase } from '../../db/sqlite'
import { createSqliteConnectorRepository } from './connector.repository'

describe('SQLite connector repository', () => {
  it('preserves scope cooldown and generation when auth references are edited', async () => {
    const sqlite = createInMemoryDatabase(); migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    const first = await repository.upsertInstance({ id: 'stable-scope', connectorId: 'fixture.jobs', connectorVersion: '1.0.0', displayName: 'Stable', enabled: true, auth: [{ id: 'first', mode: 'api_key', secretKey: 'one' }] })
    database.update(sourceExecutionScopes).set({ status: 'cooldown', blockedUntil: '2026-07-12T13:00:00.000Z', authGeneration: 4 }).where(eq(sourceExecutionScopes.id, first.executionScopeId)).run()
    const edited = await repository.upsertInstance({ id: 'stable-scope', connectorId: 'fixture.jobs', connectorVersion: '1.0.0', displayName: 'Stable', enabled: true, auth: [{ id: 'second', mode: 'bearer_token', secretKey: 'two' }] })
    expect(edited.executionScopeId).toBe(first.executionScopeId)
    expect(database.select().from(sourceExecutionScopes).where(eq(sourceExecutionScopes.id, first.executionScopeId)).get()).toMatchObject({ status: 'cooldown', blockedUntil: '2026-07-12T13:00:00.000Z', authGeneration: 4 })
    sqlite.close()
  })
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
        retryHints: null,
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
            parserVersion: 'fixture-parser@2026-07-09',
            observationSchemaVersion: 'job-observation@2',
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
        parserVersion: 'fixture-parser@2026-07-09',
        observationSchemaVersion: 'job-observation@2',
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

  it('can defer checkpoint persistence until a refresh run is accepted', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)

    await repository.upsertInstance({
      id: 'connector-instance-deferred',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Deferred fixture jobs',
      enabled: true,
      createdAt: '2026-07-08T15:00:00.000Z',
    })

    const run = await repository.recordRefreshResult({
      connectorInstanceId: 'connector-instance-deferred',
      mode: 'manual',
      startedAt: '2026-07-08T16:00:00.000Z',
      completedAt: '2026-07-08T16:00:01.000Z',
      config: {},
      filters: {},
      filterSignature: 'filters:{}',
      checkpointPersistence: 'deferred',
      result: emptyConnectorRefreshResult({
        checkpoint: { cursor: 'deferred-cursor' },
        coverage: {
          start: '2026-07-08T15:00:00.000Z',
          end: '2026-07-08T16:00:00.000Z',
        },
      }),
    })

    expect(run).toMatchObject({
      connectorInstanceId: 'connector-instance-deferred',
      status: 'completed',
    })
    await expect(
      repository.getCheckpoint({
        connectorInstanceId: 'connector-instance-deferred',
        filterSignature: 'filters:{}',
      }),
    ).resolves.toBeNull()

    await repository.recordCheckpoint({
      connectorInstanceId: 'connector-instance-deferred',
      filterSignature: 'filters:{}',
      checkpoint: {
        checkpoint: { cursor: 'deferred-cursor' },
        schemaVersion: 'fixture-checkpoint@1',
      },
      coverage: {
        start: '2026-07-08T15:00:00.000Z',
        end: '2026-07-08T16:00:00.000Z',
      },
      savedAt: '2026-07-08T16:00:01.000Z',
    })

    await expect(
      repository.getCheckpoint({
        connectorInstanceId: 'connector-instance-deferred',
        filterSignature: 'filters:{}',
      }),
    ).resolves.toMatchObject({
      checkpoint: { cursor: 'deferred-cursor' },
      coverageEndedAt: '2026-07-08T16:00:00.000Z',
      coverageStartedAt: '2026-07-08T15:00:00.000Z',
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
          id: ' fixture-api ',
          mode: 'api_key',
          label: ' Fixture API key ',
          secretKey: ' fixture_api_key ',
          sessionKey: 'wrong_session_key',
          value: 'fixture-secret',
        } as never,
        {
          id: ' fixture-auth ',
          mode: 'browser_session',
          secretKey: 'wrong_secret_key',
          sessionKey: ' workspace_session_1 ',
        } as never,
        {
          id: ' fixture-password ',
          mode: 'username_password',
          label: ' Jobright credentials ',
          secretKey: ' connector.jobright.credentials.fixture ',
          sessionKey: 'wrong_session_key',
          value: 'plaintext-password-json',
        } as never,
      ],
      createdAt: '2026-07-08T15:00:00.000Z',
    })

    const instance = await repository.getInstance('connector-instance-auth')

    expect(instance).toMatchObject({
      auth: [
        {
          id: 'fixture-api',
          mode: 'api_key',
          label: 'Fixture API key',
          secretKey: 'fixture_api_key',
        },
        {
          id: 'fixture-auth',
          mode: 'browser_session',
          sessionKey: 'workspace_session_1',
        },
        {
          id: 'fixture-password',
          mode: 'username_password',
          label: 'Jobright credentials',
          secretKey: 'connector.jobright.credentials.fixture',
        },
      ],
    })
    expect(JSON.stringify(instance)).not.toContain('fixture-secret')
    expect(JSON.stringify(instance)).not.toContain('wrong_secret_key')
    expect(JSON.stringify(instance)).not.toContain('wrong_session_key')
    expect(JSON.stringify(instance)).not.toContain('plaintext-password-json')
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
        retryHints: null,
      },
    })

    expect(run).toMatchObject({
      status: 'partial_success',
      retryHints: null,
    })
  })

  it('keeps an existing run non-terminal while deferred projection is pending', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)

    await repository.upsertInstance({
      id: 'connector-instance-deferred',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Deferred fixture jobs',
      enabled: true,
      createdAt: '2026-07-08T15:00:00.000Z',
    })
    const request = (await repository.recordRunRequest({
      connectorInstanceId: 'connector-instance-deferred',
      mode: 'manual',
      startedAt: '2026-07-08T16:00:00.000Z',
    })).run
    await repository.markRunRunning({
      connectorRunId: request.id,
      startedAt: '2026-07-08T16:00:00.000Z',
    })

    const run = await repository.recordRefreshResult({
      connectorRunId: request.id,
      connectorInstanceId: 'connector-instance-deferred',
      mode: 'manual',
      startedAt: '2026-07-08T16:00:00.000Z',
      completedAt: '2026-07-08T16:00:01.000Z',
      config: {},
      filters: {},
      filterSignature: 'filters:{}',
      checkpointPersistence: 'deferred',
      result: {
        ...emptyConnectorRefreshResult({
          checkpoint: { cursor: 'deferred-cursor' },
          coverage: {
            start: '2026-07-08T15:00:00.000Z',
            end: '2026-07-08T16:00:00.000Z',
          },
        }),
        status: 'partial_success',
      },
    })

    expect(run).toMatchObject({
      completedAt: null,
      id: request.id,
      status: 'running',
    })

    await expect(repository.completeRun({
      completedAt: '2026-07-08T16:00:02.000Z',
      connectorRunId: request.id,
      status: 'partial_success',
    })).resolves.toMatchObject({
      completedAt: '2026-07-08T16:00:02.000Z',
      id: request.id,
      status: 'partial_success',
    })
  })

  it('returns the active run request until failure releases the connector instance', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)

    await repository.upsertInstance({
      id: 'connector-instance-single-flight',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Single-flight fixture jobs',
      enabled: true,
      createdAt: '2026-07-08T15:00:00.000Z',
    })

    const first = await repository.recordRunRequest({
      connectorInstanceId: 'connector-instance-single-flight',
      mode: 'manual',
      startedAt: '2026-07-08T16:00:00.000Z',
    })
    const queuedDuplicate = await repository.recordRunRequest({
      connectorInstanceId: 'connector-instance-single-flight',
      mode: 'scheduled',
      startedAt: '2026-07-08T16:00:01.000Z',
    })

    expect(first).toMatchObject({ acquired: true, run: { status: 'queued' } })
    expect(queuedDuplicate).toMatchObject({
      acquired: false,
      run: { id: first.run.id, mode: 'manual', status: 'queued' },
    })

    await repository.markRunRunning({
      connectorRunId: first.run.id,
      startedAt: '2026-07-08T16:00:00.000Z',
    })
    await expect(repository.recordRunRequest({
      connectorInstanceId: 'connector-instance-single-flight',
      mode: 'manual',
      startedAt: '2026-07-08T16:00:02.000Z',
    })).resolves.toMatchObject({
      acquired: false,
      run: { id: first.run.id, status: 'running' },
    })

    await repository.markRunFailed({
      connectorRunId: first.run.id,
      completedAt: '2026-07-08T16:00:03.000Z',
      warning: {
        code: 'connector.execution_failed',
        message: 'Connector execution failed.',
      },
    })
    const retry = await repository.recordRunRequest({
      connectorInstanceId: 'connector-instance-single-flight',
      mode: 'manual',
      startedAt: '2026-07-08T16:00:04.000Z',
    })

    expect(retry).toMatchObject({ acquired: true, run: { status: 'queued' } })
    expect(retry.run.id).not.toBe(first.run.id)
    await expect(repository.listRuns({
      connectorInstanceId: 'connector-instance-single-flight',
    })).resolves.toMatchObject({ total: 2 })
  })

  it('records failed connector run attempts without advancing checkpoints', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)

    await repository.upsertInstance({
      id: 'connector-instance-failed',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Failed fixture jobs',
      enabled: true,
      filters: { roleKeywords: ['intern'] },
      createdAt: '2026-07-08T15:00:00.000Z',
    })

    const run = await repository.recordRunFailure({
      connectorInstanceId: 'connector-instance-failed',
      mode: 'manual',
      startedAt: '2026-07-08T16:00:00.000Z',
      completedAt: '2026-07-08T16:00:02.000Z',
      coverageStartedAt: '2026-07-08T15:00:00.000Z',
      coverageEndedAt: '2026-07-08T16:00:00.000Z',
      retryHints: null,
      warning: {
        code: 'connector.execution_failed',
        message: 'Connector execution failed.',
      },
    })

    expect(run).toMatchObject({
      connectorInstanceId: 'connector-instance-failed',
      coverageEndedAt: '2026-07-08T16:00:00.000Z',
      coverageStartedAt: '2026-07-08T15:00:00.000Z',
      filterSignature: 'filters:{"roleKeywords":["intern"]}',
      mode: 'manual',
      observationCount: 0,
      retryHints: null,
      status: 'failed',
      warningCount: 1,
      warnings: [
        {
          code: 'connector.execution_failed',
          message: 'Connector execution failed.',
        },
      ],
    })
    await expect(
      repository.getCheckpoint({
        connectorInstanceId: 'connector-instance-failed',
        filterSignature: 'filters:{"roleKeywords":["intern"]}',
      }),
    ).resolves.toBeNull()
    await expect(
      repository.listObservations({
        connectorInstanceId: 'connector-instance-failed',
      }),
    ).resolves.toEqual([])
  })

  it('lists enabled connector instances with their latest run status', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)

    await repository.upsertInstance({
      id: 'connector-instance-fixture',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.1.0',
      displayName: 'Fixture Jobs',
      enabled: true,
      createdAt: '2026-07-08T15:00:00.000Z',
    })
    await repository.upsertInstance({
      id: 'connector-instance-disabled',
      connectorId: 'disabled.jobs',
      connectorVersion: '0.1.0',
      displayName: 'Disabled connector',
      enabled: false,
      createdAt: '2026-07-08T15:00:00.000Z',
    })

    await repository.recordRefreshResult({
      connectorInstanceId: 'connector-instance-fixture',
      mode: 'manual',
      startedAt: '2026-07-08T16:00:00.000Z',
      completedAt: '2026-07-08T16:00:01.000Z',
      config: {},
      filters: {},
      filterSignature: 'filters:{}',
      result: emptyConnectorRefreshResult({
        checkpoint: { cursor: 'older-cursor' },
        coverage: {
          start: '2026-07-08T15:00:00.000Z',
          end: '2026-07-08T16:00:00.000Z',
        },
      }),
    })
    await repository.recordRefreshResult({
      connectorInstanceId: 'connector-instance-fixture',
      mode: 'catch_up',
      startedAt: '2026-07-08T17:00:00.000Z',
      completedAt: '2026-07-08T17:00:01.000Z',
      config: {},
      filters: {},
      filterSignature: 'filters:{}',
      result: {
        ...emptyConnectorRefreshResult({
          checkpoint: { cursor: 'latest-cursor' },
          coverage: {
            start: '2026-07-08T16:00:00.000Z',
            end: '2026-07-08T17:00:00.000Z',
          },
        }),
        status: 'partial_success',
        warnings: [
          {
            code: 'auth.expired_session',
            message: 'Fixture session expired.',
          },
        ],
        retryHints: null,
      },
    })
    await repository.recordRefreshResult({
      connectorInstanceId: 'connector-instance-disabled',
      mode: 'manual',
      startedAt: '2026-07-08T18:00:00.000Z',
      completedAt: '2026-07-08T18:00:01.000Z',
      config: {},
      filters: {},
      filterSignature: 'filters:{}',
      result: emptyConnectorRefreshResult({
        checkpoint: { cursor: 'disabled-cursor' },
        coverage: {
          start: '2026-07-08T17:00:00.000Z',
          end: '2026-07-08T18:00:00.000Z',
        },
      }),
    })

    await expect(repository.listStatusSummaries()).resolves.toMatchObject([
      {
        connectorId: 'fixture.jobs',
        connectorVersion: '0.1.0',
        displayName: 'Fixture Jobs',
        enabled: true,
        id: 'connector-instance-fixture',
        latestRun: expect.objectContaining({
          completedAt: '2026-07-08T17:00:01.000Z',
          coverageEndedAt: '2026-07-08T17:00:00.000Z',
          coverageStartedAt: '2026-07-08T16:00:00.000Z',
          mode: 'catch_up',
          observationCount: 0,
          retryHints: null,
          startedAt: '2026-07-08T17:00:00.000Z',
          status: 'partial_success',
          warningCount: 1,
          warnings: [
            {
              code: 'auth.expired_session',
              message: 'Fixture session expired.',
            },
          ],
        }),
      },
    ])
  })})

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
