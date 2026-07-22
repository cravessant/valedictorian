import { describe, expect, it } from 'vitest'
import { createPgliteClient, migratePgliteDatabase, type PgliteClient } from './pglite'

async function publicTables(client: PgliteClient) {
  const result = await client.query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'public' order by tablename`,
  )
  return result.rows.map((row) => row.tablename)
}

describe.sequential('PGlite operational baseline after lifecycle cutover', () => {
  it('installs one canonical lifecycle root set and no retired aggregate tables', async () => {
    const client = await createPgliteClient()
    try {
      await migratePgliteDatabase(client)
      const names = await publicTables(client)
      for (const current of ['captures', 'jobs', 'opportunities', 'applications', 'workspace_secrets']) {
        expect(names).toContain(current)
      }
      for (const retired of [
        'companies', 'raw_records', 'canonical_candidates', 'sourcing_findings',
        'capture_lineages', 'capture_evidence_versions', 'retry_work',
        'lifecycle_captures', 'lifecycle_jobs', 'lifecycle_opportunities', 'lifecycle_applications',
      ]) {
        expect(names).not.toContain(retired)
      }
    } finally {
      await client.close()
    }
  })

  it('reapplies the migration journal idempotently', async () => {
    const client = await createPgliteClient()
    try {
      await migratePgliteDatabase(client)
      const first = await publicTables(client)
      await migratePgliteDatabase(client)
      expect(await publicTables(client)).toEqual(first)
    } finally {
      await client.close()
    }
  })

  it('persists encrypted workspace-secret text without lifecycle coupling', async () => {
    const client = await createPgliteClient()
    try {
      await migratePgliteDatabase(client)
      await client.query(
        `insert into workspace_secrets (key, label, kind, encrypted_value, created_at, updated_at)
         values ('greenhouse_password', 'Greenhouse', 'password', 'enc:fixture',
           '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z')`,
      )
      const result = await client.query<{ encrypted_value: string }>(
        `select encrypted_value from workspace_secrets where key = 'greenhouse_password'`,
      )
      expect(result.rows).toEqual([{ encrypted_value: 'enc:fixture' }])
    } finally {
      await client.close()
    }
  })

  it('enforces connector execution-scope ownership', async () => {
    const client = await createPgliteClient()
    try {
      await migratePgliteDatabase(client)
      await client.query(
        `insert into source_execution_scopes (id, status, backoff_attempt, auth_generation, created_at, updated_at)
         values
           ('scope-oneaaaa', 'available', 0, 0, '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z'),
           ('scope-twoaaaa', 'available', 0, 0, '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z')`,
      )
      await client.query(
        `insert into connector_instances
           (id, execution_scope_id, connector_id, connector_version, display_name, enabled,
            config_json, auth_json, filters_json, created_at, updated_at)
         values
           ('one', 'scope-oneaaaa', 'fixture', '1', 'One', true, '{}', '[]', '{}', '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z'),
           ('two', 'scope-twoaaaa', 'fixture', '1', 'Two', true, '{}', '[]', '{}', '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z')`,
      )
      await expect(client.query(
        `insert into connector_runs
           (id, execution_scope_id, connector_instance_id, mode, status, started_at, config_json,
            filters_json, filter_signature, observation_count, warning_count, stats_json,
            warnings_json, retry_hints_json, created_at, updated_at)
         values ('run-one', 'scope-twoaaaa', 'one', 'manual', 'queued', '2026-07-18T00:00:00.000Z',
           '{}', '{}', 'filters:{}', 0, 0, '{}', '[]', 'null',
           '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z')`,
      )).rejects.toThrow(/scope owner mismatch/i)
    } finally {
      await client.close()
    }
  })

  it('removes temporary embedded identity and reverse-link columns', async () => {
    const client = await createPgliteClient()
    try {
      await migratePgliteDatabase(client)
      const result = await client.query<{ table_name: string; column_name: string }>(
        `select table_name, column_name from information_schema.columns
         where table_schema = 'public' and (
           (table_name = 'jobs' and column_name in ('identity_kind','identity_namespace','identity_value'))
           or (table_name = 'opportunities' and column_name in ('projection_aliases_json','application_id'))
         )`,
      )
      expect(result.rows).toEqual([])
    } finally {
      await client.close()
    }
  })
})
