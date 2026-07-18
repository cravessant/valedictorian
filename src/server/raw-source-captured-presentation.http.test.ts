import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHttpValedictorianClient } from 'sparxie'
import { afterEach, describe, expect, it } from 'vitest'
import { presentCapturedRawFacts } from '../modules/sourcing/raw-captured-presentation'
import { createLocalValedictorianClient } from './local-valedictorian-client.test-harness'
import { createConnectorCaptureFixture } from '../test-fixtures/connector-capture.fixture'
import {
  LEGACY_NESTED_JOBRIGHT_PAYLOAD,
} from '../test-fixtures/legacy-raw-source.fixture'
import { createValedictorianHttpServer, type StartedValedictorianHttpServer } from './local-server'

describe('raw source captured presentation HTTP boundary', () => {
  let server: StartedValedictorianHttpServer | null = null

  afterEach(async () => {
    await server?.close()
    server = null
  })

  it('aligns list and detail captured title/company for nested Jobright evidence', async () => {
    const pgliteDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'raw-captured-presentation-'))
    const capture = await createConnectorCaptureFixture(pgliteDataPath, 'jobright', '0.11.0')
    const local = await createLocalValedictorianClient({
      pgliteDataPath,
      now: () => new Date('2026-07-13T18:00:00.000Z'),
    })
    const nestedJobrightPayload = {
      decodingStatus: 'valid',
      rawType: 'object',
      providerJobId: 'consigli-coop-2027',
      providerRow: {
        jobResult: {
          jobId: 'consigli-coop-2027',
          jobTitle: 'IT Co-op (Spring 2027)',
          companyName: 'Consigli Construction Co., Inc.',
        },
        companyResult: {
          companyName: 'Consigli Construction Co., Inc.',
        },
      },
    }
    const intake = await local.sourcing.rawRecords.ingestBatch({
      records: [{
        adapter: { id: 'jobright', kind: 'connector', version: '0.11.0' },
        capture: {
          connectorInstanceId: capture.connectorInstanceId,
          connectorRunId: capture.connectorRunId,
          executionScopeId: capture.executionScopeId,
        },
        observedAt: '2026-07-13T17:30:00.000Z',
        providerRecordId: 'consigli-coop-2027',
        providerSchema: 'jobright-visitor-list@1',
        reportedOrigin: { kind: 'aggregator', name: 'Jobright', providerId: 'jobright' },
        payload: nestedJobrightPayload,
      }],
    })
    const rawRecordId = intake.receipts[0].rawRecordId
    server = await createValedictorianHttpServer({ client: local, host: '127.0.0.1', port: 0 })
    const rawRecords = createHttpValedictorianClient({ baseUrl: server.url })
      .forWorkspace('workspace-1')
      .sourcing
      .rawRecords

    const listed = await rawRecords.list({ adapterId: 'jobright' })
    const detail = await rawRecords.get(rawRecordId)
    const captured = presentCapturedRawFacts(detail.latestRevision.payload)

    expect(listed.items).toEqual([expect.objectContaining({
      id: rawRecordId,
      roleTitle: 'IT Co-op (Spring 2027)',
      companyName: 'Consigli Construction Co., Inc.',
    })])
    expect(captured).toEqual({
      title: 'IT Co-op (Spring 2027)',
      company: 'Consigli Construction Co., Inc.',
    })
    expect(listed.items[0]?.roleTitle).toBe(captured.title)
    expect(listed.items[0]?.companyName).toBe(captured.company)
    expect(detail.latestRevision.payload).toEqual(expect.objectContaining(nestedJobrightPayload))
    expect(listed.items[0]?.canonicalCandidateId).toBeNull()
  })

  it('aligns list and detail captured facts for a legacy-version nested Jobright revision', async () => {
    const pgliteDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'raw-captured-migrated-jobright-'))
    const capture = await createConnectorCaptureFixture(pgliteDataPath, 'jobright', '0.11.0')
    const local = await createLocalValedictorianClient({
      pgliteDataPath,
      seedDataMode: 'none',
      now: () => new Date('2026-07-13T18:00:00.000Z'),
    })
    const intake = await local.sourcing.rawRecords.ingestBatch({
      records: [{
        adapter: { id: 'jobright', kind: 'connector', version: '0.11.0' },
        capture: {
          connectorInstanceId: capture.connectorInstanceId,
          connectorRunId: capture.connectorRunId,
          executionScopeId: capture.executionScopeId,
        },
        observedAt: '2026-07-10T12:00:00.000Z',
        providerRecordId: 'consigli-coop-2027',
        providerSchema: 'jobright-visitor-list@1',
        payload: LEGACY_NESTED_JOBRIGHT_PAYLOAD,
      }],
    })
    const rawRecordId = intake.receipts[0].rawRecordId
    server = await createValedictorianHttpServer({ client: local, host: '127.0.0.1', port: 0 })
    const rawRecords = createHttpValedictorianClient({ baseUrl: server.url })
      .forWorkspace('workspace-1')
      .sourcing
      .rawRecords

    const listed = await rawRecords.list({ adapterId: 'jobright' })
    const detail = await rawRecords.get(rawRecordId)
    const captured = presentCapturedRawFacts(detail.latestRevision.payload)

    expect(listed.items).toEqual(expect.arrayContaining([expect.objectContaining({
      id: rawRecordId,
      roleTitle: 'IT Co-op (Spring 2027)',
      companyName: 'Consigli Construction Co., Inc.',
      canonicalCandidateId: null,
    })]))
    expect(captured).toEqual({
      title: 'IT Co-op (Spring 2027)',
      company: 'Consigli Construction Co., Inc.',
    })
    expect(listed.items.find(({ id }) => id === rawRecordId)?.roleTitle)
      .toBe(captured.title)
    expect(listed.items.find(({ id }) => id === rawRecordId)?.companyName)
      .toBe(captured.company)
    expect(detail.latestRevision.payload).toEqual(LEGACY_NESTED_JOBRIGHT_PAYLOAD)
  })

  it('keeps sparse raw captures missing title and company without throwing', async () => {
    const pgliteDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'raw-captured-sparse-'))
    const local = await createLocalValedictorianClient({
      pgliteDataPath,
      now: () => new Date('2026-07-13T18:00:00.000Z'),
    })
    const intake = await local.sourcing.rawRecords.ingestBatch({
      records: [{
        adapter: { id: 'fixture.cli', kind: 'cli', version: '1.0.0' },
        observedAt: '2026-07-13T17:30:00.000Z',
        payload: { arbitrary: { note: 'no title or company' } },
      }],
    })
    server = await createValedictorianHttpServer({ client: local, host: '127.0.0.1', port: 0 })
    const rawRecords = createHttpValedictorianClient({ baseUrl: server.url })
      .forWorkspace('workspace-1')
      .sourcing
      .rawRecords

    const listed = await rawRecords.list()
    const detail = await rawRecords.get(intake.receipts[0].rawRecordId)
    const captured = presentCapturedRawFacts(detail.latestRevision.payload)

    expect(listed.items).toEqual([expect.objectContaining({
      id: intake.receipts[0].rawRecordId,
      roleTitle: null,
      companyName: null,
    })])
    expect(captured).toEqual({ title: null, company: null })
  })

})
