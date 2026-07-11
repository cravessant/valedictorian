import { describe, expect, it } from 'vitest'
import { createDrizzleDatabase, createInMemoryDatabase, migrateDatabase } from '../../db/sqlite'
import { createSqliteProfileRepository, type ProfileSecretCodec } from '../profile/profile.repository'
import {
  createSqliteConnectorRepository,
  type ConnectorCoverageWindow,
  type ConnectorObservationInput,
} from './connector.repository'
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
    const delayInputs: unknown[] = []
    const runner = createConnectorRunner({
      repository,
      workspaceId: 'workspace-fixture',
      runtime: {
        delay: {
          async wait(input) {
            delayInputs.push(input)

            return input.minDelayMs
          },
        },
      },
    })
    const observedAt = '2026-07-08T17:00:00.000Z'
    const receivedInputs: unknown[] = []
    const fixtureConnector: AppJobConnector = {
      definition: {
        id: 'fixture.jobs',
        version: '0.0.0-fixture',
      },
      async refresh(input, runtime) {
        receivedInputs.push(input)
        await runtime.delay?.wait({
          minDelayMs: 1000,
          maxDelayMs: 10_000,
          reason: 'fixture-politeness',
        })

        return {
          coverage: input.coverage,
          stats: {
            observations: 1,
          },
          warnings: [],
          nextCheckpoint: {
            checkpoint: {
              attempted: 3,
              authRequired: 1,
              cursor: `fixture:${observedAt}`,
              discovered: 12,
              eligible: 8,
              resolved: 2,
              sensitiveSessionKey: 'must-not-reach-run-stats',
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
      stats: {
        attempted: 3,
        authRequired: 1,
        discovered: 12,
        eligible: 8,
        observations: 1,
        resolved: 2,
      },
      coverageStartedAt: '2026-07-01T00:00:00.000Z',
      coverageEndedAt: observedAt,
    })
    expect(firstRun.stats).not.toHaveProperty('sensitiveSessionKey')
    expect(receivedInputs).toEqual([
      {
        connectorInstanceId: 'connector-instance-fixture',
        workspaceId: 'workspace-fixture',
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
    expect(delayInputs).toEqual([
      {
        minDelayMs: 1000,
        maxDelayMs: 10_000,
        reason: 'fixture-politeness',
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
    const runner = createConnectorRunner({ repository, workspaceId: 'workspace-fixture' })
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

  it('passes the current Jobright checkpoint payload without legacy observation seeds', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    const runner = createConnectorRunner({ repository, workspaceId: 'workspace-fixture' })
    const receivedInputs: unknown[] = []
    const connector: AppJobConnector = {
      definition: {
        id: 'jobright.resolver',
        version: '0.6.0',
        capabilities: { supportsFiltering: false },
      },
      async refresh(input) {
        receivedInputs.push(input)
        return {
          ...emptyConnectorRefreshResult({
            coverage: input.coverage,
            checkpoint: { cycleId: 'continued-cycle' },
          }),
          nextCheckpoint: {
            checkpoint: { cycleId: 'continued-cycle' },
            schemaVersion: 'jobright-resolution-checkpoint@3',
          },
        }
      },
    }

    await repository.upsertInstance({
      id: 'jobright-seeded',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.6.0',
      displayName: 'Jobright internslist',
      enabled: true,
      filters: { roleTerms: ['intern'] },
    })
    await repository.recordRefreshResult({
      connectorInstanceId: 'jobright-seeded',
      mode: 'manual',
      startedAt: '2026-06-01T12:00:00.000Z',
      completedAt: '2026-06-01T12:00:01.000Z',
      config: {},
      filters: { roleTerms: ['intern'] },
      filterSignature: 'filters:{"roleTerms":["intern"]}',
      result: {
        ...emptyConnectorRefreshResult({
          coverage: {
            start: '2026-06-01T11:00:00.000Z',
            end: '2026-06-01T12:00:00.000Z',
          },
          checkpoint: { attempted: 2 },
        }),
        observations: [
          jobrightSeedObservation('jobright.public:duplicate', '2026-06-01T10:00:00.000Z'),
          jobrightSeedObservation('jobright.public:duplicate', '2026-06-01T11:00:00.000Z'),
          jobrightSeedObservation('jobright.public:second', '2026-06-01T09:00:00.000Z'),
        ],
        stats: { observations: 3 },
      },
    })
    await repository.recordCheckpoint({
      connectorInstanceId: 'jobright-seeded',
      filterSignature: 'provider-state:jobright.resolver@0.6.0',
      checkpoint: {
        checkpoint: { attempted: 2 },
        schemaVersion: 'jobright-resolution-checkpoint@3',
      },
      coverage: {
        start: '2026-06-01T11:00:00.000Z',
        end: '2026-06-01T12:00:00.000Z',
      },
      savedAt: '2026-06-01T12:00:01.000Z',
    })

    const run = await runner.refresh(connector, {
      connectorInstanceId: 'jobright-seeded',
      mode: 'manual',
      coverage: {
        start: '2026-06-01T12:00:00.000Z',
        end: '2026-06-01T13:00:00.000Z',
      },
    })

    expect(receivedInputs).toEqual([
      expect.objectContaining({
        checkpoint: { attempted: 2 },
      }),
    ])
    expect(run.filterSignature).toBe('provider-state:jobright.resolver@0.6.0')

    await runner.refresh(connector, {
      connectorInstanceId: 'jobright-seeded',
      mode: 'catch_up',
      coverage: {
        start: '2026-06-01T13:00:00.000Z',
        end: '2026-06-01T14:00:00.000Z',
      },
    })

    expect(receivedInputs[1]).toMatchObject({
      checkpoint: { cycleId: 'continued-cycle' },
    })
    expect(receivedInputs[1]).not.toHaveProperty('observations')
  })

  it('resolves secret-backed auth grants from app-owned encrypted profile secrets', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    const profileRepository = createSqliteProfileRepository(database, testCodec)
    const runner = createConnectorRunner({
      repository,
      workspaceId: 'workspace-fixture',
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
      workspaceId: 'workspace-fixture',
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
      workspaceId: 'workspace-fixture',
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

  it('computes first catch-up coverage from connector-added time and the default backfill cap', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    const runner = createConnectorRunner({ repository, workspaceId: 'workspace-fixture' })
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
    const runner = createConnectorRunner({ repository, workspaceId: 'workspace-fixture' })
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
    const runner = createConnectorRunner({ repository, workspaceId: 'workspace-fixture' })
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
    const runner = createConnectorRunner({ repository, workspaceId: 'workspace-fixture' })
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
    const runner = createConnectorRunner({ repository, workspaceId: 'workspace-fixture' })
    const receivedInputs: unknown[] = []
    const fixtureConnector = createBudgetCapturingConnector(receivedInputs)

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

  it('passes connector politeness defaults as a host-owned run budget during manual refresh', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    const runner = createConnectorRunner({ repository, workspaceId: 'workspace-fixture' })
    const receivedInputs: unknown[] = []
    const fixtureConnector = createBudgetCapturingConnector(receivedInputs)

    await runner.registerInstance({
      id: 'connector-instance-fixture',
      connector: fixtureConnector,
      displayName: 'Fixture jobs',
      enabled: true,
      createdAt: '2026-07-08T16:00:00.000Z',
    })

    await runner.refresh(fixtureConnector, {
      connectorInstanceId: 'connector-instance-fixture',
      mode: 'manual',
      coverage: {
        start: '2026-07-09T15:00:00.000Z',
        end: '2026-07-09T16:00:00.000Z',
      },
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

  it('passes connector politeness defaults as a host-owned run budget during scheduled deferred refresh', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    const runner = createConnectorRunner({ repository, workspaceId: 'workspace-fixture' })
    const receivedInputs: unknown[] = []
    const fixtureConnector = createBudgetCapturingConnector(receivedInputs)

    await runner.registerInstance({
      id: 'connector-instance-fixture',
      connector: fixtureConnector,
      displayName: 'Fixture jobs',
      enabled: true,
      createdAt: '2026-07-08T16:00:00.000Z',
    })

    await runner.refreshWithDeferredCheckpoint(fixtureConnector, {
      connectorInstanceId: 'connector-instance-fixture',
      mode: 'scheduled',
      coverage: {
        start: '2026-07-09T15:00:00.000Z',
        end: '2026-07-09T16:00:00.000Z',
      },
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

  it('keeps explicit caller budgets for manual refreshes', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    const runner = createConnectorRunner({ repository, workspaceId: 'workspace-fixture' })
    const receivedInputs: unknown[] = []
    const fixtureConnector = createBudgetCapturingConnector(receivedInputs)

    await runner.registerInstance({
      id: 'connector-instance-fixture',
      connector: fixtureConnector,
      displayName: 'Fixture jobs',
      enabled: true,
      createdAt: '2026-07-08T16:00:00.000Z',
    })

    await runner.refresh(fixtureConnector, {
      connectorInstanceId: 'connector-instance-fixture',
      mode: 'manual',
      coverage: {
        start: '2026-07-09T15:00:00.000Z',
        end: '2026-07-09T16:00:00.000Z',
      },
      startedAt: '2026-07-09T16:00:00.000Z',
      completedAt: '2026-07-09T16:00:01.000Z',
      budget: {
        maxRequestsPerRun: 2,
      },
    })

    expect((receivedInputs[0] as { budget?: unknown }).budget).toEqual({
      maxRequestsPerRun: 2,
    })
  })

  it('uses the stricter host max requests policy when building a catch-up budget', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    const runner = createConnectorRunner({ repository, workspaceId: 'workspace-fixture' })
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
    const runner = createConnectorRunner({ repository, workspaceId: 'workspace-fixture' })
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

describe('connector validateAuth', () => {
  it('validates username/password credentials without recording run artifacts', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    const profileRepository = createSqliteProfileRepository(database, testCodec)
    const runner = createConnectorRunner({
      repository,
      workspaceId: 'workspace-fixture',
      auth: {
        secrets: profileRepository,
      },
    })
    const receivedValues: string[] = []
    const connector: AppJobConnector = {
      definition: {
        id: 'fixture.password-jobs',
        version: '0.0.0-fixture',
        auth: {
          modes: ['username_password'],
          requirements: [
            {
              id: 'jobright',
              mode: 'username_password',
              label: 'Jobright username and password',
              required: true,
            },
          ],
        },
      },
      async refresh() {
        throw new Error('refresh should not run during validateAuth')
      },
      async validateAuth(_input, runtime) {
        const grant = await runtime.auth.resolve({
          id: 'jobright',
          mode: 'username_password',
        })

        if (grant.status !== 'ready' || typeof grant.value !== 'string') {
          return {
            status: 'missing',
            reason: 'username_password_missing',
          }
        }

        receivedValues.push(grant.value)

        return {
          status: 'ready',
          reason: 'jobright_auth_ready',
        }
      },
    }

    await profileRepository.upsertSecret({
      key: 'connector_jobright_credentials_fixture',
      kind: 'password',
      label: 'Jobright username and password',
      value: JSON.stringify({
        username: 'demo@example.com',
        password: ' pass with spaces ',
      }),
    })
    await runner.registerInstance({
      id: 'connector-instance-password',
      connector,
      displayName: 'Password jobs',
      enabled: true,
      auth: [
        {
          id: 'jobright',
          mode: 'username_password',
          secretKey: 'connector_jobright_credentials_fixture',
        },
      ],
      createdAt: '2026-07-08T16:55:00.000Z',
    })

    const validation = await runner.validateAuth(connector, {
      connectorInstanceId: 'connector-instance-password',
    })
    const runs = await repository.listRuns({
      connectorInstanceId: 'connector-instance-password',
      limit: 10,
      offset: 0,
    })
    const observations = await repository.listObservations({
      connectorInstanceId: 'connector-instance-password',
    })
    const checkpoints = await repository.listCheckpoints({
      connectorInstanceId: 'connector-instance-password',
    })

    expect(validation).toEqual({
      connectorInstanceId: 'connector-instance-password',
      message: 'Connector credentials are verified and ready.',
      reason: 'jobright_auth_ready',
      status: 'ready',
    })
    expect(receivedValues).toEqual([
      JSON.stringify({
        username: 'demo@example.com',
        password: ' pass with spaces ',
      }),
    ])
    expect(runs.total).toBe(0)
    expect(observations).toEqual([])
    expect(checkpoints).toEqual([])
    expect(JSON.stringify(validation)).not.toContain('demo@example.com')
    expect(JSON.stringify(validation)).not.toContain(' pass with spaces ')
  })

  it('sanitizes validateAuth status and unknown reasons', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    const runner = createConnectorRunner({
      repository,
      workspaceId: 'workspace-fixture',
    })

    const cases: Array<{
      result: { status: string; reason?: string }
      expected: {
        status: string
        reason: string
      }
    }> = [
      {
        result: { status: 'missing', reason: 'username_password_missing' },
        expected: { status: 'missing', reason: 'username_password_missing' },
      },
      {
        result: { status: 'expired', reason: 'jobright_not_logged_in' },
        expected: { status: 'expired', reason: 'jobright_not_logged_in' },
      },
      {
        result: { status: 'action_required', reason: 'jobright_login_rejected' },
        expected: { status: 'action_required', reason: 'jobright_login_rejected' },
      },
      {
        result: { status: 'rate_limited', reason: 'jobright_rate_limited' },
        expected: { status: 'rate_limited', reason: 'jobright_rate_limited' },
      },
      {
        result: { status: 'retryable', reason: 'jobright_login_retryable' },
        expected: { status: 'retryable', reason: 'jobright_login_retryable' },
      },
      {
        result: { status: 'failed', reason: 'jobright_login_schema_invalid' },
        expected: { status: 'failed', reason: 'jobright_login_schema_invalid' },
      },
      {
        result: { status: 'weird', reason: 'totally_unknown_reason' },
        expected: { status: 'failed', reason: 'auth_validation_failed' },
      },
    ]

    for (const [index, testCase] of cases.entries()) {
      const connector: AppJobConnector = {
        definition: {
          id: `fixture.validate-${index}`,
          version: '0.0.0-fixture',
        },
        async refresh() {
          throw new Error('refresh should not run')
        },
        async validateAuth() {
          return testCase.result as never
        },
      }
      const connectorInstanceId = `connector-instance-validate-${index}`

      await runner.registerInstance({
        id: connectorInstanceId,
        connector,
        displayName: `Validate ${index}`,
        enabled: true,
        auth: [],
        createdAt: '2026-07-08T16:55:00.000Z',
      })

      const validation = await runner.validateAuth(connector, { connectorInstanceId })

      expect(validation).toMatchObject({
        connectorInstanceId,
        reason: testCase.expected.reason,
        status: testCase.expected.status,
      })
      expect(JSON.stringify(validation)).not.toContain('totally_unknown_reason')
    }
  })

  it('returns secure_storage_unavailable when secret decrypt fails closed', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    const runner = createConnectorRunner({
      repository,
      workspaceId: 'workspace-fixture',
      auth: {
        secrets: {
          async revealSecret() {
            const error = new Error('sensitive-stack Secure storage is unavailable') as Error & {
              code: string
            }
            error.code = 'secure_storage_unavailable'
            throw error
          },
        },
      },
    })
    const connector: AppJobConnector = {
      definition: {
        id: 'fixture.password-jobs',
        version: '0.0.0-fixture',
        auth: {
          modes: ['username_password'],
          requirements: [
            {
              id: 'jobright',
              mode: 'username_password',
              required: true,
            },
          ],
        },
      },
      async refresh() {
        throw new Error('refresh should not run during validateAuth')
      },
      async validateAuth(_input, runtime) {
        await runtime.auth.resolve({
          id: 'jobright',
          mode: 'username_password',
        })

        return {
          status: 'ready',
          reason: 'jobright_auth_ready',
        }
      },
    }

    await runner.registerInstance({
      id: 'connector-instance-secure-storage',
      connector,
      displayName: 'Secure storage jobs',
      enabled: true,
      auth: [
        {
          id: 'jobright',
          mode: 'username_password',
          secretKey: 'connector_jobright_credentials_fixture',
        },
      ],
      createdAt: '2026-07-08T16:55:00.000Z',
    })

    const validation = await runner.validateAuth(connector, {
      connectorInstanceId: 'connector-instance-secure-storage',
    })
    const runs = await repository.listRuns({
      connectorInstanceId: 'connector-instance-secure-storage',
      limit: 10,
      offset: 0,
    })
    const observations = await repository.listObservations({
      connectorInstanceId: 'connector-instance-secure-storage',
    })
    const checkpoints = await repository.listCheckpoints({
      connectorInstanceId: 'connector-instance-secure-storage',
    })

    expect(validation).toEqual({
      connectorInstanceId: 'connector-instance-secure-storage',
      message: 'Secure storage is unavailable. Enable platform encryption, then try again.',
      reason: 'secure_storage_unavailable',
      status: 'failed',
    })
    expect(runs.total).toBe(0)
    expect(observations).toEqual([])
    expect(checkpoints).toEqual([])
    expect(JSON.stringify(validation)).not.toContain('fixture-secret')
    expect(JSON.stringify(validation)).not.toContain('sensitive-stack')
  })

  it('returns unsupported when the connector omits validateAuth', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    const runner = createConnectorRunner({
      repository,
      workspaceId: 'workspace-fixture',
    })
    const connector: AppJobConnector = {
      definition: {
        id: 'fixture.no-validate',
        version: '0.0.0-fixture',
      },
      async refresh(input) {
        return emptyConnectorRefreshResult({
          checkpoint: { cursor: input.coverage.end },
          coverage: input.coverage,
        })
      },
    }

    await runner.registerInstance({
      id: 'connector-instance-no-validate',
      connector,
      displayName: 'No validate',
      enabled: true,
      auth: [],
      createdAt: '2026-07-08T16:55:00.000Z',
    })

    await expect(runner.validateAuth(connector, {
      connectorInstanceId: 'connector-instance-no-validate',
    })).resolves.toEqual({
      connectorInstanceId: 'connector-instance-no-validate',
      message: 'Connector auth validation is not supported.',
      reason: 'validate_auth_unsupported',
      status: 'unsupported',
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

function jobrightSeedObservation(
  sourceRecordKey: string,
  observedAt: string,
): ConnectorObservationInput {
  return {
    connectorId: 'jobright.public',
    connectorVersion: '0.4.3',
    parserVersion: 'jobright-api@2',
    observationSchemaVersion: 'job-observation@2',
    sourceRecordKey,
    observedAt,
    companyName: 'Example Robotics',
    roleTitle: 'Software Engineering Intern',
    links: {
      source: `https://jobright.ai/jobs/info/${sourceRecordKey.split(':').at(-1)}`,
      intermediary: `https://jobright.ai/jobs/info/${sourceRecordKey.split(':').at(-1)}`,
      official: 'https://example.test/apply',
    },
    resolution: {
      status: 'resolved',
      method: 'jobright_detail_api',
      reason: null,
    },
    dedupeKeys: [sourceRecordKey],
    sourceMetadata: {
      destinationClass: 'employer_or_ats',
      jobrightCycleId: 'legacy-cycle',
      jobrightId: sourceRecordKey.split(':').at(-1),
    },
    evidence: [],
  }
}

function createBudgetCapturingConnector(receivedInputs: unknown[]): AppJobConnector {
  return {
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

      return emptyConnectorRefreshResult({
        checkpoint: {
          cursor: input.coverage.end,
        },
        coverage: input.coverage,
      })
    },
  }
}
