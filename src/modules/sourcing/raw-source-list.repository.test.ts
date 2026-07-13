import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { rawSourceRecordsListResultSchema } from 'sparxie'
import { createDrizzleDatabase, createFileDatabase, createInMemoryDatabase, migrateDatabase } from '../../db/sqlite'
import { createSqliteConnectorRepository } from '../connectors/connector.repository'
import { createSqliteRawSourceRepository } from './raw-source.repository'

describe('raw source repository list', () => {
  const databases: ReturnType<typeof createInMemoryDatabase>[] = []

  afterEach(() => {
    databases.splice(0).forEach((database) => database.close())
  })

  it('returns strict sparse summaries without arbitrary raw payload data', async () => {
    const sqlite = createInMemoryDatabase()
    databases.push(sqlite)
    migrateDatabase(sqlite)
    const repository = createSqliteRawSourceRepository(
      createDrizzleDatabase(sqlite),
      () => new Date('2026-07-10T14:00:00.000Z'),
    )
    const secret = 'must-not-appear-in-list-results'
    const intake = await repository.ingestBatch({
      records: [{
        adapter: { id: 'fixture.cli', kind: 'cli', version: '1.0.0' },
        observedAt: '2026-07-10T13:00:00.000Z',
        payload: { arbitrary: { privateValue: secret } },
      }],
    })

    const result = await repository.list()

    expect(rawSourceRecordsListResultSchema.parse(result)).toEqual(result)
    expect(result).toEqual({
      items: [{
        id: intake.receipts[0].rawRecordId,
        sourceEntityId: null,
        adapter: { id: 'fixture.cli', kind: 'cli', version: '1.0.0' },
        connectorInstanceId: null,
        latestConnectorRunId: null,
        reportedOrigin: null,
        providerRecordId: null,
        companyName: null,
        roleTitle: null,
        createdAt: '2026-07-10T14:00:00.000Z',
        firstObservedAt: '2026-07-10T13:00:00.000Z',
        lastObservedAt: '2026-07-10T13:00:00.000Z',
        firstReceivedAt: '2026-07-10T14:00:00.000Z',
        lastReceivedAt: '2026-07-10T14:00:00.000Z',
        occurrenceCount: 1,
        revisionCount: 1,
        latestRevision: {
          id: intake.receipts[0].revision.id,
          revision: 1,
          observedAt: '2026-07-10T13:00:00.000Z',
          createdAt: '2026-07-10T14:00:00.000Z',
        },
        normalizationStatus: 'raw_only',
        normalizationUpdatedAt: null,
        normalizationRawRevisionId: null,
        gateStatus: null,
        canonicalCandidateId: null,
        projectionStatus: 'not_eligible',
        findingId: null,
      }],
      nextCursor: null,
    })
    expect(JSON.stringify(result)).not.toContain(secret)
  })

  it('uses one bounded SQLite statement for a one-row page regardless of total records', async () => {
    const sqlite = createInMemoryDatabase()
    databases.push(sqlite)
    migrateDatabase(sqlite)
    const repository = createSqliteRawSourceRepository(
      createDrizzleDatabase(sqlite),
      () => new Date('2026-07-10T14:00:00.000Z'),
    )
    const intake = await repository.ingestBatch({
      records: Array.from({ length: 100 }, (_, index) =>
        rawRecord('fixture.cli', 'cli', `record-${index}`)),
    })
    const insertNormalization = sqlite.prepare(`
      insert into normalization_runs (
        id, raw_record_id, raw_revision_id, input_hash, resolver_set_hash,
        canonical_schema_version, gate_policy_version, trigger_kind, status,
        created_at, updated_at
      ) values (?, ?, ?, ?, 'sha256:resolver-set', 'candidate/v1', 'gate/v1',
        'intake', 'pending', '2026-07-10T15:00:00.000Z', '2026-07-10T15:00:00.000Z')
    `)
    sqlite.transaction(() => intake.receipts.forEach((receipt, index) => {
      insertNormalization.run(
        `normalization-${index}`, receipt.rawRecordId, receipt.revision.id, `sha256:${index}`,
      )
    }))()
    const prepare = vi.spyOn(sqlite, 'prepare')

    const result = await repository.list({ limit: 1 })

    expect(result.items).toHaveLength(1)
    expect(result.items[0].normalizationStatus).toBe('pending')
    expect(result.nextCursor).toEqual(expect.any(String))
    expect(prepare).toHaveBeenCalledTimes(1)
  })

  it('ranks normalization history once instead of rescanning it for every raw record', async () => {
    const sqlite = createInMemoryDatabase()
    databases.push(sqlite)
    migrateDatabase(sqlite)
    const repository = createSqliteRawSourceRepository(createDrizzleDatabase(sqlite))
    await repository.ingestBatch({ records: [rawRecord('fixture.cli', 'cli', 'plan')] })
    const prepare = vi.spyOn(sqlite, 'prepare')
    await repository.list({ limit: 1 })
    const statement = prepare.mock.calls[0][0]
    prepare.mockRestore()

    const plan = sqlite.prepare(`explain query plan ${statement}`).all(2) as Array<{
      detail: string
    }>
    const details = plan.map(({ detail }) => detail).join('\n')

    expect(details).toContain('MATERIALIZE latest_normalization')
    expect(details).not.toContain('SCAN selected_normalization')
  })

  it('continues by the fixed timestamp and bytewise-id keyset across concurrent inserts', async () => {
    const sqlite = createInMemoryDatabase()
    databases.push(sqlite)
    migrateDatabase(sqlite)
    const receivedTimes = [
      new Date('2026-07-10T14:00:00.000Z'),
      new Date('2026-07-10T14:00:00.000Z'),
      new Date('2026-07-10T13:00:00.000Z'),
      new Date('2026-07-10T15:00:00.000Z'),
    ]
    const repository = createSqliteRawSourceRepository(
      createDrizzleDatabase(sqlite),
      () => receivedTimes.shift()!,
    )
    await repository.ingestBatch({ records: [rawRecord('fixture.cli', 'cli', 'one')] })
    await repository.ingestBatch({ records: [rawRecord('fixture.cli', 'cli', 'two')] })
    await repository.ingestBatch({ records: [rawRecord('fixture.import', 'import', 'three')] })

    const first = await repository.list({ limit: 1, adapterKind: 'cli' })
    expect(first.items).toHaveLength(1)
    expect(first.nextCursor).toEqual(expect.any(String))
    await repository.ingestBatch({ records: [rawRecord('fixture.cli', 'cli', 'concurrent')] })
    const second = await repository.list({
      limit: 1,
      adapterKind: 'cli',
      cursor: first.nextCursor!,
    })

    expect(second.items).toHaveLength(1)
    expect(second.items[0].lastReceivedAt).toBe('2026-07-10T14:00:00.000Z')
    expect(second.items[0].id < first.items[0].id).toBe(true)
    expect(second.nextCursor).toBeNull()
    await expect(repository.list({ cursor: 'not-an-opaque-cursor' })).rejects.toThrow(
      'Invalid raw source records cursor',
    )
  })

  it('uses SQLite-compatible UTF-8 bytewise id order for equal receipt timestamps', async () => {
    const sqlite = createInMemoryDatabase()
    databases.push(sqlite)
    migrateDatabase(sqlite)
    const ids = [`raw-\u{10000}`, `raw-\u{E000}`]
    const receivedAt = '2026-07-10T14:00:00.000Z'
    const insertRecord = sqlite.prepare(
      'insert into raw_source_records (id, created_at) values (?, ?)',
    )
    const insertRevision = sqlite.prepare(`
      insert into raw_source_revisions (
        id, raw_record_id, revision, content_hash, adapter_id, adapter_kind,
        adapter_version, observed_at, evidence_json, created_at
      ) values (?, ?, 1, ?, 'fixture.cli', 'cli', '1.0.0', ?, '[]', ?)
    `)
    const insertOccurrence = sqlite.prepare(`
      insert into raw_source_occurrences (
        id, raw_record_id, raw_revision_id, observed_at, received_at
      ) values (?, ?, ?, ?, ?)
    `)
    ids.forEach((id, index) => {
      const revisionId = `revision-${index}`
      insertRecord.run(id, receivedAt)
      insertRevision.run(
        revisionId,
        id,
        `sha256:${index}`,
        receivedAt,
        receivedAt,
      )
      insertOccurrence.run(`occurrence-${index}`, id, revisionId, receivedAt, receivedAt)
    })

    const result = await createSqliteRawSourceRepository(createDrizzleDatabase(sqlite)).list()

    expect(result.items.map(({ id }) => id)).toEqual(ids)
  })

  it('filters connector capture and inclusive received-time identity', async () => {
    const sqlite = createInMemoryDatabase()
    databases.push(sqlite)
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const connectors = createSqliteConnectorRepository(database)
    const repository = createSqliteRawSourceRepository(
      database,
      () => new Date('2026-07-10T14:00:00.000Z'),
    )
    const connector = await connectors.upsertInstance({
      id: 'connector-instance-one',
      connectorId: 'fixture.connector',
      connectorVersion: '1.0.0',
      displayName: 'Fixture',
      enabled: true,
    })
    const run = (await connectors.recordRunRequest({
      connectorInstanceId: connector.id,
      mode: 'manual',
      startedAt: '2026-07-10T13:00:00.000Z',
    })).run
    const receipt = await repository.ingestBatch({ records: [{
      adapter: { id: 'fixture.connector', kind: 'connector', version: '1.0.0' },
      capture: {
        connectorInstanceId: connector.id,
        connectorRunId: run.id,
        executionScopeId: run.executionScopeId,
      },
      observedAt: '2026-07-10T13:30:00.000Z',
      providerRecordId: 'provider-job-one',
      reportedOrigin: { kind: 'job_board', name: 'Fixture Board' },
    }] })

    const result = await repository.list({
      adapterId: 'fixture.connector',
      adapterKind: 'connector',
      connectorInstanceId: connector.id,
      receivedFrom: '2026-07-10T10:00:00.000-04:00',
      receivedTo: '2026-07-10T14:00:00.000Z',
      normalizationStatus: 'raw_only',
      projectionStatus: 'not_eligible',
    })

    expect(result.items).toEqual([
      expect.objectContaining({
        id: receipt.receipts[0].rawRecordId,
        connectorInstanceId: connector.id,
        latestConnectorRunId: run.id,
        reportedOrigin: { kind: 'job_board', name: 'Fixture Board', providerId: null },
      }),
    ])
    await expect(repository.list({ receivedFrom: '2026-07-10T14:00:00.001Z' }))
      .resolves.toEqual({ items: [], nextCursor: null })
  })

  it('filters exact connector-run lineage across any persisted occurrence', async () => {
    const sqlite = createInMemoryDatabase()
    databases.push(sqlite)
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const connectors = createSqliteConnectorRepository(database)
    const receivedAt = [
      new Date('2026-07-10T14:00:00.000Z'),
      new Date('2026-07-10T15:00:00.000Z'),
      new Date('2026-07-10T16:00:00.000Z'),
    ]
    const repository = createSqliteRawSourceRepository(database, () => receivedAt.shift()!)
    const connector = await connectors.upsertInstance({
      id: 'connector-instance-lineage',
      connectorId: 'fixture.connector',
      connectorVersion: '1.0.0',
      displayName: 'Fixture',
      enabled: true,
    })
    const firstRun = (await connectors.recordRunRequest({
      connectorInstanceId: connector.id,
      mode: 'manual',
      startedAt: '2026-07-10T13:00:00.000Z',
    })).run
    const record = (connectorRunId: string) => ({
      adapter: { id: 'fixture.connector', kind: 'connector' as const, version: '1.0.0' },
      capture: {
        connectorInstanceId: connector.id,
        connectorRunId,
        executionScopeId: connector.executionScopeId,
      },
      observedAt: '2026-07-10T13:30:00.000Z',
      providerRecordId: 'shared-provider-record',
      reportedOrigin: { kind: 'job_board' as const, name: 'Fixture Board' },
    })
    const first = await repository.ingestBatch({ records: [record(firstRun.id)] })
    await connectors.markRunRunning({
      connectorRunId: firstRun.id,
      startedAt: '2026-07-10T13:00:00.000Z',
    })
    await connectors.completeRun({
      connectorRunId: firstRun.id,
      completedAt: '2026-07-10T14:15:00.000Z',
      status: 'completed',
    })
    const secondRun = (await connectors.recordRunRequest({
      connectorInstanceId: connector.id,
      mode: 'manual',
      startedAt: '2026-07-10T14:30:00.000Z',
    })).run
    await repository.ingestBatch({ records: [record(secondRun.id)] })
    await repository.ingestBatch({
      records: [{ ...record(secondRun.id), providerRecordId: 'second-provider-record' }],
    })

    const result = await repository.list({ connectorRunId: firstRun.id })

    expect(result.items).toEqual([
      expect.objectContaining({
        id: first.receipts[0].rawRecordId,
        latestConnectorRunId: secondRun.id,
      }),
    ])
  })

  it('preserves deterministic pages after the workspace database reopens', async () => {
    const sqlitePath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'raw-source-list-reopen-')),
      'valedictorian.sqlite',
    )
    let sqlite = createFileDatabase(sqlitePath)
    migrateDatabase(sqlite)
    let repository = createSqliteRawSourceRepository(
      createDrizzleDatabase(sqlite),
      () => new Date('2026-07-10T14:00:00.000Z'),
    )
    await repository.ingestBatch({ records: [rawRecord('fixture.cli', 'cli', 'one')] })
    await repository.ingestBatch({ records: [rawRecord('fixture.cli', 'cli', 'two')] })
    const before = await repository.list({ limit: 1 })
    sqlite.close()

    sqlite = createFileDatabase(sqlitePath)
    repository = createSqliteRawSourceRepository(createDrizzleDatabase(sqlite))
    const after = await repository.list({ limit: 1 })
    const continuation = await repository.list({ limit: 1, cursor: after.nextCursor! })

    expect(after).toEqual(before)
    expect(continuation.items).toHaveLength(1)
    expect(new Set([...after.items, ...continuation.items].map(({ id }) => id)).size).toBe(2)
    sqlite.close()
  })

  it.each(['pending', 'in_progress', 'blocked'] as const)(
    'reports unfinished %s normalization without gate or projection lineage',
    async (status) => {
      const sqlite = createInMemoryDatabase()
      databases.push(sqlite)
      migrateDatabase(sqlite)
      const repository = createSqliteRawSourceRepository(
        createDrizzleDatabase(sqlite),
        () => new Date('2026-07-10T14:00:00.000Z'),
      )
      const intake = await repository.ingestBatch({
        records: [rawRecord('fixture.cli', 'cli', status)],
      })
      sqlite.prepare(`
        insert into normalization_runs (
          id, raw_record_id, raw_revision_id, input_hash, resolver_set_hash,
          canonical_schema_version, gate_policy_version, trigger_kind, status,
          created_at, updated_at
        ) values (?, ?, ?, ?, 'sha256:resolver-set', 'candidate/v1', 'gate/v1',
          'intake', ?, '2026-07-10T15:00:00.000Z', '2026-07-10T15:00:00.000Z')
      `).run(
        `normalization-${status}`,
        intake.receipts[0].rawRecordId,
        intake.receipts[0].revision.id,
        `sha256:${status}`,
        status,
      )

      await expect(repository.list({ normalizationStatus: status })).resolves.toEqual({
        items: [expect.objectContaining({
          normalizationStatus: status,
          normalizationRawRevisionId: intake.receipts[0].revision.id,
          gateStatus: null,
          canonicalCandidateId: null,
          projectionStatus: 'not_eligible',
          findingId: null,
        })],
        nextCursor: null,
      })
    },
  )

  it('selects the newest normalization creation over an older run updated later', async () => {
    const sqlite = createInMemoryDatabase()
    databases.push(sqlite)
    migrateDatabase(sqlite)
    const repository = createSqliteRawSourceRepository(
      createDrizzleDatabase(sqlite),
      () => new Date('2026-07-10T14:00:00.000Z'),
    )
    const intake = await repository.ingestBatch({ records: [rawRecord(
      'fixture.cli',
      'cli',
      'normalization-order',
    )] })
    const insertRun = sqlite.prepare(`
      insert into normalization_runs (
        id, raw_record_id, raw_revision_id, input_hash, resolver_set_hash,
        canonical_schema_version, gate_policy_version, trigger_kind, status,
        created_at, updated_at
      ) values (?, ?, ?, ?, 'sha256:resolver-set', 'candidate/v1', 'gate/v1',
        'intake', ?, ?, ?)
    `)
    const rawRecordId = intake.receipts[0].rawRecordId
    const revisionId = intake.receipts[0].revision.id
    insertRun.run(
      'newer-replay', rawRecordId, revisionId, 'sha256:newer', 'pending',
      '2026-07-10T16:00:00.000Z', '2026-07-10T16:00:00.000Z',
    )
    insertRun.run(
      'older-updated-later', rawRecordId, revisionId, 'sha256:older', 'blocked',
      '2026-07-10T15:00:00.000Z', '2026-07-10T17:00:00.000Z',
    )

    const result = await repository.list()

    expect(result.items).toEqual([
      expect.objectContaining({
        normalizationStatus: 'pending',
        normalizationUpdatedAt: '2026-07-10T16:00:00.000Z',
      }),
    ])
  })
})

function rawRecord(
  adapterId: string,
  kind: 'cli' | 'import',
  marker: string,
) {
  return {
    adapter: { id: adapterId, kind, version: '1.0.0' },
    observedAt: '2026-07-10T12:00:00.000Z',
    payload: { marker },
  }
}
