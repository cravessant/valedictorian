import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createLocalValedictorianClient } from './local-valedictorian-client'

describe('local raw source runtime', () => {
  it('wires raw source persistence without enabling normalization execution', async () => {
    const client = createLocalValedictorianClient({
      sqlitePath: path.join(
        fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-raw-runtime-')),
        'valedictorian.sqlite',
      ),
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
    ).rejects.toMatchObject({ code: 'capability_unavailable', statusCode: 501 })
  })
})
