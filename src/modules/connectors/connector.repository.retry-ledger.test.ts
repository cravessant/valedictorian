import fs from 'node:fs'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  captureEvidenceVersions,
  captureLineages,
  connectorInstances,
  retryWork,
  sourceExecutionScopes,
} from '../../db/schema'
import { createPgliteClient, createPgliteDatabase, migratePgliteDatabase, type PgliteClient, type PgliteDatabase } from '../../db/pglite'
import { createPgliteConnectorRepository } from './connector.repository'
import { createConnectorRepositoryTestContext } from './connector.repository.pglite-test-helpers'
import { completedConnectorRefreshContract } from './connector-refresh-result.test-helpers'

describe('PGlite connector repository retry ledger', () => {
  it('leaves provider URL lineage for the app-wide source instead of connector acquisition', async () => {
    const { client, database, repository } = await createConnectorRepositoryTestContext()
    await repository.upsertInstance({
      id: 'provider-owner', connectorId: 'fixture.jobs', connectorVersion: '1.0.0',
      displayName: 'Provider owner', enabled: true, filters: {}, createdAt: '2026-07-11T12:00:00.000Z',
    })
    await seedNormalizationRetry(client, database, 'provider-owner', 'provider-url-work', '2026-07-11T12:00:00.000Z', 'provider-one')
await database.update(retryWork).set({
      lineageJson: JSON.stringify({
        connectorInstanceId: 'provider-owner',
        intermediaryUrl: 'https://jobright.ai/jobs/info/provider-one',
        providerRecordId: 'jobright.public:provider-one',
        workKind: 'provider_url_resolution',
      }),
    }).where(eq(retryWork.id, 'provider-url-work'))

    const request = await repository.recordRunRequest({
      connectorInstanceId: 'provider-owner', mode: 'manual', startedAt: '2026-07-11T12:00:00.000Z',
    })

    expect(request.acquiredWork).toBeNull()
    const [persistedWork] = await database.select().from(retryWork).limit(1)
    expect(persistedWork).toMatchObject({
      id: 'provider-url-work', state: 'scheduled', acquisitionRunId: null,
    })
  })

  it('admits Jobright capture runs while provider URL work remains scheduled', async () => {
    const { client, database, repository } = await createConnectorRepositoryTestContext()
    await repository.upsertInstance({
      id: 'jobright-capture', connectorId: 'jobright.resolver', connectorVersion: '0.14.1',
      displayName: 'Jobright capture', enabled: true, filters: {},
      earliestBackfillDate: '2026-07-01', createdAt: '2026-07-11T12:00:00.000Z',
    })
    await seedNormalizationRetry(
      client, database, 'jobright-capture', 'provider-url-work',
      '2026-07-11T12:00:00.000Z', 'provider-one',
    )
await database.update(retryWork).set({
      resolverId: 'jobright.authenticated-destination',
      resolverVersion: 'jobright-authenticated-destination@1',
      lineageJson: JSON.stringify({
        connectorInstanceId: 'jobright-capture',
        intermediaryUrl: 'https://jobright.ai/jobs/info/provider-one',
        providerRecordId: 'jobright.public:provider-one',
        workKind: 'provider_url_resolution',
      }),
    }).where(eq(retryWork.id, 'provider-url-work'))
    await repository.recordCheckpoint({
      connectorInstanceId: 'jobright-capture', filterSignature: 'filters:{}',
      savedAt: '2026-07-11T12:00:00.000Z',
      coverage: { start: '2026-07-01T00:00:00.000Z', end: '2026-07-11T12:00:00.000Z' },
      checkpoint: {
        schemaVersion: 'jobright-capture-checkpoint@1',
        checkpoint: { cursor: 'capture-complete' },
      },
    })

    const request = await repository.recordRunRequest({
      connectorInstanceId: 'jobright-capture', mode: 'manual',
      startedAt: '2026-07-11T12:01:00.000Z',
    })

    expect(request).toMatchObject({ acquired: true, acquiredWork: null })
    const [persistedWork] = await database.select().from(retryWork).limit(1)
    expect(persistedWork).toMatchObject({
      id: 'provider-url-work', state: 'scheduled', acquisitionRunId: null,
    })
  })

  it('admits Jobright capture runs without acquiring legacy v5 exact retry work', async () => {
    const { client, database, repository } = await createConnectorRepositoryTestContext()
    await repository.upsertInstance({
      id: 'jobright-upgraded-capture', connectorId: 'jobright.resolver', connectorVersion: '0.14.1',
      displayName: 'Upgraded Jobright capture', enabled: true, filters: {},
      earliestBackfillDate: '2026-07-01', createdAt: '2026-07-11T12:00:00.000Z',
    })
    await seedNormalizationRetry(
      client, database, 'jobright-upgraded-capture', 'legacy-v5-work',
      '2026-07-11T12:00:00.000Z', 'legacy-provider',
    )
await database.update(retryWork).set({
      resolverId: 'jobright.authenticated-destination',
      resolverVersion: 'jobright-authenticated-destination@1',
    }).where(eq(retryWork.id, 'legacy-v5-work'))
    await repository.recordCheckpoint({
      connectorInstanceId: 'jobright-upgraded-capture', filterSignature: 'filters:{}',
      savedAt: '2026-07-11T12:00:00.000Z',
      coverage: { start: '2026-07-01T00:00:00.000Z', end: '2026-07-11T12:00:00.000Z' },
      checkpoint: {
        schemaVersion: 'jobright-capture-checkpoint@1',
        checkpoint: { cursor: 'capture-complete' },
      },
    })

    const request = await repository.recordRunRequest({
      connectorInstanceId: 'jobright-upgraded-capture', mode: 'manual',
      startedAt: '2026-07-11T12:01:00.000Z',
    })

    expect(request).toMatchObject({ acquired: true, acquiredWork: null })
    const [persistedWork] = await database.select().from(retryWork).limit(1)
    expect(persistedWork).toMatchObject({
      id: 'legacy-v5-work', state: 'scheduled', acquisitionRunId: null,
    })
  })

  it('selects due work independently of large terminal retry history', async () => {
    const { client, database, repository } = await createConnectorRepositoryTestContext()
    const instance = await repository.upsertInstance({ id: 'bounded-history', connectorId: 'fixture.jobs', connectorVersion: '1', displayName: 'Bounded', enabled: true })
    const terminalRows = Array.from({ length: 2_000 }, (_, index) => ({
      id: `terminal-${index}`, executionScopeId: instance.executionScopeId,
      kind: 'connector_capture' as const, connectorInstanceId: instance.id,
      filterSignature: `terminal:${index}`, checkpointSchemaVersion: 'v1',
      checkpointGeneration: String(index), reason: 'server_failure', attempt: 3,
      maxAttempts: 3, lastAttemptAt: '2026-07-11T00:00:00.000Z',
      horizonAt: '2026-07-12T00:00:00.000Z', state: 'exhausted' as const,
      ownerVersion: '1', lineageJson: '{}', createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:00.000Z',
    }))
    for (let index = 0; index < terminalRows.length; index += 100) {
      await database.insert(retryWork).values(terminalRows.slice(index, index + 100))
    }
    await seedNormalizationRetry(client, database, instance.id, 'due-after-history', '2026-07-12T12:00:00.000Z')
    const request = await repository.recordRunRequest({ connectorInstanceId: instance.id, mode: 'manual', startedAt: '2026-07-12T12:00:00.000Z' })
    expect(request).toMatchObject({ acquired: true, acquiredWork: { retryWorkId: 'due-after-history' } })
    await client.exec('set enable_seqscan = off')
    const duePlan = await explainPlan(client,
      "select * from retry_work where state='scheduled' and next_attempt_at <= $1 order by next_attempt_at limit 1",
      ['2026-07-12T12:00:00.000Z'])
    expect(duePlan).toContain('idx_retry_work_due')
    for (const [query, indexName, parameters] of [
      ["select * from retry_work where kind='connector_capture' and connector_instance_id=$1 and filter_signature=$2 and state='scheduled' and deleted_at is null order by next_attempt_at limit 1", 'idx_retry_work_capture_pending', [instance.id, 'filters:{}']],
      ["select * from retry_work where kind='normalization' and execution_scope_id=$1 and state='scheduled' and deleted_at is null order by next_attempt_at, created_at limit 1", 'idx_retry_work_normalization_pending', [instance.executionScopeId]],
    ] as const) {
      const plan = await explainPlan(client, query, [...parameters])
      if (indexName === 'idx_retry_work_normalization_pending') {
        expect(plan).toMatch(/idx_retry_work_(normalization_pending|normalization_identity)/)
      } else {
        expect(plan).toContain(indexName)
      }
      expect(plan).not.toContain('Seq Scan')
    }
  })
  it('atomically blocks non-adjacent same-scope work while another scope proceeds across callers and restart', async () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-acquisition-'))
    const pgliteDataPath = path.join(temporaryRoot, 'pglite')
    const client = await createPgliteClient({ dataDir: pgliteDataPath })
    const database = await migratePgliteDatabase(client)
    const repository = createPgliteConnectorRepository(database)
    for (const id of ['shared-a', 'other']) {
      await repository.upsertInstance({ id, connectorId: 'fixture.jobs', connectorVersion: '1.0.0', displayName: id, enabled: true, filters: {}, createdAt: '2026-07-11T12:00:00.000Z' })
      await seedNormalizationRetry(client, database, id, `retry-${id}`, '2026-07-11T12:01:00.000Z')
    }
    const [shared] = await database.select({ id: connectorInstances.executionScopeId }).from(connectorInstances).where(eq(connectorInstances.id, 'shared-a')).limit(1)
    await database.update(sourceExecutionScopes).set({
      status: 'cooldown', blockedUntil: '2026-07-11T12:04:00.000Z', backoffAttempt: 1,
      updatedAt: '2026-07-11T12:02:00.000Z',
    }).where(eq(sourceExecutionScopes.id, shared!.id))
    await client.close()

    const firstClient = await createPgliteClient({ dataDir: pgliteDataPath })
    const sharedDatabase = createPgliteDatabase(firstClient)
    const first = createPgliteConnectorRepository(sharedDatabase)
    const second = createPgliteConnectorRepository(sharedDatabase)
    const [blockedA, allowed] = await Promise.all([
      first.recordRunRequest({ connectorInstanceId: 'shared-a', mode: 'manual', startedAt: '2026-07-11T12:03:00.000Z' }),
      second.recordRunRequest({ connectorInstanceId: 'other', mode: 'manual', startedAt: '2026-07-11T12:03:00.000Z' }),
    ])
    expect(blockedA).toEqual(expect.objectContaining({ acquired: false, acquiredWork: null, run: expect.objectContaining({ status: 'skipped' }) }))
    expect(allowed.acquiredWork).toMatchObject({ retryWorkId: 'retry-other' })
    await expect(first.getRunSynchronization(blockedA.run.id)).resolves.toMatchObject({ outcome: { kind: 'cooling_down' } })
    await firstClient.close()
    await fs.promises.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('returns one persisted not-due run for repeated triggers in the same retry window', async () => {
    const { repository } = await createConnectorRepositoryTestContext()
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
  })

  it('preserves the skipped run when identical retry advice is persisted again', async () => {
    const { repository } = await createConnectorRepositoryTestContext()
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
  })

  it('allows one exact-due acquisition across callers sharing the workspace owner', async () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'retry-race-'))
    const pgliteDataPath = path.join(temporaryRoot, 'pglite')
    const firstClient = await createPgliteClient({ dataDir: pgliteDataPath })
    const sharedDatabase = await migratePgliteDatabase(firstClient)
    const first = createPgliteConnectorRepository(sharedDatabase)
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
    const second = createPgliteConnectorRepository(sharedDatabase)

    const results = await Promise.all([first, second].map((repository) => repository.recordRunRequest({
      connectorInstanceId: 'race-instance', mode: 'catch_up', startedAt: '2026-07-11T12:01:00.000Z',
    })))

    expect(results.filter(({ acquired }) => acquired)).toHaveLength(1)
    expect(new Set(results.map(({ run }) => run.id))).toHaveLength(1)
    await firstClient.close()
    await fs.promises.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('reuses one exact-due outcome after a worker process owner closes', async () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'retry-process-race-'))
    const pgliteDataPath = path.join(temporaryRoot, 'pglite')
    const client = await createPgliteClient({ dataDir: pgliteDataPath })
    const repository = createPgliteConnectorRepository(await migratePgliteDatabase(client))
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

    await client.close()
    const startEpoch = Date.now() + 200
    const results = [
      await runAcquisitionWorker(pgliteDataPath, startEpoch),
      await runAcquisitionWorker(pgliteDataPath, Date.now()),
    ]

    expect(results.filter(({ acquired }) => acquired)).toHaveLength(1)
    expect(new Set(results.map(({ id }) => id))).toHaveLength(1)
    await fs.promises.rm(temporaryRoot, { recursive: true, force: true })
  })

  it.each(['exhausted', 'cancelled'] as const)(
    'does not let persisted %s capture work block unrelated discovery after restart',
    async (state) => {
      const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), `retry-${state}-`))
      const pgliteDataPath = path.join(temporaryRoot, 'pglite')
      let client = await createPgliteClient({ dataDir: pgliteDataPath })
      const repository = createPgliteConnectorRepository(await migratePgliteDatabase(client))
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
      await client.close()
      client = await createPgliteClient({ dataDir: pgliteDataPath })
      const restarted = createPgliteConnectorRepository(createPgliteDatabase(client))
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
      await client.close()
      await fs.promises.rm(temporaryRoot, { recursive: true, force: true })
    },
  )

  it.each(['exhausted', 'cancelled'] as const)(
    'does not let persisted normalization %s work block unrelated discovery after restart',
    async (state) => {
      const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), `normalization-${state}-`))
      const pgliteDataPath = path.join(temporaryRoot, 'pglite')
      let client = await createPgliteClient({ dataDir: pgliteDataPath })
      const database = await migratePgliteDatabase(client)
      const repository = createPgliteConnectorRepository(database)
      await repository.upsertInstance({ id: `normalization-terminal-${state}`, connectorId: 'fixture.jobs', connectorVersion: '1.0.0', displayName: 'Normalization terminal', enabled: true, filters: {}, createdAt: '2026-07-11T12:00:00.000Z' })
      await seedNormalizationRetry(client, database, `normalization-terminal-${state}`, `normalization-${state}`, '2026-07-11T12:01:00.000Z')
      await database.update(retryWork).set({ state, nextAttemptAt: null })
        .where(eq(retryWork.id, `normalization-${state}`))

      await client.close()
      client = await createPgliteClient({ dataDir: pgliteDataPath })
      const restarted = createPgliteConnectorRepository(createPgliteDatabase(client))
      await restarted.upsertInstance({ id: `normalization-terminal-${state}`, connectorId: 'fixture.jobs', connectorVersion: '2.0.0', displayName: 'Changed normalization terminal', enabled: true, filters: {}, config: { changed: true } })
      const first = await restarted.recordRunRequest({ connectorInstanceId: `normalization-terminal-${state}`, mode: 'catch_up', startedAt: '2026-07-11T14:00:00.000Z' })
      const second = await restarted.recordRunRequest({ connectorInstanceId: `normalization-terminal-${state}`, mode: 'catch_up', startedAt: '2026-07-11T15:00:00.000Z' })

      expect(first).toMatchObject({ acquired: true, acquiredWork: null, run: { status: 'queued', retryHints: null } })
      expect(second).toMatchObject({ acquired: false, acquiredWork: null, run: { id: first.run.id, retryHints: null } })
      await client.close()
      await fs.promises.rm(temporaryRoot, { recursive: true, force: true })
    },
  )

  it('acquires due normalization work ahead of later capture work', async () => {
    const { client, database, repository } = await createConnectorRepositoryTestContext()
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
    await seedNormalizationRetry(client, database, 'scope-priority', 'normalization-due', '2026-07-11T12:01:00.000Z')

    const acquisition = await repository.recordRunRequest({ connectorInstanceId: 'scope-priority', mode: 'catch_up', startedAt: '2026-07-11T12:02:00.000Z' })

    expect(acquisition.acquired).toBe(true)
    await expect(database.select().from(retryWork)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'normalization-due', state: 'acquired', acquisitionRunId: acquisition.run.id }),
      expect.objectContaining({ kind: 'connector_capture', state: 'scheduled', nextAttemptAt: '2026-07-11T12:10:00.000Z' }),
    ]))
  })

  it('releases untouched acquired normalization work back to scheduled', async () => {
    const { client, database, repository } = await createConnectorRepositoryTestContext()
    await repository.upsertInstance({ id: 'untouched', connectorId: 'fixture.jobs', connectorVersion: '1.0.0', displayName: 'Untouched', enabled: true, filters: {}, createdAt: '2026-07-11T12:00:00.000Z' })
    await seedNormalizationRetry(client, database, 'untouched', 'normalization-untouched', '2026-07-11T12:01:00.000Z')
    const first = await repository.recordRunRequest({ connectorInstanceId: 'untouched', mode: 'catch_up', startedAt: '2026-07-11T12:01:00.000Z' })
    await repository.markRunRunning({ connectorRunId: first.run.id, startedAt: '2026-07-11T12:01:00.000Z' })
    await repository.recordRefreshResult({
      connectorRunId: first.run.id, connectorInstanceId: 'untouched', mode: 'catch_up',
      startedAt: '2026-07-11T12:01:00.000Z', completedAt: '2026-07-11T12:01:01.000Z', config: {}, filters: {}, filterSignature: 'filters:{}',
      result: { ...completedConnectorRefreshContract('2026-07-11'), observations: [], warnings: [], stats: { observations: 0 }, coverage: { start: '2026-07-11T11:00:00.000Z', end: '2026-07-11T12:01:00.000Z' }, nextCheckpoint: { checkpoint: {}, schemaVersion: 'fixture@1' }, retryHints: null },
    })
    await expect(database.select().from(retryWork)).resolves.toEqual([
      expect.objectContaining({ id: 'normalization-untouched', state: 'scheduled', acquisitionRunId: null }),
    ])
    const second = await repository.recordRunRequest({ connectorInstanceId: 'untouched', mode: 'catch_up', startedAt: '2026-07-11T12:02:00.000Z' })
    expect(second.acquired).toBe(true)
  })

  it('releases untouched acquired retry work when connector execution fails', async () => {
    const { client, database, repository } = await createConnectorRepositoryTestContext()
    await repository.upsertInstance({ id: 'failed-acquisition', connectorId: 'fixture.jobs', connectorVersion: '1.0.0', displayName: 'Failed acquisition', enabled: true, filters: {}, createdAt: '2026-07-11T12:00:00.000Z' })
    await seedNormalizationRetry(client, database, 'failed-acquisition', 'normalization-failed-acquisition', '2026-07-11T12:01:00.000Z')
    await seedNormalizationRetry(client, database, 'failed-acquisition', 'normalization-explicit-terminal', '2026-07-11T12:01:00.000Z')
await database.update(retryWork).set({ state: 'exhausted', nextAttemptAt: null }).where(eq(retryWork.id, 'normalization-explicit-terminal'))
    const acquisition = await repository.recordRunRequest({ connectorInstanceId: 'failed-acquisition', mode: 'catch_up', startedAt: '2026-07-11T12:01:00.000Z' })
    await repository.markRunRunning({ connectorRunId: acquisition.run.id, startedAt: '2026-07-11T12:01:00.000Z' })

    await repository.markRunFailed({
      connectorRunId: acquisition.run.id, completedAt: '2026-07-11T12:01:01.000Z', retryHints: null,
      warning: { code: 'connector.execution_failed', message: 'Connector execution failed.' },
    })

    await expect(database.select().from(retryWork)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'normalization-failed-acquisition', state: 'scheduled', acquisitionRunId: null, acquisitionToken: null, acquiredAt: null }),
      expect.objectContaining({ id: 'normalization-explicit-terminal', state: 'exhausted', nextAttemptAt: null }),
    ]))
    const retry = await repository.recordRunRequest({ connectorInstanceId: 'failed-acquisition', mode: 'catch_up', startedAt: '2026-07-11T12:01:02.000Z' })
    expect(retry).toMatchObject({ acquired: true, run: { status: 'queued' } })
    expect(retry.run.id).not.toBe(acquisition.run.id)
  })

  it('returns acquired retry work to its resumable due state after startup recovery', async () => {
    const { client, database, repository } = await createConnectorRepositoryTestContext()
    await repository.upsertInstance({ id: 'interrupted-acquisition', connectorId: 'fixture.jobs', connectorVersion: '1.0.0', displayName: 'Interrupted acquisition', enabled: true, filters: {}, createdAt: '2026-07-11T12:00:00.000Z' })
    await seedNormalizationRetry(client, database, 'interrupted-acquisition', 'normalization-interrupted-acquisition', '2026-07-11T12:01:00.000Z')
    const acquisition = await repository.recordRunRequest({ connectorInstanceId: 'interrupted-acquisition', mode: 'catch_up', startedAt: '2026-07-11T12:01:00.000Z' })
    await repository.markRunRunning({ connectorRunId: acquisition.run.id, startedAt: '2026-07-11T12:01:00.000Z' })

    await expect(repository.recoverInterruptedRuns({ completedAt: '2026-07-11T12:02:00.000Z' })).resolves.toBe(1)

    await expect(database.select().from(retryWork)).resolves.toEqual([
      expect.objectContaining({ id: 'normalization-interrupted-acquisition', state: 'scheduled', nextAttemptAt: '2026-07-11T12:01:00.000Z', attempt: 1, acquisitionRunId: null, acquisitionToken: null, acquiredAt: null }),
    ])
    const retry = await repository.recordRunRequest({ connectorInstanceId: 'interrupted-acquisition', mode: 'catch_up', startedAt: '2026-07-11T12:03:00.000Z' })
    expect(retry).toMatchObject({ acquired: true, acquiredWork: { retryWorkId: 'normalization-interrupted-acquisition' }, run: { status: 'queued' } })
    expect(retry.run.id).not.toBe(acquisition.run.id)
  })

  it('keeps due generic normalization retries selectable on Jobright connector instances', async () => {
    const { client, database, repository } = await createConnectorRepositoryTestContext()
    await repository.upsertInstance({
      id: 'jobright-generic-resolver',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.11.0',
      displayName: 'Jobright generic resolver',
      enabled: true,
      filters: {},
      createdAt: '2026-07-11T12:00:00.000Z',
    })
    await seedNormalizationRetry(
      client,
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
    await expect(database.select().from(retryWork)).resolves.toEqual([
      expect.objectContaining({
        id: 'normalization-jobright-generic',
        state: 'acquired',
        acquisitionRunId: acquisition.run.id,
      }),
    ])
  })

  it('selects an active third Jobright retry without stale pre-filter starvation', async () => {
    const { client, database, repository } = await createConnectorRepositoryTestContext()
    await repository.upsertInstance({ id: 'jobright-active-third', connectorId: 'jobright.resolver', connectorVersion: '0.11.0', displayName: 'Active third', enabled: true, filters: {}, createdAt: '2026-07-11T12:00:00.000Z' })
    for (const id of ['stale-one', 'stale-two', 'active-three']) {
      await seedNormalizationRetry(client, database, 'jobright-active-third', id, '2026-07-11T12:01:00.000Z', id)
      await database.update(retryWork).set({
        resolverId: 'jobright.authenticated-destination', resolverVersion: 'jobright-authenticated-destination@1',
      }).where(eq(retryWork.id, id))
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
  })

  it('does not replay an old retry when a newer revision of the same provider record exists', async () => {
    const { client, database, repository } = await currentRevisionFixture(['current-one'])
    await seedSharedProviderRevisionHistory(client)
    const historyLineages = Array.from({ length: 2_000 }, (_, index) => ({
      id: `history-record-${index}`, createdAt: '2026-07-10T00:00:00.000Z',
    }))
    const historyRevisions = Array.from({ length: 2_000 }, (_, index) => ({
      id: `history-revision-${index}`, captureLineageId: `history-record-${index}`,
      revision: 1, contentHash: `history-hash-${index}`, adapterId: 'jobright.resolver',
      adapterKind: 'connector' as const, adapterVersion: '0.11.0',
      observedAt: '2026-07-10T00:00:00.000Z', providerRecordId: `history-provider-${index}`,
      evidenceJson: '[]', createdAt: '2026-07-10T00:00:00.000Z',
    }))
    for (let index = 0; index < historyLineages.length; index += 100) {
      await database.insert(captureLineages).values(historyLineages.slice(index, index + 100))
      await database.insert(captureEvidenceVersions).values(historyRevisions.slice(index, index + 100))
    }
    await client.exec('set enable_seqscan = off')
    const plan = await explainPlan(client, `select 1 from capture_evidence_versions current
      where current.id=$1 and current.provider_record_id in ($2) and current.id=(
        select latest.id from capture_evidence_versions latest where latest.capture_lineage_id=current.capture_lineage_id
        order by latest.revision desc limit 1)`, ['shared-revision-1', 'shared-provider'])
    expect(plan).toContain('idx_capture_evidence_versions_provider_current')
    expect(plan).toContain('idx_capture_evidence_versions_lineage_revision')
    expect(plan).not.toContain('Seq Scan')
    await seedExactNormalizationRetry(database, 'current-one', 'old-retry', 'shared-revision-1')
    await recordActiveSharedProviderCheckpoint(repository, 'current-one')
    const acquisition = await repository.recordRunRequest({ connectorInstanceId: 'current-one', mode: 'manual',
      coverageStartedAt: '2026-07-01T00:00:00.000Z', startedAt: '2026-07-11T12:01:00.000Z' })
    expect(acquisition).toMatchObject({ acquired: true, acquiredWork: null })
    const [oldRetry] = await database.select().from(retryWork).where(eq(retryWork.id, 'old-retry')).limit(1)
    expect(oldRetry).toMatchObject({ state: 'scheduled' })
  })

  it('selects only the current retry across connector instances sharing a provider identity', async () => {
    const { client, database, repository } = await currentRevisionFixture(['current-a', 'current-b'])
    await seedSharedProviderRevisionHistory(client)
    await seedExactNormalizationRetry(database, 'current-a', 'old-cross-scope', 'shared-revision-1')
    await seedExactNormalizationRetry(database, 'current-b', 'current-cross-scope', 'shared-revision-2')
    await recordActiveSharedProviderCheckpoint(repository, 'current-a')
    await recordActiveSharedProviderCheckpoint(repository, 'current-b')
    const old = await repository.recordRunRequest({ connectorInstanceId: 'current-a', mode: 'manual',
      coverageStartedAt: '2026-07-01T00:00:00.000Z', startedAt: '2026-07-11T12:01:00.000Z' })
    const current = await repository.recordRunRequest({ connectorInstanceId: 'current-b', mode: 'manual',
      coverageStartedAt: '2026-07-01T00:00:00.000Z', startedAt: '2026-07-11T12:01:00.000Z' })
    expect(old.acquiredWork).toBeNull()
    expect(current.acquiredWork).toMatchObject({ retryWorkId: 'current-cross-scope', rawRevisionId: 'shared-revision-2' })
  })

  it('keeps untouched Jobright v5 normalization work scheduled when its canonical source remains pending', async () => {
    const { client, database, repository } = await createConnectorRepositoryTestContext()
    await repository.upsertInstance({ id: 'jobright-pending', connectorId: 'jobright.resolver', connectorVersion: '0.11.0', displayName: 'Jobright pending', enabled: true, filters: {}, createdAt: '2026-07-11T12:00:00.000Z' })
    await seedNormalizationRetry(client, database, 'jobright-pending', 'normalization-jobright-pending', '2026-07-11T12:01:00.000Z', 'job-retry')
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

    await expect(database.select().from(retryWork)).resolves.toEqual([
      expect.objectContaining({ id: 'normalization-jobright-pending', state: 'scheduled', acquisitionRunId: null }),
    ])
  })

  it('does not complete acquired Jobright normalization work merely because the provider left the checkpoint', async () => {
    const { client, database, repository } = await createConnectorRepositoryTestContext()
    await repository.upsertInstance({
      id: 'jobright-disappeared',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.11.0',
      displayName: 'Jobright disappeared',
      enabled: true,
      filters: {},
      createdAt: '2026-07-11T12:00:00.000Z',
    })
    await seedNormalizationRetry(
      client,
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

    await expect(database.select().from(retryWork)).resolves.toEqual([
      expect.objectContaining({
        id: 'normalization-jobright-disappeared',
        state: 'scheduled',
        nextAttemptAt: '2026-07-11T12:01:00.000Z',
        acquisitionRunId: null,
        acquiredAt: null,
        acquisitionToken: null,
      }),
    ])
  })

  it('rejects malformed persisted and refreshed Jobright v5 retry state', async () => {
    const { client, database, repository } = await createConnectorRepositoryTestContext()
    await repository.upsertInstance({ id: 'jobright-malformed', connectorId: 'jobright.resolver', connectorVersion: '0.11.0', displayName: 'Jobright malformed', enabled: true, filters: {}, createdAt: '2026-07-11T12:00:00.000Z' })
    await seedNormalizationRetry(client, database, 'jobright-malformed', 'normalization-jobright-malformed', '2026-07-11T12:01:00.000Z', 'job-retry')
await database.update(retryWork).set({
      resolverId: 'jobright.authenticated-destination',
      resolverVersion: 'jobright-authenticated-destination@1',
    }).where(eq(retryWork.id, 'normalization-jobright-malformed'))
    await repository.recordCheckpoint({
      connectorInstanceId: 'jobright-malformed', filterSignature: 'filters:{}',
      savedAt: '2026-07-11T11:59:00.000Z',
      coverage: { start: '2026-07-04T00:00:00.000Z', end: '2026-07-11T11:59:00.000Z' },
      checkpoint: {
        schemaVersion: 'jobright-resolution-checkpoint@5',
        checkpoint: { generationId: 'gen-malformed', effectiveCoverageStart: '2026-07-04T00:00:00.000Z' },
      },
    })
    await expect(repository.recordRunRequest({
      connectorInstanceId: 'jobright-malformed', mode: 'catch_up',
      coverageStartedAt: '2026-07-04T00:00:00.000Z', startedAt: '2026-07-11T12:00:00.000Z',
    })).rejects.toThrow('Jobright v5 checkpoint pending retry ledger is malformed')
    const [persistedWork] = await database.select().from(retryWork).limit(1)
    expect(persistedWork).toMatchObject({
      id: 'normalization-jobright-malformed', state: 'scheduled', acquisitionRunId: null,
    })
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
    const acquisition = await repository.recordRunRequest({ connectorInstanceId: 'jobright-malformed', mode: 'catch_up',
      coverageStartedAt: '2026-07-04T00:00:00.000Z', startedAt: '2026-07-11T12:01:00.000Z' })
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
    await expect(database.select().from(retryWork)).resolves.toEqual([
      expect.objectContaining({ id: 'normalization-jobright-malformed', state: 'acquired', acquisitionRunId: acquisition.run.id }),
    ])
  })

})

function runAcquisitionWorker(pgliteDataPath: string, startEpoch: number) {
  const workerDirectory = fs.mkdtempSync(path.join(process.cwd(), '.retry-acquisition-worker-'))
  const workerPath = path.join(workerDirectory, 'worker.ts')
  const script = `
    import { createPgliteClient, createPgliteDatabase } from ${JSON.stringify(path.resolve('src/db/pglite.ts'))};
    import { createPgliteConnectorRepository } from ${JSON.stringify(path.resolve('src/modules/connectors/connector.repository.ts'))};
    (async () => {
      const delay = Number(process.env.RETRY_START_EPOCH) - Date.now();
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      const client = await createPgliteClient({ dataDir: process.env.RETRY_DB_PATH });
      const repository = createPgliteConnectorRepository(createPgliteDatabase(client));
      const result = await repository.recordRunRequest({
        connectorInstanceId: 'process-race', mode: 'catch_up', startedAt: '2026-07-11T12:01:00.000Z'
      });
      process.stdout.write(JSON.stringify({ acquired: result.acquired, id: result.run.id }));
      await client.close();
    })().catch((error) => { process.stderr.write(String(error)); process.exitCode = 1; });
  `
  fs.writeFileSync(workerPath, script)
  return new Promise<{ acquired: boolean; id: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', workerPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        RETRY_DB_PATH: pgliteDataPath,
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

async function seedNormalizationRetry(
  client: PgliteClient,
  database: PgliteDatabase,
  connectorInstanceId: string,
  id: string,
  nextAttemptAt: string,
  providerRecordId?: string,
) {
  await client.exec(`
    insert into capture_lineages (id, created_at) values ('record-${id}', '2026-07-11T12:00:00.000Z');
    insert into capture_evidence_versions (
      id, capture_lineage_id, revision, content_hash, adapter_id, adapter_kind, adapter_version,
      observed_at, provider_record_id, evidence_json, created_at
    ) values (
      'revision-${id}', 'record-${id}', 1, 'sha256:${id}', 'fixture.jobs', 'connector', '1.0.0',
      '2026-07-11T12:00:00.000Z', ${providerRecordId ? `'${providerRecordId}'` : 'null'}, '[]', '2026-07-11T12:00:00.000Z'
    );
  `)
  const [instance] = await database.select({ id: connectorInstances.executionScopeId })
    .from(connectorInstances).where(eq(connectorInstances.id, connectorInstanceId)).limit(1)
  await database.insert(retryWork).values({
    id,
    executionScopeId: instance?.id ?? null,
    kind: 'normalization', connectorInstanceId: null, filterSignature: null,
    checkpointSchemaVersion: null, checkpointGeneration: null,
    captureEvidenceVersionId: `revision-${id}`, resolverId: 'fixture.network', resolverVersion: '1.0.0',
    inputHash: `sha256:${id}`, reason: 'server_failure', attempt: 1, maxAttempts: 3,
    lastAttemptAt: '2026-07-11T12:00:00.000Z', computedDelayMs: 60_000,
    serverMinimumDelayMs: null, nextAttemptAt, horizonAt: '2026-07-11T13:00:00.000Z',
    state: 'scheduled', ownerVersion: '1.0.0',
    lineageJson: JSON.stringify({ connectorInstanceId }), acquiredAt: null,
    acquisitionToken: null, acquisitionRunId: null, skippedRunId: null,
    createdAt: '2026-07-11T12:00:00.000Z', updatedAt: '2026-07-11T12:00:00.000Z', deletedAt: null,
  })
}

async function currentRevisionFixture(instanceIds: string[]) {
  const { client, database, repository } = await createConnectorRepositoryTestContext()
  for (const id of instanceIds) await repository.upsertInstance({ id, connectorId: 'jobright.resolver',
    connectorVersion: '0.11.0', displayName: id, enabled: true, filters: {}, createdAt: '2026-07-11T12:00:00.000Z' })
  return { client, database, repository }
}

async function seedSharedProviderRevisionHistory(client: PgliteClient) {
  await client.exec(`
    insert into capture_lineages (id,created_at) values ('shared-record','2026-07-11T12:00:00.000Z');
    insert into capture_evidence_versions (id,capture_lineage_id,revision,content_hash,adapter_id,adapter_kind,adapter_version,observed_at,provider_record_id,evidence_json,created_at) values
      ('shared-revision-1','shared-record',1,'shared-hash-1','jobright.resolver','connector','0.11.0','2026-07-11T12:00:00.000Z','shared-provider','[]','2026-07-11T12:00:00.000Z'),
      ('shared-revision-2','shared-record',2,'shared-hash-2','jobright.resolver','connector','0.11.0','2026-07-11T12:00:01.000Z','shared-provider','[]','2026-07-11T12:00:01.000Z');
  `)
}

async function seedExactNormalizationRetry(database: PgliteDatabase, instanceId: string, id: string, rawRevisionId: string) {
  const [instance] = await database.select({ id: connectorInstances.executionScopeId })
    .from(connectorInstances).where(eq(connectorInstances.id, instanceId)).limit(1)
  await database.insert(retryWork).values({ id, executionScopeId: instance!.id, kind: 'normalization', captureEvidenceVersionId: rawRevisionId,
    resolverId: 'jobright.authenticated-destination', resolverVersion: 'jobright-authenticated-destination@1', inputHash: `hash-${id}`,
    reason: 'server_failure', attempt: 1, maxAttempts: 3, lastAttemptAt: '2026-07-11T12:00:00.000Z', computedDelayMs: 1000,
    nextAttemptAt: '2026-07-11T12:00:01.000Z', horizonAt: '2026-07-11T13:00:00.000Z', state: 'scheduled', ownerVersion: '1',
    lineageJson: JSON.stringify({ connectorInstanceId: instanceId }), createdAt: '2026-07-11T12:00:00.000Z', updatedAt: '2026-07-11T12:00:00.000Z' })
}

async function recordActiveSharedProviderCheckpoint(repository: ReturnType<typeof createPgliteConnectorRepository>, connectorInstanceId: string) {
  await repository.recordCheckpoint({ connectorInstanceId, filterSignature: 'filters:{}', savedAt: '2026-07-11T12:00:00.000Z',
    coverage: { start: '2026-07-01T00:00:00.000Z', end: '2026-07-11T12:00:00.000Z' },
    checkpoint: { schemaVersion: 'jobright-resolution-checkpoint@5', checkpoint: { generationId: 'shared-generation',
      effectiveCoverageStart: '2026-07-01T00:00:00.000Z', pendingDetailRetries: [
        { sourceId: 'jobright.public:shared-provider', ownership: 'active', generationId: 'shared-generation' },
      ] } } })
}

async function explainPlan(client: PgliteClient, query: string, parameters: unknown[]) {
  const result = await client.query<Record<'QUERY PLAN', string>>(`explain ${query}`, parameters)
  return result.rows.map((row) => row['QUERY PLAN']).join('\n')
}
