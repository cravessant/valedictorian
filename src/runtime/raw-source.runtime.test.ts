import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createLocalValedictorianClient } from './local-valedictorian-client'
import { createConnectorCaptureFixture } from '../test-fixtures/connector-capture.fixture'

describe('local raw source runtime', () => {
  it('wires raw source persistence to deterministic normalization', async () => {
    const client = createLocalValedictorianClient({
      pgliteDataPath: fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-raw-runtime-')),
      workspaceId: 'workspace-1',
    })
    const result = await client.sourcing.rawRecords.ingestBatch({
      records: [
        {
          adapter: { id: 'fixture.import', kind: 'import', version: '1' },
          observedAt: '2026-07-10T12:00:00.000Z',
          payload: { imported: true },
        },
      ],
    })

    await expect(client.sourcing.rawRecords.get(result.receipts[0].rawRecordId)).resolves.toMatchObject({
      latestRevision: { payload: { imported: true } },
    })
    await expect(
      client.sourcing.rawRecords.normalization.get(result.receipts[0].rawRecordId),
    ).resolves.toMatchObject({
      status: 'completed',
      triggerOccurrence: null,
      gate: {
        status: 'needs_enrichment',
        missingFields: ['canonicalIdentity', 'companyName', 'roleTitle', 'destinationUrl'],
      },
      canonicalCandidate: null,
    })
  })

  it('keeps cached normalization trigger-free while connector capture remains complete', async () => {
    const pgliteDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-raw-runtime-'))
    const client = createLocalValedictorianClient({ pgliteDataPath })
    const capture = await createConnectorCaptureFixture(pgliteDataPath, 'fixture.connector', '1')
    const record = {
      adapter: { id: 'fixture.connector', kind: 'connector' as const, version: '1' },
      capture,
      observedAt: '2026-07-10T12:00:00.000Z',
      providerRecordId: 'job-1',
      providerSchema: 'fixture@1',
      payload: { companyName: 'Fixture', roleTitle: 'Intern' },
    }
    const first = await client.sourcing.rawRecords.ingestBatch({ records: [record] })
    const second = await client.sourcing.rawRecords.ingestBatch({ records: [record] })

    expect(second.receipts[0].revision).toMatchObject({
      id: first.receipts[0].revision.id,
      reused: true,
    })
    await expect(client.sourcing.rawRecords.normalization.get(
      first.receipts[0].rawRecordId,
    )).resolves.toMatchObject({ triggerOccurrence: null })
  })
})
