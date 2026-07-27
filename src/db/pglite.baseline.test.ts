import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getTableName } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { createPgliteClient, migratePgliteDatabase, type PgliteClient } from './pglite'
import { schema } from './schema'
import { DEFAULT_WORKSPACE_ID } from './workspaces.schema'
import { BASELINE_TAG, TRIGGER_SOURCE_PATH } from '../../scripts/generate-database-baseline'

/**
 * Fresh-database proofs for the single generated baseline: the installed shape is
 * the mapped ORM schema, and the retained triggers Drizzle Kit cannot model are
 * installed and enforcing.
 */
const T = '2026-07-26T00:00:00.000Z'
const repoRoot = path.resolve('.')
const triggerSource = fs.readFileSync(path.join(repoRoot, TRIGGER_SOURCE_PATH), 'utf8')

function declaredNames(pattern: RegExp) {
  return [...triggerSource.matchAll(pattern)].map((match) => match[1]!).sort()
}

async function publicTables(client: PgliteClient) {
  const result = await client.query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'public' order by tablename`,
  )
  return result.rows.map((row) => row.tablename)
}

function insertConnectorRun(run: { scopeId: string; status?: string }) {
  return `insert into connector_runs
    (id, execution_scope_id, connector_instance_id, mode, status, started_at, config_json,
     filters_json, filter_signature, observation_count, warning_count, stats_json,
     warnings_json, retry_hints_json, created_at, updated_at)
  values ('run-one', '${run.scopeId}', 'one', 'manual', '${run.status ?? 'queued'}', '${T}',
    '{}', '{}', 'filters:{}', 0, 0, '{}', '[]', 'null', '${T}', '${T}')`
}

describe.sequential('PGlite database baseline', () => {
  const cleanups: Array<() => void | Promise<void>> = []

  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!()
  })

  async function migrated(dataDir?: string) {
    const client = await createPgliteClient(dataDir ? { dataDir } : {})
    cleanups.push(() => (client.closed ? undefined : client.close()))
    await migratePgliteDatabase(client)
    return client
  }

  async function migratedWithConnectorInstance() {
    const client = await migrated()
    await client.query(
      `insert into source_execution_scopes (id, status, backoff_attempt, auth_generation, created_at, updated_at)
       values
         ('scope-oneaaaa', 'available', 0, 0, '${T}', '${T}'),
         ('scope-twoaaaa', 'available', 0, 0, '${T}', '${T}')`,
    )
    await client.query(
      `insert into connector_instances
         (id, execution_scope_id, connector_id, connector_version, display_name, enabled,
          config_json, auth_json, filters_json, created_at, updated_at)
       values ('one', 'scope-oneaaaa', 'fixture', '1', 'One', true, '{}', '[]', '{}', '${T}', '${T}')`,
    )
    return client
  }

  it('journals one entry whose generated portion declares no lower-level safeguards', () => {
    const drizzleDir = path.join(repoRoot, 'drizzle')
    expect(fs.readdirSync(drizzleDir).filter((name) => name.endsWith('.sql')))
      .toEqual([`${BASELINE_TAG}.sql`])
    const journal = JSON.parse(
      fs.readFileSync(path.join(drizzleDir, 'meta', '_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string }> }
    expect(journal.entries.map((entry) => entry.tag)).toEqual([BASELINE_TAG])

    const baseline = fs.readFileSync(path.join(drizzleDir, `${BASELINE_TAG}.sql`), 'utf8')
    expect(baseline.endsWith(`${triggerSource.trimEnd()}\n`)).toBe(true)
    const generated = baseline.slice(0, baseline.length - triggerSource.trimEnd().length)
    expect(generated).not.toMatch(/CREATE (?:OR REPLACE FUNCTION|TRIGGER)/)
  })

  it('installs exactly the tables the mapped schema declares', async () => {
    const client = await migrated()
    expect(await publicTables(client))
      .toEqual([...new Set(Object.values(schema).map(getTableName))].sort())
  })

  it('installs every retained trigger and function the baseline declares', async () => {
    const client = await migrated()
    const triggers = await client.query<{ tgname: string }>(
      `select tgname from pg_trigger where not tgisinternal order by tgname`,
    )
    const functions = await client.query<{ proname: string }>(
      `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' order by proname`,
    )
    expect(triggers.rows.map((row) => row.tgname))
      .toEqual(declaredNames(/^CREATE TRIGGER (\w+) /gm))
    expect(functions.rows.map((row) => row.proname))
      .toEqual(declaredNames(/^CREATE OR REPLACE FUNCTION (\w+)\(/gm))
  })

  it('reapplies the one-entry journal without changing the installed shape', async () => {
    const client = await migrated()
    const first = await publicTables(client)
    await migratePgliteDatabase(client)
    expect(await publicTables(client)).toEqual(first)
  })

  it('owns connector capture work through the seeded default workspace', async () => {
    const client = await migrated()
    await migratePgliteDatabase(client)
    const workspaces = await client.query<{ id: string }>(`select id from workspaces`)
    expect(workspaces.rows).toEqual([{ id: DEFAULT_WORKSPACE_ID }])
    await client.query(
      `insert into source_execution_scopes (id, status, backoff_attempt, auth_generation, created_at, updated_at)
       values ('scope-oneaaaa', 'available', 0, 0, '${T}', '${T}')`,
    )
    await client.query(
      `insert into connector_instances
         (id, execution_scope_id, connector_id, connector_version, display_name, enabled,
          config_json, auth_json, filters_json, created_at, updated_at)
       values ('one', 'scope-oneaaaa', 'fixture', '1', 'One', true, '{}', '[]', '{}', '${T}', '${T}')`,
    )
    await client.query(
      `insert into connector_capture_work (
         id, workspace_id, idempotency_key, attempt, max_attempts, status, next_eligible_at,
         owner_version, created_at, updated_at, connector_instance_id, filter_signature,
         checkpoint_schema_version, checkpoint_generation, last_attempt_at, computed_delay_ms,
         horizon_at, failure_reason
       ) values ('work-1', '${DEFAULT_WORKSPACE_ID}', 'work-1', 1, 3, 'scheduled', '${T}',
         '1', '${T}', '${T}', 'one', 'filters:{}', 'v1', '1', '${T}', 0, '${T}',
         'network_interruption')`,
    )
  })

  it('migrates an on-disk database from empty state and survives a restart', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-baseline-restart-'))
    cleanups.push(() => fs.rmSync(dataDir, { recursive: true, force: true }))
    const first = await migrated(dataDir)
    await first.query(
      `insert into workspaces (id, name, created_at, updated_at) values ('ws-1', 'ws-1', '${T}', '${T}')`,
    )
    await first.close()

    const reopened = await createPgliteClient({ dataDir })
    cleanups.push(() => reopened.close())
    // Re-running the migrator on the reopened database performs no unjournaled DDL.
    await migratePgliteDatabase(reopened)
    const workspaces = await reopened.query<{ id: string }>(`select id from workspaces order by id`)
    expect(workspaces.rows).toEqual([{ id: DEFAULT_WORKSPACE_ID }, { id: 'ws-1' }])
  })

  it('persists encrypted workspace-secret text without lifecycle coupling', async () => {
    const client = await migrated()
    await client.query(
      `insert into workspace_secrets (key, label, kind, encrypted_value, created_at, updated_at)
       values ('greenhouse_password', 'Greenhouse', 'password', 'enc:fixture', '${T}', '${T}')`,
    )
    const result = await client.query<{ encrypted_value: string }>(
      `select encrypted_value from workspace_secrets where key = 'greenhouse_password'`,
    )
    expect(result.rows).toEqual([{ encrypted_value: 'enc:fixture' }])
  })

  it('keeps Capture revision history append-only', async () => {
    const client = await migrated()
    await client.query(
      `insert into workspaces (id, name, created_at, updated_at) values ('ws-1', 'ws-1', '${T}', '${T}')`,
    )
    await client.query(
      `insert into captures (
         id, workspace_id, evidence_mode, adapter_id, adapter_kind, adapter_version,
         observed_at, received_at, revision, created_at, updated_at
       ) values ('cap-1', 'ws-1', 'reported', 'adapter-1', 'connector', '1', '${T}', '${T}', 1, '${T}', '${T}')`,
    )
    await client.query(
      `insert into capture_revisions (capture_id, revision, kind, snapshot_json, audit_json, created_at)
       values ('cap-1', 1, 'created', '{}', '{}', '${T}')`,
    )
    await expect(client.query(
      `update capture_revisions set kind = 'corrected' where capture_id = 'cap-1'`,
    )).rejects.toThrow(/capture revisions are append-only/i)
    await expect(client.query(
      `delete from capture_revisions where capture_id = 'cap-1'`,
    )).rejects.toThrow(/capture revisions are append-only/i)
  })

  it('rejects Capture-to-Job lineage that crosses workspaces', async () => {
    const client = await migrated()
    for (const id of ['ws-1', 'ws-2']) {
      await client.query(
        `insert into workspaces (id, name, created_at, updated_at) values ('${id}', '${id}', '${T}', '${T}')`,
      )
    }
    await client.query(
      `insert into captures (
         id, workspace_id, evidence_mode, adapter_id, adapter_kind, adapter_version,
         observed_at, received_at, revision, created_at, updated_at
       ) values ('cap-1', 'ws-1', 'reported', 'adapter-1', 'connector', '1', '${T}', '${T}', 1, '${T}', '${T}')`,
    )
    await client.query(
      `insert into capture_revisions (capture_id, revision, kind, snapshot_json, audit_json, created_at)
       values ('cap-1', 1, 'created', '{}', '{}', '${T}')`,
    )
    await client.query(
      `insert into jobs (
         id, workspace_id, facts_revision, facts_json, availability_state,
         availability_observed_at, availability_revision, created_at, updated_at
       ) values ('017f22e2-79b0-7cc3-98c4-dc0c0c070001', 'ws-2', 1, '{}', 'open', '${T}', 1, '${T}', '${T}')`,
    )
    await expect(client.query(
      `insert into job_capture_evidence_references
         (id, job_id, capture_id, capture_revision, evidence_indexes_json, created_at)
       values ('ref-1', '017f22e2-79b0-7cc3-98c4-dc0c0c070001', 'cap-1', 1, '[0]', '${T}')`,
    )).rejects.toThrow(/workspace ownership mismatch/i)
  })

  it('enforces connector run instance and execution-scope ownership', async () => {
    const client = await migratedWithConnectorInstance()
    await expect(client.query(insertConnectorRun({ scopeId: 'scope-twoaaaa' })))
      .rejects.toThrow(/scope owner mismatch/i)
    await client.query(insertConnectorRun({ scopeId: 'scope-oneaaaa' }))
    await expect(client.query(
      `update connector_runs set execution_scope_id = 'scope-twoaaaa' where id = 'run-one'`,
    )).rejects.toThrow(/scope owner mismatch/i)
  })

  it('holds a connector instance execution scope fixed for its lifetime', async () => {
    const client = await migratedWithConnectorInstance()
    await expect(client.query(
      `update connector_instances set execution_scope_id = 'scope-twoaaaa' where id = 'one'`,
    )).rejects.toThrow(/scope identity immutable/i)
    // A no-op write of the same scope still passes the column trigger.
    await client.query(
      `update connector_instances set execution_scope_id = 'scope-oneaaaa' where id = 'one'`,
    )
  })

  it('requires a known execution scope and run status through mapped constraints', async () => {
    const client = await migratedWithConnectorInstance()
    await expect(client.query(
      `insert into connector_instances
         (id, execution_scope_id, connector_id, connector_version, display_name, enabled,
          config_json, auth_json, filters_json, created_at, updated_at)
       values ('two', 'scope-missing', 'fixture', '1', 'Two', true, '{}', '[]', '{}', '${T}', '${T}')`,
    )).rejects.toThrow(/fk_connector_instances_execution_scope/i)
    await expect(client.query(insertConnectorRun({ scopeId: 'scope-oneaaaa', status: 'paused' })))
      .rejects.toThrow(/chk_connector_runs_status/i)
    await client.query(insertConnectorRun({ scopeId: 'scope-oneaaaa' }))
    await expect(client.query(`delete from source_execution_scopes where id = 'scope-oneaaaa'`))
      .rejects.toThrow(/violates foreign key constraint/i)
  })
})
