import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createInMemoryDatabase, migrateDatabase } from './sqlite'

const temporaryFolders: string[] = []

afterEach(() => {
  for (const folder of temporaryFolders.splice(0)) fs.rmSync(folder, { recursive: true, force: true })
})

describe('canonical lifecycle migration', () => {
  it('takes an unmanaged legacy workspace through the static baseline and pending rename', () => {
    const database = createInMemoryDatabase()
    database.exec(`
      create table companies (
        id text primary key,
        name text not null,
        normalized_name text not null,
        website_url text,
        created_at text not null,
        updated_at text not null,
        deleted_at text
      );
      insert into companies values
        ('company-1', 'Acme', 'acme', null, '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z', null);
    `)

    migrateDatabase(database)

    expect(database.prepare('select count(*) as count from jobs').get()).toEqual({ count: 0 })
    expect(database.prepare('select count(*) as count from opportunities').get()).toEqual({ count: 0 })
    expect(database.prepare('select name from companies').get()).toEqual({ name: 'Acme' })
    expect(database.pragma('foreign_key_check')).toEqual([])
    expect(database.prepare("select count(*) as count from __drizzle_migrations").get()).toEqual({ count: 28 })
  })

  it('preserves the old managed ledger graph while renaming physical objects', () => {
    const database = createInMemoryDatabase()
    const beforeRename = migrationFolderThrough(26)
    migrateDatabase(database, { migrationsFolder: beforeRename })

    database.exec(`
      insert into source_entities (id, identity_kind, identity_namespace, identity_value, created_at)
      values ('job-1', 'provider_job', 'jobright', 'provider-1', '2026-07-15T00:00:00.000Z');
      insert into raw_source_records (id, source_entity_id, created_at)
      values ('lineage-1', 'job-1', '2026-07-15T00:00:01.000Z');
      insert into raw_source_revisions (
        id, raw_record_id, revision, content_hash, adapter_id, adapter_kind, adapter_version,
        observed_at, evidence_json, created_at
      ) values (
        'evidence-1', 'lineage-1', 1, 'sha256:evidence', 'manual', 'manual', '1',
        '2026-07-15T00:00:02.000Z', '[]', '2026-07-15T00:00:02.000Z'
      );
      insert into raw_source_occurrences (
        id, raw_record_id, raw_revision_id, observed_at, received_at
      ) values (
        'capture-1', 'lineage-1', 'evidence-1',
        '2026-07-15T00:00:02.000Z', '2026-07-15T00:00:03.000Z'
      );
      insert into companies (id, name, normalized_name, website_url, created_at, updated_at)
      values ('company-1', 'Acme', 'acme', 'https://acme.example', '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z');
      insert into sources (id, name, account_hint, created_at, updated_at)
      values ('source-1', 'Jobright', null, '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z');
      insert into applications (
        id, company_id, source_id, role_title, role_kind, term, timing_mode, terms_json,
        start_date, end_date, city, region, country, work_mode, location_raw,
        status, has_applied, current_priority_score, current_priority_band,
        current_resume_variant, notes, created_at, updated_at
      ) values (
        'application-1', 'company-1', 'source-1', 'Software Engineering Intern', 'internship',
        null, 'unknown', '[]', null, null, 'New York', 'NY', 'US', 'hybrid', 'New York, NY',
        'queued', 0, null, null, null, null, '2026-07-15T00:00:04.000Z', '2026-07-15T00:00:04.000Z'
      );
      insert into workflow_runs (
        id, run_type, status, actor_type, actor_name, source_id, subject_application_id,
        started_at, completed_at, coverage_started_at, coverage_ended_at, timezone,
        input_json, summary, outcome, blocker, metadata_json, created_at, updated_at
      ) values (
        'workflow-1', 'sourcing', 'completed', 'system', 'migration-proof', 'source-1', 'application-1',
        '2026-07-15T00:00:04.000Z', '2026-07-15T00:00:05.000Z', null, null, 'UTC',
        '{}', 'Migration proof', 'completed', null, '{}', '2026-07-15T00:00:04.000Z', '2026-07-15T00:00:05.000Z'
      );
      insert into normalization_runs (
        id, raw_record_id, raw_revision_id, trigger_occurrence_id,
        trigger_connector_instance_id, trigger_connector_run_id, input_hash,
        resolver_set_hash, canonical_schema_version, gate_policy_version,
        trigger_kind, trigger_id, status, created_at, updated_at
      ) values (
        'normalization-1', 'lineage-1', 'evidence-1', null, null, null,
        'sha256:normalization-input', 'resolver-set/v1', 'candidate/v1', 'gate/v1',
        'intake', null, 'completed', '2026-07-15T00:00:06.000Z', '2026-07-15T00:00:06.000Z'
      );
      insert into source_entity_identities (
        id, source_entity_id, identity_kind, identity_namespace, identity_value,
        provenance_kind, provenance_version, evidence_json, raw_revision_id, created_at
      ) values (
        'identity-1', 'job-1', 'provider_job', 'jobright', 'provider-1',
        'capture', 'capture/v1', '{}', 'evidence-1', '2026-07-15T00:00:03.000Z'
      );
      insert into source_identity_conflicts (
        id, source_entity_id, conflicting_source_entity_id, raw_revision_id,
        identity_kind, identity_namespace, identity_value, reason,
        provenance_version, evidence_json, created_at
      ) values (
        'conflict-1', 'job-1', null, 'evidence-1', 'provider_job', 'jobright', 'provider-1',
        'migration proof conflict', 'conflict/v1', '{}', '2026-07-15T00:00:03.500Z'
      );
      insert into canonical_source_candidates (
        id, run_id, source_entity_id, raw_record_id, raw_revision_id,
        schema_version, candidate_json, created_at
      ) values (
        'candidate-1', 'normalization-1', 'job-1', 'lineage-1', 'evidence-1',
        'candidate/v1', '{"id":"candidate-1","sourceEntityId":"job-1","rawRecordId":"lineage-1","rawRevisionId":"evidence-1"}',
        '2026-07-15T00:00:06.000Z'
      );
      insert into normalization_gates (
        id, run_id, policy_version, status, candidate_id, gate_json, evaluated_at
      ) values (
        'gate-1', 'normalization-1', 'gate/v1', 'passed', 'candidate-1', '{}', '2026-07-15T00:00:06.000Z'
      );
      insert into sourcing_findings (
        id, projection_identity_key, projection_aliases_json, source_entity_id,
        canonical_candidate_id, raw_revision_id, adapter_id, adapter_kind, adapter_version,
        workflow_run_id, source_id, company_name, role_title, role_kind, term, timing_mode,
        terms_json, start_date, end_date, city, region, country, work_mode, location_raw,
        employment_type, seniority, location_json, compensation_json, posted_at_json,
        official_url, source_url, destination_class, destination_url, intermediary_url,
        usability, posted_age, priority_score, priority_band, fit_notes, duplicate_notes,
        blocker, policy_blocker, disposition_reason, merge_status, merged_application_id,
        merge_notes, discovered_at, created_at, updated_at, deleted_at
      ) values (
        'finding-1', 'source_entity:job-1', '["source_entity:job-1"]', 'job-1',
        'candidate-1', 'evidence-1', 'manual', 'manual', '1', 'workflow-1', 'source-1',
        'Acme', 'Software Engineering Intern', 'internship', null, 'unknown', '[]', null, null,
        'New York', 'NY', 'US', 'hybrid', 'New York, NY', 'internship', 'intern', '{}', null, '{}',
        'https://jobs.acme.example/role-1', 'https://jobs.acme.example/role-1', 'employer_or_ats',
        'https://jobs.acme.example/role-1', null, 'usable', '1d', 8, 'high', 'Strong fit', null,
        null, null, null, 'new', 'application-1', null,
        '2026-07-15T00:00:06.000Z', '2026-07-15T00:00:06.000Z', '2026-07-15T00:00:06.000Z', null
      );
      insert into sourcing_projection_outcomes (
        id, raw_record_id, raw_revision_id, canonical_candidate_id, status, finding_id,
        failure_code, failure_retryable, created_at, updated_at, projected_at, failed_at
      ) values (
        'projection-1', 'lineage-1', 'evidence-1', 'candidate-1', 'pending', null,
        null, null, '2026-07-15T00:00:07.000Z', '2026-07-15T00:00:07.000Z', null, null
      );
    `)

    migrateDatabase(database)

    database.prepare(`
      update sourcing_projection_outcomes
      set status = 'projected', opportunity_id = ?, projected_at = ?, updated_at = ?
      where id = ?
    `).run('finding-1', '2026-07-15T00:00:08.000Z', '2026-07-15T00:00:08.000Z', 'projection-1')

    expect(database.prepare('select * from jobs').get()).toMatchObject({ id: 'job-1' })
    expect(database.prepare('select * from capture_lineages').get()).toMatchObject({
      id: 'lineage-1',
      job_id: 'job-1',
    })
    expect(database.prepare('select * from capture_evidence_versions').get()).toMatchObject({
      id: 'evidence-1',
      capture_lineage_id: 'lineage-1',
    })
    expect(database.prepare('select * from captures').get()).toMatchObject({
      id: 'capture-1',
      capture_lineage_id: 'lineage-1',
      capture_evidence_version_id: 'evidence-1',
    })
    expect(database.prepare('select * from job_identities').get()).toMatchObject({
      id: 'identity-1',
      job_id: 'job-1',
      capture_evidence_version_id: 'evidence-1',
    })
    expect(database.prepare('select * from job_identity_conflicts').get()).toMatchObject({
      id: 'conflict-1',
      job_id: 'job-1',
      capture_evidence_version_id: 'evidence-1',
    })
    expect(database.prepare('select * from job_fact_versions').get()).toMatchObject({
      id: 'candidate-1',
      job_id: 'job-1',
      capture_lineage_id: 'lineage-1',
      capture_evidence_version_id: 'evidence-1',
      job_fact_version_json: expect.stringContaining('candidate-1'),
    })
    expect(database.prepare('select * from opportunities').get()).toMatchObject({
      id: 'finding-1',
      job_id: 'job-1',
      job_fact_version_id: 'candidate-1',
      capture_evidence_version_id: 'evidence-1',
      application_id: 'application-1',
    })
    expect(database.prepare('select * from applications').get()).toMatchObject({ id: 'application-1' })
    expect(database.prepare('select * from sourcing_projection_outcomes').get()).toMatchObject({
      id: 'projection-1',
      capture_lineage_id: 'lineage-1',
      capture_evidence_version_id: 'evidence-1',
      job_fact_version_id: 'candidate-1',
      opportunity_id: 'finding-1',
    })
    expect(database.pragma('foreign_key_check')).toEqual([])

    const oldObjects = database
      .prepare(`
        select type, name from sqlite_master
        where type in ('table', 'index', 'trigger')
          and (
            name like '%raw_source%'
            or name like '%source_entity%'
            or name like '%canonical_source%'
            or name like '%sourcing_finding%'
          )
      `)
      .all()
    expect(oldObjects).toEqual([])
  })
})

function migrationFolderThrough(maxIndex: number) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), `valedictorian-lifecycle-${maxIndex}-`))
  temporaryFolders.push(folder)
  fs.cpSync(path.resolve('drizzle'), folder, { recursive: true })
  for (const name of fs.readdirSync(folder)) {
    const index = Number.parseInt(name.slice(0, 4), 10)
    if (Number.isInteger(index) && index > maxIndex) fs.rmSync(path.join(folder, name))
  }
  const journalPath = path.join(folder, 'meta', '_journal.json')
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as { entries: Array<{ idx: number }> }
  journal.entries = journal.entries.filter(({ idx }) => idx <= maxIndex)
  fs.writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`)
  return folder
}
