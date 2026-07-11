import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createHttpValedictorianClient, ValedictorianHttpError } from 'sparxie'
import { afterEach, describe, expect, it } from 'vitest'
import { createLocalValedictorianClient } from '../runtime/local-valedictorian-client'
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

  it('reports normalization and replay as capability unavailable', async () => {
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
    })
    const rawRecords = createHttpValedictorianClient({ baseUrl: server.url }).forWorkspace(
      'workspace-1',
    ).sourcing.rawRecords

    await expect(rawRecords.normalization.get('raw-record-id')).rejects.toMatchObject({
      status: 501,
      body: {
        code: 'capability_unavailable',
        message: 'Raw source normalization is unavailable in the local backend',
      },
    })
    await expect(
      rawRecords.replay({ selector: { rawRecordIds: ['raw-record-id'] }, invalidate: {} }),
    ).rejects.toMatchObject({
      status: 501,
      body: {
        code: 'capability_unavailable',
        message: 'Raw source replay is unavailable in the local backend',
      },
    })
  })

  it('bounds unsupported replay request bodies before returning capability unavailable', async () => {
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
