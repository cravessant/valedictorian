import { describe, expect, it } from 'vitest'
import { createDrizzleDatabase, createInMemoryDatabase, migrateDatabase } from '../../db/sqlite'
import { createSqliteConnectorRepository } from './connector.repository'
import { createConnectorRunner, type AppJobConnector } from './connector.runner'

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
