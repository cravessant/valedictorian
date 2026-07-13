import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalValedictorianClient as createRuntimeLocalValedictorianClient } from './local-valedictorian-client'
import { createDrizzleDatabase, createFileDatabase, migrateDatabase } from '../db/sqlite'
import { createSqliteConnectorRepository } from '../modules/connectors/connector.repository'
import { createConnectorRunRecoveryLifecycle } from '../modules/connectors/connector.recovery'
import { createStaticConnectorRegistry } from '../modules/connectors/connector.registry'
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

  it('runs the same connector instance id independently in different workspace databases', async () => {
    const firstSqlitePath = createTempSqlitePath()
    const secondSqlitePath = createTempSqlitePath()
    let releaseFirstRefresh: (() => void) | undefined
    const firstRefreshGate = new Promise<void>((resolve) => {
      releaseFirstRefresh = resolve
    })
    const baseConnector = fixtureConnector({
      observedAt: '2026-07-08T18:00:00.000Z',
    })
    const refreshedWorkspaces: string[] = []
    const connector: AppJobConnector = {
      ...baseConnector,
      async refresh(input, runtime) {
        refreshedWorkspaces.push(input.workspaceId)

        if (input.workspaceId === 'workspace-first') {
          await firstRefreshGate
        }

        return baseConnector.refresh(input, runtime)
      },
    }
    const connectorRegistry = createStaticConnectorRegistry([connector])
    const firstClient = createRuntimeLocalValedictorianClient({
      connectorRegistry,
      seedDataMode: 'none',
      sqlitePath: firstSqlitePath,
      workspaceId: 'workspace-first',
    })
    const secondClient = createRuntimeLocalValedictorianClient({
      connectorRegistry,
      seedDataMode: 'none',
      sqlitePath: secondSqlitePath,
      workspaceId: 'workspace-second',
    })
    const firstSqlite = createFileDatabase(firstSqlitePath)
    const secondSqlite = createFileDatabase(secondSqlitePath)

    for (const database of [
      createDrizzleDatabase(firstSqlite),
      createDrizzleDatabase(secondSqlite),
    ]) {
      await createSqliteConnectorRepository(database).upsertInstance({
        id: 'connector-instance-fixture',
        connectorId: 'fixture.jobs',
        connectorVersion: '0.0.0-fixture',
        displayName: 'Fixture Jobs',
        enabled: true,
        createdAt: '2026-07-08T15:00:00.000Z',
      })
    }

    const triggerInput = {
      connectorInstanceId: 'connector-instance-fixture',
      coverageStartedAt: '2026-07-08T17:00:00.000Z',
      coverageEndedAt: '2026-07-08T18:00:00.000Z',
      mode: 'manual' as const,
    }
    const firstRunPromise = firstClient.connectors.runs.trigger(triggerInput)

    await vi.waitFor(() => {
      expect(refreshedWorkspaces).toEqual(['workspace-first'])
    })

    await expect(secondClient.connectors.runs.trigger(triggerInput)).resolves.toMatchObject({
      connectorInstanceId: 'connector-instance-fixture',
      status: 'completed',
    })
    await expect(firstClient.connectors.runs.list({
      connectorInstanceId: 'connector-instance-fixture',
    })).resolves.toMatchObject({
      items: [{ status: 'running' }],
      total: 1,
    })

    releaseFirstRefresh?.()
    await expect(firstRunPromise).resolves.toMatchObject({ status: 'completed' })
    expect(refreshedWorkspaces).toEqual(['workspace-first', 'workspace-second'])
    firstSqlite.close()
    secondSqlite.close()
  })

  it('recovers an interrupted running row as an explicit cancelled result on reopen', async () => {
    const sqlitePath = createTempSqlitePath()
    const sqlite = createFileDatabase(sqlitePath)
    migrateDatabase(sqlite)
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
    const requestedRun = (await connectorRepository.recordRunRequest({
      connectorInstanceId: 'connector-instance-fixture',
      coverageStartedAt: '2026-07-08T17:00:00.000Z',
      coverageEndedAt: '2026-07-08T18:00:00.000Z',
      mode: 'manual',
      startedAt: '2026-07-08T18:00:00.000Z',
    })).run
    await connectorRepository.markRunRunning({
      connectorRunId: requestedRun.id,
      startedAt: '2026-07-08T18:00:00.000Z',
    })
    await connectorRepository.recordRefreshResult({
      connectorRunId: requestedRun.id,
      connectorInstanceId: 'connector-instance-fixture',
      mode: 'manual',
      startedAt: '2026-07-08T18:00:00.000Z',
      completedAt: '2026-07-08T18:00:01.000Z',
      config: {},
      filters: {},
      filterSignature: 'filters:{}',
      checkpointPersistence: 'deferred',
      result: {
        coverage: {
          start: '2026-07-08T17:00:00.000Z',
          end: '2026-07-08T18:00:00.000Z',
        },
        nextCheckpoint: {
          checkpoint: { cursor: 'not-yet-committed' },
          schemaVersion: 'fixture-checkpoint@1',
        },
        observations: [],
        stats: { observations: 0 },
        warnings: [{
          code: 'source.rate_limited',
          message: 'Sensitive raw rate-limit details.',
        }],
        status: 'partial_success',
      },
    })
    sqlite.close()

    const reopenedClient = createRuntimeLocalValedictorianClient({
      connectorRunRecovery: createConnectorRunRecoveryLifecycle(),
      connectorRegistry: createStaticConnectorRegistry([
        fixtureConnector({ observedAt: '2026-07-08T19:00:00.000Z' }),
      ]),
      now: () => new Date('2026-07-08T19:00:00.000Z'),
      seedDataMode: 'none',
      sqlitePath,
      workspaceId: 'workspace-fixture',
    })

    await expect(reopenedClient.connectors.runs.list({
      connectorInstanceId: 'connector-instance-fixture',
    })).resolves.toMatchObject({
      items: [
        {
          completedAt: '2026-07-08T19:00:00.000Z',
          id: requestedRun.id,
          retryHints: null,
          status: 'cancelled',
          warningCount: 2,
          warnings: [
            {
              code: 'source.rate_limited',
              label: 'Rate limited',
            },
            {
              code: 'connector.interrupted',
              label: 'Run interrupted',
            },
          ],
        },
      ],
      total: 1,
    })

    const retry = await reopenedClient.connectors.runs.trigger({
      connectorInstanceId: 'connector-instance-fixture',
      coverageStartedAt: '2026-07-08T18:00:00.000Z',
      coverageEndedAt: '2026-07-08T19:00:00.000Z',
      mode: 'manual',
    })

    expect(retry).toMatchObject({ status: 'completed' })
    expect(retry.id).not.toBe(requestedRun.id)
    await expect(reopenedClient.connectors.runs.list({
      connectorInstanceId: 'connector-instance-fixture',
    })).resolves.toMatchObject({
      items: [
        { id: retry.id, status: 'completed' },
        { id: requestedRun.id, status: 'cancelled' },
      ],
      total: 2,
    })
  })

  it('rejects unsupported connector run triggers instead of queueing them', async () => {
    const sqlitePath = createTempSqlitePath()
    const client = createRuntimeLocalValedictorianClient({
      connectorRegistry: {
        get() {
          return null
        },
      },
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

    await expect(
      client.connectors.runs.trigger({
        connectorInstanceId: 'connector-instance-fixture',
        coverageStartedAt: '2026-07-08T17:00:00.000Z',
        coverageEndedAt: '2026-07-08T18:00:00.000Z',
        mode: 'manual',
      }),
    ).rejects.toThrow('Unsupported connector id: fixture.jobs')
    await expect(
      client.connectors.runs.list({
        connectorInstanceId: 'connector-instance-fixture',
      }),
    ).resolves.toMatchObject({
      total: 0,
    })
    sqlite.close()
  })

  it('rejects dry-run connector triggers before executing registered connectors', async () => {
    const sqlitePath = createTempSqlitePath()
    const client = createRuntimeLocalValedictorianClient({
      connectorRegistry: {
        get(connectorId) {
          return connectorId === 'fixture.jobs'
            ? fixtureConnector({
              observedAt: '2026-07-08T18:00:00.000Z',
            })
            : null
        },
      },
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

    await expect(
      client.connectors.runs.trigger({
        connectorInstanceId: 'connector-instance-fixture',
        coverageStartedAt: '2026-07-08T17:00:00.000Z',
        coverageEndedAt: '2026-07-08T18:00:00.000Z',
        dryRun: true,
        mode: 'manual',
      }),
    ).rejects.toThrow('dryRun connector triggers are not supported')
    await expect(
      client.connectors.runs.list({
        connectorInstanceId: 'connector-instance-fixture',
      }),
    ).resolves.toMatchObject({
      total: 0,
    })
    sqlite.close()
  })

  it('requires explicit coverage for manual connector execution', async () => {
    const sqlitePath = createTempSqlitePath()
    const client = createRuntimeLocalValedictorianClient({
      connectorRegistry: {
        get(connectorId) {
          return connectorId === 'fixture.jobs'
            ? fixtureConnector({
              observedAt: '2026-07-08T18:00:00.000Z',
            })
            : null
        },
      },
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

    await expect(
      client.connectors.runs.trigger({
        connectorInstanceId: 'connector-instance-fixture',
        mode: 'manual',
      }),
    ).rejects.toThrow('coverageEndedAt is required for manual connector runs')
    await expect(
      client.connectors.runs.list({
        connectorInstanceId: 'connector-instance-fixture',
      }),
    ).resolves.toMatchObject({
      total: 0,
    })
    sqlite.close()
  })

  it('rejects per-run filter overrides before executing registered connectors', async () => {
    const sqlitePath = createTempSqlitePath()
    const client = createRuntimeLocalValedictorianClient({
      connectorRegistry: {
        get(connectorId) {
          return connectorId === 'fixture.jobs'
            ? fixtureConnector({
              observedAt: '2026-07-08T18:00:00.000Z',
            })
            : null
        },
      },
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

    await expect(
      client.connectors.runs.trigger({
        connectorInstanceId: 'connector-instance-fixture',
        coverageStartedAt: '2026-07-08T17:00:00.000Z',
        coverageEndedAt: '2026-07-08T18:00:00.000Z',
        filters: { roleKeywords: ['intern'] },
        mode: 'manual',
      }),
    ).rejects.toThrow('Per-run connector filter overrides are not supported')
    await expect(
      client.connectors.runs.list({
        connectorInstanceId: 'connector-instance-fixture',
      }),
    ).resolves.toMatchObject({
      total: 0,
    })
    sqlite.close()
  })

  it('records failed runs and allows a later trigger when registered connectors throw', async () => {
    const sqlitePath = createTempSqlitePath()
    const client = createRuntimeLocalValedictorianClient({
      connectorRegistry: {
        get(connectorId) {
          return connectorId === 'fixture.jobs'
            ? fixtureConnector({
              observedAt: '2026-07-08T18:00:00.000Z',
              throwOnRefresh: true,
            })
            : null
        },
      },
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

    await expect(
      client.connectors.runs.trigger({
        connectorInstanceId: 'connector-instance-fixture',
        coverageStartedAt: '2026-07-08T17:00:00.000Z',
        coverageEndedAt: '2026-07-08T18:00:00.000Z',
        mode: 'manual',
      }),
    ).rejects.toThrow('Fixture connector refresh failed')

    await expect(
      client.connectors.runs.trigger({
        connectorInstanceId: 'connector-instance-fixture',
        coverageStartedAt: '2026-07-08T18:00:00.000Z',
        coverageEndedAt: '2026-07-08T19:00:00.000Z',
        mode: 'manual',
      }),
    ).rejects.toThrow('Fixture connector refresh failed')
    await expect(
      client.connectors.runs.list({
        connectorInstanceId: 'connector-instance-fixture',
      }),
    ).resolves.toMatchObject({
      items: [
        {
          retryHints: null,
          stats: {
            failures: 1,
            running: false,
          },
          status: 'failed',
        },
        {
          retryHints: null,
          status: 'failed',
        },
      ],
      total: 2,
    })
    sqlite.close()
  })

  it('does not fail a connector run by interpreting an invalid legacy observation', async () => {
    const sqlitePath = createTempSqlitePath()
    const client = createRuntimeLocalValedictorianClient({
      connectorRegistry: {
        get(connectorId) {
          return connectorId === 'fixture.jobs'
            ? fixtureConnector({
              companyName: '',
              observedAt: '2026-07-08T18:00:00.000Z',
            })
            : null
        },
      },
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
    await connectorRepository.recordRefreshResult({
      connectorInstanceId: 'connector-instance-fixture',
      mode: 'manual',
      startedAt: '2026-07-08T16:00:00.000Z',
      completedAt: '2026-07-08T16:00:01.000Z',
      config: {},
      filters: {},
      filterSignature: 'filters:{}',
      result: {
        coverage: {
          start: '2026-07-08T15:00:00.000Z',
          end: '2026-07-08T16:00:00.000Z',
        },
        nextCheckpoint: {
          checkpoint: {
            cursor: 'previous-successful-cursor',
          },
          schemaVersion: 'fixture-checkpoint@1',
        },
        observations: [],
        stats: {
          observations: 0,
        },
        warnings: [],
      },
    })

    await expect(
      client.connectors.runs.trigger({
        connectorInstanceId: 'connector-instance-fixture',
        coverageStartedAt: '2026-07-08T17:00:00.000Z',
        coverageEndedAt: '2026-07-08T18:00:00.000Z',
        mode: 'manual',
      }),
    ).resolves.toMatchObject({ status: 'completed' })
    const runs = await client.connectors.runs.list({
      connectorInstanceId: 'connector-instance-fixture',
    })

    expect(runs.total).toBe(2)
    expect(runs.items[0]).toMatchObject({
      retryHints: null,
      status: 'completed',
    })
    await expect(
      client.connectors.checkpoints.list({
        connectorInstanceId: 'connector-instance-fixture',
        filterSignature: 'filters:{}',
      }),
    ).resolves.toMatchObject({
      items: [
        {
          checkpoint: {
            cursor: 'fixture:2026-07-08T18:00:00.000Z',
          },
          coverage: {
            end: '2026-07-08T18:00:00.000Z',
            start: '2026-07-01T00:00:00.000Z',
          },
        },
      ],
    })
    sqlite.close()
  })

  it('commits catch-up checkpoints independently of legacy observation projection', async () => {
    const sqlitePath = createTempSqlitePath()
    const client = createRuntimeLocalValedictorianClient({
      connectorRegistry: {
        get(connectorId) {
          return connectorId === 'fixture.jobs'
            ? fixtureConnector({
              additionalCompanyNames: [''],
              observedAt: '2026-07-08T18:00:00.000Z',
            })
            : null
        },
      },
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
    await connectorRepository.recordRefreshResult({
      connectorInstanceId: 'connector-instance-fixture',
      mode: 'manual',
      startedAt: '2026-07-08T16:00:00.000Z',
      completedAt: '2026-07-08T16:00:01.000Z',
      config: {},
      filters: {},
      filterSignature: 'filters:{}',
      result: {
        coverage: {
          start: '2026-07-08T15:00:00.000Z',
          end: '2026-07-08T16:00:00.000Z',
        },
        nextCheckpoint: {
          checkpoint: {
            cursor: 'previous-successful-cursor',
          },
          schemaVersion: 'fixture-checkpoint@1',
        },
        observations: [],
        stats: {
          observations: 0,
        },
        warnings: [],
      },
    })

    await expect(
      client.connectors.runs.trigger({
        connectorInstanceId: 'connector-instance-fixture',
        coverageEndedAt: '2026-07-08T18:00:00.000Z',
        mode: 'manual',
        executionIntent: 'deferred_refresh',
      }),
    ).resolves.toMatchObject({ status: 'completed' })
    const runs = await client.connectors.runs.list({
      connectorInstanceId: 'connector-instance-fixture',
    })
    const observations = await client.connectors.observations.list({
      connectorInstanceId: 'connector-instance-fixture',
      limit: 10,
    })

    expect(runs.total).toBe(2)
    expect(runs.items[0]).toMatchObject({
      coverage: {
        end: '2026-07-08T18:00:00.000Z',
        start: '2026-07-01T00:00:00.000Z',
      },
      mode: 'manual',
      scheduleOccurrence: null,
      observationCount: 2,
      retryHints: null,
      status: 'completed',
    })
    expect(observations.total).toBe(2)
    await expect(
      client.connectors.checkpoints.list({
        connectorInstanceId: 'connector-instance-fixture',
        filterSignature: 'filters:{}',
      }),
    ).resolves.toMatchObject({
      items: [
        {
          checkpoint: {
            cursor: 'fixture:2026-07-08T18:00:00.000Z',
          },
          coverage: {
            end: '2026-07-08T18:00:00.000Z',
            start: '2026-07-01T00:00:00.000Z',
          },
        },
      ],
    })
    sqlite.close()
  })


  it('gates a manual retry before connector refresh and returns the persisted not-due run', async () => {
    const sqlitePath = createTempSqlitePath()
    const base = fixtureConnector({ observedAt: '2026-07-11T12:00:00.000Z' })
    const refresh = vi.fn(async (input: Parameters<AppJobConnector['refresh']>[0], runtime: Parameters<AppJobConnector['refresh']>[1]) => ({
      ...await base.refresh(input, runtime),
      observations: [],
      stats: { observations: 0 },
      retryHints: {
        state: 'scheduled' as const, reason: 'rate_limit' as const,
        attempt: 1, maxAttempts: 3, lastAttemptAt: '2026-07-11T12:00:00.000Z',
        computedDelayMs: 60_000, serverMinimumDelayMs: null,
        nextAttemptAt: '2026-07-11T12:01:00.000Z', horizonAt: '2026-07-11T13:00:00.000Z',
      },
    }))
    const connector: AppJobConnector = { ...base, refresh }
    const client = createRuntimeLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([connector]),
      now: () => new Date('2026-07-11T12:00:30.000Z'), seedDataMode: 'none', sqlitePath,
    })
    const sqlite = createFileDatabase(sqlitePath)
    const repository = createSqliteConnectorRepository(createDrizzleDatabase(sqlite))
    await repository.upsertInstance({
      id: 'retry-runtime', connectorId: connector.definition.id,
      connectorVersion: connector.definition.version, displayName: 'Retry runtime', enabled: true,
      filters: {}, createdAt: '2026-07-11T11:00:00.000Z',
    })

    await client.connectors.runs.trigger({
      connectorInstanceId: 'retry-runtime', mode: 'manual',
      coverageStartedAt: '2026-07-11T11:00:00.000Z', coverageEndedAt: '2026-07-11T12:00:00.000Z',
    })
    const early = await client.connectors.runs.trigger({
      connectorInstanceId: 'retry-runtime', mode: 'manual',
      coverageStartedAt: '2026-07-11T11:00:00.000Z', coverageEndedAt: '2026-07-11T12:00:00.000Z',
    })
    const repeated = await client.connectors.runs.trigger({
      connectorInstanceId: 'retry-runtime', mode: 'manual',
      coverageStartedAt: '2026-07-11T11:00:00.000Z', coverageEndedAt: '2026-07-11T12:00:00.000Z',
    })

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(early).toMatchObject({ status: 'skipped', retryHints: { state: 'not_due', reason: 'rate_limit' } })
    expect(repeated.id).toBe(early.id)
    sqlite.close()
  })


  it('gates Jobright capture retries with the exact provider-state signature across direct, startup, and repeated triggers', async () => {
    const sqlitePath = createTempSqlitePath()
    const refresh = vi.fn(async () => {
      throw new Error('Jobright refresh must not run before due')
    })
    const connector = {
      definition: {
        id: 'jobright.resolver',
        version: '0.10.0',
        capabilities: { supportsFiltering: false },
      },
      refresh,
    } as AppJobConnector
    const client = createRuntimeLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([connector]),
      now: () => new Date('2026-07-11T12:00:30.000Z'),
      seedDataMode: 'none',
      sqlitePath,
    })
    const sqlite = createFileDatabase(sqlitePath)
    const repository = createSqliteConnectorRepository(createDrizzleDatabase(sqlite))
    await repository.upsertInstance({
      id: 'jobright-capture-retry',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.10.0',
      displayName: 'Jobright capture retry',
      enabled: true,
      filters: { roleTerms: ['intern'] },
      createdAt: '2026-07-11T11:00:00.000Z',
    })
    await repository.recordRefreshResult({
      connectorInstanceId: 'jobright-capture-retry',
      mode: 'manual',
      startedAt: '2026-07-11T12:00:00.000Z',
      completedAt: '2026-07-11T12:00:01.000Z',
      config: {},
      filters: { roleTerms: ['intern'] },
      filterSignature: 'provider-state:jobright.resolver@0.10.0',
      result: {
        observations: [],
        warnings: [],
        stats: { observations: 0 },
        coverage: { start: '2026-07-11T11:00:00.000Z', end: '2026-07-11T12:00:00.000Z' },
        nextCheckpoint: {
          checkpoint: { pendingDetailRetries: [], retryState: [], cycleId: 'capture-cycle' },
          schemaVersion: 'jobright-resolution-checkpoint@5',
        },
        retryHints: {
          state: 'scheduled', reason: 'rate_limit', attempt: 1, maxAttempts: 3,
          lastAttemptAt: '2026-07-11T12:00:00.000Z', computedDelayMs: 60_000,
          nextAttemptAt: '2026-07-11T12:01:00.000Z', horizonAt: '2026-07-11T13:00:00.000Z',
        },
      },
    })

    const direct = await client.connectors.runs.trigger({
      connectorInstanceId: 'jobright-capture-retry',
      mode: 'manual',
      coverageStartedAt: '2026-07-11T11:00:00.000Z',
      coverageEndedAt: '2026-07-11T12:00:00.000Z',
    })
    const repeated = await client.connectors.runs.trigger({
      connectorInstanceId: 'jobright-capture-retry',
      mode: 'manual',
      coverageStartedAt: '2026-07-11T11:00:00.000Z',
      coverageEndedAt: '2026-07-11T12:00:00.000Z',
    })
    expect(direct).toMatchObject({
      mode: 'manual',
      scheduleOccurrence: null,
      status: 'skipped',
      filterSignature: 'provider-state:jobright.resolver@0.10.0',
      retryHints: { state: 'not_due', reason: 'rate_limit' },
    })
    expect(repeated.id).toBe(direct.id)
    expect(refresh).not.toHaveBeenCalled()
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
