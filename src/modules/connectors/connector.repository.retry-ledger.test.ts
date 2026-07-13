import fs from 'node:fs'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { connectorInstances, retryWork } from '../../db/schema'
import { createDrizzleDatabase, createFileDatabase, createInMemoryDatabase, migrateDatabase } from '../../db/sqlite'
import { createSqliteConnectorRepository } from './connector.repository'
import { completedConnectorRefreshContract } from './connector-refresh-result.test-helpers'
import { createSourceExecutionGovernor } from '../source-execution/source-execution-governor'

describe('SQLite connector repository retry ledger', () => {
  it('selects due work independently of large terminal retry history', async () => {
    const sqlite = createInMemoryDatabase(); migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite); const repository = createSqliteConnectorRepository(database)
    const instance = await repository.upsertInstance({ id: 'bounded-history', connectorId: 'fixture.jobs', connectorVersion: '1', displayName: 'Bounded', enabled: true })
    const insert = sqlite.prepare(`insert into retry_work (id,execution_scope_id,kind,connector_instance_id,filter_signature,checkpoint_schema_version,checkpoint_generation,reason,attempt,max_attempts,last_attempt_at,horizon_at,state,owner_version,lineage_json,created_at,updated_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    sqlite.transaction(() => {
      for (let index = 0; index < 2000; index += 1) insert.run(`terminal-${index}`, instance.executionScopeId, 'connector_capture', instance.id,
        `terminal:${index}`, 'v1', String(index), 'server_failure', 3, 3, '2026-07-11T00:00:00.000Z', '2026-07-12T00:00:00.000Z',
        'exhausted', '1', '{}', '2026-07-11T00:00:00.000Z', '2026-07-11T00:00:00.000Z')
    })()
    seedNormalizationRetry(sqlite, database, instance.id, 'due-after-history', '2026-07-12T12:00:00.000Z')
    const request = await repository.recordRunRequest({ connectorInstanceId: instance.id, mode: 'manual', startedAt: '2026-07-12T12:00:00.000Z' })
    expect(request).toMatchObject({ acquired: true, acquiredWork: { retryWorkId: 'due-after-history' } })
    expect(sqlite.prepare("explain query plan select * from retry_work where state='scheduled' and next_attempt_at <= ? order by next_attempt_at limit 1")
      .all('2026-07-12T12:00:00.000Z')).toEqual(expect.arrayContaining([expect.objectContaining({ detail: expect.stringContaining('idx_retry_work_due') })]))
    for (const [query, indexName, parameters] of [
      ["select * from retry_work where kind='connector_capture' and connector_instance_id=? and filter_signature=? and state='scheduled' and deleted_at is null order by next_attempt_at limit 1", 'idx_retry_work_capture_pending', [instance.id, 'filters:{}']],
      ["select * from retry_work where kind='normalization' and execution_scope_id=? and state='scheduled' and deleted_at is null order by next_attempt_at, created_at limit 1", 'idx_retry_work_normalization_pending', [instance.executionScopeId]],
    ] as const) {
      const plan = sqlite.prepare(`explain query plan ${query}`).all(...parameters) as Array<{ detail: string }>
      expect(plan.some(({ detail }) => detail.includes(indexName))).toBe(true)
      expect(plan.some(({ detail }) => detail.includes('TEMP B-TREE') || detail === 'SCAN retry_work')).toBe(false)
    }
    sqlite.close()
  })
  it('atomically blocks non-adjacent same-scope work while another scope proceeds across callers and restart', async () => {
    const sqlitePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'scope-acquisition-')), 'workspace.sqlite')
    const sqlite = createFileDatabase(sqlitePath); migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    for (const id of ['shared-a', 'other']) {
      await repository.upsertInstance({ id, connectorId: 'fixture.jobs', connectorVersion: '1.0.0', displayName: id, enabled: true, filters: {}, createdAt: '2026-07-11T12:00:00.000Z' })
      seedNormalizationRetry(sqlite, database, id, `retry-${id}`, '2026-07-11T12:01:00.000Z')
    }
    const sharedScope = database.select({ id: connectorInstances.executionScopeId }).from(connectorInstances).where(eq(connectorInstances.id, 'shared-a')).get()!.id
    createSourceExecutionGovernor(database).blockScope(sharedScope, { now: '2026-07-11T12:02:00.000Z', retryAfter: '120' })
    sqlite.close()

    const firstSqlite = createFileDatabase(sqlitePath)
    const secondSqlite = createFileDatabase(sqlitePath)
    const first = createSqliteConnectorRepository(createDrizzleDatabase(firstSqlite))
    const second = createSqliteConnectorRepository(createDrizzleDatabase(secondSqlite))
    const [blockedA, allowed] = await Promise.all([
      first.recordRunRequest({ connectorInstanceId: 'shared-a', mode: 'manual', startedAt: '2026-07-11T12:03:00.000Z' }),
      second.recordRunRequest({ connectorInstanceId: 'other', mode: 'manual', startedAt: '2026-07-11T12:03:00.000Z' }),
    ])
    expect(blockedA).toEqual(expect.objectContaining({ acquired: false, acquiredWork: null, run: expect.objectContaining({ status: 'skipped' }) }))
    expect(allowed.acquiredWork).toMatchObject({ retryWorkId: 'retry-other' })
    expect(first.getRunSynchronization(blockedA.run.id)).toMatchObject({ outcome: { kind: 'cooling_down' } })
    firstSqlite.close(); secondSqlite.close()
  })

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
        ...completedConnectorRefreshContract('2026-07-11'),
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
        ...completedConnectorRefreshContract('2026-07-11'),
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
        ...completedConnectorRefreshContract('2026-07-11'),
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
        ...completedConnectorRefreshContract('2026-07-11'),
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
    'does not let persisted %s capture work block unrelated discovery after restart',
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
          ...completedConnectorRefreshContract('2026-07-11'),
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

      expect(first).toMatchObject({ acquired: true, acquiredWork: null, run: { status: 'queued', retryHints: null } })
      expect(second).toMatchObject({ acquired: false, acquiredWork: null, run: { id: first.run.id, retryHints: null } })
      restartedSqlite.close()
    },
  )

  it.each(['exhausted', 'cancelled'] as const)(
    'does not let persisted normalization %s work block unrelated discovery after restart',
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

      expect(first).toMatchObject({ acquired: true, acquiredWork: null, run: { status: 'queued', retryHints: null } })
      expect(second).toMatchObject({ acquired: false, acquiredWork: null, run: { id: first.run.id, retryHints: null } })
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
        ...completedConnectorRefreshContract('2026-07-11'),
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
      result: { ...completedConnectorRefreshContract('2026-07-11'), observations: [], warnings: [], stats: { observations: 0 }, coverage: { start: '2026-07-11T11:00:00.000Z', end: '2026-07-11T12:01:00.000Z' }, nextCheckpoint: { checkpoint: {}, schemaVersion: 'fixture@1' }, retryHints: null },
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

  it('returns acquired retry work to its resumable due state after startup recovery', async () => {
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
      expect.objectContaining({ id: 'normalization-interrupted-acquisition', state: 'scheduled', nextAttemptAt: '2026-07-11T12:01:00.000Z', attempt: 1, acquisitionRunId: null, acquisitionToken: null, acquiredAt: null }),
    ])
    const retry = await repository.recordRunRequest({ connectorInstanceId: 'interrupted-acquisition', mode: 'catch_up', startedAt: '2026-07-11T12:03:00.000Z' })
    expect(retry).toMatchObject({ acquired: true, acquiredWork: { retryWorkId: 'normalization-interrupted-acquisition' }, run: { status: 'queued' } })
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
      connectorVersion: '0.11.0',
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

  it('selects an active third Jobright retry without stale pre-filter starvation', async () => {
    const sqlite = createInMemoryDatabase(); migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    await repository.upsertInstance({ id: 'jobright-active-third', connectorId: 'jobright.resolver', connectorVersion: '0.11.0', displayName: 'Active third', enabled: true, filters: {}, createdAt: '2026-07-11T12:00:00.000Z' })
    for (const id of ['stale-one', 'stale-two', 'active-three']) {
      seedNormalizationRetry(sqlite, database, 'jobright-active-third', id, '2026-07-11T12:01:00.000Z', id)
      database.update(retryWork).set({
        resolverId: 'jobright.authenticated-destination', resolverVersion: 'jobright-authenticated-destination@1',
      }).where(eq(retryWork.id, id)).run()
    }
    await repository.recordCheckpoint({
      connectorInstanceId: 'jobright-active-third', filterSignature: 'filters:{}', savedAt: '2026-07-11T12:00:00.000Z',
      coverage: { start: '2026-07-01T00:00:00.000Z', end: '2026-07-11T12:00:00.000Z' },
      checkpoint: { schemaVersion: 'jobright-resolution-checkpoint@5', checkpoint: {
        generationId: 'generation-active', effectiveCoverageStart: '2026-07-01T00:00:00.000Z',
        pendingDetailRetries: [{ sourceId: 'jobright.public:active-three', ownership: 'active', generationId: 'generation-active' }],
      } },
    })
    const acquisition = await repository.recordRunRequest({
      connectorInstanceId: 'jobright-active-third', mode: 'catch_up',
      coverageStartedAt: '2026-07-01T00:00:00.000Z', startedAt: '2026-07-11T12:01:00.000Z',
    })
    expect(acquisition.acquiredWork).toMatchObject({ retryWorkId: 'active-three' })
    sqlite.close()
  })

  it('does not replay an old retry when a newer revision of the same provider record exists', async () => {
    const { sqlite, database, repository } = await currentRevisionFixture(['current-one'])
    seedSharedProviderRevisionHistory(sqlite)
    const insertRecord = sqlite.prepare('insert into raw_source_records (id,created_at) values (?,?)')
    const insertRevision = sqlite.prepare(`insert into raw_source_revisions
      (id,raw_record_id,revision,content_hash,adapter_id,adapter_kind,adapter_version,observed_at,provider_record_id,evidence_json,created_at)
      values (?,?,?,?,?,?,?,?,?,?,?)`)
    sqlite.transaction(() => {
      for (let index = 0; index < 2000; index += 1) {
        insertRecord.run(`history-record-${index}`, '2026-07-10T00:00:00.000Z')
        insertRevision.run(`history-revision-${index}`, `history-record-${index}`, 1, `history-hash-${index}`,
          'jobright.resolver', 'connector', '0.11.0', '2026-07-10T00:00:00.000Z',
          `history-provider-${index}`, '[]', '2026-07-10T00:00:00.000Z')
      }
    })()
    const plan = sqlite.prepare(`explain query plan select 1 from raw_source_revisions current indexed by idx_raw_source_revisions_provider_current
      where current.id=? and current.provider_record_id in (?) and current.id=(
        select latest.id from raw_source_revisions latest where latest.raw_record_id=current.raw_record_id
        order by latest.revision desc limit 1)` ).all('shared-revision-1', 'shared-provider') as Array<{ detail: string }>
    expect(plan.map(({ detail }) => detail)).toEqual(expect.arrayContaining([
      expect.stringContaining('idx_raw_source_revisions_provider_current'),
      expect.stringContaining('idx_raw_source_revisions_record_revision'),
    ]))
    expect(plan.some(({ detail }) => detail.includes('SCAN raw_source_revisions') || detail.includes('TEMP B-TREE'))).toBe(false)
    seedExactNormalizationRetry(database, 'current-one', 'old-retry', 'shared-revision-1')
    await recordActiveSharedProviderCheckpoint(repository, 'current-one')
    const acquisition = await repository.recordRunRequest({ connectorInstanceId: 'current-one', mode: 'manual',
      coverageStartedAt: '2026-07-01T00:00:00.000Z', startedAt: '2026-07-11T12:01:00.000Z' })
    expect(acquisition).toMatchObject({ acquired: true, acquiredWork: null })
    expect(database.select().from(retryWork).where(eq(retryWork.id, 'old-retry')).get()).toMatchObject({ state: 'scheduled' })
    sqlite.close()
  })

  it('selects only the current retry across connector instances sharing a provider identity', async () => {
    const { sqlite, database, repository } = await currentRevisionFixture(['current-a', 'current-b'])
    seedSharedProviderRevisionHistory(sqlite)
    seedExactNormalizationRetry(database, 'current-a', 'old-cross-scope', 'shared-revision-1')
    seedExactNormalizationRetry(database, 'current-b', 'current-cross-scope', 'shared-revision-2')
    await recordActiveSharedProviderCheckpoint(repository, 'current-a')
    await recordActiveSharedProviderCheckpoint(repository, 'current-b')
    const old = await repository.recordRunRequest({ connectorInstanceId: 'current-a', mode: 'manual',
      coverageStartedAt: '2026-07-01T00:00:00.000Z', startedAt: '2026-07-11T12:01:00.000Z' })
    const current = await repository.recordRunRequest({ connectorInstanceId: 'current-b', mode: 'manual',
      coverageStartedAt: '2026-07-01T00:00:00.000Z', startedAt: '2026-07-11T12:01:00.000Z' })
    expect(old.acquiredWork).toBeNull()
    expect(current.acquiredWork).toMatchObject({ retryWorkId: 'current-cross-scope', rawRevisionId: 'shared-revision-2' })
    sqlite.close()
  })

  it('keeps untouched Jobright v5 normalization work scheduled when its canonical source remains pending', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    await repository.upsertInstance({ id: 'jobright-pending', connectorId: 'jobright.resolver', connectorVersion: '0.11.0', displayName: 'Jobright pending', enabled: true, filters: {}, createdAt: '2026-07-11T12:00:00.000Z' })
    seedNormalizationRetry(sqlite, database, 'jobright-pending', 'normalization-jobright-pending', '2026-07-11T12:01:00.000Z', 'job-retry')
    const acquisition = await repository.recordRunRequest({ connectorInstanceId: 'jobright-pending', mode: 'catch_up', startedAt: '2026-07-11T12:01:00.000Z' })
    await repository.markRunRunning({ connectorRunId: acquisition.run.id, startedAt: '2026-07-11T12:01:00.000Z' })

    await repository.recordRefreshResult({
      connectorRunId: acquisition.run.id, connectorInstanceId: 'jobright-pending', mode: 'catch_up',
      startedAt: '2026-07-11T12:01:00.000Z', completedAt: '2026-07-11T12:01:01.000Z', config: {}, filters: {}, filterSignature: 'filters:{}',
      result: {
        ...completedConnectorRefreshContract('2026-07-11'),
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
      connectorVersion: '0.11.0',
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
        ...completedConnectorRefreshContract('2026-07-11'),
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
    await repository.upsertInstance({ id: 'jobright-malformed', connectorId: 'jobright.resolver', connectorVersion: '0.11.0', displayName: 'Jobright malformed', enabled: true, filters: {}, createdAt: '2026-07-11T12:00:00.000Z' })
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
        ...completedConnectorRefreshContract('2026-07-11'),
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
    id,
    executionScopeId: database.select({ id: connectorInstances.executionScopeId }).from(connectorInstances)
      .where(eq(connectorInstances.id, connectorInstanceId)).get()?.id ?? null,
    kind: 'normalization', connectorInstanceId: null, filterSignature: null,
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

async function currentRevisionFixture(instanceIds: string[]) {
  const sqlite = createInMemoryDatabase(); migrateDatabase(sqlite)
  const database = createDrizzleDatabase(sqlite)
  const repository = createSqliteConnectorRepository(database)
  for (const id of instanceIds) await repository.upsertInstance({ id, connectorId: 'jobright.resolver',
    connectorVersion: '0.11.0', displayName: id, enabled: true, filters: {}, createdAt: '2026-07-11T12:00:00.000Z' })
  return { sqlite, database, repository }
}

function seedSharedProviderRevisionHistory(sqlite: ReturnType<typeof createInMemoryDatabase>) {
  sqlite.exec(`
    insert into raw_source_records (id,created_at) values ('shared-record','2026-07-11T12:00:00.000Z');
    insert into raw_source_revisions (id,raw_record_id,revision,content_hash,adapter_id,adapter_kind,adapter_version,observed_at,provider_record_id,evidence_json,created_at) values
      ('shared-revision-1','shared-record',1,'shared-hash-1','jobright.resolver','connector','0.11.0','2026-07-11T12:00:00.000Z','shared-provider','[]','2026-07-11T12:00:00.000Z'),
      ('shared-revision-2','shared-record',2,'shared-hash-2','jobright.resolver','connector','0.11.0','2026-07-11T12:00:01.000Z','shared-provider','[]','2026-07-11T12:00:01.000Z');
  `)
}

function seedExactNormalizationRetry(database: ReturnType<typeof createDrizzleDatabase>, instanceId: string, id: string, rawRevisionId: string) {
  const executionScopeId = database.select({ id: connectorInstances.executionScopeId }).from(connectorInstances)
    .where(eq(connectorInstances.id, instanceId)).get()!.id
  database.insert(retryWork).values({ id, executionScopeId, kind: 'normalization', rawRevisionId,
    resolverId: 'jobright.authenticated-destination', resolverVersion: 'jobright-authenticated-destination@1', inputHash: `hash-${id}`,
    reason: 'server_failure', attempt: 1, maxAttempts: 3, lastAttemptAt: '2026-07-11T12:00:00.000Z', computedDelayMs: 1000,
    nextAttemptAt: '2026-07-11T12:00:01.000Z', horizonAt: '2026-07-11T13:00:00.000Z', state: 'scheduled', ownerVersion: '1',
    lineageJson: JSON.stringify({ connectorInstanceId: instanceId }), createdAt: '2026-07-11T12:00:00.000Z', updatedAt: '2026-07-11T12:00:00.000Z' }).run()
}

async function recordActiveSharedProviderCheckpoint(repository: ReturnType<typeof createSqliteConnectorRepository>, connectorInstanceId: string) {
  await repository.recordCheckpoint({ connectorInstanceId, filterSignature: 'filters:{}', savedAt: '2026-07-11T12:00:00.000Z',
    coverage: { start: '2026-07-01T00:00:00.000Z', end: '2026-07-11T12:00:00.000Z' },
    checkpoint: { schemaVersion: 'jobright-resolution-checkpoint@5', checkpoint: { generationId: 'shared-generation',
      effectiveCoverageStart: '2026-07-01T00:00:00.000Z', pendingDetailRetries: [
        { sourceId: 'jobright.public:shared-provider', ownership: 'active', generationId: 'shared-generation' },
      ] } } })
}
