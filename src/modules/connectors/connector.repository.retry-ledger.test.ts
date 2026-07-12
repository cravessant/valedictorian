import fs from 'node:fs'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { retryWork } from '../../db/schema'
import { createDrizzleDatabase, createFileDatabase, createInMemoryDatabase, migrateDatabase } from '../../db/sqlite'
import { createSqliteConnectorRepository } from './connector.repository'

describe('SQLite connector repository retry ledger', () => {
  it('returns one persisted not-due run for repeated triggers in the same retry window', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const repository = createSqliteConnectorRepository(createDrizzleDatabase(sqlite))
    await repository.upsertInstance({
      id: 'retry-instance', connectorId: 'fixture.jobs', connectorVersion: '1.0.0',
      displayName: 'Retry fixture', enabled: true, filters: {}, createdAt: '2026-07-11T12:00:00.000Z',
    })
    await repository.recordRefreshResult({
      connectorInstanceId: 'retry-instance', mode: 'manual',
      startedAt: '2026-07-11T12:00:00.000Z', completedAt: '2026-07-11T12:00:01.000Z',
      config: {}, filters: {}, filterSignature: 'filters:{}',
      result: {
        observations: [], warnings: [], stats: { observations: 0 },
        coverage: { start: '2026-07-11T11:00:00.000Z', end: '2026-07-11T12:00:00.000Z' },
        nextCheckpoint: { checkpoint: {}, schemaVersion: 'fixture-checkpoint@1' },
        retryHints: {
          state: 'scheduled', reason: 'rate_limit', attempt: 2, maxAttempts: 4,
          lastAttemptAt: '2026-07-11T12:00:00.000Z', computedDelayMs: 60_000,
          serverMinimumDelayMs: 30_000, nextAttemptAt: '2026-07-11T12:01:00.000Z',
          horizonAt: '2026-07-11T13:00:00.000Z',
        },
      },
    })

    const first = await repository.recordRunRequest({
      connectorInstanceId: 'retry-instance', mode: 'manual', startedAt: '2026-07-11T12:00:30.000Z',
    })
    const second = await repository.recordRunRequest({
      connectorInstanceId: 'retry-instance', mode: 'manual', startedAt: '2026-07-11T12:00:45.000Z',
    })

    expect(first.acquired).toBe(false)
    expect(second.acquired).toBe(false)
    expect(second.run.id).toBe(first.run.id)
    expect(first.run).toMatchObject({ status: 'skipped', retryHints: {
      state: 'not_due', reason: 'rate_limit', attempt: 2, maxAttempts: 4,
      nextAttemptAt: '2026-07-11T12:01:00.000Z',
    } })
    sqlite.close()
  })

  it('preserves the skipped run when identical retry advice is persisted again', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const repository = createSqliteConnectorRepository(createDrizzleDatabase(sqlite))
    await repository.upsertInstance({
      id: 'retry-window', connectorId: 'fixture.jobs', connectorVersion: '1.0.0',
      displayName: 'Retry window', enabled: true, filters: {}, createdAt: '2026-07-11T12:00:00.000Z',
    })
    const retryHints = {
      state: 'scheduled' as const, reason: 'rate_limit' as const, attempt: 2, maxAttempts: 4,
      lastAttemptAt: '2026-07-11T12:00:00.000Z', computedDelayMs: 60_000,
      serverMinimumDelayMs: 30_000, nextAttemptAt: '2026-07-11T12:01:00.000Z',
      horizonAt: '2026-07-11T13:00:00.000Z',
    }
    const persistAdvice = (completedAt: string, advice = retryHints) => repository.recordRefreshResult({
      connectorInstanceId: 'retry-window', mode: 'manual',
      startedAt: '2026-07-11T12:00:00.000Z', completedAt,
      config: {}, filters: {}, filterSignature: 'filters:{}',
      result: {
        observations: [], warnings: [], stats: { observations: 0 },
        coverage: { start: '2026-07-11T11:00:00.000Z', end: '2026-07-11T12:00:00.000Z' },
        nextCheckpoint: { checkpoint: {}, schemaVersion: 'fixture-checkpoint@1' },
        retryHints: advice,
      },
    })
    await persistAdvice('2026-07-11T12:00:01.000Z')
    const first = await repository.recordRunRequest({
      connectorInstanceId: 'retry-window', mode: 'manual', startedAt: '2026-07-11T12:00:30.000Z',
    })

    await persistAdvice('2026-07-11T12:00:40.000Z')
    const second = await repository.recordRunRequest({
      connectorInstanceId: 'retry-window', mode: 'manual', startedAt: '2026-07-11T12:00:45.000Z',
    })

    expect(second.acquired).toBe(false)
    expect(second.run.id).toBe(first.run.id)

    await persistAdvice('2026-07-11T12:00:50.000Z', {
      ...retryHints, attempt: 3, computedDelayMs: 120_000, nextAttemptAt: '2026-07-11T12:02:00.000Z',
    })
    const changedWindow = await repository.recordRunRequest({
      connectorInstanceId: 'retry-window', mode: 'manual', startedAt: '2026-07-11T12:00:55.000Z',
    })
    expect(changedWindow.run.id).not.toBe(first.run.id)
    sqlite.close()
  })

  it('allows one exact-due acquisition across independent SQLite clients', async () => {
    const sqlitePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'retry-race-')), 'workspace.sqlite')
    const firstSqlite = createFileDatabase(sqlitePath)
    migrateDatabase(firstSqlite)
    const first = createSqliteConnectorRepository(createDrizzleDatabase(firstSqlite))
    await first.upsertInstance({
      id: 'race-instance', connectorId: 'fixture.jobs', connectorVersion: '1.0.0',
      displayName: 'Race fixture', enabled: true, filters: {}, createdAt: '2026-07-11T12:00:00.000Z',
    })
    await first.recordRefreshResult({
      connectorInstanceId: 'race-instance', mode: 'manual',
      startedAt: '2026-07-11T12:00:00.000Z', completedAt: '2026-07-11T12:00:01.000Z',
      config: {}, filters: {}, filterSignature: 'filters:{}',
      result: {
        observations: [], warnings: [], stats: { observations: 0 },
        coverage: { start: '2026-07-11T11:00:00.000Z', end: '2026-07-11T12:00:00.000Z' },
        nextCheckpoint: { checkpoint: {}, schemaVersion: 'fixture-checkpoint@1' },
        retryHints: {
          state: 'scheduled', reason: 'server_failure', attempt: 1, maxAttempts: 3,
          lastAttemptAt: '2026-07-11T12:00:00.000Z', computedDelayMs: 60_000,
          nextAttemptAt: '2026-07-11T12:01:00.000Z', horizonAt: '2026-07-11T13:00:00.000Z',
        },
      },
    })
    const secondSqlite = createFileDatabase(sqlitePath)
    const second = createSqliteConnectorRepository(createDrizzleDatabase(secondSqlite))

    const results = await Promise.all([first, second].map((repository) => repository.recordRunRequest({
      connectorInstanceId: 'race-instance', mode: 'catch_up', startedAt: '2026-07-11T12:01:00.000Z',
    })))

    expect(results.filter(({ acquired }) => acquired)).toHaveLength(1)
    expect(new Set(results.map(({ run }) => run.id))).toHaveLength(1)
    firstSqlite.close()
    secondSqlite.close()
  })

  it('allows one exact-due acquisition across independent worker processes', async () => {
    const sqlitePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'retry-process-race-')), 'workspace.sqlite')
    const sqlite = createFileDatabase(sqlitePath)
    migrateDatabase(sqlite)
    const repository = createSqliteConnectorRepository(createDrizzleDatabase(sqlite))
    await repository.upsertInstance({
      id: 'process-race', connectorId: 'fixture.jobs', connectorVersion: '1.0.0',
      displayName: 'Process race', enabled: true, filters: {}, createdAt: '2026-07-11T12:00:00.000Z',
    })
    await repository.recordRefreshResult({
      connectorInstanceId: 'process-race', mode: 'manual',
      startedAt: '2026-07-11T12:00:00.000Z', completedAt: '2026-07-11T12:00:01.000Z',
      config: {}, filters: {}, filterSignature: 'filters:{}',
      result: {
        observations: [], warnings: [], stats: { observations: 0 },
        coverage: { start: '2026-07-11T11:00:00.000Z', end: '2026-07-11T12:00:00.000Z' },
        nextCheckpoint: { checkpoint: {}, schemaVersion: 'fixture-checkpoint@1' },
        retryHints: {
          state: 'scheduled', reason: 'network_interruption', attempt: 1, maxAttempts: 3,
          lastAttemptAt: '2026-07-11T12:00:00.000Z', computedDelayMs: 60_000,
          nextAttemptAt: '2026-07-11T12:01:00.000Z', horizonAt: '2026-07-11T13:00:00.000Z',
        },
      },
    })
    sqlite.close()

    const startEpoch = Date.now() + 400
    const results = await Promise.all([
      runAcquisitionWorker(sqlitePath, startEpoch),
      runAcquisitionWorker(sqlitePath, startEpoch),
    ])

    expect(results.filter(({ acquired }) => acquired)).toHaveLength(1)
    expect(new Set(results.map(({ id }) => id))).toHaveLength(1)
  })

  it.each(['exhausted', 'cancelled'] as const)(
    'does not reacquire persisted %s work after restart and configuration changes',
    async (state) => {
      const sqlitePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), `retry-${state}-`)), 'workspace.sqlite')
      const sqlite = createFileDatabase(sqlitePath)
      migrateDatabase(sqlite)
      const repository = createSqliteConnectorRepository(createDrizzleDatabase(sqlite))
      await repository.upsertInstance({
        id: `terminal-${state}`, connectorId: 'fixture.jobs', connectorVersion: '1.0.0',
        displayName: 'Terminal fixture', enabled: true, filters: {}, createdAt: '2026-07-11T12:00:00.000Z',
      })
      await repository.recordRefreshResult({
        connectorInstanceId: `terminal-${state}`, mode: 'manual',
        startedAt: '2026-07-11T12:00:00.000Z', completedAt: '2026-07-11T12:00:01.000Z',
        config: {}, filters: {}, filterSignature: 'filters:{}',
        result: {
          observations: [], warnings: [], stats: { observations: 0 },
          coverage: { start: '2026-07-11T11:00:00.000Z', end: '2026-07-11T12:00:00.000Z' },
          nextCheckpoint: { checkpoint: {}, schemaVersion: 'fixture-checkpoint@1' },
          retryHints: {
            state, reason: 'operation_timeout', attempt: 3, maxAttempts: 3,
            lastAttemptAt: '2026-07-11T12:00:00.000Z', computedDelayMs: null,
            nextAttemptAt: null, horizonAt: '2026-07-11T13:00:00.000Z',
          },
        },
      })
      sqlite.close()
      const restartedSqlite = createFileDatabase(sqlitePath)
      const restarted = createSqliteConnectorRepository(createDrizzleDatabase(restartedSqlite))
      await restarted.upsertInstance({
        id: `terminal-${state}`, connectorId: 'fixture.jobs', connectorVersion: '2.0.0',
        displayName: 'Changed terminal fixture', enabled: true, filters: {}, config: { changed: true },
      })

      const first = await restarted.recordRunRequest({
        connectorInstanceId: `terminal-${state}`, mode: 'catch_up', startedAt: '2026-07-11T14:00:00.000Z',
      })
      const second = await restarted.recordRunRequest({
        connectorInstanceId: `terminal-${state}`, mode: 'catch_up', startedAt: '2026-07-11T15:00:00.000Z',
      })

      expect(first.acquired).toBe(false)
      expect(first.run).toMatchObject({ status: 'skipped', retryHints: { state } })
      expect(second.run.id).toBe(first.run.id)
      restartedSqlite.close()
    },
  )

  it.each(['exhausted', 'cancelled'] as const)(
    'does not reacquire persisted normalization %s work after restart and configuration changes',
    async (state) => {
      const sqlitePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), `normalization-${state}-`)), 'workspace.sqlite')
      const sqlite = createFileDatabase(sqlitePath)
      migrateDatabase(sqlite)
      const database = createDrizzleDatabase(sqlite)
      const repository = createSqliteConnectorRepository(database)
      await repository.upsertInstance({ id: `normalization-terminal-${state}`, connectorId: 'fixture.jobs', connectorVersion: '1.0.0', displayName: 'Normalization terminal', enabled: true, filters: {}, createdAt: '2026-07-11T12:00:00.000Z' })
      seedNormalizationRetry(sqlite, database, `normalization-terminal-${state}`, `normalization-${state}`, '2026-07-11T12:01:00.000Z')
      database.update(retryWork).set({ state, nextAttemptAt: null }).where(eq(retryWork.id, `normalization-${state}`)).run()
      sqlite.close()

      const restartedSqlite = createFileDatabase(sqlitePath)
      const restarted = createSqliteConnectorRepository(createDrizzleDatabase(restartedSqlite))
      await restarted.upsertInstance({ id: `normalization-terminal-${state}`, connectorId: 'fixture.jobs', connectorVersion: '2.0.0', displayName: 'Changed normalization terminal', enabled: true, filters: {}, config: { changed: true } })
      const first = await restarted.recordRunRequest({ connectorInstanceId: `normalization-terminal-${state}`, mode: 'catch_up', startedAt: '2026-07-11T14:00:00.000Z' })
      const second = await restarted.recordRunRequest({ connectorInstanceId: `normalization-terminal-${state}`, mode: 'catch_up', startedAt: '2026-07-11T15:00:00.000Z' })

      expect(first).toMatchObject({ acquired: false, run: { status: 'skipped', retryHints: { state } } })
      expect(second.run.id).toBe(first.run.id)
      restartedSqlite.close()
    },
  )

  it('acquires due normalization work ahead of later capture work', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    await repository.upsertInstance({
      id: 'scope-priority', connectorId: 'fixture.jobs', connectorVersion: '1.0.0',
      displayName: 'Scope priority', enabled: true, filters: {}, createdAt: '2026-07-11T12:00:00.000Z',
    })
    await repository.recordRefreshResult({
      connectorInstanceId: 'scope-priority', mode: 'manual', startedAt: '2026-07-11T12:00:00.000Z', completedAt: '2026-07-11T12:00:01.000Z',
      config: {}, filters: {}, filterSignature: 'filters:{}', result: {
        observations: [], warnings: [], stats: { observations: 0 }, coverage: { start: '2026-07-11T11:00:00.000Z', end: '2026-07-11T12:00:00.000Z' },
        nextCheckpoint: { checkpoint: {}, schemaVersion: 'fixture@1' },
        retryHints: { state: 'scheduled', reason: 'rate_limit', attempt: 1, maxAttempts: 3, lastAttemptAt: '2026-07-11T12:00:00.000Z', computedDelayMs: 600_000, nextAttemptAt: '2026-07-11T12:10:00.000Z', horizonAt: '2026-07-11T13:00:00.000Z' },
      },
    })
    seedNormalizationRetry(sqlite, database, 'scope-priority', 'normalization-due', '2026-07-11T12:01:00.000Z')

    const acquisition = await repository.recordRunRequest({ connectorInstanceId: 'scope-priority', mode: 'catch_up', startedAt: '2026-07-11T12:02:00.000Z' })

    expect(acquisition.acquired).toBe(true)
    expect(database.select().from(retryWork).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'normalization-due', state: 'acquired', acquisitionRunId: acquisition.run.id }),
      expect.objectContaining({ kind: 'connector_capture', state: 'scheduled', nextAttemptAt: '2026-07-11T12:10:00.000Z' }),
    ]))
    sqlite.close()
  })

  it('releases untouched acquired normalization work back to scheduled', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    await repository.upsertInstance({ id: 'untouched', connectorId: 'fixture.jobs', connectorVersion: '1.0.0', displayName: 'Untouched', enabled: true, filters: {}, createdAt: '2026-07-11T12:00:00.000Z' })
    seedNormalizationRetry(sqlite, database, 'untouched', 'normalization-untouched', '2026-07-11T12:01:00.000Z')
    const first = await repository.recordRunRequest({ connectorInstanceId: 'untouched', mode: 'catch_up', startedAt: '2026-07-11T12:01:00.000Z' })
    await repository.markRunRunning({ connectorRunId: first.run.id, startedAt: '2026-07-11T12:01:00.000Z' })
    await repository.recordRefreshResult({
      connectorRunId: first.run.id, connectorInstanceId: 'untouched', mode: 'catch_up',
      startedAt: '2026-07-11T12:01:00.000Z', completedAt: '2026-07-11T12:01:01.000Z', config: {}, filters: {}, filterSignature: 'filters:{}',
      result: { observations: [], warnings: [], stats: { observations: 0 }, coverage: { start: '2026-07-11T11:00:00.000Z', end: '2026-07-11T12:01:00.000Z' }, nextCheckpoint: { checkpoint: {}, schemaVersion: 'fixture@1' }, retryHints: null },
    })
    expect(database.select().from(retryWork).all()).toEqual([
      expect.objectContaining({ id: 'normalization-untouched', state: 'scheduled', acquisitionRunId: null }),
    ])
    const second = await repository.recordRunRequest({ connectorInstanceId: 'untouched', mode: 'catch_up', startedAt: '2026-07-11T12:02:00.000Z' })
    expect(second.acquired).toBe(true)
    sqlite.close()
  })

  it('releases untouched acquired retry work when connector execution fails', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    await repository.upsertInstance({ id: 'failed-acquisition', connectorId: 'fixture.jobs', connectorVersion: '1.0.0', displayName: 'Failed acquisition', enabled: true, filters: {}, createdAt: '2026-07-11T12:00:00.000Z' })
    seedNormalizationRetry(sqlite, database, 'failed-acquisition', 'normalization-failed-acquisition', '2026-07-11T12:01:00.000Z')
    seedNormalizationRetry(sqlite, database, 'failed-acquisition', 'normalization-explicit-terminal', '2026-07-11T12:01:00.000Z')
    database.update(retryWork).set({ state: 'exhausted', nextAttemptAt: null }).where(eq(retryWork.id, 'normalization-explicit-terminal')).run()
    const acquisition = await repository.recordRunRequest({ connectorInstanceId: 'failed-acquisition', mode: 'catch_up', startedAt: '2026-07-11T12:01:00.000Z' })
    await repository.markRunRunning({ connectorRunId: acquisition.run.id, startedAt: '2026-07-11T12:01:00.000Z' })

    await repository.markRunFailed({
      connectorRunId: acquisition.run.id, completedAt: '2026-07-11T12:01:01.000Z', retryHints: null,
      warning: { code: 'connector.execution_failed', message: 'Connector execution failed.' },
    })

    expect(database.select().from(retryWork).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'normalization-failed-acquisition', state: 'scheduled', acquisitionRunId: null, acquisitionToken: null, acquiredAt: null }),
      expect.objectContaining({ id: 'normalization-explicit-terminal', state: 'exhausted', nextAttemptAt: null }),
    ]))
    const retry = await repository.recordRunRequest({ connectorInstanceId: 'failed-acquisition', mode: 'catch_up', startedAt: '2026-07-11T12:01:02.000Z' })
    expect(retry).toMatchObject({ acquired: true, run: { status: 'queued' } })
    expect(retry.run.id).not.toBe(acquisition.run.id)
    sqlite.close()
  })

  it('cancels acquired retry work when startup recovery cancels its interrupted run', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    await repository.upsertInstance({ id: 'interrupted-acquisition', connectorId: 'fixture.jobs', connectorVersion: '1.0.0', displayName: 'Interrupted acquisition', enabled: true, filters: {}, createdAt: '2026-07-11T12:00:00.000Z' })
    seedNormalizationRetry(sqlite, database, 'interrupted-acquisition', 'normalization-interrupted-acquisition', '2026-07-11T12:01:00.000Z')
    const acquisition = await repository.recordRunRequest({ connectorInstanceId: 'interrupted-acquisition', mode: 'catch_up', startedAt: '2026-07-11T12:01:00.000Z' })
    await repository.markRunRunning({ connectorRunId: acquisition.run.id, startedAt: '2026-07-11T12:01:00.000Z' })

    expect(repository.recoverInterruptedRuns({ completedAt: '2026-07-11T12:02:00.000Z' })).toBe(1)

    expect(database.select().from(retryWork).all()).toEqual([
      expect.objectContaining({ id: 'normalization-interrupted-acquisition', state: 'cancelled', nextAttemptAt: null, acquisitionRunId: null, acquisitionToken: null, acquiredAt: null }),
    ])
    const retry = await repository.recordRunRequest({ connectorInstanceId: 'interrupted-acquisition', mode: 'catch_up', startedAt: '2026-07-11T12:03:00.000Z' })
    expect(retry).toMatchObject({ acquired: false, run: { status: 'skipped', retryHints: { state: 'cancelled' } } })
    expect(retry.run.id).not.toBe(acquisition.run.id)
    sqlite.close()
  })

  it('keeps due generic normalization retries selectable on Jobright connector instances', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    await repository.upsertInstance({
      id: 'jobright-generic-resolver',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.8.0',
      displayName: 'Jobright generic resolver',
      enabled: true,
      filters: {},
      createdAt: '2026-07-11T12:00:00.000Z',
    })
    seedNormalizationRetry(
      sqlite,
      database,
      'jobright-generic-resolver',
      'normalization-jobright-generic',
      '2026-07-11T12:01:00.000Z',
      'job-generic',
    )

    const acquisition = await repository.recordRunRequest({
      connectorInstanceId: 'jobright-generic-resolver',
      mode: 'catch_up',
      startedAt: '2026-07-11T12:01:00.000Z',
    })

    expect(acquisition).toMatchObject({
      acquired: true,
      acquiredWork: {
        kind: 'normalization',
        rawRevisionId: 'revision-normalization-jobright-generic',
        resolverId: 'fixture.network',
        resolverVersion: '1.0.0',
        inputHash: 'sha256:normalization-jobright-generic',
      },
    })
    expect(database.select().from(retryWork).all()).toEqual([
      expect.objectContaining({
        id: 'normalization-jobright-generic',
        state: 'acquired',
        acquisitionRunId: acquisition.run.id,
      }),
    ])
    sqlite.close()
  })

  it('keeps untouched Jobright v5 normalization work scheduled when its canonical source remains pending', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    await repository.upsertInstance({ id: 'jobright-pending', connectorId: 'jobright.resolver', connectorVersion: '0.8.0', displayName: 'Jobright pending', enabled: true, filters: {}, createdAt: '2026-07-11T12:00:00.000Z' })
    seedNormalizationRetry(sqlite, database, 'jobright-pending', 'normalization-jobright-pending', '2026-07-11T12:01:00.000Z', 'job-retry')
    const acquisition = await repository.recordRunRequest({ connectorInstanceId: 'jobright-pending', mode: 'catch_up', startedAt: '2026-07-11T12:01:00.000Z' })
    await repository.markRunRunning({ connectorRunId: acquisition.run.id, startedAt: '2026-07-11T12:01:00.000Z' })

    await repository.recordRefreshResult({
      connectorRunId: acquisition.run.id, connectorInstanceId: 'jobright-pending', mode: 'catch_up',
      startedAt: '2026-07-11T12:01:00.000Z', completedAt: '2026-07-11T12:01:01.000Z', config: {}, filters: {}, filterSignature: 'filters:{}',
      result: {
        observations: [], warnings: [], stats: { observations: 0 },
        coverage: { start: '2026-07-11T11:00:00.000Z', end: '2026-07-11T12:01:00.000Z' },
        nextCheckpoint: {
          schemaVersion: 'jobright-resolution-checkpoint@5',
          checkpoint: {
            pendingDetailRetries: [{
              sourceId: 'jobright.public:job-retry',
              ownership: 'active',
              generationId: 'gen-pending',
              posting: { inclusion: 'included', kind: 'unknown', raw: null },
              advice: {
                state: 'scheduled', reason: 'server_failure', attempt: 1, maxAttempts: 3,
                lastAttemptAt: '2026-07-11T12:00:00.000Z', computedDelayMs: 60_000,
                nextAttemptAt: '2026-07-11T12:01:00.000Z', horizonAt: '2026-07-11T13:00:00.000Z',
              },
            }],
            retryState: [{
              sourceId: 'jobright.public:job-retry',
              advice: {
                state: 'scheduled', reason: 'server_failure', attempt: 1, maxAttempts: 3,
                lastAttemptAt: '2026-07-11T12:00:00.000Z', computedDelayMs: 60_000,
                nextAttemptAt: '2026-07-11T12:01:00.000Z', horizonAt: '2026-07-11T13:00:00.000Z',
              },
            }],
          },
        },
        retryHints: null,
      },
    })

    expect(database.select().from(retryWork).all()).toEqual([
      expect.objectContaining({ id: 'normalization-jobright-pending', state: 'scheduled', acquisitionRunId: null }),
    ])
    sqlite.close()
  })

  it('does not complete acquired Jobright normalization work merely because the provider left the checkpoint', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    await repository.upsertInstance({
      id: 'jobright-disappeared',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.8.0',
      displayName: 'Jobright disappeared',
      enabled: true,
      filters: {},
      createdAt: '2026-07-11T12:00:00.000Z',
    })
    seedNormalizationRetry(
      sqlite,
      database,
      'jobright-disappeared',
      'normalization-jobright-disappeared',
      '2026-07-11T12:01:00.000Z',
      'job-retry',
    )
    const acquisition = await repository.recordRunRequest({
      connectorInstanceId: 'jobright-disappeared',
      mode: 'catch_up',
      startedAt: '2026-07-11T12:01:00.000Z',
    })
    await repository.markRunRunning({
      connectorRunId: acquisition.run.id,
      startedAt: '2026-07-11T12:01:00.000Z',
    })

    await repository.recordRefreshResult({
      connectorRunId: acquisition.run.id,
      connectorInstanceId: 'jobright-disappeared',
      mode: 'catch_up',
      startedAt: '2026-07-11T12:01:00.000Z',
      completedAt: '2026-07-11T12:01:01.000Z',
      config: {},
      filters: {},
      filterSignature: 'filters:{}',
      result: {
        observations: [],
        warnings: [],
        stats: { observations: 0 },
        coverage: { start: '2026-07-11T11:00:00.000Z', end: '2026-07-11T12:01:00.000Z' },
        nextCheckpoint: {
          schemaVersion: 'jobright-resolution-checkpoint@5',
          checkpoint: { pendingDetailRetries: [], retryState: [] },
        },
        retryHints: null,
      },
    })

    expect(database.select().from(retryWork).all()).toEqual([
      expect.objectContaining({
        id: 'normalization-jobright-disappeared',
        state: 'scheduled',
        nextAttemptAt: '2026-07-11T12:01:00.000Z',
        acquisitionRunId: null,
        acquiredAt: null,
        acquisitionToken: null,
      }),
    ])
    sqlite.close()
  })

  it('rejects malformed current Jobright v5 retry state instead of inferring completion', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    await repository.upsertInstance({ id: 'jobright-malformed', connectorId: 'jobright.resolver', connectorVersion: '0.8.0', displayName: 'Jobright malformed', enabled: true, filters: {}, createdAt: '2026-07-11T12:00:00.000Z' })
    seedNormalizationRetry(sqlite, database, 'jobright-malformed', 'normalization-jobright-malformed', '2026-07-11T12:01:00.000Z', 'job-retry')
    await repository.recordCheckpoint({
      connectorInstanceId: 'jobright-malformed',
      filterSignature: 'filters:{}',
      savedAt: '2026-07-11T12:00:00.000Z',
      coverage: {
        start: '2026-07-04T00:00:00.000Z',
        end: '2026-07-11T12:00:00.000Z',
      },
      checkpoint: {
        schemaVersion: 'jobright-resolution-checkpoint@5',
        checkpoint: {
          generationId: 'gen-malformed',
          effectiveCoverageStart: '2026-07-04T00:00:00.000Z',
          pendingDetailRetries: [{
            sourceId: 'jobright.public:job-retry',
            ownership: 'active',
            generationId: 'gen-malformed',
            posting: { inclusion: 'included', kind: 'unknown', raw: null },
            advice: {
              state: 'scheduled', reason: 'server_failure', attempt: 1, maxAttempts: 3,
              lastAttemptAt: '2026-07-11T12:00:00.000Z', computedDelayMs: 60_000,
              nextAttemptAt: '2026-07-11T12:01:00.000Z', horizonAt: '2026-07-11T13:00:00.000Z',
            },
          }],
          retryState: [{
            sourceId: 'jobright.public:job-retry',
            advice: {
              state: 'scheduled', reason: 'server_failure', attempt: 1, maxAttempts: 3,
              lastAttemptAt: '2026-07-11T12:00:00.000Z', computedDelayMs: 60_000,
              nextAttemptAt: '2026-07-11T12:01:00.000Z', horizonAt: '2026-07-11T13:00:00.000Z',
            },
          }],
        },
      },
    })
    const acquisition = await repository.recordRunRequest({ connectorInstanceId: 'jobright-malformed', mode: 'catch_up', startedAt: '2026-07-11T12:01:00.000Z' })
    expect(acquisition).toMatchObject({ acquired: true, acquiredWork: { kind: 'normalization' } })
    await repository.markRunRunning({ connectorRunId: acquisition.run.id, startedAt: '2026-07-11T12:01:00.000Z' })

    await expect(repository.recordRefreshResult({
      connectorRunId: acquisition.run.id, connectorInstanceId: 'jobright-malformed', mode: 'catch_up',
      startedAt: '2026-07-11T12:01:00.000Z', completedAt: '2026-07-11T12:01:01.000Z', config: {}, filters: {}, filterSignature: 'filters:{}',
      result: {
        observations: [], warnings: [], stats: { observations: 0 },
        coverage: { start: '2026-07-11T11:00:00.000Z', end: '2026-07-11T12:01:00.000Z' },
        nextCheckpoint: {
          schemaVersion: 'jobright-resolution-checkpoint@5',
          checkpoint: { pendingDetailRetries: [{ sourceId: 'jobright.public:job-retry', ownership: 'active', advice: { state: 'scheduled' } }], retryState: [{ sourceId: 'jobright.public:job-retry', advice: { state: 'scheduled' } }] },
        },
        retryHints: null,
      },
    })).rejects.toThrow()
    expect(database.select().from(retryWork).all()).toEqual([
      expect.objectContaining({ id: 'normalization-jobright-malformed', state: 'acquired', acquisitionRunId: acquisition.run.id }),
    ])
    sqlite.close()
  })

})

function runAcquisitionWorker(sqlitePath: string, startEpoch: number) {
  const workerDirectory = fs.mkdtempSync(path.join(process.cwd(), '.retry-acquisition-worker-'))
  const workerPath = path.join(workerDirectory, 'worker.ts')
  const script = `
    import { createDrizzleDatabase, createFileDatabase } from ${JSON.stringify(path.resolve('src/db/sqlite.ts'))};
    import { createSqliteConnectorRepository } from ${JSON.stringify(path.resolve('src/modules/connectors/connector.repository.ts'))};
    (async () => {
      const delay = Number(process.env.RETRY_START_EPOCH) - Date.now();
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      const sqlite = createFileDatabase(process.env.RETRY_DB_PATH);
      const repository = createSqliteConnectorRepository(createDrizzleDatabase(sqlite));
      const result = await repository.recordRunRequest({
        connectorInstanceId: 'process-race', mode: 'catch_up', startedAt: '2026-07-11T12:01:00.000Z'
      });
      process.stdout.write(JSON.stringify({ acquired: result.acquired, id: result.run.id }));
      sqlite.close();
    })().catch((error) => { process.stderr.write(String(error)); process.exitCode = 1; });
  `
  fs.writeFileSync(workerPath, script)
  return new Promise<{ acquired: boolean; id: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', workerPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        RETRY_DB_PATH: sqlitePath,
        RETRY_START_EPOCH: String(startEpoch),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', reject)
    child.on('close', (code) => {
      fs.rmSync(workerDirectory, { recursive: true, force: true })
      if (code !== 0) reject(new Error(stderr || `Retry worker exited ${String(code)}`))
      else resolve(JSON.parse(stdout) as { acquired: boolean; id: string })
    })
  })
}

function seedNormalizationRetry(
  sqlite: ReturnType<typeof createInMemoryDatabase>,
  database: ReturnType<typeof createDrizzleDatabase>,
  connectorInstanceId: string,
  id: string,
  nextAttemptAt: string,
  providerRecordId?: string,
) {
  sqlite.exec(`
    insert into raw_source_records (id, created_at) values ('record-${id}', '2026-07-11T12:00:00.000Z');
    insert into raw_source_revisions (
      id, raw_record_id, revision, content_hash, adapter_id, adapter_kind, adapter_version,
      observed_at, provider_record_id, evidence_json, created_at
    ) values (
      'revision-${id}', 'record-${id}', 1, 'sha256:${id}', 'fixture.jobs', 'connector', '1.0.0',
      '2026-07-11T12:00:00.000Z', ${providerRecordId ? `'${providerRecordId}'` : 'null'}, '[]', '2026-07-11T12:00:00.000Z'
    );
  `)
  database.insert(retryWork).values({
    id, kind: 'normalization', connectorInstanceId: null, filterSignature: null,
    checkpointSchemaVersion: null, checkpointGeneration: null,
    rawRevisionId: `revision-${id}`, resolverId: 'fixture.network', resolverVersion: '1.0.0',
    inputHash: `sha256:${id}`, reason: 'server_failure', attempt: 1, maxAttempts: 3,
    lastAttemptAt: '2026-07-11T12:00:00.000Z', computedDelayMs: 60_000,
    serverMinimumDelayMs: null, nextAttemptAt, horizonAt: '2026-07-11T13:00:00.000Z',
    state: 'scheduled', ownerVersion: '1.0.0',
    lineageJson: JSON.stringify({ connectorInstanceId }), acquiredAt: null,
    acquisitionToken: null, acquisitionRunId: null, skippedRunId: null,
    createdAt: '2026-07-11T12:00:00.000Z', updatedAt: '2026-07-11T12:00:00.000Z', deletedAt: null,
  }).run()
}
