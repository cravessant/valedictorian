import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createPgliteClient,
  migratePgliteDatabase,
  resolvePgliteMigrationsFolder,
  type PgliteClient,
} from './pglite'

async function applyMigrationsThrough(client: PgliteClient, maxIndex: number) {
  const fullFolder = resolvePgliteMigrationsFolder()
  const tempFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-capture-field-migration-'))
  fs.mkdirSync(path.join(tempFolder, 'meta'), { recursive: true })
  const journal = JSON.parse(fs.readFileSync(path.join(fullFolder, 'meta', '_journal.json'), 'utf8')) as {
    entries: Array<{ idx: number; tag: string }>
  }
  journal.entries = journal.entries.filter((entry) => entry.idx <= maxIndex)
  for (const entry of journal.entries) {
    fs.copyFileSync(path.join(fullFolder, `${entry.tag}.sql`), path.join(tempFolder, `${entry.tag}.sql`))
    const snapshotName = `${entry.idx.toString().padStart(4, '0')}_snapshot.json`
    const snapshotPath = path.join(fullFolder, 'meta', snapshotName)
    if (fs.existsSync(snapshotPath)) fs.copyFileSync(snapshotPath, path.join(tempFolder, 'meta', snapshotName))
  }
  fs.writeFileSync(path.join(tempFolder, 'meta', '_journal.json'), JSON.stringify(journal))
  try {
    await migratePgliteDatabase(client, { migrationsFolder: tempFolder })
  } finally {
    fs.rmSync(tempFolder, { recursive: true, force: true })
  }
}

describe.sequential('capture field-outcomes migration', () => {
  const clients: PgliteClient[] = []

  afterEach(async () => {
    while (clients.length > 0) await clients.pop()!.close()
  })

  it('backfills only the founding revision even when the Capture head has advanced', async () => {
    const client = await createPgliteClient()
    clients.push(client)
    await applyMigrationsThrough(client, 5)
    const timestamp = '2026-07-22T00:00:00.000Z'
    const payload = JSON.stringify({ providerRow: { jobResult: { jobId: 'legacy-1', jobLocation: 'Toronto, Canada' } } })
    const laterPayload = JSON.stringify({ providerRow: { jobResult: { jobId: 'legacy-2', jobLocation: 'Vancouver, Canada' } } })
    await client.query(`
      insert into workspaces (id, name, created_at, updated_at)
      values ('ws-field-migration', 'Migration', '${timestamp}', '${timestamp}')
    `)
    await client.query(`
      insert into captures (
        id, workspace_id, evidence_mode, adapter_id, adapter_kind, adapter_version,
        observed_at, received_at, provider_record_id, provider_schema, payload_json,
        revision, created_at, updated_at
      ) values
      (
        'capture-field-migration', 'ws-field-migration', 'reported', 'jobright.resolver',
        'connector', '0.17.0', '${timestamp}', '${timestamp}', 'legacy-1',
        'jobright-authenticated-search@1', '${payload}', 1, '${timestamp}', '${timestamp}'
      ),
      (
        'capture-field-migration-later', 'ws-field-migration', 'reported', 'jobright.resolver',
        'connector', '0.17.0', '${timestamp}', '${timestamp}', 'legacy-2',
        'jobright-authenticated-search@1', '${laterPayload}', 2, '${timestamp}', '${timestamp}'
      )
    `)
    await client.query(`
      insert into capture_revisions (
        capture_id, revision, kind, snapshot_json, audit_json, content_hash, created_at
      ) values
        ('capture-field-migration', 1, 'created', '{}', '{}', 'hash-1', '${timestamp}'),
        ('capture-field-migration-later', 1, 'created', '{}', '{}', 'hash-2', '${timestamp}'),
        ('capture-field-migration-later', 2, 'corrected', '{}', '{}', 'hash-3', '${timestamp}')
    `)

    await migratePgliteDatabase(client)

    const result = await client.query<{ revision: number; payload_json: string | null }>(`
      select revision, payload_json
      from capture_revisions
      where capture_id in ('capture-field-migration', 'capture-field-migration-later')
      order by capture_id, revision
    `)
    expect(result.rows).toEqual([
      { revision: 1, payload_json: payload },
      { revision: 1, payload_json: laterPayload },
      { revision: 2, payload_json: null },
    ])
  })
})
