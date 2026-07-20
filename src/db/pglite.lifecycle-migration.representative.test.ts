import { afterEach, describe, expect, it } from 'vitest'
import { createPgliteClient, type PgliteClient } from './pglite'
import { applyBaselineOnly, applyLifecycleMigration, seedLegacyDataset } from '../test/lifecycle-migration-harness'

/**
 * #298 Round E representative-data integrity proof: seed a realistic legacy
 * dataset covering every transform branch, apply 0001, and assert preservation +
 * migration-report completeness.
 */
describe.sequential('lifecycle migration representative data', () => {
  let client: PgliteClient | null = null

  afterEach(async () => {
    await client?.close()
    client = null
  })

  async function migrate() {
    client = await createPgliteClient()
    await applyBaselineOnly(client)
    await seedLegacyDataset(client)
    await applyLifecycleMigration(client)
    return client
  }

  async function count(c: PgliteClient, table: string, where = '') {
    const r = await c.query<{ n: number }>(`select count(*)::int as n from ${table} ${where}`)
    return r.rows[0]!.n
  }

  it('seeds one nil-UUID default workspace and backfills ownership', async () => {
    const c = await migrate()
    const ws = await c.query<{ id: string }>(`select id from workspaces`)
    expect(ws.rows).toEqual([{ id: '00000000-0000-0000-0000-000000000000' }])
    expect(await count(c, 'lifecycle_captures', `where workspace_id = '00000000-0000-0000-0000-000000000000'`)).toBe(4)
  })

  it('preserves captures, revisions, and faithfully extracts evidence with degradation reports', async () => {
    const c = await migrate()
    expect(await count(c, 'lifecycle_captures')).toBe(4)
    // lin-A has 2 revisions, lin-B/lin-C/lin-D one each.
    expect(await count(c, 'capture_revisions')).toBe(5)
    // lin-C respects the <=50 cap, and reports the >50, malformed, and forbidden (OAuth key) drops.
    const kept = await count(c, 'capture_evidence_items', `where capture_id = 'lin-C'`)
    expect(kept).toBeGreaterThan(0)
    expect(kept).toBeLessThanOrEqual(50)
    const drops = await c.query<{ reason: string }>(
      `select reason from lifecycle_migration_report where source_id = 'cev-C1'`,
    )
    const reasons = drops.rows.map((r) => r.reason).join(' | ')
    expect(reasons).toMatch(/beyond the 50/)
    expect(reasons).toMatch(/malformed/)
    // The access_token element (an OAuth key the old exact-match rule missed) is now caught.
    expect(reasons).toMatch(/forbidden/)
    // The OAuth-style payload key (api_key) on cev-C1 was reset to null and reported.
    expect(await count(c, 'lifecycle_migration_report', `where category = 'reset' and reason like '%payload%'`)).toBe(1)
    // Malformed (non-JSON) evidence_json (cev-D1) is reported, not aborted.
    expect(await count(c, 'lifecycle_migration_report', `where source_id = 'cev-D1' and reason like '%not valid JSON%'`)).toBe(1)
  })

  it('mints UUIDv7 jobs and maps identities to posting/canonical_destination as provisional', async () => {
    const c = await migrate()
    // job-A, job-B, plus one synthesized job for the orphan application = 3.
    expect(await count(c, 'lifecycle_jobs')).toBe(3)
    const ids = await c.query<{ id: string }>(`select id from lifecycle_jobs`)
    // Every seeded row was created at the same instant, so the leading 48 timestamp
    // bits (real v7 semantics from created_at, not md5 noise) must all decode to it.
    const expectedTsHex = Date.parse('2026-07-19T00:00:00.000Z').toString(16).padStart(12, '0')
    for (const { id } of ids.rows) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      expect(id.replace(/-/g, '').slice(0, 12)).toBe(expectedTsHex)
    }
    // provider_job -> posting; destinations/aliases -> canonical_destination; all provisional, no account.
    const kinds = await c.query<{ kind: string; strength: string; account: string | null }>(`select kind, strength, account from job_external_identities`)
    expect(kinds.rows.every((r) => r.strength === 'provisional' && r.account === null)).toBe(true)
    const kindSet = new Set(kinds.rows.map((r) => r.kind))
    expect(kindSet).toEqual(new Set(['posting', 'canonical_destination']))
    expect(await count(c, 'job_external_identities', `where kind = 'ats_job'`)).toBe(0)
  })

  it('resolves divergent Capture-to-Job lineage to the facts-version job and quarantines the loser', async () => {
    const c = await migrate()
    // lin-B: lineage says job-B, facts say job-A -> keep job-A, report divergence.
    const divergence = await c.query<{ detail_json: string }>(
      `select detail_json from lifecycle_migration_report where category = 'quarantine' and source_id = 'lin-B'`,
    )
    expect(divergence.rows).toHaveLength(1)
    expect(divergence.rows[0]!.detail_json).toMatch(/factsSideJob/)
  })

  it('maps policy states to reviewing, user states to their disposition, and quarantines dedup opportunities', async () => {
    const c = await migrate()
    const policy = await c.query<{ fit: string; cutoff: string; disposition: string }>(`select fit, cutoff, disposition from lifecycle_opportunities where id = 'opp-policy'`)
    expect(policy.rows[0]).toEqual({ fit: 'unknown', cutoff: 'below', disposition: 'reviewing' })
    const user = await c.query<{ disposition: string }>(`select disposition from lifecycle_opportunities where id = 'opp-user'`)
    expect(user.rows[0]!.disposition).toBe('declined')
    // opp-dupe (duplicate) quarantined, not migrated.
    expect(await count(c, 'lifecycle_opportunities', `where id = 'opp-dupe'`)).toBe(0)
    expect(await count(c, 'lifecycle_migration_report', `where category = 'quarantine' and source_id = 'opp-dupe'`)).toBe(1)
  })

  it('preserves the linked application and synthesizes lineage for the orphan', async () => {
    const c = await migrate()
    expect(await count(c, 'lifecycle_applications')).toBe(2)
    // Linked app points at opp-user; orphan app points at a synthesized opportunity.
    const linked = await c.query<{ opportunity_id: string }>(`select opportunity_id from lifecycle_applications where id = 'app-linked'`)
    expect(linked.rows[0]!.opportunity_id).toBe('opp-user')
    const orphan = await c.query<{ opportunity_id: string }>(`select opportunity_id from lifecycle_applications where id = 'app-orphan'`)
    expect(orphan.rows[0]!.opportunity_id).toBe('synth-opp:app-orphan')
    expect(await count(c, 'lifecycle_migration_report', `where category = 'synthesized' and source_id = 'app-orphan'`)).toBe(1)
    // Links, attempts/events, history preserved.
    expect(await count(c, 'pursuit_links', `where application_id = 'app-linked'`)).toBe(1)
    expect(await count(c, 'application_event_records', `where application_id = 'app-linked'`)).toBe(1)
  })

  it('splits retry_work into distinct identities with the cancelled/terminal disambiguation', async () => {
    const c = await migrate()
    // rw-cap (connector), rw-cancel (connector cancelled) -> connector_capture_work.
    expect(await count(c, 'connector_capture_work')).toBe(2)
    // rw-prov + rw-term -> provider table; rw-norm -> normalization table.
    expect(await count(c, 'provider_url_resolution_work')).toBe(2)
    expect(await count(c, 'normalization_work')).toBe(1)
    // rw-term (cancelled + failureEvidence) -> terminal; rw-cancel (cancelled, no evidence) -> cancelled.
    const term = await c.query<{ status: string; failure_reason: string }>(`select status, failure_reason from provider_url_resolution_work where id = 'rw-term'`)
    expect(term.rows[0]).toEqual({ status: 'terminal', failure_reason: 'unresolvable' })
    const cancel = await c.query<{ status: string }>(`select status from connector_capture_work where id = 'rw-cancel'`)
    expect(cancel.rows[0]!.status).toBe('cancelled')
    // Tombstoned rw-dead skipped + reported; not migrated.
    expect(await count(c, 'connector_capture_work', `where id = 'rw-dead'`)).toBe(0)
    expect(await count(c, 'lifecycle_migration_report', `where source_table = 'retry_work' and source_id = 'rw-dead'`)).toBe(1)
  })

  it('leaves the legacy tables physically intact', async () => {
    const c = await migrate()
    expect(await count(c, 'jobs')).toBe(2)
    expect(await count(c, 'applications')).toBe(2)
    expect(await count(c, 'retry_work')).toBe(6)
  })

  // #299 slice-4 correction: the 0002 provenance index is keyed on provider_schema
  // (matching the legacy connector lineage identity), with a pre-index quarantine of
  // residual true duplicates. Schema-divergent observations survive as distinct
  // captures; a true duplicate is deduped with a migration-report entry.
  it('keeps schema-divergent captures distinct and quarantines a true provenance duplicate (#299 0002)', async () => {
    const c = await createPgliteClient()
    client = c
    await applyBaselineOnly(c)
    const T0 = '2026-07-10T12:00:00.000Z'
    const T1 = '2026-07-10T12:00:01.000Z'
    const lineage = (id: string, createdAt: string) =>
      c.query(`insert into capture_lineages (id, job_id, created_at) values ('${id}',null,'${createdAt}')`)
    const cev = (id: string, lin: string, hash: string, schema: string, record: string, createdAt: string) =>
      c.query(`insert into capture_evidence_versions (id, capture_lineage_id, revision, content_hash, adapter_id, adapter_kind, adapter_version, observed_at, provider_record_id, provider_schema, payload_json, evidence_json, created_at)
        values ('${id}','${lin}',1,'${hash}','jobright','connector','1','${T0}','${record}','${schema}','{}','[]','${createdAt}')`)

    // Schema-divergent pair: same adapter + provider_record_id, DIFFERENT provider_schema.
    await lineage('lin-sd1', T0); await cev('cev-sd1', 'lin-sd1', 'h-sd1', 'jobright.v1', 'pr-shared', T0)
    await lineage('lin-sd2', T0); await cev('cev-sd2', 'lin-sd2', 'h-sd2', 'jobright.v2', 'pr-shared', T0)
    // True duplicate pair: identical (adapter, schema, record); earliest created_at (lin-dup1) wins.
    await lineage('lin-dup1', T0); await cev('cev-dup1', 'lin-dup1', 'h-dup1', 'jobright.v1', 'pr-dup', T0)
    await lineage('lin-dup2', T1); await cev('cev-dup2', 'lin-dup2', 'h-dup2', 'jobright.v1', 'pr-dup', T1)

    await applyLifecycleMigration(c)

    const divergent = await c.query<{ provider_schema: string }>(
      `select provider_schema from lifecycle_captures where provider_record_id = 'pr-shared' order by provider_schema`,
    )
    expect(divergent.rows.map((row) => row.provider_schema)).toEqual(['jobright.v1', 'jobright.v2'])

    expect(await count(c, 'lifecycle_captures', `where provider_record_id = 'pr-dup'`)).toBe(1)
    const survivor = await c.query<{ id: string }>(`select id from lifecycle_captures where provider_record_id = 'pr-dup'`)
    expect(survivor.rows[0]?.id).toBe('lin-dup1')
    expect(await count(c, 'lifecycle_migration_report', `where category = 'quarantine' and source_id = 'lin-dup2'`)).toBe(1)
  })
})
