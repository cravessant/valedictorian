import { afterEach, describe, expect, it } from 'vitest'
import { createDrizzleDatabase, createInMemoryDatabase, migrateDatabase } from '../../db/sqlite'
import { createSqliteRawSourceRepository } from './raw-source.repository'

describe('raw source repository', () => {
  const databases: ReturnType<typeof createInMemoryDatabase>[] = []

  afterEach(() => {
    databases.splice(0).forEach((database) => database.close())
  })

  it('scopes strong identity independently from adapter version and preserves revision provenance', async () => {
    const sqlite = createInMemoryDatabase()
    databases.push(sqlite)
    migrateDatabase(sqlite)
    const receivedTimes = [
      new Date('2026-07-10T14:00:00.000Z'),
      new Date('2026-07-10T15:00:00.000Z'),
    ]
    const repository = createSqliteRawSourceRepository(
      createDrizzleDatabase(sqlite),
      () => receivedTimes.shift()!,
    )
    const first = await repository.ingestBatch({
      records: [
        {
          adapter: { id: 'fixture.connector', kind: 'connector', version: '1.0.0' },
          observedAt: '2026-07-10T13:00:00.000Z',
          providerRecordId: 'job-1',
          providerSchema: null,
          reportedOrigin: {
            kind: 'job_board',
            name: 'Fixture Board',
            providerId: 'board-1',
            url: 'https://example.test/jobs/1',
          },
          payload: { state: 'open' },
        },
      ],
    })
    const second = await repository.ingestBatch({
      records: [
        {
          adapter: { id: 'fixture.connector', kind: 'connector', version: '2.0.0' },
          observedAt: '2026-07-10T12:00:00.000Z',
          providerRecordId: 'job-1',
          providerSchema: null,
          reportedOrigin: {
            kind: 'employer',
            name: 'Fixture Robotics',
          },
          payload: { state: 'closed' },
        },
      ],
    })

    expect(second.receipts[0]).toMatchObject({
      rawRecordId: first.receipts[0].rawRecordId,
      sourceEntityId: first.receipts[0].sourceEntityId,
      revision: { revision: 2, reused: false },
    })
    await expect(repository.get(first.receipts[0].rawRecordId)).resolves.toMatchObject({
      adapter: { id: 'fixture.connector', kind: 'connector', version: '2.0.0' },
      reportedOrigin: {
        kind: 'employer',
        name: 'Fixture Robotics',
        providerId: null,
        url: null,
      },
      latestRevision: {
        adapter: { version: '2.0.0' },
        revision: 2,
        payload: { state: 'closed' },
      },
      occurrences: [
        { observedAt: '2026-07-10T12:00:00.000Z', receivedAt: '2026-07-10T15:00:00.000Z' },
        { observedAt: '2026-07-10T13:00:00.000Z', receivedAt: '2026-07-10T14:00:00.000Z' },
      ],
    })
  })

  it('does not create strong identity for blank connector provider ids', async () => {
    const sqlite = createInMemoryDatabase()
    databases.push(sqlite)
    migrateDatabase(sqlite)
    const repository = createSqliteRawSourceRepository(createDrizzleDatabase(sqlite))
    const result = await repository.ingestBatch({
      records: ['', '   '].map((providerRecordId) => ({
        adapter: { id: 'fixture.connector', kind: 'connector' as const, version: '1' },
        observedAt: '2026-07-10T12:00:00.000Z',
        providerRecordId,
        payload: { same: true },
      })),
    })

    expect(result.receipts.map((receipt) => receipt.sourceEntityId)).toEqual([null, null])
    expect(new Set(result.receipts.map((receipt) => receipt.rawRecordId)).size).toBe(2)
  })

  it('reuses trimmed-equivalent provider identity while preserving raw provenance', async () => {
    const sqlite = createInMemoryDatabase()
    databases.push(sqlite)
    migrateDatabase(sqlite)
    const repository = createSqliteRawSourceRepository(createDrizzleDatabase(sqlite))
    const base = {
      adapter: { id: 'fixture.connector', kind: 'connector' as const, version: '1' },
      observedAt: '2026-07-10T12:00:00.000Z',
      providerSchema: 'jobs@1',
      payload: { unchanged: true },
    }
    const first = await repository.ingestBatch({
      records: [{ ...base, providerRecordId: 'job-1' }],
    })
    const second = await repository.ingestBatch({
      records: [{ ...base, providerRecordId: '  job-1  ' }],
    })

    expect(second.receipts[0]).toMatchObject({
      rawRecordId: first.receipts[0].rawRecordId,
      sourceEntityId: first.receipts[0].sourceEntityId,
      revision: { reused: false, revision: 2 },
    })
    await expect(repository.get(first.receipts[0].rawRecordId)).resolves.toMatchObject({
      latestRevision: { providerRecordId: '  job-1  ', revision: 2 },
    })
  })

  it('keeps null and present provider schemas in separate identity namespaces', async () => {
    const sqlite = createInMemoryDatabase()
    databases.push(sqlite)
    migrateDatabase(sqlite)
    const repository = createSqliteRawSourceRepository(createDrizzleDatabase(sqlite))
    const result = await repository.ingestBatch({
      records: [null, 'null'].map((providerSchema) => ({
        adapter: { id: 'fixture.connector', kind: 'connector' as const, version: '1' },
        observedAt: '2026-07-10T12:00:00.000Z',
        providerRecordId: 'job-1',
        providerSchema,
      })),
    })

    expect(result.receipts[0].sourceEntityId).not.toBe(result.receipts[1].sourceEntityId)
    expect(result.receipts[0].rawRecordId).not.toBe(result.receipts[1].rawRecordId)
  })

  it('rejects invalid timestamps and non-JSON runtime values', async () => {
    const sqlite = createInMemoryDatabase()
    databases.push(sqlite)
    migrateDatabase(sqlite)
    const repository = createSqliteRawSourceRepository(createDrizzleDatabase(sqlite))
    const base = {
      adapter: { id: 'fixture.cli', kind: 'cli' as const, version: '1' },
    }

    await expect(
      repository.ingestBatch({
        records: [{ ...base, observedAt: '2026-02-31T12:00:00.000Z' }],
      }),
    ).rejects.toThrow('observedAt is invalid')
    await expect(
      repository.ingestBatch({
        records: [
          {
            ...base,
            observedAt: '2026-07-10T12:00:00.000Z',
            payload: { invalid: new Date() } as never,
          },
        ],
      }),
    ).rejects.toThrow('must contain only JSON objects')
  })

  it('rejects exact credential header aliases throughout fixed envelopes', async () => {
    const sqlite = createInMemoryDatabase()
    databases.push(sqlite)
    migrateDatabase(sqlite)
    const repository = createSqliteRawSourceRepository(createDrizzleDatabase(sqlite))
    const secretValue = 'envelope-secret-must-not-leak'
    const record = {
      adapter: { id: 'fixture.cli', kind: 'cli' as const, version: '1' },
      observedAt: '2026-07-10T12:00:00.000Z',
    }
    const inputs = [
      { records: [record], 'X-Auth-Token': secretValue },
      { records: [{ ...record, 'X-Access-Token': secretValue }] },
      { records: [{ ...record, adapter: { ...record.adapter, 'X-Api-Token': secretValue } }] },
      {
        records: [
          {
            ...record,
            reportedOrigin: {
              kind: 'job_board' as const,
              name: 'Fixture',
              'proxy-authorization': secretValue,
            },
          },
        ],
      },
      {
        records: [
          {
            ...record,
            evidence: [
              { kind: 'fixture', label: 'unsafe', value: null, authentication: secretValue },
            ],
          },
        ],
      },
    ]

    for (const input of inputs) {
      const error = await repository.ingestBatch(input as never).catch((caught: unknown) => caught) as Error

      expect(error.message).toContain('forbidden sensitive key')
      expect(error.message).not.toContain(secretValue)
    }
  })

  it('rejects unknown keys on every fixed transport envelope', async () => {
    const sqlite = createInMemoryDatabase()
    databases.push(sqlite)
    migrateDatabase(sqlite)
    const repository = createSqliteRawSourceRepository(createDrizzleDatabase(sqlite))
    const record = {
      adapter: { id: 'fixture.cli', kind: 'cli' as const, version: '1' },
      observedAt: '2026-07-10T12:00:00.000Z',
    }
    const inputs = [
      { records: [record], extra: true },
      { records: [{ ...record, extra: true }] },
      { records: [{ ...record, adapter: { ...record.adapter, extra: true } }] },
      {
        records: [
          {
            ...record,
            reportedOrigin: { kind: 'job_board' as const, name: 'Fixture', extra: true },
          },
        ],
      },
      {
        records: [
          {
            ...record,
            evidence: [{ kind: 'fixture', label: 'unknown', value: null, extra: true }],
          },
        ],
      },
    ]

    for (const input of inputs) {
      await expect(repository.ingestBatch(input as never)).rejects.toThrow(
        'contains an unsupported property',
      )
    }
  })
})
