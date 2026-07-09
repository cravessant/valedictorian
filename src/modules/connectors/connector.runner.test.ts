import { describe, expect, it } from 'vitest'
import { createDrizzleDatabase, createInMemoryDatabase, migrateDatabase } from '../../db/sqlite'
import { createSqliteProfileRepository, type ProfileSecretCodec } from '../profile/profile.repository'
import { createSqliteConnectorRepository, type ConnectorCoverageWindow } from './connector.repository'
import { createConnectorRunner, type AppJobConnector } from './connector.runner'

const testCodec: ProfileSecretCodec = {
  decrypt(value) {
    return value.replace(/^enc:/, '')
  },
  encrypt(value) {
    return `enc:${value}`
  },
}

describe('connector runner', () => {
  it('invokes a fixture connector through the app host and stores its refresh result', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    const runner = createConnectorRunner({ repository })
    const observedAt = '2026-07-08T17:00:00.000Z'
    const receivedInputs: unknown[] = []
    const fixtureConnector: AppJobConnector = {
      definition: {
        id: 'fixture.jobs',
        version: '0.0.0-fixture',
      },
      async refresh(input) {
        receivedInputs.push(input)

        return {
          coverage: input.coverage,
          stats: {
            observations: 1,
          },
          warnings: [],
          nextCheckpoint: {
            checkpoint: {
              cursor: `fixture:${observedAt}`,
            },
            schemaVersion: 'fixture-checkpoint@1',
          },
          observations: [
            {
              connectorId: 'fixture.jobs',
              connectorVersion: '0.0.0-fixture',
              sourceRecordKey: 'fixture.jobs:software-engineering-intern',
              observedAt,
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
                  capturedAt: observedAt,
                  sourceUrl: 'https://example.test/jobs/software-engineering-intern',
                },
              ],
            },
          ],
        }
      },
    }

    await runner.registerInstance({
      id: 'connector-instance-fixture',
      connector: fixtureConnector,
      displayName: 'Fixture jobs',
      enabled: true,
      config: { fixture: true },
      filters: { roleKeywords: ['intern'] },
      createdAt: '2026-07-08T16:55:00.000Z',
    })

    const firstRun = await runner.refresh(fixtureConnector, {
      connectorInstanceId: 'connector-instance-fixture',
      mode: 'manual',
      coverage: {
        start: '2026-07-01T00:00:00.000Z',
        end: observedAt,
      },
      startedAt: '2026-07-08T17:00:00.000Z',
      completedAt: '2026-07-08T17:00:01.000Z',
    })

    expect(firstRun).toMatchObject({
      status: 'completed',
      observationCount: 1,
      coverageStartedAt: '2026-07-01T00:00:00.000Z',
      coverageEndedAt: observedAt,
    })
    expect(receivedInputs).toEqual([
      {
        connectorInstanceId: 'connector-instance-fixture',
        mode: 'manual',
        coverage: {
          start: '2026-07-01T00:00:00.000Z',
          end: observedAt,
        },
        config: {
          fixture: true,
        },
        filters: {
          roleKeywords: ['intern'],
        },
      },
    ])

    await runner.refresh(fixtureConnector, {
      connectorInstanceId: 'connector-instance-fixture',
      mode: 'manual',
      coverage: {
        start: observedAt,
        end: '2026-07-08T18:00:00.000Z',
      },
      startedAt: '2026-07-08T18:00:00.000Z',
      completedAt: '2026-07-08T18:00:01.000Z',
    })

    expect(receivedInputs[1]).toMatchObject({
      connectorInstanceId: 'connector-instance-fixture',
      checkpoint: {
        cursor: `fixture:${observedAt}`,
      },
      config: {
        fixture: true,
      },
      filters: {
        roleKeywords: ['intern'],
      },
    })

    await runner.registerInstance({
      id: 'connector-instance-fixture',
      connector: fixtureConnector,
      displayName: 'Fixture jobs',
      enabled: true,
      config: { fixture: true },
      filters: { roleKeywords: ['new grad'] },
    })

    const changedFilterRun = await runner.refresh(fixtureConnector, {
      connectorInstanceId: 'connector-instance-fixture',
      mode: 'manual',
      coverage: {
        start: '2026-07-08T18:00:00.000Z',
        end: '2026-07-08T19:00:00.000Z',
      },
      startedAt: '2026-07-08T19:00:00.000Z',
      completedAt: '2026-07-08T19:00:01.000Z',
    })

    expect(receivedInputs[2]).toMatchObject({
      connectorInstanceId: 'connector-instance-fixture',
      config: {
        fixture: true,
      },
      filters: {
        roleKeywords: ['new grad'],
      },
    })
    expect(receivedInputs[2]).not.toHaveProperty('checkpoint')
    expect(changedFilterRun).toMatchObject({
      config: {
        fixture: true,
      },
      filters: {
        roleKeywords: ['new grad'],
      },
      filterSignature: 'filters:{"roleKeywords":["new grad"]}',
    })
    await expect(
      repository.listObservations({ connectorInstanceId: 'connector-instance-fixture' }),
    ).resolves.toHaveLength(3)
  })

  it('provides a ready no-auth grant through the connector runtime', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    const runner = createConnectorRunner({ repository })
    const receivedGrants: unknown[] = []
    const fixtureConnector: AppJobConnector = {
      definition: {
        id: 'fixture.public-jobs',
        version: '0.0.0-fixture',
        auth: {
          modes: ['none'],
          requirements: [
            {
              id: 'public',
              mode: 'none',
            },
          ],
        },
      },
      async refresh(input, runtime) {
        receivedGrants.push(
          await runtime.auth.resolve({
            id: 'public',
          }),
        )

        return emptyConnectorRefreshResult({
          coverage: input.coverage,
          checkpoint: { cursor: input.coverage.end },
        })
      },
    }

    await runner.registerInstance({
      id: 'connector-instance-public',
      connector: fixtureConnector,
      displayName: 'Public jobs',
      enabled: true,
      createdAt: '2026-07-08T16:55:00.000Z',
    })

    await runner.refresh(fixtureConnector, {
      connectorInstanceId: 'connector-instance-public',
      mode: 'manual',
      coverage: {
        start: '2026-07-08T17:00:00.000Z',
        end: '2026-07-08T18:00:00.000Z',
      },
    })

    expect(receivedGrants).toEqual([
      {
        id: 'public',
        mode: 'none',
        status: 'ready',
      },
    ])
  })

  it('resolves secret-backed auth grants from app-owned encrypted profile secrets', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    const profileRepository = createSqliteProfileRepository(database, testCodec)
    const runner = createConnectorRunner({
      repository,
      auth: {
        secrets: profileRepository,
      },
    })
    const receivedGrants: unknown[] = []
    const fixtureConnector: AppJobConnector = {
      definition: {
        id: 'fixture.secret-jobs',
        version: '0.0.0-fixture',
        auth: {
          modes: ['api_key'],
          requirements: [
            {
              id: 'fixture-api',
              mode: 'api_key',
              label: 'Fixture API key',
            },
          ],
        },
      },
      async refresh(input, runtime) {
        const grant = await runtime.auth.resolve({
          id: 'fixture-api',
          mode: 'api_key',
        })
        receivedGrants.push(grant)

        return {
          ...emptyConnectorRefreshResult({
            coverage: input.coverage,
            checkpoint: { cursor: input.coverage.end },
          }),
          stats: {
            observations: 0,
            copiedValue: grant.value,
            leakedGrant: grant,
          },
          warnings: [
            {
              code: 'fixture.leak',
              message: `leaked ${grant.value}`,
            },
          ],
          retryHints: {
            copiedValue: grant.value,
            grant,
          },
          nextCheckpoint: {
            checkpoint: {
              copiedValue: grant.value,
              grant,
            },
            schemaVersion: 'fixture-checkpoint@1',
          },
        }
      },
    }

    await profileRepository.upsertSecret({
      key: 'fixture_api_key',
      kind: 'token',
      label: 'Fixture API key',
      value: 'fixture-secret',
    })
    await runner.registerInstance({
      id: 'connector-instance-secret',
      connector: fixtureConnector,
      displayName: 'Secret jobs',
      enabled: true,
      auth: [
        {
          id: 'fixture-api',
          mode: 'api_key',
          secretKey: 'fixture_api_key',
        },
      ],
      createdAt: '2026-07-08T16:55:00.000Z',
    })

    const run = await runner.refresh(fixtureConnector, {
      connectorInstanceId: 'connector-instance-secret',
      mode: 'manual',
      coverage: {
        start: '2026-07-08T17:00:00.000Z',
        end: '2026-07-08T18:00:00.000Z',
      },
    })

    expect(receivedGrants).toEqual([
      {
        id: 'fixture-api',
        mode: 'api_key',
        secretKey: 'fixture_api_key',
        status: 'ready',
        value: 'fixture-secret',
      },
    ])
    expect(JSON.stringify(run)).not.toContain('fixture-secret')
    expect(JSON.stringify(run)).toContain('[redacted-secret]')
    await expect(
      repository.getCheckpoint({
        connectorInstanceId: 'connector-instance-secret',
        filterSignature: 'filters:{}',
      }),
    ).resolves.toEqual({
      connectorInstanceId: 'connector-instance-secret',
      filterSignature: 'filters:{}',
      checkpoint: {
        copiedValue: '[redacted-secret]',
        grant: {
          id: 'fixture-api',
          mode: 'api_key',
          secretKey: 'fixture_api_key',
          status: 'ready',
          value: '[redacted-secret]',
        },
      },
      schemaVersion: 'fixture-checkpoint@1',
      coverageStartedAt: '2026-07-08T17:00:00.000Z',
      coverageEndedAt: '2026-07-08T18:00:00.000Z',
    })
    expect(
      JSON.stringify(
        await repository.getCheckpoint({
          connectorInstanceId: 'connector-instance-secret',
          filterSignature: 'filters:{}',
        }),
      ),
    ).not.toContain('fixture-secret')
    await expect(repository.getInstance('connector-instance-secret')).resolves.toMatchObject({
      auth: [
        {
          id: 'fixture-api',
          mode: 'api_key',
          secretKey: 'fixture_api_key',
        },
      ],
    })
    expect(JSON.stringify(await repository.getInstance('connector-instance-secret'))).not.toContain(
      'fixture-secret',
    )
  })

  it('redacts overlapping secret values longest-first before persisting connector results', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    const profileRepository = createSqliteProfileRepository(database, testCodec)
    const runner = createConnectorRunner({
      repository,
      auth: {
        secrets: profileRepository,
      },
    })
    const fixtureConnector: AppJobConnector = {
      definition: {
        id: 'fixture.overlap-secret-jobs',
        version: '0.0.0-fixture',
        auth: {
          modes: ['api_key'],
        },
      },
      async refresh(input, runtime) {
        await runtime.auth.resolve({
          id: 'short',
          mode: 'api_key',
        })
        await runtime.auth.resolve({
          id: 'long',
          mode: 'api_key',
        })

        return {
          ...emptyConnectorRefreshResult({
            coverage: input.coverage,
            checkpoint: { cursor: input.coverage.end },
          }),
          stats: {
            observations: 0,
            copiedValue: 'abc123',
          },
          warnings: [
            {
              code: 'fixture.leak',
              message: 'leaked abc123',
            },
          ],
          nextCheckpoint: {
            checkpoint: {
              copiedValue: 'abc123',
            },
            schemaVersion: 'fixture-checkpoint@1',
          },
        }
      },
    }

    await profileRepository.upsertSecret({
      key: 'short_key',
      kind: 'token',
      label: 'Short key',
      value: 'abc',
    })
    await profileRepository.upsertSecret({
      key: 'long_key',
      kind: 'token',
      label: 'Long key',
      value: 'abc123',
    })
    await runner.registerInstance({
      id: 'connector-instance-overlap-secret',
      connector: fixtureConnector,
      displayName: 'Overlap secret jobs',
      enabled: true,
      auth: [
        {
          id: 'short',
          mode: 'api_key',
          secretKey: 'short_key',
        },
        {
          id: 'long',
          mode: 'api_key',
          secretKey: 'long_key',
        },
      ],
      createdAt: '2026-07-08T16:55:00.000Z',
    })

    const run = await runner.refresh(fixtureConnector, {
      connectorInstanceId: 'connector-instance-overlap-secret',
      mode: 'manual',
      coverage: {
        start: '2026-07-08T17:00:00.000Z',
        end: '2026-07-08T18:00:00.000Z',
      },
    })
    const checkpoint = await repository.getCheckpoint({
      connectorInstanceId: 'connector-instance-overlap-secret',
      filterSignature: 'filters:{}',
    })
    const persisted = JSON.stringify({
      checkpoint: checkpoint?.checkpoint,
      stats: run.stats,
      warnings: run.warnings,
    })

    expect(persisted).toContain('[redacted-secret]')
    expect(persisted).not.toContain('abc')
    expect(persisted).not.toContain('123')
  })

  it('returns missing secret-backed grants without exposing persistence to connectors', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    const profileRepository = createSqliteProfileRepository(database, testCodec)
    const runner = createConnectorRunner({
      repository,
      auth: {
        secrets: profileRepository,
      },
    })
    const receivedGrants: unknown[] = []
    const fixtureConnector: AppJobConnector = {
      definition: {
        id: 'fixture.missing-secret-jobs',
        version: '0.0.0-fixture',
        auth: {
          modes: ['bearer_token'],
        },
      },
      async refresh(input, runtime) {
        receivedGrants.push(
          await runtime.auth.resolve({
            id: 'fixture-auth',
            mode: 'bearer_token',
          }),
        )

        return emptyConnectorRefreshResult({
          coverage: input.coverage,
          checkpoint: { cursor: input.coverage.end },
        })
      },
    }

    await runner.registerInstance({
      id: 'connector-instance-missing-secret',
      connector: fixtureConnector,
      displayName: 'Missing secret jobs',
      enabled: true,
      auth: [
        {
          id: 'fixture-auth',
          mode: 'bearer_token',
          secretKey: 'fixture_token',
        },
      ],
      createdAt: '2026-07-08T16:55:00.000Z',
    })

    await runner.refresh(fixtureConnector, {
      connectorInstanceId: 'connector-instance-missing-secret',
      mode: 'manual',
      coverage: {
        start: '2026-07-08T17:00:00.000Z',
        end: '2026-07-08T18:00:00.000Z',
      },
    })

    expect(receivedGrants).toEqual([
      {
        id: 'fixture-auth',
        mode: 'bearer_token',
        reason: 'secret_missing',
        secretKey: 'fixture_token',
        status: 'missing',
      },
    ])
  })

  it('returns browser-session action-required grants when no local session resolver is configured', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    const runner = createConnectorRunner({ repository })
    const receivedGrants: unknown[] = []
    const fixtureConnector: AppJobConnector = {
      definition: {
        id: 'fixture.browser-jobs',
        version: '0.0.0-fixture',
        auth: {
          modes: ['browser_session'],
        },
      },
      async refresh(input, runtime) {
        receivedGrants.push(
          await runtime.auth.resolve({
            id: 'fixture-auth',
            mode: 'browser_session',
          }),
        )

        return emptyConnectorRefreshResult({
          coverage: input.coverage,
          checkpoint: { cursor: input.coverage.end },
        })
      },
    }

    await runner.registerInstance({
      id: 'connector-instance-browser',
      connector: fixtureConnector,
      displayName: 'Browser jobs',
      enabled: true,
      auth: [
        {
          id: 'fixture-auth',
          mode: 'browser_session',
        },
      ],
      createdAt: '2026-07-08T16:55:00.000Z',
    })

    await runner.refresh(fixtureConnector, {
      connectorInstanceId: 'connector-instance-browser',
      mode: 'manual',
      coverage: {
        start: '2026-07-08T17:00:00.000Z',
        end: '2026-07-08T18:00:00.000Z',
      },
    })

    expect(receivedGrants).toEqual([
      {
        id: 'fixture-auth',
        mode: 'browser_session',
        reason: 'browser_session_action_required',
        status: 'action_required',
      },
    ])
  })

  it('redacts browser-session handles before persisting connector results', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    const runner = createConnectorRunner({
      repository,
      auth: {
        browserSessions: {
          async resolve(reference) {
            return {
              id: 'ignored-id',
              mode: 'browser_session',
              secretKey: 'should-not-cross-session-boundary',
              sessionId: 'fixture-session-123',
              sessionKey: 'resolver-session-key',
              status: 'ready',
              value: 'should-not-cross-session-boundary',
              ...(reference.sessionKey ? { reason: reference.sessionKey } : {}),
            } as never
          },
        },
      },
    })
    const receivedGrants: unknown[] = []
    const fixtureConnector: AppJobConnector = {
      definition: {
        id: 'fixture.browser-jobs',
        version: '0.0.0-fixture',
        auth: {
          modes: ['browser_session'],
        },
      },
      async refresh(input, runtime) {
        const grant = await runtime.auth.resolve({
          id: 'fixture-auth',
          mode: 'browser_session',
        })
        receivedGrants.push(grant)

        return {
          ...emptyConnectorRefreshResult({
            coverage: input.coverage,
            checkpoint: { cursor: input.coverage.end },
          }),
          stats: {
            observations: 0,
            leakedGrant: grant,
          },
          warnings: [
            {
              code: 'fixture.session_leak',
              message: `leaked ${grant.sessionId} ${grant.sessionKey}`,
            },
          ],
          retryHints: {
            grant,
          },
          nextCheckpoint: {
            checkpoint: {
              grant,
            },
            schemaVersion: 'fixture-checkpoint@1',
          },
        }
      },
    }

    await runner.registerInstance({
      id: 'connector-instance-browser-session',
      connector: fixtureConnector,
      displayName: 'Browser jobs',
      enabled: true,
      auth: [
        {
          id: 'fixture-auth',
          mode: 'browser_session',
          sessionKey: 'workspace_session_1',
        },
      ],
      createdAt: '2026-07-08T16:55:00.000Z',
    })

    const run = await runner.refresh(fixtureConnector, {
      connectorInstanceId: 'connector-instance-browser-session',
      mode: 'manual',
      coverage: {
        start: '2026-07-08T17:00:00.000Z',
        end: '2026-07-08T18:00:00.000Z',
      },
    })
    const checkpoint = await repository.getCheckpoint({
      connectorInstanceId: 'connector-instance-browser-session',
      filterSignature: 'filters:{}',
    })
    const persisted = JSON.stringify({ run, checkpoint })

    expect(receivedGrants).toEqual([
      {
        id: 'fixture-auth',
        mode: 'browser_session',
        reason: 'workspace_session_1',
        sessionId: 'fixture-session-123',
        sessionKey: 'workspace_session_1',
        status: 'ready',
      },
    ])
    expect(persisted).toContain('[redacted-secret]')
    expect(persisted).not.toContain('fixture-session-123')
    expect(persisted).not.toContain('workspace_session_1')
    expect(persisted).not.toContain('resolver-session-key')
    expect(persisted).not.toContain('should-not-cross-session-boundary')
  })

  it('computes first catch-up coverage from connector-added time and the default backfill cap', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    const runner = createConnectorRunner({ repository })
    const receivedInputs: Array<{ coverage: { start: string; end: string } }> = []
    const fixtureConnector: AppJobConnector = {
      definition: {
        id: 'fixture.jobs',
        version: '0.0.0-fixture',
      },
      async refresh(input) {
        receivedInputs.push(input)

        return {
          coverage: input.coverage,
          stats: {
            observations: 0,
          },
          warnings: [],
          nextCheckpoint: {
            checkpoint: {
              cursor: input.coverage.end,
            },
            schemaVersion: 'fixture-checkpoint@1',
          },
          observations: [],
        }
      },
    }

    await runner.registerInstance({
      id: 'connector-instance-fixture',
      connector: fixtureConnector,
      displayName: 'Fixture jobs',
      enabled: true,
      createdAt: '2026-07-08T16:00:00.000Z',
    })

    const run = await runner.catchUp(fixtureConnector, {
      connectorInstanceId: 'connector-instance-fixture',
      now: '2026-07-09T16:00:00.000Z',
      startedAt: '2026-07-09T16:00:00.000Z',
      completedAt: '2026-07-09T16:00:01.000Z',
    })

    expect(receivedInputs[0]?.coverage).toEqual({
      start: '2026-07-01T16:00:00.000Z',
      end: '2026-07-09T16:00:00.000Z',
    })
    expect(run).toMatchObject({
      mode: 'catch_up',
      coverageStartedAt: '2026-07-01T16:00:00.000Z',
      coverageEndedAt: '2026-07-09T16:00:00.000Z',
    })
  })

  it('computes missed-run catch-up coverage from the previous checkpoint with overlap', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    const runner = createConnectorRunner({ repository })
    const receivedInputs: Array<{ coverage: { start: string; end: string } }> = []
    const fixtureConnector: AppJobConnector = {
      definition: {
        id: 'fixture.jobs',
        version: '0.0.0-fixture',
      },
      async refresh(input) {
        receivedInputs.push(input)

        return {
          coverage: input.coverage,
          stats: {
            observations: 0,
          },
          warnings: [],
          nextCheckpoint: {
            checkpoint: {
              cursor: input.coverage.end,
            },
            schemaVersion: 'fixture-checkpoint@1',
          },
          observations: [],
        }
      },
    }

    await runner.registerInstance({
      id: 'connector-instance-fixture',
      connector: fixtureConnector,
      displayName: 'Fixture jobs',
      enabled: true,
      createdAt: '2026-07-08T16:00:00.000Z',
    })

    await runner.catchUp(fixtureConnector, {
      connectorInstanceId: 'connector-instance-fixture',
      now: '2026-07-09T16:00:00.000Z',
      startedAt: '2026-07-09T16:00:00.000Z',
      completedAt: '2026-07-09T16:00:01.000Z',
    })
    const run = await runner.catchUp(fixtureConnector, {
      connectorInstanceId: 'connector-instance-fixture',
      now: '2026-07-10T16:00:00.000Z',
      startedAt: '2026-07-10T16:00:00.000Z',
      completedAt: '2026-07-10T16:00:01.000Z',
      policy: {
        overlapMinutes: 30,
      },
    })

    expect(receivedInputs[1]?.coverage).toEqual({
      start: '2026-07-09T15:30:00.000Z',
      end: '2026-07-10T16:00:00.000Z',
    })
    expect(run).toMatchObject({
      mode: 'catch_up',
      coverageStartedAt: '2026-07-09T15:30:00.000Z',
      coverageEndedAt: '2026-07-10T16:00:00.000Z',
    })
  })

  it('clamps configured catch-up backfill to the host maximum', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    const runner = createConnectorRunner({ repository })
    const receivedInputs: Array<{ coverage: { start: string; end: string } }> = []
    const fixtureConnector: AppJobConnector = {
      definition: {
        id: 'fixture.jobs',
        version: '0.0.0-fixture',
      },
      async refresh(input) {
        receivedInputs.push(input)

        return {
          coverage: input.coverage,
          stats: {
            observations: 0,
          },
          warnings: [],
          nextCheckpoint: {
            checkpoint: {
              cursor: input.coverage.end,
            },
            schemaVersion: 'fixture-checkpoint@1',
          },
          observations: [],
        }
      },
    }

    await runner.registerInstance({
      id: 'connector-instance-fixture',
      connector: fixtureConnector,
      displayName: 'Fixture jobs',
      enabled: true,
      createdAt: '2026-07-08T16:00:00.000Z',
    })

    await runner.catchUp(fixtureConnector, {
      connectorInstanceId: 'connector-instance-fixture',
      now: '2026-07-09T16:00:00.000Z',
      startedAt: '2026-07-09T16:00:00.000Z',
      completedAt: '2026-07-09T16:00:01.000Z',
      policy: {
        backfillDays: 90,
        maxBackfillDays: 30,
      },
    })

    expect(receivedInputs[0]?.coverage).toEqual({
      start: '2026-06-08T16:00:00.000Z',
      end: '2026-07-09T16:00:00.000Z',
    })
  })

  it('uses a connector-declared stricter backfill cap when computing catch-up coverage', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    const runner = createConnectorRunner({ repository })
    const receivedInputs: Array<{ coverage: { start: string; end: string } }> = []
    const fixtureConnector: AppJobConnector = {
      definition: {
        id: 'fixture.jobs',
        version: '0.0.0-fixture',
        politeness: {
          maxBackfillDays: 3,
        },
      },
      async refresh(input) {
        receivedInputs.push(input)

        return {
          coverage: input.coverage,
          stats: {
            observations: 0,
          },
          warnings: [],
          nextCheckpoint: {
            checkpoint: {
              cursor: input.coverage.end,
            },
            schemaVersion: 'fixture-checkpoint@1',
          },
          observations: [],
        }
      },
    }

    await runner.registerInstance({
      id: 'connector-instance-fixture',
      connector: fixtureConnector,
      displayName: 'Fixture jobs',
      enabled: true,
      createdAt: '2026-07-08T16:00:00.000Z',
    })

    await runner.catchUp(fixtureConnector, {
      connectorInstanceId: 'connector-instance-fixture',
      now: '2026-07-09T16:00:00.000Z',
      startedAt: '2026-07-09T16:00:00.000Z',
      completedAt: '2026-07-09T16:00:01.000Z',
      policy: {
        backfillDays: 7,
        maxBackfillDays: 30,
      },
    })

    expect(receivedInputs[0]?.coverage).toEqual({
      start: '2026-07-05T16:00:00.000Z',
      end: '2026-07-09T16:00:00.000Z',
    })
  })

  it('passes connector politeness defaults as a host-owned run budget during catch-up', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    const runner = createConnectorRunner({ repository })
    const receivedInputs: unknown[] = []
    const fixtureConnector: AppJobConnector = {
      definition: {
        id: 'fixture.jobs',
        version: '0.0.0-fixture',
        politeness: {
          concurrency: 1,
          minDelayMs: 1_000,
          maxDelayMs: 10_000,
          maxRequestsPerRun: 5,
        },
      },
      async refresh(input) {
        receivedInputs.push(input)

        return {
          coverage: input.coverage,
          stats: {
            observations: 0,
          },
          warnings: [],
          nextCheckpoint: {
            checkpoint: {
              cursor: input.coverage.end,
            },
            schemaVersion: 'fixture-checkpoint@1',
          },
          observations: [],
        }
      },
    }

    await runner.registerInstance({
      id: 'connector-instance-fixture',
      connector: fixtureConnector,
      displayName: 'Fixture jobs',
      enabled: true,
      createdAt: '2026-07-08T16:00:00.000Z',
    })

    await runner.catchUp(fixtureConnector, {
      connectorInstanceId: 'connector-instance-fixture',
      now: '2026-07-09T16:00:00.000Z',
      startedAt: '2026-07-09T16:00:00.000Z',
      completedAt: '2026-07-09T16:00:01.000Z',
    })

    expect(receivedInputs[0]).toMatchObject({
      budget: {
        concurrency: 1,
        minDelayMs: 1_000,
        maxDelayMs: 10_000,
        maxRequestsPerRun: 5,
      },
    })
  })

  it('uses the stricter host max requests policy when building a catch-up budget', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    const runner = createConnectorRunner({ repository })
    const receivedInputs: unknown[] = []
    const fixtureConnector: AppJobConnector = {
      definition: {
        id: 'fixture.jobs',
        version: '0.0.0-fixture',
        politeness: {
          concurrency: 1,
          maxRequestsPerRun: 10,
        },
      },
      async refresh(input) {
        receivedInputs.push(input)

        return {
          coverage: input.coverage,
          stats: {
            observations: 0,
          },
          warnings: [],
          nextCheckpoint: {
            checkpoint: {
              cursor: input.coverage.end,
            },
            schemaVersion: 'fixture-checkpoint@1',
          },
          observations: [],
        }
      },
    }

    await runner.registerInstance({
      id: 'connector-instance-fixture',
      connector: fixtureConnector,
      displayName: 'Fixture jobs',
      enabled: true,
      createdAt: '2026-07-08T16:00:00.000Z',
    })

    await runner.catchUp(fixtureConnector, {
      connectorInstanceId: 'connector-instance-fixture',
      now: '2026-07-09T16:00:00.000Z',
      startedAt: '2026-07-09T16:00:00.000Z',
      completedAt: '2026-07-09T16:00:01.000Z',
      policy: {
        maxRequestsPerRun: 3,
      },
    })

    expect(receivedInputs[0]).toMatchObject({
      budget: {
        concurrency: 1,
        maxRequestsPerRun: 3,
      },
    })
  })

  it('records exhausted-budget partial success without advancing past the connector checkpoint', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    const runner = createConnectorRunner({ repository })
    const fixtureConnector: AppJobConnector = {
      definition: {
        id: 'fixture.jobs',
        version: '0.0.0-fixture',
        politeness: {
          maxRequestsPerRun: 1,
        },
      },
      async refresh(input) {
        return {
          status: 'partial_success',
          coverage: {
            start: input.coverage.start,
            end: '2026-07-09T16:05:00.000Z',
          },
          stats: {
            observations: 1,
            skipped: 4,
          },
          warnings: [
            {
              code: 'connector.budget_exhausted',
              message: 'Run stopped after exhausting its host budget.',
            },
          ],
          retryHints: {
            reason: 'budget_exhausted',
            resumeAfter: '2026-07-09T16:10:00.000Z',
          },
          nextCheckpoint: {
            checkpoint: {
              cursor: 'partial:2026-07-09T16:05:00.000Z',
            },
            schemaVersion: 'fixture-checkpoint@1',
          },
          observations: [],
        }
      },
    }

    await runner.registerInstance({
      id: 'connector-instance-fixture',
      connector: fixtureConnector,
      displayName: 'Fixture jobs',
      enabled: true,
      createdAt: '2026-07-08T16:00:00.000Z',
    })

    const run = await runner.catchUp(fixtureConnector, {
      connectorInstanceId: 'connector-instance-fixture',
      now: '2026-07-09T17:00:00.000Z',
      startedAt: '2026-07-09T17:00:00.000Z',
      completedAt: '2026-07-09T17:00:01.000Z',
    })

    expect(run).toMatchObject({
      status: 'partial_success',
      coverageEndedAt: '2026-07-09T16:05:00.000Z',
      retryHints: {
        reason: 'budget_exhausted',
        resumeAfter: '2026-07-09T16:10:00.000Z',
      },
    })
    await expect(
      repository.getCheckpoint({
        connectorInstanceId: 'connector-instance-fixture',
        filterSignature: 'filters:{}',
      }),
    ).resolves.toMatchObject({
      coverageEndedAt: '2026-07-09T16:05:00.000Z',
      checkpoint: {
        cursor: 'partial:2026-07-09T16:05:00.000Z',
      },
    })
  })
})

function emptyConnectorRefreshResult({
  checkpoint,
  coverage,
}: {
  checkpoint: unknown
  coverage: ConnectorCoverageWindow
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
