import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPgliteClient, migratePgliteDatabase, type PgliteClient } from './pglite'

/**
 * #298 red-first schema proof for the journaled lifecycle aggregates (Capture,
 * Job, Opportunity, Application) at the PGlite public seam. Uses one migrated
 * in-memory database and raw SQL so it asserts the physical constraints the
 * journaled migration must install, independent of any Drizzle query layer.
 *
 * The clean-cutover migration renames the canonical roots to their final
 * physical names, so these assertions exercise the installed production shape.
 */
const T = '2026-07-19T00:00:00.000Z'

/** Distinct valid UUIDv7 identifiers (version nibble 7, variant nibble 9). */
const jobId = (index: number) => `017f22e2-79b0-7cc3-98c4-dc0c0c07${index.toString(16).padStart(4, '0')}`

async function insertCapture(
  client: PgliteClient,
  overrides: { id: string; workspaceId?: string; evidenceMode?: string; adapterKind?: string },
) {
  const workspaceId = overrides.workspaceId ?? 'ws-1'
  const evidenceMode = overrides.evidenceMode ?? 'reported'
  const adapterKind = overrides.adapterKind ?? 'connector'
  await client.query(
    `insert into captures (
       id, workspace_id, evidence_mode, adapter_id, adapter_kind, adapter_version,
       observed_at, received_at, provider_record_id, provider_schema, payload_json,
       revision, created_at, updated_at
     ) values (
       '${overrides.id}', '${workspaceId}', '${evidenceMode}', 'adapter-1', '${adapterKind}', '1',
       '${T}', '${T}', null, null, null, 1, '${T}', '${T}'
     )`,
  )
  await client.query(
    `insert into capture_revisions (capture_id, revision, kind, snapshot_json, audit_json, created_at)
     values ('${overrides.id}', 1, 'created', '{}', '{}', '${T}')`,
  )
}

async function insertJob(client: PgliteClient, id: string, workspaceId = 'ws-1') {
  await client.query(
    `insert into jobs (
       id, workspace_id, facts_revision, facts_json, availability_state, availability_observed_at,
       availability_revision, created_at, updated_at
     ) values (
       '${id}', '${workspaceId}', 1, '{}', 'open', '${T}', 1, '${T}', '${T}'
     )`,
  )
}

async function insertIdentity(
  client: PgliteClient,
  o: { id: string; jobId: string; kind?: string; provider?: string; account?: string | null; value?: string; strength?: string },
) {
  const account = o.account === undefined ? 'acme' : o.account
  await client.query(
    `insert into job_external_identities (
       id, job_id, kind, provider, account, value, strength, provenance_kind, provenance_version, evidence_json, created_at
     ) values (
       '${o.id}', '${o.jobId}', '${o.kind ?? 'ats_job'}', '${o.provider ?? 'greenhouse'}',
       ${account === null ? 'null' : `'${account}'`}, '${o.value ?? 'req-1'}', '${o.strength ?? 'strong'}',
       'capture', '1', '{}', '${T}'
     )`,
  )
}

async function insertOpportunity(
  client: PgliteClient,
  o: { id: string; jobId: string; workspaceId?: string; fit?: string; cutoff?: string; disposition?: string },
) {
  await client.query(
    `insert into opportunities (
       id, workspace_id, job_id, revision, fit, rank, cutoff, disposition, created_at, updated_at
     ) values (
       '${o.id}', '${o.workspaceId ?? 'ws-1'}', '${o.jobId}', 1, '${o.fit ?? 'fit'}', null,
       '${o.cutoff ?? 'above'}', '${o.disposition ?? 'reviewing'}', '${T}', '${T}'
     )`,
  )
}

async function insertApplication(
  client: PgliteClient,
  o: { id: string; opportunityId: string; jobId: string; workspaceId?: string; status?: string },
) {
  await client.query(
    `insert into applications (
       id, workspace_id, opportunity_id, job_id, revision, status, job_facts_revision,
       snapshot_json, company_name, source_name, created_at, updated_at
     ) values (
       '${o.id}', '${o.workspaceId ?? 'ws-1'}', '${o.opportunityId}', '${o.jobId}', 1,
       '${o.status ?? 'active'}', 1, '{}', 'Acme', 'Jobright', '${T}', '${T}'
     )`,
  )
}

describe.sequential('PGlite lifecycle schema', () => {
  let client: PgliteClient

  beforeAll(async () => {
    client = await createPgliteClient()
    await migratePgliteDatabase(client)
    for (const ws of ['ws-1', 'ws-lineage', 'ws-different', 'ws-opp', 'ws-job', 'ws-other', 'ws-app']) {
      await client.query(`insert into workspaces (id, name, created_at, updated_at) values ('${ws}', '${ws}', '${T}', '${T}')`)
    }
  })

  afterAll(async () => {
    await client.close()
  })

  it('creates every canonical lifecycle aggregate table', async () => {
    const result = await client.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public'`,
    )
    const names = result.rows.map((row) => row.tablename)
    for (const table of [
      'captures', 'capture_evidence_items', 'capture_revisions',
      'jobs', 'job_external_identities', 'job_capture_evidence_references', 'job_history',
      'opportunities', 'opportunity_history',
      'applications', 'pursuit_links', 'application_attempt_records',
      'application_event_records', 'application_history',
    ]) {
      expect(names).toContain(table)
    }
  })

  it('requires a UUIDv7 job id and rejects non-v7 identifiers', async () => {
    await insertJob(client, jobId(1))
    await expect(insertJob(client, 'job-not-a-uuid')).rejects.toThrow(/chk_lifecycle_jobs_id|check/i)
    await expect(insertJob(client, '017f22e2-79b0-4cc3-98c4-dc0c0c07398f')).rejects.toThrow(/chk_lifecycle_jobs_id|check/i)
  })

  it('warns rather than blocks on shared provisional identity but globally uniques strong identity', async () => {
    await insertJob(client, jobId(10))
    await insertJob(client, jobId(11))
    // Two different jobs may share a provisional identity (weak matches are a policy warning, not a DB block).
    await insertIdentity(client, { id: 'prov-a', jobId: jobId(10), strength: 'provisional', value: 'shared' })
    await insertIdentity(client, { id: 'prov-b', jobId: jobId(11), strength: 'provisional', value: 'shared' })
    // A strong identity is globally unique across jobs.
    await insertIdentity(client, { id: 'strong-a', jobId: jobId(10), strength: 'strong', value: 'strong-shared' })
    await expect(
      insertIdentity(client, { id: 'strong-b', jobId: jobId(11), strength: 'strong', value: 'strong-shared' }),
    ).rejects.toThrow(/unique|duplicate/i)
  })

  it('prevents duplicate identities within one job and requires an account for strong identities', async () => {
    await insertJob(client, jobId(12))
    await insertIdentity(client, { id: 'dup-1', jobId: jobId(12), strength: 'provisional', value: 'dup' })
    await expect(
      insertIdentity(client, { id: 'dup-2', jobId: jobId(12), strength: 'provisional', value: 'dup' }),
    ).rejects.toThrow(/unique|duplicate/i)
    await expect(
      insertIdentity(client, { id: 'strong-noacct', jobId: jobId(12), strength: 'strong', account: null, value: 'x' }),
    ).rejects.toThrow(/chk_job_external_identities_strong_account|check/i)
    await expect(
      client.query(
        `insert into job_external_identities (id, job_id, kind, provider, account, value, strength, provenance_kind, provenance_version, evidence_json, created_at)
         values ('upper', '${jobId(12)}', 'ats_job', 'Greenhouse', 'acme', 'y', 'provisional', 'capture', '1', '{}', '${T}')`,
      ),
    ).rejects.toThrow(/chk_job_external_identities_provider|check/i)
  })

  it('permits one-way identity removal and re-establishment but forbids mutation or delete', async () => {
    await insertJob(client, jobId(20))
    await insertIdentity(client, { id: 'rm-1', jobId: jobId(20), strength: 'strong', value: 'removable' })
    // Mutating another column while removing is rejected.
    await expect(
      client.query(`update job_external_identities set removed_at = '${T}', value = 'changed' where id = 'rm-1'`),
    ).rejects.toThrow(/append-only/i)
    // Delete is always forbidden.
    await expect(client.query(`delete from job_external_identities where id = 'rm-1'`)).rejects.toThrow(/append-only/i)
    // The lone removal transition succeeds.
    await client.query(`update job_external_identities set removed_at = '${T}' where id = 'rm-1'`)
    // A removed strong identity can be re-established (removed rows are excluded from the strong unique scope).
    await insertJob(client, jobId(21))
    await insertIdentity(client, { id: 'rm-2', jobId: jobId(21), strength: 'strong', value: 'removable' })
  })

  it('integrity-checks Capture-to-Job lineage revisions and scopes them to one workspace', async () => {
    await insertCapture(client, { id: 'cap-1', workspaceId: 'ws-lineage' })
    await insertJob(client, jobId(30), 'ws-lineage')
    await client.query(
      `insert into job_capture_evidence_references (id, job_id, capture_id, capture_revision, evidence_indexes_json, created_at)
       values ('ref-1', '${jobId(30)}', 'cap-1', 1, '[0]', '${T}')`,
    )
    // A nonexistent capture revision is rejected by the composite FK.
    await expect(
      client.query(
        `insert into job_capture_evidence_references (id, job_id, capture_id, capture_revision, evidence_indexes_json, created_at)
         values ('ref-badrev', '${jobId(30)}', 'cap-1', 99, '[0]', '${T}')`,
      ),
    ).rejects.toThrow(/foreign key/i)
    // Duplicate (job, capture, revision) lineage is rejected.
    await expect(
      client.query(
        `insert into job_capture_evidence_references (id, job_id, capture_id, capture_revision, evidence_indexes_json, created_at)
         values ('ref-dup', '${jobId(30)}', 'cap-1', 1, '[0]', '${T}')`,
      ),
    ).rejects.toThrow(/unique|duplicate/i)
    // Lineage across differing workspaces is rejected.
    await insertCapture(client, { id: 'cap-otherws', workspaceId: 'ws-different' })
    await expect(
      client.query(
        `insert into job_capture_evidence_references (id, job_id, capture_id, capture_revision, evidence_indexes_json, created_at)
         values ('ref-cross', '${jobId(30)}', 'cap-otherws', 1, '[0]', '${T}')`,
      ),
    ).rejects.toThrow(/workspace/i)
  })

  it('keeps evidence occurrences, revisions, and history append-only with a bounded evidence count', async () => {
    await insertCapture(client, { id: 'cap-append' })
    await client.query(
      `insert into capture_evidence_items (id, capture_id, capture_revision, evidence_index, kind, label, value_json, created_at)
       values ('ev-1', 'cap-append', 1, 0, 'posting', 'Posting', '{}', '${T}')`,
    )
    await expect(client.query(`update capture_evidence_items set label = 'x' where id = 'ev-1'`)).rejects.toThrow(/append-only/i)
    await expect(client.query(`delete from capture_evidence_items where id = 'ev-1'`)).rejects.toThrow(/append-only/i)
    await expect(client.query(`delete from capture_revisions where capture_id = 'cap-append'`)).rejects.toThrow(/append-only/i)
    // The ≤50 evidence-per-revision bound is enforced by the index range.
    await expect(
      client.query(
        `insert into capture_evidence_items (id, capture_id, capture_revision, evidence_index, kind, label, value_json, created_at)
         values ('ev-over', 'cap-append', 1, 50, 'posting', 'Posting', '{}', '${T}')`,
      ),
    ).rejects.toThrow(/chk_capture_evidence_items_index|check/i)
    await insertJob(client, jobId(40))
    await client.query(
      `insert into job_history (id, job_id, sequence, kind, snapshot_json, audit_json, created_at)
       values ('hist-1', '${jobId(40)}', 1, 'created', '{}', '{}', '${T}')`,
    )
    await expect(client.query(`update job_history set kind = 'removed' where id = 'hist-1'`)).rejects.toThrow(/append-only/i)
  })

  it('bounds json columns and rejects forbidden sensitive keys', async () => {
    await insertCapture(client, { id: 'cap-bounds' })
    // Oversized snapshot json is rejected.
    await expect(
      client.query(
        `insert into capture_revisions (capture_id, revision, kind, snapshot_json, audit_json, created_at)
         values ('cap-bounds', 2, 'corrected', '${'x'.repeat(262145)}', '{}', '${T}')`,
      ),
    ).rejects.toThrow(/chk_capture_revisions_snapshot_bound|check/i)
    // A forbidden sensitive key in an evidence value is rejected.
    await expect(
      client.query(
        `insert into capture_evidence_items (id, capture_id, capture_revision, evidence_index, kind, label, value_json, created_at)
         values ('ev-secret', 'cap-bounds', 1, 1, 'posting', 'Posting', '{"password":"x"}', '${T}')`,
      ),
    ).rejects.toThrow(/chk_capture_evidence_items_value_keys|check/i)
    // A forbidden sensitive key in audit evidence is rejected.
    await expect(
      client.query(
        `insert into capture_revisions (capture_id, revision, kind, snapshot_json, audit_json, created_at)
         values ('cap-bounds', 3, 'corrected', '{}', '{"token":"x"}', '${T}')`,
      ),
    ).rejects.toThrow(/chk_capture_revisions_audit_keys|check/i)
    // OAuth- and header-style keys the old exact-match denylist missed are now rejected (substring match).
    for (const oauth of ['access_token', 'client_secret', 'apiKey', 'privateKey', 'bearer', 'X-Api-Key', 'X-Auth-Token']) {
      await expect(
        client.query(
          `insert into capture_evidence_items (id, capture_id, capture_revision, evidence_index, kind, label, value_json, created_at)
           values ('ev-${oauth}', 'cap-bounds', 1, 2, 'posting', 'Posting', '{"${oauth}":"x"}', '${T}')`,
        ),
      ).rejects.toThrow(/chk_capture_evidence_items_value_keys|check/i)
    }
  })

  it('enforces capture, job, and workspace check constraints', async () => {
    await expect(insertCapture(client, { id: 'c-mode', evidenceMode: 'bad' })).rejects.toThrow(/chk_lifecycle_captures_evidence_mode|check/i)
    await expect(insertCapture(client, { id: 'c-adapter', adapterKind: 'bad' })).rejects.toThrow(/chk_lifecycle_captures_adapter_kind|check/i)
    await expect(
      client.query(
        `insert into jobs (id, workspace_id, facts_revision, facts_json, availability_state, availability_observed_at, availability_revision, created_at, updated_at)
         values ('${jobId(50)}', 'ws-1', 1, '{}', 'bad', '${T}', 1, '${T}', '${T}')`,
      ),
    ).rejects.toThrow(/chk_lifecycle_jobs_availability_state|check/i)
    await expect(
      client.query(
        `insert into captures (id, workspace_id, evidence_mode, adapter_id, adapter_kind, adapter_version, observed_at, received_at, provider_record_id, provider_schema, payload_json, revision, created_at, updated_at)
         values ('c-nows', null, 'reported', 'a', 'connector', '1', '${T}', '${T}', null, null, null, 1, '${T}', '${T}')`,
      ),
    ).rejects.toThrow(/not-null|null value/i)
  })

  it('normalizes Opportunity identity as a direct workspace-scoped Job reference', async () => {
    await insertJob(client, jobId(60), 'ws-opp')
    await insertOpportunity(client, { id: 'opp-1', jobId: jobId(60), workspaceId: 'ws-opp' })
    // One opportunity per (workspace, job).
    await expect(
      insertOpportunity(client, { id: 'opp-dup', jobId: jobId(60), workspaceId: 'ws-opp' }),
    ).rejects.toThrow(/unique|duplicate/i)
    // Invalid disposition/fit are rejected.
    await insertJob(client, jobId(61), 'ws-opp')
    await expect(
      insertOpportunity(client, { id: 'opp-bad', jobId: jobId(61), workspaceId: 'ws-opp', disposition: 'bad' }),
    ).rejects.toThrow(/chk_lifecycle_opportunities_disposition|check/i)
    // Opportunity workspace must match its Job's workspace.
    await insertJob(client, jobId(62), 'ws-job')
    await expect(
      insertOpportunity(client, { id: 'opp-crossws', jobId: jobId(62), workspaceId: 'ws-other' }),
    ).rejects.toThrow(/workspace/i)
    // History is append-only.
    await client.query(
      `insert into opportunity_history (opportunity_id, revision, kind, snapshot_json, audit_json, created_at)
       values ('opp-1', 1, 'created', '{}', '{}', '${T}')`,
    )
    await expect(client.query(`delete from opportunity_history where opportunity_id = 'opp-1'`)).rejects.toThrow(/append-only/i)
  })

  it('gives Application direct Opportunity-and-Job lineage with bounded links and records', async () => {
    await insertJob(client, jobId(70), 'ws-app')
    await insertOpportunity(client, { id: 'opp-app', jobId: jobId(70), workspaceId: 'ws-app' })
    await insertApplication(client, { id: 'app-1', opportunityId: 'opp-app', jobId: jobId(70), workspaceId: 'ws-app' })
    // Application job must match its Opportunity's job.
    await insertJob(client, jobId(71), 'ws-app')
    await insertOpportunity(client, { id: 'opp-app2', jobId: jobId(71), workspaceId: 'ws-app' })
    await expect(
      insertApplication(client, { id: 'app-mismatch', opportunityId: 'opp-app2', jobId: jobId(70), workspaceId: 'ws-app' }),
    ).rejects.toThrow(/lineage/i)
    // Invalid status is rejected.
    await expect(
      client.query(
        `insert into applications (id, workspace_id, opportunity_id, job_id, revision, status, job_facts_revision, snapshot_json, company_name, source_name, created_at, updated_at)
         values ('app-badstatus', 'ws-app', 'opp-app2', '${jobId(71)}', 1, 'bad', 1, '{}', 'Acme', 'Jobright', '${T}', '${T}')`,
      ),
    ).rejects.toThrow(/chk_lifecycle_applications_status|check/i)
    // At most one primary pursuit link per application.
    await client.query(
      `insert into pursuit_links (id, application_id, kind, label, url, is_primary, created_at)
       values ('link-1', 'app-1', 'posting', 'Apply', 'https://example.com/a', true, '${T}')`,
    )
    await expect(
      client.query(
        `insert into pursuit_links (id, application_id, kind, label, url, is_primary, created_at)
         values ('link-2', 'app-1', 'posting', 'Apply2', 'https://example.com/b', true, '${T}')`,
      ),
    ).rejects.toThrow(/unique|duplicate/i)
    // Attempt/event bounded enums.
    await expect(
      client.query(
        `insert into application_attempt_records (id, workspace_id, application_id, state, started_at, created_at)
         values ('att-bad', 'ws-app', 'app-1', 'bad', '${T}', '${T}')`,
      ),
    ).rejects.toThrow(/chk_application_attempt_records_state|check/i)
    await expect(
      client.query(
        `insert into application_event_records (id, workspace_id, application_id, type, occurred_at, actor_id, actor_type, summary, created_at)
         values ('evt-bad', 'ws-app', 'app-1', 'note', '${T}', 'actor', 'robot', 'x', '${T}')`,
      ),
    ).rejects.toThrow(/chk_application_event_records_actor_type|check/i)
  })
})
