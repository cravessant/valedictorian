import { afterEach, describe, expect, it } from 'vitest'
import { createDrizzleDatabase, createInMemoryDatabase, migrateDatabase } from '../../db/sqlite'
import { createSqliteConnectorRepository } from '../connectors/connector.repository'
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

  it('persists connector instance and run lineage on every raw occurrence', async () => {
    const sqlite = createInMemoryDatabase()
    databases.push(sqlite)
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const connectorRepository = createSqliteConnectorRepository(database)
    const repository = createSqliteRawSourceRepository(database)
    const connectorInstanceId = 'jobright-instance-1'
    await connectorRepository.upsertInstance({
      id: connectorInstanceId,
      connectorId: 'jobright.resolver',
      connectorVersion: '0.5.0',
      displayName: 'Jobright',
      enabled: true,
    })
    const runRequest = await connectorRepository.recordRunRequest({
      connectorInstanceId,
      mode: 'manual',
      startedAt: '2026-07-10T12:00:00.000Z',
    })
    const capture = {
      connectorInstanceId,
      connectorRunId: runRequest.run.id,
      executionScopeId: runRequest.run.executionScopeId,
    }
    const result = await repository.ingestBatch({
      records: [{
        adapter: { id: 'jobright.resolver', kind: 'connector', version: '0.5.0' },
        capture,
        observedAt: '2026-07-10T12:00:00.000Z',
        providerRecordId: 'job-1',
        providerSchema: 'jobright-visitor-list@1',
        payload: { companyName: 'Fixture Robotics', roleTitle: 'Intern' },
      }],
    })

    expect(result.receipts[0].occurrence).toMatchObject({ capture })
    await expect(repository.get(result.receipts[0].rawRecordId)).resolves.toMatchObject({
      occurrences: [expect.objectContaining({ capture })],
    })
  })

  it('rejects occurrence lineage assembled from different raw or connector owners', async () => {
    const sqlite = createInMemoryDatabase()
    databases.push(sqlite)
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const connectorRepository = createSqliteConnectorRepository(database)
    const rawRepository = createSqliteRawSourceRepository(database)
    const runs = []

    for (const suffix of ['one', 'two']) {
      const connectorInstanceId = `instance-${suffix}`
      await connectorRepository.upsertInstance({
        id: connectorInstanceId,
        connectorId: `fixture.${suffix}`,
        connectorVersion: '1.0.0',
        displayName: suffix,
        enabled: true,
      })
      runs.push((await connectorRepository.recordRunRequest({
        connectorInstanceId,
        mode: 'manual',
        startedAt: '2026-07-10T12:00:00.000Z',
      })).run)
    }
    const raw = await rawRepository.ingestBatch({ records: ['one', 'two'].map((suffix) => ({
      adapter: { id: `fixture.${suffix}`, kind: 'connector' as const, version: '1.0.0' },
      observedAt: '2026-07-10T12:00:00.000Z',
      providerRecordId: `job-${suffix}`,
      providerSchema: 'fixture@1',
      payload: { suffix },
    })) })
    const insert = sqlite.prepare(`
      insert into raw_source_occurrences (
        id, raw_record_id, raw_revision_id, connector_instance_id, connector_run_id,
        observed_at, received_at
      ) values (?, ?, ?, ?, ?, '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:01.000Z')
    `)

    expect(() => insert.run(
      'mismatched-raw',
      raw.receipts[0].rawRecordId,
      raw.receipts[1].revision.id,
      runs[0].connectorInstanceId,
      runs[0].id,
    )).toThrow(/foreign key|lineage mismatch|scope owner mismatch/i)
    expect(() => insert.run(
      'mismatched-connector',
      raw.receipts[0].rawRecordId,
      raw.receipts[0].revision.id,
      runs[0].connectorInstanceId,
      runs[1].id,
    )).toThrow(/foreign key|lineage mismatch|scope owner mismatch/i)
    const captured = await rawRepository.ingestBatch({ records: [{
      adapter: { id: 'fixture.one', kind: 'connector', version: '1.0.0' },
      capture: {
        connectorInstanceId: runs[0].connectorInstanceId,
        connectorRunId: runs[0].id,
        executionScopeId: runs[0].executionScopeId,
      },
      observedAt: '2026-07-10T12:00:00.000Z',
      providerRecordId: 'job-one',
      providerSchema: 'fixture@1',
      payload: { suffix: 'one' },
    }] })
    const insertNormalization = sqlite.prepare(`
      insert into normalization_runs (
        id, raw_record_id, raw_revision_id, trigger_occurrence_id,
        trigger_connector_instance_id, trigger_connector_run_id, input_hash, resolver_set_hash,
        canonical_schema_version, gate_policy_version, trigger_kind, status, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, 'sha256:resolvers', 'candidate/v1', 'gate/v1',
        'intake', 'completed', '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z')
    `)
    expect(() => insertNormalization.run(
      'bad-normalization-raw',
      raw.receipts[1].rawRecordId,
      raw.receipts[1].revision.id,
      captured.receipts[0].occurrence.id,
      runs[0].connectorInstanceId,
      runs[0].id,
      'sha256:bad-normalization-raw',
    )).toThrow(/foreign key|lineage mismatch|scope owner mismatch/i)
    expect(() => insertNormalization.run(
      'bad-normalization-history',
      raw.receipts[0].rawRecordId,
      raw.receipts[0].revision.id,
      raw.receipts[0].occurrence.id,
      runs[0].connectorInstanceId,
      runs[0].id,
      'sha256:bad-normalization-history',
    )).toThrow(/foreign key|lineage mismatch|scope owner mismatch/i)
    expect(() => insertNormalization.run(
      'manual-normalization',
      raw.receipts[0].rawRecordId,
      raw.receipts[0].revision.id,
      null,
      null,
      null,
      'sha256:manual-normalization',
    )).not.toThrow()
    expect(sqlite.prepare('pragma foreign_key_check').all()).toEqual([])
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
