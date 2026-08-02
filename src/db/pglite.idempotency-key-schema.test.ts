import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPgliteClient, migratePgliteDatabase, type PgliteClient } from '@sparxie/valedictorian-local-runtime/database'

/**
 * #304 (stage 2) schema proof for the create-dedup `idempotency_key` column and
 * partial unique index on the four canonical lifecycle aggregates. Raw SQL at the
 * PGlite seam so it asserts the physical constraint the baseline must ship,
 * independent of the Drizzle query layer.
 */
const T = '2026-07-20T00:00:00.000Z'
const jobId = (index: number) => `017f22e2-79b0-7cc3-98c4-dc0c0c07${index.toString(16).padStart(4, '0')}`

async function insertCapture(client: PgliteClient, id: string, workspaceId: string, key: string | null) {
  const keyLit = key === null ? 'null' : `'${key}'`
  await client.query(
    `insert into captures (
       id, workspace_id, evidence_mode, adapter_id, adapter_kind, adapter_version,
       observed_at, received_at, provider_record_id, provider_schema, payload_json,
       revision, created_at, updated_at, idempotency_key
     ) values ('${id}', '${workspaceId}', 'reported', 'adapter-1', 'connector', '1',
       '${T}', '${T}', null, null, null, 1, '${T}', '${T}', ${keyLit})`,
  )
}
async function insertJob(client: PgliteClient, id: string, workspaceId: string, key: string | null) {
  const keyLit = key === null ? 'null' : `'${key}'`
  await client.query(
    `insert into jobs (
       id, workspace_id, facts_revision, facts_json, availability_state, availability_observed_at,
       availability_revision, created_at, updated_at, idempotency_key
     ) values ('${id}', '${workspaceId}', 1, '{}', 'open', '${T}', 1, '${T}', '${T}', ${keyLit})`,
  )
}
async function insertOpportunity(client: PgliteClient, id: string, workspaceId: string, jId: string, key: string | null) {
  const keyLit = key === null ? 'null' : `'${key}'`
  await client.query(
    `insert into opportunities (
       id, workspace_id, job_id, revision, fit, rank, cutoff, disposition, override_json,
       created_at, updated_at, idempotency_key
     ) values ('${id}', '${workspaceId}', '${jId}', 1, 'fit', null, 'above', 'reviewing', null,
       '${T}', '${T}', ${keyLit})`,
  )
}
async function insertApplication(client: PgliteClient, id: string, workspaceId: string, oppId: string, jId: string, key: string | null) {
  const keyLit = key === null ? 'null' : `'${key}'`
  await client.query(
    `insert into applications (
       id, workspace_id, opportunity_id, job_id, revision, status, job_facts_revision,
       snapshot_json, company_name, source_name, created_at, updated_at, idempotency_key
     ) values ('${id}', '${workspaceId}', '${oppId}', '${jId}', 1, 'active', 1,
       '{}', 'Acme', 'src', '${T}', '${T}', ${keyLit})`,
  )
}

describe('lifecycle idempotency_key schema (0003)', () => {
  let client: PgliteClient
  beforeAll(async () => {
    client = await createPgliteClient()
    await migratePgliteDatabase(client)
    for (const ws of ['ws-1', 'ws-2']) {
      await client.query(`insert into workspaces (id, name, created_at, updated_at) values ('${ws}', '${ws}', '${T}', '${T}')`)
    }
  })
  afterAll(async () => { await client.close() })

  it('adds an idempotency_key column to every canonical aggregate', async () => {
    const { rows } = await client.query<{ table_name: string }>(
      `select table_name from information_schema.columns
       where column_name = 'idempotency_key'
         and table_name in ('captures','jobs','opportunities','applications')`,
    )
    expect(new Set(rows.map((r) => r.table_name))).toEqual(
      new Set(['captures', 'jobs', 'opportunities', 'applications']),
    )
  })

  it('uniques a captured idempotency key within a workspace but excludes nulls and scopes to workspace', async () => {
    await insertCapture(client, 'cap-a', 'ws-1', 'key-1')
    // Same (workspace, key) collides.
    await expect(insertCapture(client, 'cap-b', 'ws-1', 'key-1')).rejects.toThrow()
    // Different workspace may reuse the same key.
    await insertCapture(client, 'cap-c', 'ws-2', 'key-1')
    // Null keys never collide (partial index excludes them).
    await insertCapture(client, 'cap-d', 'ws-1', null)
    await insertCapture(client, 'cap-e', 'ws-1', null)
  })

  it('enforces the partial unique index on jobs, opportunities, and applications', async () => {
    await insertJob(client, jobId(1), 'ws-1', 'jk-1')
    await expect(insertJob(client, jobId(2), 'ws-1', 'jk-1')).rejects.toThrow()

    await insertJob(client, jobId(3), 'ws-1', null)
    await insertOpportunity(client, 'opp-a', 'ws-1', jobId(3), 'ok-1')
    await expect(insertOpportunity(client, 'opp-b', 'ws-1', jobId(3), 'ok-1')).rejects.toThrow()

    await insertApplication(client, 'app-a', 'ws-1', 'opp-a', jobId(3), 'ak-1')
    await expect(insertApplication(client, 'app-b', 'ws-1', 'opp-a', jobId(3), 'ak-1')).rejects.toThrow()
  })

  it('bounds the idempotency key length', async () => {
    await expect(insertCapture(client, 'cap-empty', 'ws-1', '')).rejects.toThrow()
    await expect(insertCapture(client, 'cap-long', 'ws-1', 'x'.repeat(201))).rejects.toThrow()
  })
})
