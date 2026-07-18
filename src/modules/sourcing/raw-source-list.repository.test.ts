import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { rawSourceRecordsListResultSchema } from 'sparxie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  captureEvidenceVersions,
  captureLineages,
  captures,
  connectorInstances,
  connectorRuns,
  normalizationRuns,
  sourceExecutionScopes,
} from '../../db/schema'
import {
  createPgliteClient,
  createPgliteDatabase,
  migratePgliteDatabase,
  type PgliteClient,
  type PgliteDatabase,
} from '../../db/pglite'
import { createPgliteRawSourceRepository } from './raw-source.repository'

describe('raw source repository list', () => {
  const clients = new Set<PgliteClient>()

  afterEach(async () => {
    await Promise.all([...clients].map((client) => client.close()))
    clients.clear()
  })

  it('returns strict sparse summaries without arbitrary raw payload data', async () => {
    const { repository } = await createTestContext(
      clients,
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

  it('uses one bounded PostgreSQL statement for a one-row page regardless of total records', async () => {
    const { client, database, repository } = await createTestContext(
      clients,
      () => new Date('2026-07-10T14:00:00.000Z'),
    )
    const intake = await repository.ingestBatch({
      records: Array.from({ length: 100 }, (_, index) =>
        rawRecord('fixture.cli', 'cli', `record-${index}`)),
    })
    await database.insert(normalizationRuns).values(intake.receipts.map((receipt, index) =>
      normalizationValues({
        id: `normalization-${index}`,
        rawRecordId: receipt.rawRecordId,
        revisionId: receipt.revision.id,
        inputHash: `sha256:${index}`,
        status: 'pending',
      })))
    const query = vi.spyOn(client, 'query')

    const result = await repository.list({ limit: 1 })

    expect(result.items).toHaveLength(1)
    expect(result.items[0].normalizationStatus).toBe('pending')
    expect(result.nextCursor).toEqual(expect.any(String))
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('ranks normalization history once instead of rescanning it for every raw record', async () => {
    const { client, repository } = await createTestContext(clients)
    await repository.ingestBatch({ records: [rawRecord('fixture.cli', 'cli', 'plan')] })
    const query = vi.spyOn(client, 'query')
    await repository.list({ limit: 1 })
    const statement = query.mock.calls[0]?.[0]
    query.mockRestore()
    expect(typeof statement).toBe('string')

    const plan = await client.query(`explain (format json) ${statement as string}`, [2])
    const details = JSON.stringify(plan.rows)

    expect(details).toContain('latest_normalization')
    expect(details).toContain('WindowAgg')
    expect(details.match(/"CTE Name":"latest_normalization"/g)).toHaveLength(1)
  })

  it('continues by the fixed timestamp and bytewise-id keyset across concurrent inserts', async () => {
    const receivedTimes = [
      new Date('2026-07-10T14:00:00.000Z'),
      new Date('2026-07-10T14:00:00.000Z'),
      new Date('2026-07-10T13:00:00.000Z'),
      new Date('2026-07-10T15:00:00.000Z'),
    ]
    const { repository } = await createTestContext(clients, () => receivedTimes.shift()!)
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

  it('uses C-collation UTF-8 bytewise id order for equal receipt timestamps', async () => {
    const { database, repository } = await createTestContext(clients)
    const ids = [`raw-\u{10000}`, `raw-\u{E000}`]
    const receivedAt = '2026-07-10T14:00:00.000Z'
    await seedRawRows(database, ids, receivedAt)

    const result = await repository.list()

    expect(result.items.map(({ id }) => id)).toEqual(ids)
  })

  it('keeps identical-timestamp pages on the strict stable-id cursor boundary', async () => {
    const { database, repository } = await createTestContext(clients)
    const ids = ['raw-c', 'raw-b', 'raw-a']
    await seedRawRows(database, ids, '2026-07-10T14:00:00.000Z')

    const first = await repository.list({ limit: 1 })
    const second = await repository.list({ limit: 1, cursor: first.nextCursor! })
    const third = await repository.list({ limit: 1, cursor: second.nextCursor! })

    expect(first.items.map(({ id }) => id)).toEqual(['raw-c'])
    expect(second.items.map(({ id }) => id)).toEqual(['raw-b'])
    expect(third.items.map(({ id }) => id)).toEqual(['raw-a'])
    expect(third.nextCursor).toBeNull()
  })

  it('filters connector capture and inclusive received-time identity', async () => {
    const { database, repository } = await createTestContext(
      clients,
      () => new Date('2026-07-10T14:00:00.000Z'),
    )
    const connector = await createConnectorInstance(
      database,
      'connector-instance-one',
      'fixture.connector',
    )
    const run = await createConnectorRun(
      database,
      connector,
      'connector-run-one',
      '2026-07-10T13:00:00.000Z',
    )
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

  it('keeps inclusive lower and upper received boundaries exact', async () => {
    const receivedTimes = [
      new Date('2026-07-10T14:00:00.000Z'),
      new Date('2026-07-10T14:00:00.001Z'),
      new Date('2026-07-10T14:00:00.002Z'),
    ]
    const { repository } = await createTestContext(clients, () => receivedTimes.shift()!)
    await repository.ingestBatch({ records: [rawRecord('fixture.cli', 'cli', 'lower')] })
    const middle = await repository.ingestBatch({ records: [rawRecord('fixture.cli', 'cli', 'middle')] })
    await repository.ingestBatch({ records: [rawRecord('fixture.cli', 'cli', 'upper')] })

    const result = await repository.list({
      receivedFrom: '2026-07-10T14:00:00.001Z',
      receivedTo: '2026-07-10T14:00:00.001Z',
    })

    expect(result.items.map(({ id }) => id)).toEqual([middle.receipts[0].rawRecordId])
  })

  it('filters exact connector-run lineage across any persisted occurrence', async () => {
    const receivedAt = [
      new Date('2026-07-10T14:00:00.000Z'),
      new Date('2026-07-10T15:00:00.000Z'),
      new Date('2026-07-10T16:00:00.000Z'),
    ]
    const { database, repository } = await createTestContext(clients, () => receivedAt.shift()!)
    const connector = await createConnectorInstance(
      database,
      'connector-instance-lineage',
      'fixture.connector',
    )
    const firstRun = await createConnectorRun(
      database,
      connector,
      'connector-run-first',
      '2026-07-10T13:00:00.000Z',
    )
    const secondRun = await createConnectorRun(
      database,
      connector,
      'connector-run-second',
      '2026-07-10T14:30:00.000Z',
    )
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
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'raw-source-list-reopen-'))
    const dataDir = path.join(temporaryRoot, 'pglite')
    const closed = new Set<PgliteClient>()
    let firstClient: PgliteClient | null = null
    let secondClient: PgliteClient | null = null

    try {
      firstClient = await createPgliteClient({ dataDir })
      const firstDatabase = await migratePgliteDatabase(firstClient)
      let repository = createPgliteRawSourceRepository(
        firstDatabase,
        () => new Date('2026-07-10T14:00:00.000Z'),
      )
      await repository.ingestBatch({ records: [rawRecord('fixture.cli', 'cli', 'one')] })
      await repository.ingestBatch({ records: [rawRecord('fixture.cli', 'cli', 'two')] })
      const before = await repository.list({ limit: 1 })
      await closeOnce(firstClient, closed)

      secondClient = await createPgliteClient({ dataDir })
      repository = createPgliteRawSourceRepository(createPgliteDatabase(secondClient))
      const after = await repository.list({ limit: 1 })
      const continuation = await repository.list({ limit: 1, cursor: after.nextCursor! })

      expect(after).toEqual(before)
      expect(continuation.items).toHaveLength(1)
      expect(new Set([...after.items, ...continuation.items].map(({ id }) => id)).size).toBe(2)
    } finally {
      await closeOnce(secondClient, closed)
      await closeOnce(firstClient, closed)
      await fs.promises.rm(temporaryRoot, { recursive: true, force: true })
    }

    expect(closed.size).toBe(2)
    expect(fs.existsSync(temporaryRoot)).toBe(false)
  })

  it.each(['pending', 'in_progress', 'blocked'] as const)(
    'reports unfinished %s normalization without gate or projection lineage',
    async (status) => {
      const { database, repository } = await createTestContext(
        clients,
        () => new Date('2026-07-10T14:00:00.000Z'),
      )
      const intake = await repository.ingestBatch({
        records: [rawRecord('fixture.cli', 'cli', status)],
      })
      await database.insert(normalizationRuns).values(normalizationValues({
        id: `normalization-${status}`,
        rawRecordId: intake.receipts[0].rawRecordId,
        revisionId: intake.receipts[0].revision.id,
        inputHash: `sha256:${status}`,
        status,
      }))

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

  it('reports absent normalization lineage with explicit null summaries', async () => {
    const { repository } = await createTestContext(clients)
    await repository.ingestBatch({ records: [rawRecord('fixture.cli', 'cli', 'raw-only')] })

    const result = await repository.list({ normalizationStatus: 'raw_only' })

    expect(result.items).toEqual([expect.objectContaining({
      normalizationStatus: 'raw_only',
      normalizationUpdatedAt: null,
      normalizationRawRevisionId: null,
      gateStatus: null,
      canonicalCandidateId: null,
      projectionStatus: 'not_eligible',
      findingId: null,
    })])
  })

  it('selects the newest normalization creation over an older run updated later', async () => {
    const { database, repository } = await createTestContext(
      clients,
      () => new Date('2026-07-10T14:00:00.000Z'),
    )
    const intake = await repository.ingestBatch({ records: [rawRecord(
      'fixture.cli',
      'cli',
      'normalization-order',
    )] })
    const rawRecordId = intake.receipts[0].rawRecordId
    const revisionId = intake.receipts[0].revision.id
    await database.insert(normalizationRuns).values([
      normalizationValues({
        id: 'newer-replay',
        rawRecordId,
        revisionId,
        inputHash: 'sha256:newer',
        status: 'pending',
        createdAt: '2026-07-10T16:00:00.000Z',
        updatedAt: '2026-07-10T16:00:00.000Z',
      }),
      normalizationValues({
        id: 'older-updated-later',
        rawRecordId,
        revisionId,
        inputHash: 'sha256:older',
        status: 'blocked',
        createdAt: '2026-07-10T15:00:00.000Z',
        updatedAt: '2026-07-10T17:00:00.000Z',
      }),
    ])

    const result = await repository.list()

    expect(result.items).toEqual([
      expect.objectContaining({
        normalizationStatus: 'pending',
        normalizationUpdatedAt: '2026-07-10T16:00:00.000Z',
      }),
    ])
  })

  it('returns stable concurrent list snapshots for unchanged durable state', async () => {
    const { repository } = await createTestContext(clients)
    await repository.ingestBatch({
      records: ['one', 'two', 'three'].map((marker) =>
        rawRecord('fixture.cli', 'cli', marker)),
    })

    const [first, second] = await Promise.all([
      repository.list({ limit: 2 }),
      repository.list({ limit: 2 }),
    ])

    expect(second).toEqual(first)
  })
})

async function createTestContext(
  clients: Set<PgliteClient>,
  now?: () => Date,
) {
  const client = await createPgliteClient()
  clients.add(client)
  const database = await migratePgliteDatabase(client)
  return {
    client,
    database,
    repository: createPgliteRawSourceRepository(database, now),
  }
}

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

function normalizationValues(input: {
  id: string
  rawRecordId: string
  revisionId: string
  inputHash: string
  status: 'pending' | 'in_progress' | 'blocked'
  createdAt?: string
  updatedAt?: string
}): typeof normalizationRuns.$inferInsert {
  return {
    id: input.id,
    captureLineageId: input.rawRecordId,
    captureEvidenceVersionId: input.revisionId,
    inputHash: input.inputHash,
    resolverSetHash: 'sha256:resolver-set',
    canonicalSchemaVersion: 'candidate/v1',
    gatePolicyVersion: 'gate/v1',
    triggerKind: 'intake',
    status: input.status,
    createdAt: input.createdAt ?? '2026-07-10T15:00:00.000Z',
    updatedAt: input.updatedAt ?? '2026-07-10T15:00:00.000Z',
  }
}

async function seedRawRows(
  database: PgliteDatabase,
  ids: readonly string[],
  receivedAt: string,
) {
  for (const [index, id] of ids.entries()) {
    const revisionId = `revision-${index}`
    await database.insert(captureLineages).values({ id, createdAt: receivedAt })
    await database.insert(captureEvidenceVersions).values({
      id: revisionId,
      captureLineageId: id,
      revision: 1,
      contentHash: `sha256:${index}`,
      adapterId: 'fixture.cli',
      adapterKind: 'cli',
      adapterVersion: '1.0.0',
      observedAt: receivedAt,
      evidenceJson: '[]',
      createdAt: receivedAt,
    })
    await database.insert(captures).values({
      id: `occurrence-${index}`,
      captureLineageId: id,
      captureEvidenceVersionId: revisionId,
      observedAt: receivedAt,
      receivedAt,
    })
  }
}

async function createConnectorInstance(
  database: PgliteDatabase,
  id: string,
  connectorId: string,
) {
  const executionScopeId = `${id}-scope`
  const timestamp = '2026-07-10T12:00:00.000Z'
  await database.insert(sourceExecutionScopes).values({
    id: executionScopeId,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  const [connector] = await database.insert(connectorInstances).values({
    id,
    executionScopeId,
    connectorId,
    connectorVersion: '1.0.0',
    displayName: 'Fixture',
    enabled: true,
    configJson: '{}',
    createdAt: timestamp,
    updatedAt: timestamp,
  }).returning()
  return connector!
}

async function createConnectorRun(
  database: PgliteDatabase,
  connector: typeof connectorInstances.$inferSelect,
  id: string,
  startedAt: string,
) {
  const [run] = await database.insert(connectorRuns).values({
    id,
    executionScopeId: connector.executionScopeId,
    connectorInstanceId: connector.id,
    mode: 'manual',
    status: 'running',
    startedAt,
    observationCount: 0,
    warningCount: 0,
    statsJson: '{}',
    warningsJson: '[]',
    retryHintsJson: 'null',
    createdAt: startedAt,
    updatedAt: startedAt,
  }).returning()
  return run!
}

async function closeOnce(client: PgliteClient | null, closed: Set<PgliteClient>) {
  if (client && !closed.has(client)) {
    closed.add(client)
    await client.close()
  }
}
