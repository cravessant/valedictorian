import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  captureLineages,
  captureEvidenceVersions,
  captures,
  connectorInstances,
  connectorRuns,
  jobIdentities,
  jobs,
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
import { createPgliteTestDatabase } from '../../test/pglite-test-owner'
import { createPgliteRawSourceRepository } from './raw-source.repository'

describe('raw source repository', () => {
  it('rolls back raw capture when transactional staging fails', async () => {
    const database = await createTestDatabase()
    const repository = createPgliteRawSourceRepository(database)
    let stageCompleted = false

    await expect(repository.ingestBatch({
      records: [{
        adapter: { id: 'fixture.manual', kind: 'manual', version: '1.0.0' },
        observedAt: '2026-07-10T12:00:00.000Z',
        payload: { companyName: 'Fixture', roleTitle: 'Engineer' },
      }, {
        adapter: { id: 'fixture.import', kind: 'import', version: '1.0.0' },
        observedAt: '2026-07-10T12:01:00.000Z',
        payload: { companyName: 'Second', roleTitle: 'Designer' },
      }],
    }, {
      stage: async () => {
        await Promise.resolve()
        stageCompleted = true
        throw new Error('provider staging failed')
      },
    })).rejects.toThrow('provider staging failed')
    expect(stageCompleted).toBe(true)
    await expect(database.select().from(captureLineages)).resolves.toHaveLength(0)
    await expect(database.select().from(captureEvidenceVersions)).resolves.toHaveLength(0)
    await expect(database.select().from(captures)).resolves.toHaveLength(0)
  })

  it('returns receipts in input order after awaited transactional staging', async () => {
    const database = await createTestDatabase()
    const repository = createPgliteRawSourceRepository(database)
    let stagedIntakeIds: readonly string[] = []

    const result = await repository.ingestBatch({
      records: ['third', 'first', 'second'].map((intakeItemId, index) => ({
        intakeItemId,
        adapter: { id: 'fixture.manual', kind: 'manual' as const, version: '1.0.0' },
        observedAt: `2026-07-10T12:0${index}:00.000Z`,
        payload: { index },
      })),
    }, {
      stage: async (_transaction, { receipts }) => {
        await Promise.resolve()
        stagedIntakeIds = receipts.map((receipt) => receipt.intakeItemId)
      },
    })

    expect(result.receipts.map((receipt) => receipt.intakeItemId)).toEqual([
      'third',
      'first',
      'second',
    ])
    expect(stagedIntakeIds).toEqual(['third', 'first', 'second'])
  })

  it('rejects connector intake without complete capture lineage', async () => {
    const database = await createTestDatabase()
    const repository = createPgliteRawSourceRepository(database)

    await expect(repository.ingestBatch({
      records: [{
        adapter: { id: 'fixture.connector', kind: 'connector', version: '1.0.0' },
        observedAt: '2026-07-10T12:00:00.000Z',
        payload: { title: 'Fixture role' },
      }],
    } as never)).rejects.toThrow('records[0].capture is required for a connector adapter')
  })

  it('scopes strong identity independently from adapter version and preserves revision provenance', async () => {
    const database = await createTestDatabase()
    const receivedTimes = [
      new Date('2026-07-10T14:00:00.000Z'),
      new Date('2026-07-10T15:00:00.000Z'),
    ]
    const capture = await createConnectorCapture(database, 'fixture.connector')
    const repository = createPgliteRawSourceRepository(
      database,
      () => receivedTimes.shift()!,
    )
    const first = await repository.ingestBatch({
      records: [
        {
          adapter: { id: 'fixture.connector', kind: 'connector', version: '1.0.0' },
          capture,
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
          capture,
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
    const database = await createTestDatabase()
    const repository = createPgliteRawSourceRepository(database)
    const capture = await createConnectorCapture(database, 'jobright.resolver')
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
    const database = await createTestDatabase()
    const rawRepository = createPgliteRawSourceRepository(database)
    const runs = []

    for (const suffix of ['one', 'two']) {
      const capture = await createConnectorCapture(database, `fixture.${suffix}`)
      runs.push({
        id: capture.connectorRunId,
        connectorInstanceId: capture.connectorInstanceId,
        executionScopeId: capture.executionScopeId,
      })
    }
    const raw = await rawRepository.ingestBatch({ records: ['one', 'two'].map((suffix, index) => ({
      adapter: { id: `fixture.${suffix}`, kind: 'connector' as const, version: '1.0.0' },
      capture: {
        connectorInstanceId: runs[index]!.connectorInstanceId,
        connectorRunId: runs[index]!.id,
        executionScopeId: runs[index]!.executionScopeId,
      },
      observedAt: '2026-07-10T12:00:00.000Z',
      providerRecordId: `job-${suffix}`,
      providerSchema: 'fixture@1',
      payload: { suffix },
    })) })
    await expectPostgresFailure(database.insert(captures).values({
      id: 'mismatched-raw',
      captureLineageId: raw.receipts[0].rawRecordId,
      captureEvidenceVersionId: raw.receipts[1].revision.id,
      connectorInstanceId: runs[0].connectorInstanceId,
      connectorRunId: runs[0].id,
      executionScopeId: runs[0].executionScopeId,
      observedAt: '2026-07-10T12:00:00.000Z',
      receivedAt: '2026-07-10T12:00:01.000Z',
    }), /foreign key|lineage mismatch|scope owner mismatch/i)
    await expectPostgresFailure(database.insert(captures).values({
      id: 'mismatched-connector',
      captureLineageId: raw.receipts[0].rawRecordId,
      captureEvidenceVersionId: raw.receipts[0].revision.id,
      connectorInstanceId: runs[0].connectorInstanceId,
      connectorRunId: runs[1].id,
      executionScopeId: runs[0].executionScopeId,
      observedAt: '2026-07-10T12:00:00.000Z',
      receivedAt: '2026-07-10T12:00:01.000Z',
    }), /foreign key|lineage mismatch|scope owner mismatch/i)
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
    await expectPostgresFailure(database.insert(normalizationRuns).values(normalizationValues({
      id: 'bad-normalization-raw',
      rawRecordId: raw.receipts[1].rawRecordId,
      revisionId: raw.receipts[1].revision.id,
      captureId: captured.receipts[0].occurrence.id,
      connectorInstanceId: runs[0].connectorInstanceId,
      connectorRunId: runs[0].id,
    })), /foreign key|lineage mismatch|invalid/i)
    await expectPostgresFailure(database.insert(normalizationRuns).values(normalizationValues({
      id: 'bad-normalization-history',
      rawRecordId: raw.receipts[0].rawRecordId,
      revisionId: raw.receipts[0].revision.id,
      captureId: raw.receipts[1].occurrence.id,
      connectorInstanceId: runs[1].connectorInstanceId,
      connectorRunId: runs[1].id,
    })), /foreign key|lineage mismatch|invalid/i)
    await expect(database.insert(normalizationRuns).values(normalizationValues({
      id: 'manual-normalization',
      rawRecordId: raw.receipts[0].rawRecordId,
      revisionId: raw.receipts[0].revision.id,
    }))).resolves.toBeDefined()
  })

  it('does not create strong identity for blank connector provider ids', async () => {
    const database = await createTestDatabase()
    const capture = await createConnectorCapture(database, 'fixture.connector')
    const repository = createPgliteRawSourceRepository(database)
    const result = await repository.ingestBatch({
      records: ['', '   '].map((providerRecordId) => ({
        adapter: { id: 'fixture.connector', kind: 'connector' as const, version: '1' },
        capture,
        observedAt: '2026-07-10T12:00:00.000Z',
        providerRecordId,
        payload: { same: true },
      })),
    })

    expect(result.receipts.map((receipt) => receipt.sourceEntityId)).toEqual([null, null])
    expect(new Set(result.receipts.map((receipt) => receipt.rawRecordId)).size).toBe(2)
  })

  it('reuses trimmed-equivalent provider identity while preserving raw provenance', async () => {
    const database = await createTestDatabase()
    const capture = await createConnectorCapture(database, 'fixture.connector')
    const repository = createPgliteRawSourceRepository(database)
    const base = {
      adapter: { id: 'fixture.connector', kind: 'connector' as const, version: '1' },
      capture,
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
    const database = await createTestDatabase()
    const capture = await createConnectorCapture(database, 'fixture.connector')
    const repository = createPgliteRawSourceRepository(database)
    const result = await repository.ingestBatch({
      records: [null, 'null'].map((providerSchema) => ({
        adapter: { id: 'fixture.connector', kind: 'connector' as const, version: '1' },
        capture,
        observedAt: '2026-07-10T12:00:00.000Z',
        providerRecordId: 'job-1',
        providerSchema,
      })),
    })

    expect(result.receipts[0].sourceEntityId).not.toBe(result.receipts[1].sourceEntityId)
    expect(result.receipts[0].rawRecordId).not.toBe(result.receipts[1].rawRecordId)
  })

  it('reuses exact content while appending ordered occurrences to one durable revision', async () => {
    const database = await createTestDatabase()
    const capture = await createConnectorCapture(database, 'fixture.connector')
    const receivedTimes = [
      new Date('2026-07-10T12:00:01.000Z'),
      new Date('2026-07-10T12:00:02.000Z'),
    ]
    const repository = createPgliteRawSourceRepository(database, () => receivedTimes.shift()!)
    const record = {
      adapter: { id: 'fixture.connector', kind: 'connector' as const, version: '1.0.0' },
      capture,
      observedAt: '2026-07-10T12:00:00.000Z',
      providerRecordId: 'job-exact',
      providerSchema: 'fixture@1',
      payload: { state: 'open' },
    }

    const first = await repository.ingestBatch({ records: [record] })
    const second = await repository.ingestBatch({ records: [record] })

    expect(second.receipts[0]).toMatchObject({
      rawRecordId: first.receipts[0].rawRecordId,
      sourceEntityId: first.receipts[0].sourceEntityId,
      revision: {
        id: first.receipts[0].revision.id,
        revision: 1,
        reused: true,
      },
    })
    await expect(repository.get(first.receipts[0].rawRecordId)).resolves.toMatchObject({
      latestRevision: { id: first.receipts[0].revision.id, revision: 1 },
      occurrences: [
        { receivedAt: '2026-07-10T12:00:01.000Z' },
        { receivedAt: '2026-07-10T12:00:02.000Z' },
      ],
    })
  })

  it('converges concurrent duplicate intake on one canonical durable record', async () => {
    const database = await createTestDatabase()
    const capture = await createConnectorCapture(database, 'fixture.concurrent')
    const repository = createPgliteRawSourceRepository(
      database,
      () => new Date('2026-07-10T12:00:01.000Z'),
    )
    const input = {
      records: [{
        adapter: { id: 'fixture.concurrent', kind: 'connector' as const, version: '1.0.0' },
        capture,
        observedAt: '2026-07-10T12:00:00.000Z',
        providerRecordId: 'job-concurrent',
        providerSchema: 'fixture@1',
        payload: { state: 'open' },
      }],
    }

    const results = await Promise.all([
      repository.ingestBatch(input),
      repository.ingestBatch(input),
    ])
    const receipts = results.map((result) => result.receipts[0])

    expect(new Set(receipts.map((receipt) => receipt.sourceEntityId)).size).toBe(1)
    expect(new Set(receipts.map((receipt) => receipt.rawRecordId)).size).toBe(1)
    expect(new Set(receipts.map((receipt) => receipt.revision.id)).size).toBe(1)
    expect(receipts.map((receipt) => receipt.revision.reused)
      .sort((left, right) => Number(left) - Number(right))).toEqual([false, true])
    await expect(repository.get(receipts[0].rawRecordId)).resolves.toMatchObject({
      latestRevision: { revision: 1 },
      occurrences: [{}, {}],
    })
  })

  it('rejects a captured identity already evidenced for a conflicting owner', async () => {
    const database = await createTestDatabase()
    const capture = await createConnectorCapture(database, 'fixture.connector')
    const repository = createPgliteRawSourceRepository(database)
    const identityNamespace = 'adapter:17:fixture.connector|schema:value:9:fixture@1'
    const createdAt = '2026-07-10T12:00:00.000Z'
    await database.insert(jobs).values({
      id: 'conflicting-owner',
      identityKind: 'provider_job',
      identityNamespace: 'seed-owner',
      identityValue: 'seed-owner',
      createdAt,
    })
    await database.insert(jobIdentities).values({
      id: 'conflicting-identity',
      jobId: 'conflicting-owner',
      identityKind: 'provider_job',
      identityNamespace,
      identityValue: 'job-conflict',
      provenanceKind: 'capture',
      provenanceVersion: 'raw-source-capture/v1',
      evidenceJson: '{}',
      createdAt,
    })

    await expectPostgresFailure(repository.ingestBatch({ records: [{
      adapter: { id: 'fixture.connector', kind: 'connector', version: '1.0.0' },
      capture,
      observedAt: createdAt,
      providerRecordId: 'job-conflict',
      providerSchema: 'fixture@1',
    }] }), /duplicate key|unique constraint/i)
    await expect(database.select().from(jobs)).resolves.toHaveLength(1)
    await expect(database.select().from(captureLineages)).resolves.toHaveLength(0)
  })

  it('keeps raw captures visible after an on-disk PGlite restart', async () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'raw-source-pglite-'))
    const dataDir = path.join(temporaryRoot, 'pglite')
    const closed = new Set<PgliteClient>()
    const close = async (client: PgliteClient | null) => {
      if (client && !closed.has(client)) {
        closed.add(client)
        await client.close()
      }
    }
    let firstClient: PgliteClient | null = null
    let secondClient: PgliteClient | null = null

    try {
      firstClient = await createPgliteClient({ dataDir })
      const firstDatabase = await migratePgliteDatabase(firstClient)
      const firstRepository = createPgliteRawSourceRepository(firstDatabase)
      const intake = await firstRepository.ingestBatch({ records: [{
        adapter: { id: 'fixture.import', kind: 'import', version: '1.0.0' },
        observedAt: '2026-07-10T12:00:00.000Z',
        payload: { roleTitle: 'Restart proof' },
      }] })
      await close(firstClient)

      secondClient = await createPgliteClient({ dataDir })
      const secondRepository = createPgliteRawSourceRepository(
        createPgliteDatabase(secondClient),
      )

      await expect(secondRepository.get(intake.receipts[0].rawRecordId)).resolves.toMatchObject({
        latestRevision: { payload: { roleTitle: 'Restart proof' } },
        occurrences: [{ observedAt: '2026-07-10T12:00:00.000Z' }],
      })
    } finally {
      await close(secondClient)
      await close(firstClient)
      await fs.promises.rm(temporaryRoot, { recursive: true, force: true })
    }

    expect(closed.size).toBe(2)
    expect(fs.existsSync(temporaryRoot)).toBe(false)
  })

  it('rejects invalid timestamps and non-JSON runtime values', async () => {
    const database = await createTestDatabase()
    const repository = createPgliteRawSourceRepository(database)
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
    const database = await createTestDatabase()
    const repository = createPgliteRawSourceRepository(database)
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
    const database = await createTestDatabase()
    const repository = createPgliteRawSourceRepository(database)
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

async function createConnectorCapture(
  database: PgliteDatabase,
  connectorId: string,
) {
  const stem = connectorId.replaceAll('.', '-')
  const executionScopeId = `${stem}-scope`
  const connectorInstanceId = `${stem}-instance`
  const connectorRunId = `${stem}-run`
  const timestamp = '2026-07-10T12:00:00.000Z'
  await database.insert(sourceExecutionScopes).values({
    id: executionScopeId,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  await database.insert(connectorInstances).values({
    id: connectorInstanceId,
    executionScopeId,
    connectorId,
    connectorVersion: '1.0.0',
    displayName: connectorId,
    enabled: true,
    configJson: '{}',
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  await database.insert(connectorRuns).values({
    id: connectorRunId,
    executionScopeId,
    connectorInstanceId,
    mode: 'manual',
    status: 'running',
    startedAt: timestamp,
    observationCount: 0,
    warningCount: 0,
    statsJson: '{}',
    warningsJson: '[]',
    retryHintsJson: 'null',
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  return {
    connectorInstanceId,
    connectorRunId,
    executionScopeId,
  }
}

async function createTestDatabase() {
  return createPgliteTestDatabase()
}

function normalizationValues(input: {
  id: string
  rawRecordId: string
  revisionId: string
  captureId?: string
  connectorInstanceId?: string
  connectorRunId?: string
}): typeof normalizationRuns.$inferInsert {
  return {
    id: input.id,
    captureLineageId: input.rawRecordId,
    captureEvidenceVersionId: input.revisionId,
    triggerCaptureId: input.captureId ?? null,
    triggerConnectorInstanceId: input.connectorInstanceId ?? null,
    triggerConnectorRunId: input.connectorRunId ?? null,
    inputHash: `sha256:${input.id}`,
    resolverSetHash: 'sha256:resolvers',
    canonicalSchemaVersion: 'candidate/v1',
    gatePolicyVersion: 'gate/v1',
    triggerKind: 'intake',
    status: 'completed',
    createdAt: '2026-07-10T12:00:00.000Z',
    updatedAt: '2026-07-10T12:00:00.000Z',
  }
}

async function expectPostgresFailure(
  operation: PromiseLike<unknown>,
  expected: RegExp,
) {
  const caught = await Promise.resolve(operation).catch((error: unknown) => error)
  const messages: string[] = []
  const visited = new Set<unknown>()
  let current: unknown = caught

  while (current && !visited.has(current)) {
    visited.add(current)
    if (current instanceof Error) messages.push(current.message)
    current = typeof current === 'object' && 'cause' in current
      ? current.cause
      : null
  }

  expect(messages.join('\n')).toMatch(expected)
}
