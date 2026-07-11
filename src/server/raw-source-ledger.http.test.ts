import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createHttpValedictorianClient, ValedictorianHttpError } from 'sparxie'
import { afterEach, describe, expect, it } from 'vitest'
import { createLocalValedictorianClient } from '../runtime/local-valedictorian-client'
import {
  createDefaultNormalizationResolverRegistry,
  createNormalizationResolverRegistry,
} from '../modules/sourcing/normalization.registry'
import { createValedictorianHttpServer, type StartedValedictorianHttpServer } from './local-server'

describe('raw source ledger HTTP API', () => {
  let server: StartedValedictorianHttpServer | null = null

  afterEach(async () => {
    await server?.close()
    server = null
  })

  it('round-trips a sparse CLI record through the released workspace client', async () => {
    const sqlitePath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-raw-http-')),
      'valedictorian.sqlite',
    )
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath }),
      host: '127.0.0.1',
      port: 0,
    })
    const workspace = createHttpValedictorianClient({ baseUrl: server.url }).forWorkspace(
      'workspace / encoded',
    )

    const result = await workspace.sourcing.rawRecords.ingestBatch({
      records: [
        {
          adapter: { id: 'valedictorian.cli', kind: 'cli', version: '0.7.6' },
          observedAt: '2026-07-10T12:00:00.000Z',
          reportedOrigin: { kind: 'job_board', name: 'LinkedIn' },
          payload: { arbitrary: { sparse: true } },
        },
      ],
    })

    expect(result.receipts).toHaveLength(1)
    expect(result.receipts[0]).toMatchObject({
      sourceEntityId: null,
      revision: { reused: false, revision: 1 },
      occurrence: { observedAt: '2026-07-10T12:00:00.000Z' },
    })

    await expect(
      workspace.sourcing.rawRecords.get(result.receipts[0].rawRecordId),
    ).resolves.toMatchObject({
      id: result.receipts[0].rawRecordId,
      sourceEntityId: null,
      adapter: { id: 'valedictorian.cli', kind: 'cli', version: '0.7.6' },
      reportedOrigin: { kind: 'job_board', name: 'LinkedIn' },
      latestRevision: {
        revision: 1,
        observedAt: '2026-07-10T12:00:00.000Z',
        payload: { arbitrary: { sparse: true } },
      },
      occurrences: [{ observedAt: '2026-07-10T12:00:00.000Z' }],
    })
  })

  it('reuses exact connector content and appends another occurrence', async () => {
    const sqlitePath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-raw-http-')),
      'valedictorian.sqlite',
    )
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath }),
      host: '127.0.0.1',
      port: 0,
    })
    const rawRecords = createHttpValedictorianClient({ baseUrl: server.url }).forWorkspace(
      'workspace-1',
    ).sourcing.rawRecords
    const content = {
      adapter: { id: 'jobright.jobs', kind: 'connector' as const, version: '0.4.3' },
      providerRecordId: 'provider-job-1',
      providerSchema: null,
      payload: { company: 'Fixture Robotics', role: 'Intern' },
    }

    const first = await rawRecords.ingestBatch({
      records: [{ ...content, observedAt: '2026-07-10T12:00:00.000Z' }],
    })
    const second = await rawRecords.ingestBatch({
      records: [{ ...content, observedAt: '2026-07-10T13:00:00.000Z' }],
    })

    expect(second.receipts[0]).toMatchObject({
      rawRecordId: first.receipts[0].rawRecordId,
      sourceEntityId: first.receipts[0].sourceEntityId,
      revision: {
        id: first.receipts[0].revision.id,
        contentHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        reused: true,
        revision: 1,
      },
    })
    await expect(rawRecords.get(first.receipts[0].rawRecordId)).resolves.toMatchObject({
      occurrences: [
        { observedAt: '2026-07-10T12:00:00.000Z' },
        { observedAt: '2026-07-10T13:00:00.000Z' },
      ],
    })
  })

  it('appends revision two when connector content changes', async () => {
    const sqlitePath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-raw-http-')),
      'valedictorian.sqlite',
    )
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath }),
      host: '127.0.0.1',
      port: 0,
    })
    const rawRecords = createHttpValedictorianClient({ baseUrl: server.url }).forWorkspace(
      'workspace-1',
    ).sourcing.rawRecords
    const identity = {
      adapter: { id: 'fixture.connector', kind: 'connector' as const, version: '1.0.0' },
      providerRecordId: 'job-42',
      providerSchema: 'jobs@1',
      observedAt: '2026-07-10T12:00:00.000Z',
    }

    const first = await rawRecords.ingestBatch({
      records: [{ ...identity, payload: { status: 'open' } }],
    })
    const second = await rawRecords.ingestBatch({
      records: [{ ...identity, payload: { status: 'closed' } }],
    })

    expect(second.receipts[0]).toMatchObject({
      rawRecordId: first.receipts[0].rawRecordId,
      sourceEntityId: first.receipts[0].sourceEntityId,
      revision: { reused: false, revision: 2 },
    })
    await expect(rawRecords.get(first.receipts[0].rawRecordId)).resolves.toMatchObject({
      latestRevision: { revision: 2, payload: { status: 'closed' } },
      occurrences: [
        { rawRevisionId: first.receipts[0].revision.id },
        { rawRevisionId: second.receipts[0].revision.id },
      ],
    })
  })

  it('keeps non-connector submissions provisional and separate', async () => {
    const sqlitePath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-raw-http-')),
      'valedictorian.sqlite',
    )
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath }),
      host: '127.0.0.1',
      port: 0,
    })
    const rawRecords = createHttpValedictorianClient({ baseUrl: server.url }).forWorkspace(
      'workspace-1',
    ).sourcing.rawRecords
    const result = await rawRecords.ingestBatch({
      records: (['cli', 'manual', 'import'] as const).map((kind) => ({
        adapter: { id: `fixture.${kind}`, kind, version: '1.0.0' },
        observedAt: '2026-07-10T12:00:00.000Z',
        providerRecordId: 'reported-but-not-authoritative',
        providerSchema: 'jobs@1',
        payload: { exact: 'same content' },
      })),
    })

    expect(result.receipts.map(({ rawRecordId, sourceEntityId }) => ({ rawRecordId, sourceEntityId })))
      .toEqual([
        { rawRecordId: expect.any(String), sourceEntityId: null },
        { rawRecordId: expect.any(String), sourceEntityId: null },
        { rawRecordId: expect.any(String), sourceEntityId: null },
      ])
    expect(new Set(result.receipts.map((receipt) => receipt.rawRecordId))).toHaveProperty('size', 3)
  })

  it('rolls back an invalid batch and preserves receipt order', async () => {
    const sqlitePath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-raw-http-')),
      'valedictorian.sqlite',
    )
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath }),
      host: '127.0.0.1',
      port: 0,
    })
    const rawRecords = createHttpValedictorianClient({ baseUrl: server.url }).forWorkspace(
      'workspace-1',
    ).sourcing.rawRecords
    const validRecord = {
      adapter: { id: 'fixture.connector', kind: 'connector' as const, version: '1.0.0' },
      observedAt: '2026-07-10T12:00:00.000Z',
      providerRecordId: 'atomic-job',
      payload: { order: 1 },
    }

    await expect(
      rawRecords.ingestBatch({
        records: [
          validRecord,
          { ...validRecord, adapter: { ...validRecord.adapter, id: '' }, providerRecordId: 'bad' },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 })

    const result = await rawRecords.ingestBatch({
      records: [
        validRecord,
        { ...validRecord, providerRecordId: 'second-job', payload: { order: 2 } },
      ],
    })

    expect(result.receipts.map((receipt) => receipt.revision)).toEqual([
      expect.objectContaining({ reused: false, revision: 1 }),
      expect.objectContaining({ reused: false, revision: 1 }),
    ])
    await expect(rawRecords.get(result.receipts[0].rawRecordId)).resolves.toMatchObject({
      latestRevision: { payload: { order: 1 } },
    })
    await expect(rawRecords.get(result.receipts[1].rawRecordId)).resolves.toMatchObject({
      latestRevision: { payload: { order: 2 } },
    })
  })

  it('isolates workspaces and returns typed 404s for encoded raw ids', async () => {
    const workspaceClients = new Map([
      ['workspace / one', createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() })],
      ['workspace two', createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() })],
    ])
    server = await createValedictorianHttpServer({
      client: workspaceClients.get('workspace / one')!,
      host: '127.0.0.1',
      port: 0,
      resolveWorkspaceClient(workspaceId) {
        return workspaceClients.get(workspaceId)!
      },
    })
    const client = createHttpValedictorianClient({ baseUrl: server.url })
    const firstWorkspace = client.forWorkspace('workspace / one')
    const secondWorkspace = client.forWorkspace('workspace two')
    const created = await firstWorkspace.sourcing.rawRecords.ingestBatch({
      records: [
        {
          adapter: { id: 'fixture.cli', kind: 'cli', version: '1' },
          observedAt: '2026-07-10T12:00:00.000Z',
        },
      ],
    })

    await expect(
      secondWorkspace.sourcing.rawRecords.get(created.receipts[0].rawRecordId),
    ).rejects.toMatchObject({
      status: 404,
      body: { message: 'Raw source record not found' },
    })
    await expect(firstWorkspace.sourcing.rawRecords.get('missing / encoded id')).rejects.toBeInstanceOf(
      ValedictorianHttpError,
    )
  })

  it('hashes canonical revision content independent of object key order', async () => {
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
    })
    const rawRecords = createHttpValedictorianClient({ baseUrl: server.url }).forWorkspace(
      'workspace-1',
    ).sourcing.rawRecords
    const first = await rawRecords.ingestBatch({
      records: [
        {
          adapter: { id: 'a', kind: 'connector', version: '1' },
          observedAt: '2026-07-10T12:00:00.000Z',
          providerRecordId: 'p',
          providerSchema: null,
          payload: { b: 2, a: 1 },
        },
      ],
    })
    const second = await rawRecords.ingestBatch({
      records: [
        {
          adapter: { version: '1', kind: 'connector', id: 'a' },
          observedAt: '2026-07-10T13:00:00.000Z',
          providerRecordId: 'p',
          providerSchema: null,
          payload: { a: 1, b: 2 },
        },
      ],
    })

    expect(first.receipts[0].revision.contentHash).toBe(
      'sha256:ab4f83f982454be6706006855b2d322e6040b96bc216afcff511b56de5e970df',
    )
    expect(second.receipts[0].revision).toMatchObject({
      id: first.receipts[0].revision.id,
      reused: true,
    })
  })

  it('enforces raw payload, evidence, and batch contract limits', async () => {
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
    })
    const rawRecords = createHttpValedictorianClient({ baseUrl: server.url }).forWorkspace(
      'workspace-1',
    ).sourcing.rawRecords
    const base = {
      adapter: { id: 'fixture.cli', kind: 'cli' as const, version: '1' },
      observedAt: '2026-07-10T12:00:00.000Z',
    }

    await expect(
      rawRecords.ingestBatch({
        records: [{ ...base, payload: { data: 'x'.repeat(262_144 - 11) } }],
      }),
    ).resolves.toMatchObject({ receipts: [expect.any(Object)] })
    await expect(
      rawRecords.ingestBatch({
        records: [{ ...base, payload: { data: 'x'.repeat(262_144 - 10) } }],
      }),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      rawRecords.ingestBatch({
        records: [
          {
            ...base,
            evidence: [{ kind: 'fixture', label: 'oversized', value: 'x'.repeat(16_384 - 1) }],
          },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      rawRecords.ingestBatch({
        records: [{ ...base, evidence: Array.from({ length: 51 }, () => ({ kind: 'k', label: 'l', value: null })) }],
      }),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      rawRecords.ingestBatch({ records: Array.from({ length: 101 }, () => base) }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects recursive sensitive keys without leaking their values', async () => {
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
    })
    const rawRecords = createHttpValedictorianClient({ baseUrl: server.url }).forWorkspace(
      'workspace-1',
    ).sourcing.rawRecords
    const secretValue = 'must-never-appear-in-error-output'
    const rejectedInputs = [
      { payload: { nested: [{ Access_Token: secretValue }] } },
      {
        evidence: [
          { kind: 'fixture', label: 'nested', value: { wrapper: { 'set.cookie': secretValue } } },
        ],
      },
    ]

    for (const rejected of rejectedInputs) {
      const error = await rawRecords.ingestBatch({
        records: [
          {
            adapter: { id: 'fixture.cli', kind: 'cli', version: '1' },
            observedAt: '2026-07-10T12:00:00.000Z',
            ...rejected,
          },
        ],
      }).catch((caught: unknown) => caught) as ValedictorianHttpError

      expect(error).toMatchObject({ status: 400 })
      expect(JSON.stringify(error.body)).not.toContain(secretValue)
      expect(error.message).not.toContain(secretValue)
    }
  })

  it('rejects credential-bearing HTTP URLs across raw envelopes atomically without echoing credentials', async () => {
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
    })
    const rawRecords = createHttpValedictorianClient({ baseUrl: server.url }).forWorkspace(
      'workspace-1',
    ).sourcing.rawRecords
    const username = 'raw-user-must-not-leak'
    const password = 'raw-password-must-not-leak'
    const credentialUrl = `https://${username}:${password}@jobs.lever.co/acme/job-1`
    const unsafeEnvelopes = [
      { payload: { nested: [{ applicationUrl: credentialUrl }] } },
      { evidence: [{ kind: 'fixture', label: 'nested URL', value: { applicationUrl: credentialUrl } }] },
      { reportedOrigin: { kind: 'job_board' as const, name: 'Fixture', url: credentialUrl } },
      { providerRecordId: credentialUrl },
    ]

    for (const [index, unsafeEnvelope] of unsafeEnvelopes.entries()) {
      const base = {
        adapter: { id: 'fixture.connector', kind: 'connector' as const, version: '1' },
        observedAt: '2026-07-10T12:00:00.000Z',
        providerSchema: 'jobs@1',
      }
      const error = await rawRecords.ingestBatch({ records: [
        { ...base, providerRecordId: `credential-canary-${index}`, payload: { safe: true } },
        { ...base, providerRecordId: `credential-target-${index}`, ...unsafeEnvelope },
      ] }).catch((caught: unknown) => caught) as ValedictorianHttpError

      expect(error).toMatchObject({ status: 400 })
      expect(error.message).not.toContain(username)
      expect(error.message).not.toContain(password)
      expect(JSON.stringify(error.body)).not.toContain(username)
      expect(JSON.stringify(error.body)).not.toContain(password)

      const accepted = await rawRecords.ingestBatch({ records: [
        { ...base, providerRecordId: `credential-canary-${index}`, payload: { safe: true } },
        {
          ...base,
          providerRecordId: `credential-target-${index}`,
          payload: { contact: 'person@example.com', note: 'user:password@jobs.lever.co/acme/job-1' },
        },
      ] })
      expect(accepted.receipts.map(({ revision }) => revision)).toEqual([
        expect.objectContaining({ reused: false, revision: 1 }),
        expect.objectContaining({ reused: false, revision: 1 }),
      ])
      const raw = await rawRecords.get(accepted.receipts[1].rawRecordId)
      const serializedRaw = JSON.stringify(raw)
      expect(serializedRaw).not.toContain(username)
      expect(serializedRaw).not.toContain(password)
      expect(raw.latestRevision.payload).toEqual({
        contact: 'person@example.com', note: 'user:password@jobs.lever.co/acme/job-1',
      })
      const normalization = await rawRecords.normalization.get(accepted.receipts[1].rawRecordId)
      expect(normalization.canonicalCandidate).toBeNull()
      expect(JSON.stringify(normalization)).not.toContain(username)
      expect(JSON.stringify(normalization)).not.toContain(password)
    }
  })

  it('rejects sensitive aliases and unknown properties across the raw envelope atomically', async () => {
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
    })
    const rawRecords = createHttpValedictorianClient({ baseUrl: server.url }).forWorkspace(
      'workspace-1',
    ).sourcing.rawRecords
    const base = {
      adapter: { id: 'fixture.connector', kind: 'connector' as const, version: '1' },
      observedAt: '2026-07-10T12:00:00.000Z',
      providerSchema: 'jobs@1',
    }
    const payloadSecret = 'payload-secret-must-not-leak'
    const payloadError = await rawRecords.ingestBatch({
      records: [
        { ...base, providerRecordId: 'atomic-canary', payload: { safe: true } },
        {
          ...base,
          providerRecordId: 'payload-secret-record',
          payload: { 'X-API-Key': payloadSecret },
        },
      ],
    }).catch((caught: unknown) => caught) as ValedictorianHttpError

    expect(payloadError).toMatchObject({ status: 400 })
    expect(payloadError.message).not.toContain(payloadSecret)
    expect(JSON.stringify(payloadError.body)).not.toContain(payloadSecret)

    const afterRollback = await rawRecords.ingestBatch({
      records: [
        { ...base, providerRecordId: 'atomic-canary', payload: { safe: true } },
        { ...base, providerRecordId: 'payload-secret-record', payload: { sanitized: true } },
      ],
    })

    expect(afterRollback.receipts.map((receipt) => receipt.revision)).toEqual([
      expect.objectContaining({ reused: false, revision: 1 }),
      expect.objectContaining({ reused: false, revision: 1 }),
    ])
    await expect(
      rawRecords.get(afterRollback.receipts[1].rawRecordId),
    ).resolves.toMatchObject({ latestRevision: { payload: { sanitized: true }, revision: 1 } })

    const evidenceSecret = 'evidence-secret-must-not-leak'
    const evidenceError = await rawRecords.ingestBatch({
      records: [
        {
          ...base,
          providerRecordId: 'evidence-secret-record',
          evidence: [
            {
              kind: 'fixture',
              label: 'unsafe envelope',
              value: null,
              'access-token': evidenceSecret,
            },
          ],
        },
      ],
    } as never).catch((caught: unknown) => caught) as ValedictorianHttpError

    expect(evidenceError).toMatchObject({ status: 400 })
    expect(evidenceError.message).not.toContain(evidenceSecret)
    expect(JSON.stringify(evidenceError.body)).not.toContain(evidenceSecret)

    const evidenceAfterRollback = await rawRecords.ingestBatch({
      records: [
        {
          ...base,
          providerRecordId: 'evidence-secret-record',
          evidence: [{ kind: 'fixture', label: 'safe envelope', value: null }],
        },
      ],
    })
    expect(evidenceAfterRollback.receipts[0].revision).toMatchObject({
      reused: false,
      revision: 1,
    })

    await expect(
      rawRecords.ingestBatch({
        records: [
          {
            ...base,
            adapter: { ...base.adapter, displayName: 'unsupported' },
            providerRecordId: 'unknown-envelope-property',
          },
        ],
      } as never),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects a declared raw batch body above 128 MiB before accumulation', async () => {
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
    })

    const response = await new Promise<{ body: string; status: number | undefined }>((resolve, reject) => {
      const request = http.request(
        `${server!.url}/v1/workspaces/workspace-1/sourcing/raw-records/batch`,
        {
          headers: { 'content-length': 128 * 1024 * 1024 + 1, 'content-type': 'application/json' },
          method: 'POST',
        },
        (incoming) => {
          const chunks: Buffer[] = []
          incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
          incoming.on('end', () => resolve({
            body: Buffer.concat(chunks).toString('utf8'),
            status: incoming.statusCode,
          }))
        },
      )
      request.on('error', reject)
      request.end()
    })

    expect(response.status).toBe(413)
    expect(JSON.parse(response.body)).toEqual({ message: 'Request body exceeds the raw batch limit' })
  })

  it('commits raw intake then exposes a passed deterministic normalization result', async () => {
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
    })
    const rawRecords = createHttpValedictorianClient({ baseUrl: server.url }).forWorkspace(
      'workspace-1',
    ).sourcing.rawRecords

    const findingCountBefore = await createHttpValedictorianClient({ baseUrl: server.url })
      .forWorkspace('workspace-1').sourcing.findings.list()
    const intake = await rawRecords.ingestBatch({
      records: [{
        adapter: { id: 'valedictorian.cli', kind: 'cli', version: '0.7.6' },
        observedAt: '2026-07-10T12:00:00.000Z',
        payload: {
          companyName: '  Fixture Robotics  ',
          roleTitle: ' Software Intern ',
          applicationUrl: 'https://boards.greenhouse.io/fixture/jobs/123?ref=source',
          sourceUrl: 'https://Example.com/source?id=42&utm_source=kept#fragment',
        },
      }],
    })
    const result = await rawRecords.normalization.get(intake.receipts[0].rawRecordId)

    expect(result).toMatchObject({
      rawRecordId: intake.receipts[0].rawRecordId,
      rawRevisionId: intake.receipts[0].revision.id,
      canonicalSchemaVersion: 'canonical-source-candidate/v1',
      status: 'completed',
      gate: { status: 'passed', policyVersion: 'sourcing-admission/v1' },
      canonicalCandidate: {
        companyName: 'Fixture Robotics',
        roleTitle: 'Software Intern',
        destination: {
          class: 'employer_or_ats',
          url: 'https://boards.greenhouse.io/fixture/jobs/123',
        },
        sourceUrl: 'https://example.com/source?id=42&utm_source=kept',
      },
    })
    expect(result.attempts.length).toBeGreaterThan(0)
    expect(result.fieldOutcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'companyName', status: 'resolved' }),
      expect.objectContaining({ field: 'roleTitle', status: 'resolved' }),
      expect.objectContaining({ field: 'destinationUrl', status: 'resolved' }),
    ]))
    await expect(createHttpValedictorianClient({ baseUrl: server.url })
      .forWorkspace('workspace-1').sourcing.findings.list()).resolves.toMatchObject({
      total: findingCountBefore.total + 1,
      items: [expect.objectContaining({
        rawRevisionId: intake.receipts[0].revision.id,
        canonicalCandidateId: result.canonicalCandidate?.id,
        employmentType: 'unknown',
        country: null,
        mergeStatus: 'blocked',
        policyBlocker: 'missing_country',
      })],
    })

    await expect(rawRecords.replay({
      selector: { rawRecordIds: ['raw-record-id'] }, invalidate: {},
    })).resolves.toMatchObject({
      replayId: expect.any(String), matchedRawRevisionIds: [], status: 'completed',
    })
  })

  it('persists needs-enrichment across restart and reuses an exact terminal run', async () => {
    const sqlitePath = createTempSqlitePath()
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath }), host: '127.0.0.1', port: 0,
    })
    let rawRecords = createHttpValedictorianClient({ baseUrl: server.url })
      .forWorkspace('workspace-1').sourcing.rawRecords
    const record = {
      adapter: { id: 'fixture.connector', kind: 'connector' as const, version: '1.0.0' },
      providerRecordId: 'missing-destination-1',
      observedAt: '2026-07-10T12:00:00.000Z',
      payload: { companyName: 'Fixture Robotics', roleTitle: 'Software Intern' },
    }
    const first = await rawRecords.ingestBatch({ records: [record] })
    const firstResult = await rawRecords.normalization.get(first.receipts[0].rawRecordId)
    expect(firstResult).toMatchObject({
      status: 'completed',
      gate: { status: 'needs_enrichment', missingFields: ['destinationUrl'] },
      canonicalCandidate: null,
    })

    const second = await rawRecords.ingestBatch({ records: [record] })
    const reused = await rawRecords.normalization.get(second.receipts[0].rawRecordId)
    expect(second.receipts[0].revision.reused).toBe(true)
    expect(reused.attempts.map(({ id }) => id)).toEqual(firstResult.attempts.map(({ id }) => id))
    expect(reused.updatedAt).toBe(firstResult.updatedAt)

    await server.close()
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath }), host: '127.0.0.1', port: 0,
    })
    rawRecords = createHttpValedictorianClient({ baseUrl: server.url })
      .forWorkspace('workspace-1').sourcing.rawRecords
    await expect(rawRecords.normalization.get(first.receipts[0].rawRecordId)).resolves.toEqual(firstResult)
  })

  it('persists a throwing resolver failure without rolling back intake or stopping the batch', async () => {
    const defaults = createDefaultNormalizationResolverRegistry()
    const registry = createNormalizationResolverRegistry([
      {
        declaration: {
          id: 'fixture.throwing', version: '1.0.0',
          supportedAdapters: { ids: ['throw-adapter'] },
          requiredInputs: ['rawRevision'], outputFields: ['companyName'],
          capabilities: ['pure'], costClass: 'none', precedence: 1_000,
        },
        resolve() { throw new Error('synthetic resolver failure') },
      },
      ...defaults.resolvers,
    ])
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath: createTempSqlitePath(), normalizationRegistry: registry }),
      host: '127.0.0.1', port: 0,
    })
    const rawRecords = createHttpValedictorianClient({ baseUrl: server.url })
      .forWorkspace('workspace-1').sourcing.rawRecords
    const common = {
      observedAt: '2026-07-10T12:00:00.000Z',
      payload: { companyName: 'Fixture', roleTitle: 'Intern', applicationUrl: 'https://jobs.lever.co/fixture/job-123' },
    }
    const intake = await rawRecords.ingestBatch({ records: [
      { ...common, adapter: { id: 'throw-adapter', kind: 'manual', version: '1.0.0' } },
      { ...common, adapter: { id: 'safe-adapter', kind: 'manual', version: '1.0.0' } },
    ] })

    expect(intake.receipts).toHaveLength(2)
    await expect(rawRecords.get(intake.receipts[0].rawRecordId)).resolves.toBeTruthy()
    await expect(rawRecords.get(intake.receipts[1].rawRecordId)).resolves.toBeTruthy()
    await expect(rawRecords.normalization.get(intake.receipts[0].rawRecordId)).resolves.toMatchObject({
      status: 'failed', gate: { status: 'failed', candidate: null },
      attempts: expect.arrayContaining([expect.objectContaining({ resolver: expect.objectContaining({ id: 'fixture.throwing' }), status: 'failed' })]),
    })
    await expect(rawRecords.normalization.get(intake.receipts[1].rawRecordId)).resolves.toMatchObject({
      status: 'completed', gate: { status: 'passed' },
    })

    const replay = await rawRecords.replay({
      selector: { rawRevisionIds: intake.receipts.map(({ revision }) => revision.id) },
      invalidate: {},
    })
    expect(replay).toMatchObject({
      status: 'completed_with_failures',
      matchedRawRevisionIds: expect.arrayContaining(intake.receipts.map(({ revision }) => revision.id)),
      items: expect.arrayContaining([
        {
          status: 'failed', rawRecordId: intake.receipts[0].rawRecordId,
          rawRevisionId: intake.receipts[0].revision.id,
          normalizationRunId: expect.any(String),
          failure: { code: 'normalization_failed', retryable: false },
        },
        {
          status: 'completed', rawRecordId: intake.receipts[1].rawRecordId,
          rawRevisionId: intake.receipts[1].revision.id,
          normalizationRunId: expect.any(String),
        },
      ]),
    })
    expect(JSON.stringify(replay)).not.toContain('synthetic resolver failure')
  })

  it('returns persisted replay conflicts through the typed workspace client', async () => {
    const companyResolver = (id: string, companyName: string) => ({
      declaration: {
        id, version: '1.0.0', requiredInputs: ['rawRevision'], outputFields: ['companyName'] as const,
        capabilities: ['pure'] as const, costClass: 'none' as const, precedence: 1_000,
      },
      resolve(context: Parameters<ReturnType<typeof createDefaultNormalizationResolverRegistry>['resolvers'][number]['resolve']>[0]) {
        return [{
          resolverId: id, resolverVersion: '1.0.0', field: 'companyName' as const,
          inputHash: context.hashInput(companyName), status: 'resolved' as const,
          value: companyName, confidence: 0.8,
        }]
      },
    })
    const defaultsWithoutCompany = createDefaultNormalizationResolverRegistry().resolvers
      .filter(({ declaration }) => declaration.id !== 'deterministic.explicit-company')
    const registry = createNormalizationResolverRegistry([
      companyResolver('fixture.http-company-a', 'HTTP Company A'),
      companyResolver('fixture.http-company-b', 'HTTP Company B'),
      ...defaultsWithoutCompany,
    ])
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath: createTempSqlitePath(), normalizationRegistry: registry }),
      host: '127.0.0.1', port: 0,
    })
    const rawRecords = createHttpValedictorianClient({ baseUrl: server.url })
      .forWorkspace('workspace-1').sourcing.rawRecords
    const intake = await rawRecords.ingestBatch({ records: [{
      adapter: { id: 'manual', kind: 'manual', version: '1.0.0' },
      observedAt: '2026-07-10T12:00:00.000Z',
      payload: { title: 'Intern', url: 'https://jobs.lever.co/acme/http-conflict' },
    }] })

    await expect(rawRecords.replay({
      selector: { rawRevisionIds: [intake.receipts[0].revision.id] }, invalidate: {},
    })).resolves.toMatchObject({
      status: 'completed', items: [expect.objectContaining({ status: 'completed' })],
    })
    await expect(rawRecords.normalization.get(intake.receipts[0].rawRecordId)).resolves.toMatchObject({
      canonicalCandidate: null,
      gate: { status: 'needs_enrichment', conflictingFields: ['companyName'] },
      fieldOutcomes: expect.arrayContaining([expect.objectContaining({
        field: 'companyName', status: 'conflict', values: ['HTTP Company A', 'HTTP Company B'],
      })]),
    })
  })

  it('keeps persisted normalization isolated behind encoded workspace routes', async () => {
    const firstClient = createLocalValedictorianClient({ sqlitePath: createTempSqlitePath(), workspaceId: 'workspace / one' })
    const secondClient = createLocalValedictorianClient({ sqlitePath: createTempSqlitePath(), workspaceId: 'workspace / two' })
    server = await createValedictorianHttpServer({
      client: firstClient, host: '127.0.0.1', port: 0,
      resolveWorkspaceClient: (workspaceId) => workspaceId === 'workspace / one' ? firstClient : secondClient,
    })
    const root = createHttpValedictorianClient({ baseUrl: server.url })
    const first = root.forWorkspace('workspace / one').sourcing.rawRecords
    const second = root.forWorkspace('workspace / two').sourcing.rawRecords
    const intake = await first.ingestBatch({ records: [{
      adapter: { id: 'manual', kind: 'manual', version: '1.0.0' }, observedAt: '2026-07-10T12:00:00.000Z',
      payload: { company: 'Acme', title: 'Intern', url: 'https://jobs.lever.co/acme/job-1' },
    }] })
    await expect(first.normalization.get(intake.receipts[0].rawRecordId)).resolves.toMatchObject({ status: 'completed' })
    await expect(second.normalization.get(intake.receipts[0].rawRecordId)).rejects.toMatchObject({ status: 404 })
  })

  it('persists exact replay history across restart without crossing workspace boundaries', async () => {
    const firstPath = createTempSqlitePath()
    const firstClient = createLocalValedictorianClient({ sqlitePath: firstPath, workspaceId: 'workspace / one' })
    const secondClient = createLocalValedictorianClient({ sqlitePath: createTempSqlitePath(), workspaceId: 'workspace / two' })
    server = await createValedictorianHttpServer({
      client: firstClient, host: '127.0.0.1', port: 0,
      resolveWorkspaceClient: (workspaceId) => workspaceId === 'workspace / one' ? firstClient : secondClient,
    })
    let root = createHttpValedictorianClient({ baseUrl: server.url })
    let first = root.forWorkspace('workspace / one').sourcing.rawRecords
    const second = root.forWorkspace('workspace / two').sourcing.rawRecords
    const intake = await first.ingestBatch({ records: [{
      adapter: { id: 'manual', kind: 'manual', version: '1.0.0' },
      observedAt: '2026-07-10T12:00:00.000Z',
      payload: { company: 'Acme', title: 'Intern', url: 'https://jobs.lever.co/acme/job-replay' },
    }] })
    const before = await first.normalization.get(intake.receipts[0].rawRecordId)

    await expect(first.replay({
      selector: {
        rawRecordIds: [intake.receipts[0].rawRecordId],
        rawRevisionIds: ['another-revision'],
      },
      invalidate: {},
    })).resolves.toMatchObject({ matchedRawRevisionIds: [] })
    await expect(second.replay({
      selector: { rawRevisionIds: [intake.receipts[0].revision.id] }, invalidate: {},
    })).resolves.toMatchObject({ matchedRawRevisionIds: [] })
    await expect(first.replay({
      selector: { rawRevisionIds: [intake.receipts[0].revision.id] },
      invalidate: { canonicalSchemaVersions: ['canonical-source-candidate/v0'] },
    })).resolves.toMatchObject({ matchedRawRevisionIds: [], items: [] })
    expect((await first.normalization.get(intake.receipts[0].rawRecordId)).attempts
      .map(({ id }) => id)).toEqual(before.attempts.map(({ id }) => id))

    await first.replay({
      selector: { rawRevisionIds: [intake.receipts[0].revision.id] }, invalidate: {},
      fieldDirectives: [{
        action: 'suppress', field: 'companyName', reason: 'HTTP suppression proof',
        inputHash: `sha256:${'e'.repeat(64)}`, policyVersion: 'user-suppression/v1',
      }],
    })
    await expect(first.normalization.get(intake.receipts[0].rawRecordId)).resolves.toMatchObject({
      canonicalCandidate: null,
      gate: { status: 'needs_enrichment', missingFields: ['companyName'] },
      fieldOutcomes: expect.arrayContaining([expect.objectContaining({
        field: 'companyName', status: 'suppressed', policyVersion: 'user-suppression/v1',
      })]),
    })

    const receipt = await first.replay({
      selector: { rawRevisionIds: [intake.receipts[0].revision.id] }, invalidate: {},
      fieldDirectives: [{
        action: 'lock', field: 'companyName', value: 'HTTP Replacement',
        reason: 'HTTP lock proof', inputHash: `sha256:${'f'.repeat(64)}`,
        policyVersion: 'user-lock/v2',
      }],
    })
    expect(receipt).toMatchObject({
      matchedRawRevisionIds: [intake.receipts[0].revision.id], status: 'completed',
      completedAt: expect.any(String),
      items: [{
        status: 'completed', rawRecordId: intake.receipts[0].rawRecordId,
        rawRevisionId: intake.receipts[0].revision.id,
        normalizationRunId: expect.any(String),
      }],
    })
    const replayed = await first.normalization.get(intake.receipts[0].rawRecordId)
    expect(replayed.canonicalCandidate?.companyName).toBe('HTTP Replacement')
    expect(replayed.attempts.map(({ id }) => id)).not.toEqual(before.attempts.map(({ id }) => id))

    await server.close()
    const restarted = createLocalValedictorianClient({ sqlitePath: firstPath, workspaceId: 'workspace / one' })
    server = await createValedictorianHttpServer({ client: restarted, host: '127.0.0.1', port: 0 })
    root = createHttpValedictorianClient({ baseUrl: server.url })
    first = root.forWorkspace('workspace / one').sourcing.rawRecords
    await expect(first.normalization.get(intake.receipts[0].rawRecordId)).resolves.toEqual(replayed)
  })

  it('bounds replay request bodies before parsing or persistence', async () => {
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
    })

    const response = await fetch(
      `${server.url}/v1/workspaces/workspace-1/sourcing/raw-records/replay`,
      {
        body: 'x'.repeat(1024 * 1024 + 1),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      },
    )

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({
      message: 'Request body exceeds the raw replay limit',
    })
  })
})

function createTempSqlitePath() {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-raw-http-')),
    'valedictorian.sqlite',
  )
}
