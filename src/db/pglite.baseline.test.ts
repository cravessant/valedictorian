import { describe, expect, it } from 'vitest'
import { createPgliteClient, migratePgliteDatabase } from './pglite'

/**
 * Temporary #283 cutover-parity shapes retained only to finish the engine cutover.
 * These are not desired lifecycle decisions and must remain replaceable by ordinary
 * versioned PostgreSQL migrations after post-#237 reassessment.
 */
export const temporaryLifecycleParityShapes = [
  'jobs embeds external identityKind/identityNamespace/identityValue as the primary identity tuple',
  'capture_lineages.job_id and capture-owned job linkage can diverge from a single Capture→Job owner',
  'opportunities.projection_aliases_json retains JSON-scanned Opportunity aliases',
  'opportunities.application_id is reverse-only Opportunity→Application linkage',
  'retry_work collapsed scheduled-work identity uniqueness for connector_capture and normalization kinds',
] as const

async function migratedClient() {
  const client = await createPgliteClient()
  await migratePgliteDatabase(client)
  return client
}

async function publicTables(client: Awaited<ReturnType<typeof createPgliteClient>>) {
  const result = await client.query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'public' order by tablename`,
  )
  return result.rows.map((row) => row.tablename)
}

describe('PGlite operational baseline', () => {
  it('applies the one PostgreSQL baseline to a fresh database', async () => {
    const client = await createPgliteClient()
    try {
      await migratePgliteDatabase(client)
      const names = await publicTables(client)

      expect(names).toContain('companies')
      expect(names).toContain('jobs')
      expect(names).toContain('captures')
      expect(names).toContain('opportunities')
      expect(names).toContain('workspace_secrets')
      expect(names).not.toContain('user_profile')
      expect(names).not.toContain('profile_education')
      expect(names).not.toContain('profile_answers')
      expect(names).not.toContain('profile_sensitive_details')
      expect(names).not.toContain('profile_secrets')
    } finally {
      await client.close()
    }
  })

  it('applies the baseline a second time idempotently', async () => {
    const client = await createPgliteClient()
    try {
      await migratePgliteDatabase(client)
      const first = await publicTables(client)
      await migratePgliteDatabase(client)
      const second = await publicTables(client)
      expect(second).toEqual(first)
      expect(second).toContain('workspace_secrets')
    } finally {
      await client.close()
    }
  })

  it('persists workspace secrets with encrypted text and boolean/timestamp/json mappings', async () => {
    const client = await migratedClient()
    try {
      await client.query(
        `insert into workspace_secrets (key, label, kind, encrypted_value, created_at, updated_at)
         values ('greenhouse_password', 'Greenhouse', 'password', 'enc:fixture', '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z')`,
      )
      const secret = await client.query<{ encrypted_value: string }>(
        `select encrypted_value from workspace_secrets where key = 'greenhouse_password'`,
      )
      expect(secret.rows[0]?.encrypted_value).toBe('enc:fixture')

      await client.query(
        `insert into companies (id, name, normalized_name, created_at, updated_at)
         values ('company-1', 'Acme', 'acme', '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z')`,
      )
      await client.query(
        `insert into sources (id, name, created_at, updated_at)
         values ('source-1', 'Jobright', '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z')`,
      )
      await client.query(
        `insert into applications (
           id, company_id, source_id, role_title, role_kind, timing_mode, terms_json, country, work_mode, status, has_applied, created_at, updated_at
         ) values (
           'app-1', 'company-1', 'source-1', 'Engineer', 'full_time', 'unknown', '[]', 'US', 'remote', 'saved', true,
           '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z'
         )`,
      )
      const application = await client.query<{ has_applied: boolean; terms_json: string; created_at: string }>(
        `select has_applied, terms_json, created_at from applications where id = 'app-1'`,
      )
      expect(application.rows[0]).toEqual({
        has_applied: true,
        terms_json: '[]',
        created_at: '2026-07-18T00:00:00.000Z',
      })

      const columnTypes = await client.query<{ column_name: string; data_type: string }>(
        `select column_name, data_type from information_schema.columns
         where table_schema = 'public' and table_name = 'applications'
           and column_name in ('has_applied', 'terms_json', 'created_at')
         order by column_name`,
      )
      expect(columnTypes.rows).toEqual([
        { column_name: 'created_at', data_type: 'text' },
        { column_name: 'has_applied', data_type: 'boolean' },
        { column_name: 'terms_json', data_type: 'text' },
      ])
    } finally {
      await client.close()
    }
  })

  it('enforces foreign keys, checks, uniqueness, and partial unique indexes', async () => {
    const client = await migratedClient()
    try {
      await expect(
        client.query(
          `insert into source_execution_scopes (
             id, status, backoff_attempt, auth_generation, action_reason, created_at, updated_at
           ) values (
             'scope-invalid-action', 'available', 0, 0, 'UPPER SPACE!',
             '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z'
           )`,
        ),
      ).rejects.toThrow(/chk_source_execution_scopes_action_reason|check/i)

      await expect(
        client.query(
          `insert into applications (
             id, company_id, source_id, role_title, role_kind, timing_mode, terms_json, country, work_mode, status, has_applied, created_at, updated_at
           ) values (
             'app-missing', 'missing', 'missing', 'Engineer', 'full_time', 'unknown', '[]', 'US', 'remote', 'saved', false,
             '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z'
           )`,
        ),
      ).rejects.toThrow(/foreign key/i)

      await client.query(
        `insert into jobs (id, identity_kind, identity_namespace, identity_value, created_at)
         values ('job-1', 'provider_job', 'ns', 'value-1', '2026-07-18T00:00:00.000Z')`,
      )
      await expect(
        client.query(
          `insert into jobs (id, identity_kind, identity_namespace, identity_value, created_at)
           values ('job-2', 'provider_job', 'ns', 'value-1', '2026-07-18T00:00:00.000Z')`,
        ),
      ).rejects.toThrow(/unique|duplicate/i)

      await expect(
        client.query(
          `insert into jobs (id, identity_kind, identity_namespace, identity_value, created_at)
           values ('job-bad', '', 'ns', 'value', '2026-07-18T00:00:00.000Z')`,
        ),
      ).rejects.toThrow(/chk_jobs_identity_kind_length|check/i)

      await client.query(
        `insert into source_execution_scopes (id, status, backoff_attempt, auth_generation, created_at, updated_at)
         values ('scope-aaaaaaaa', 'available', 0, 0, '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z')`,
      )
      await client.query(
        `insert into connector_instances (
           id, execution_scope_id, connector_id, connector_version, display_name, enabled, config_json, auth_json, filters_json, created_at, updated_at
         ) values (
           'instance-1', 'scope-aaaaaaaa', 'fixture', '1', 'One', true, '{}', '[]', '{}',
           '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z'
         )`,
      )
      await client.query(
        `insert into connector_schedules (
           id, connector_instance_id, revision, state, cadence_json, timezone, next_eligible_at, created_at, updated_at
         ) values (
           'schedule-1', 'instance-1', 'rev-1', 'active', '{}', 'UTC', '2026-07-18T01:00:00.000Z',
           '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z'
         )`,
      )
      await expect(
        client.query(
          `insert into connector_schedules (
             id, connector_instance_id, revision, state, cadence_json, timezone, next_eligible_at, created_at, updated_at
           ) values (
             'schedule-2', 'instance-1', 'rev-2', 'active', '{}', 'UTC', '2026-07-18T02:00:00.000Z',
             '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z'
           )`,
        ),
      ).rejects.toThrow(/unique|duplicate/i)

      await client.query(
        `insert into capture_lineages (id, created_at) values ('lineage-1', '2026-07-18T00:00:00.000Z')`,
      )
      await client.query(
        `insert into capture_evidence_versions (
           id, capture_lineage_id, revision, content_hash, adapter_id, adapter_kind, adapter_version, observed_at, evidence_json, created_at
         ) values (
           'evidence-1', 'lineage-1', 1, 'hash-1', 'fixture', 'connector', '1', '2026-07-18T00:00:00.000Z', '[]', '2026-07-18T00:00:00.000Z'
         )`,
      )
      await client.query(
        `insert into normalization_runs (
           id, capture_lineage_id, capture_evidence_version_id, input_hash, resolver_set_hash, canonical_schema_version, gate_policy_version, status, created_at, updated_at
         ) values (
           'norm-1', 'lineage-1', 'evidence-1', 'input', 'resolvers', 'schema', 'gate', 'completed',
           '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z'
         )`,
      )
      await expect(
        client.query(
          `insert into normalization_runs (
             id, capture_lineage_id, capture_evidence_version_id, input_hash, resolver_set_hash, canonical_schema_version, gate_policy_version, status, created_at, updated_at
           ) values (
             'norm-2', 'lineage-1', 'evidence-1', 'input', 'resolvers', 'schema', 'gate', 'completed',
             '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z'
           )`,
        ),
      ).rejects.toThrow(/unique|duplicate/i)
    } finally {
      await client.close()
    }
  })

  it('enforces append-only job identities and projection outcomes plus source-bound identity limits', async () => {
    const client = await migratedClient()
    try {
      await client.query(
        `insert into jobs (id, identity_kind, identity_namespace, identity_value, created_at)
         values ('job-bound', 'provider_job', 'ns', 'bound-value', '2026-07-18T00:00:00.000Z')`,
      )
      await client.query(
        `insert into job_identities (
           id, job_id, identity_kind, identity_namespace, identity_value, provenance_kind, provenance_version, evidence_json, created_at
         ) values (
           'identity-1', 'job-bound', 'provider_job', 'ns', 'alias-1', 'capture', '1', '{}', '2026-07-18T00:00:00.000Z'
         )`,
      )
      await expect(
        client.query(`update job_identities set identity_value = 'changed' where id = 'identity-1'`),
      ).rejects.toThrow(/append-only/i)
      await expect(client.query(`delete from job_identities where id = 'identity-1'`)).rejects.toThrow(
        /append-only/i,
      )

      for (let index = 2; index <= 32; index += 1) {
        await client.query(
          `insert into job_identities (
             id, job_id, identity_kind, identity_namespace, identity_value, provenance_kind, provenance_version, evidence_json, created_at
           ) values (
             'identity-${index}', 'job-bound', 'destination_alias', 'ns', 'alias-${index}', 'capture', '1', '{}', '2026-07-18T00:00:00.000Z'
           )`,
        )
      }
      await expect(
        client.query(
          `insert into job_identities (
             id, job_id, identity_kind, identity_namespace, identity_value, provenance_kind, provenance_version, evidence_json, created_at
           ) values (
             'identity-33', 'job-bound', 'destination_alias', 'ns', 'alias-33', 'capture', '1', '{}', '2026-07-18T00:00:00.000Z'
           )`,
        ),
      ).rejects.toThrow(/bound is exhausted/i)

      await client.query(
        `insert into capture_lineages (id, created_at) values ('lineage-proj', '2026-07-18T00:00:00.000Z')`,
      )
      await client.query(
        `insert into capture_evidence_versions (
           id, capture_lineage_id, revision, content_hash, adapter_id, adapter_kind, adapter_version, observed_at, evidence_json, created_at
         ) values (
           'evidence-proj', 'lineage-proj', 1, 'hash-proj', 'fixture', 'connector', '1', '2026-07-18T00:00:00.000Z', '[]', '2026-07-18T00:00:00.000Z'
         )`,
      )
      await client.query(
        `insert into normalization_runs (
           id, capture_lineage_id, capture_evidence_version_id, input_hash, resolver_set_hash, canonical_schema_version, gate_policy_version, status, created_at, updated_at
         ) values (
           'norm-proj', 'lineage-proj', 'evidence-proj', 'input', 'resolvers', 'schema', 'gate', 'completed',
           '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z'
         )`,
      )
      await client.query(
        `insert into job_fact_versions (
           id, run_id, job_id, capture_lineage_id, capture_evidence_version_id, schema_version, job_fact_version_json, created_at
         ) values (
           'fact-proj', 'norm-proj', 'job-bound', 'lineage-proj', 'evidence-proj', 'v1', '{}', '2026-07-18T00:00:00.000Z'
         )`,
      )
      await client.query(
        `insert into sourcing_projection_outcomes (
           id, capture_lineage_id, capture_evidence_version_id, job_fact_version_id, status, created_at, updated_at
         ) values (
           'outcome-1', 'lineage-proj', 'evidence-proj', 'fact-proj', 'pending', '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z'
         )`,
      )
      await expect(client.query(`delete from sourcing_projection_outcomes where id = 'outcome-1'`)).rejects.toThrow(
        /append-only/i,
      )
      await expect(
        client.query(
          `update sourcing_projection_outcomes set status = 'projected', opportunity_id = 'missing', projected_at = '2026-07-18T01:00:00.000Z' where id = 'outcome-1'`,
        ),
      ).rejects.toThrow(/foreign key|immutable|check/i)
    } finally {
      await client.close()
    }
  })

  it('enforces connector scope-owner invariants', async () => {
    const client = await migratedClient()
    try {
      await client.query(
        `insert into source_execution_scopes (id, status, backoff_attempt, auth_generation, created_at, updated_at)
         values
           ('scope-oneaaaa', 'available', 0, 0, '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z'),
           ('scope-twoaaaa', 'available', 0, 0, '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z')`,
      )
      await client.query(
        `insert into connector_instances (
           id, execution_scope_id, connector_id, connector_version, display_name, enabled, config_json, auth_json, filters_json, created_at, updated_at
         ) values
           ('one', 'scope-oneaaaa', 'fixture', '1', 'One', true, '{}', '[]', '{}', '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z'),
           ('two', 'scope-twoaaaa', 'fixture', '1', 'Two', true, '{}', '[]', '{}', '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z')`,
      )
      await expect(
        client.query(
          `insert into connector_runs (
             id, execution_scope_id, connector_instance_id, mode, status, started_at, config_json, filters_json, filter_signature,
             observation_count, warning_count, stats_json, warnings_json, retry_hints_json, created_at, updated_at
           ) values (
             'run-one', 'scope-twoaaaa', 'one', 'manual', 'queued', '2026-07-18T00:00:00.000Z', '{}', '{}', 'filters:{}',
             0, 0, '{}', '[]', 'null', '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z'
           )`,
        ),
      ).rejects.toThrow(/scope owner mismatch/i)
    } finally {
      await client.close()
    }
  })

  it('characterizes temporary #283 lifecycle parity shapes as cutover parity only', async () => {
    const client = await migratedClient()
    try {
      const jobsColumns = await client.query<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'jobs'
         order by column_name`,
      )
      expect(jobsColumns.rows.map((row) => row.column_name)).toEqual(
        expect.arrayContaining(['identity_kind', 'identity_namespace', 'identity_value']),
      )

      const opportunityColumns = await client.query<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'opportunities'
           and column_name in ('projection_aliases_json', 'application_id')
         order by column_name`,
      )
      expect(opportunityColumns.rows.map((row) => row.column_name)).toEqual([
        'application_id',
        'projection_aliases_json',
      ])

      const retryIndexes = await client.query<{ indexname: string }>(
        `select indexname from pg_indexes
         where schemaname = 'public' and tablename = 'retry_work'
           and indexname in ('idx_retry_work_capture_identity', 'idx_retry_work_normalization_identity')
         order by indexname`,
      )
      expect(retryIndexes.rows.map((row) => row.indexname)).toEqual([
        'idx_retry_work_capture_identity',
        'idx_retry_work_normalization_identity',
      ])

      // Explicit temporary cutover inventory — not desired lifecycle contracts.
      expect(temporaryLifecycleParityShapes).toEqual([
        'jobs embeds external identityKind/identityNamespace/identityValue as the primary identity tuple',
        'capture_lineages.job_id and capture-owned job linkage can diverge from a single Capture→Job owner',
        'opportunities.projection_aliases_json retains JSON-scanned Opportunity aliases',
        'opportunities.application_id is reverse-only Opportunity→Application linkage',
        'retry_work collapsed scheduled-work identity uniqueness for connector_capture and normalization kinds',
      ])
    } finally {
      await client.close()
    }
  })
})
