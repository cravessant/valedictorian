import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createHttpValedictorianClient,
  InvalidPersistedRawDetailHttpError,
  invalidPersistedRawDetailErrorBody,
} from 'sparxie'
import { afterEach, describe, expect, it } from 'vitest'
import { createLocalValedictorianClient } from '../runtime/local-valedictorian-client'
import { createValedictorianHttpServer, type StartedValedictorianHttpServer } from './local-server'

describe('raw source detail HTTP response boundary', () => {
  let server: StartedValedictorianHttpServer | null = null

  afterEach(async () => {
    await server?.close()
    server = null
  })

  it('returns a sanitized server-integrity error for contract-invalid persisted detail', async () => {
    const pgliteDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'raw-detail-boundary-'))
    const client = createLocalValedictorianClient({ pgliteDataPath })
    client.sourcing.rawRecords.get = async () => ({
      id: 'invalid-record',
      sourceEntityId: null,
      adapter: { id: 'fixture.connector', kind: 'connector', version: '1.0.0' },
      reportedOrigin: null,
      createdAt: '2026-07-10T12:00:00.000Z',
      latestRevision: {
        id: 'invalid-revision', rawRecordId: 'invalid-record', revision: 1,
        contentHash: 'sha256:invalid',
        adapter: { id: 'fixture.connector', kind: 'connector', version: '1.0.0' },
        reportedOrigin: null, observedAt: '2026-07-10T12:00:00.000Z',
        providerRecordId: null, providerSchema: null, payload: null, evidence: [],
        createdAt: '2026-07-10T12:00:00.000Z',
      },
      occurrences: [{
        id: 'invalid-occurrence', rawRecordId: 'invalid-record',
        rawRevisionId: 'invalid-revision', capture: null,
        observedAt: '2026-07-10T12:00:00.000Z', receivedAt: '2026-07-10T12:00:00.000Z',
      }],
    } as never)
    server = await createValedictorianHttpServer({ client, host: '127.0.0.1', port: 0 })

    const response = await fetch(
      `${server.url}/v1/workspaces/workspace-1/sourcing/raw-records/invalid-record`,
    )

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toEqual(invalidPersistedRawDetailErrorBody)
    expect(JSON.stringify(body)).not.toContain('capture lineage must agree')
    expect(JSON.stringify(body)).not.toContain('Zod')
    const error = await createHttpValedictorianClient({ baseUrl: server.url })
      .forWorkspace('workspace-1')
      .sourcing.rawRecords.get('invalid-record')
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(InvalidPersistedRawDetailHttpError)
    expect(error).toMatchObject({
      status: 500,
      body: invalidPersistedRawDetailErrorBody,
      message: invalidPersistedRawDetailErrorBody.message,
    })
  })
})
