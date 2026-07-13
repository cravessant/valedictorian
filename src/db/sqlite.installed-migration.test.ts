import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createInMemoryDatabase, migrateDatabase } from './sqlite'

describe('installed SQLite migration repair', () => {
  it('preserves a referenced candidate while removing its obsolete partial connector run', () => {
    const database = createInMemoryDatabase()
    migrateDatabase(database, { migrationsFolder: migrationFolderThrough(22) })
    seedReferencedPartialRun(database)

    migrateDatabase(database)

    expect(database.prepare(`
      select trigger_occurrence_id, trigger_connector_instance_id, trigger_connector_run_id
      from normalization_runs where id = 'normalization-partial'
    `).get()).toEqual({
      trigger_occurrence_id: null,
      trigger_connector_instance_id: null,
      trigger_connector_run_id: null,
    })
    expect(database.prepare(`
      select id, canonical_candidate_id from sourcing_findings where id = 'finding-partial'
    `).get()).toEqual({ id: 'finding-partial', canonical_candidate_id: 'candidate-partial' })
    expect(database.prepare(`
      select id, run_id from canonical_source_candidates where id = 'candidate-partial'
    `).get()).toEqual({ id: 'candidate-partial', run_id: 'normalization-partial' })
    expect(database.prepare(`
      select id, candidate_id from normalization_gates where id = 'gate-partial'
    `).get()).toEqual({ id: 'gate-partial', candidate_id: 'candidate-partial' })
    expect(database.prepare(`
      select id, canonical_candidate_id, finding_id, status
      from sourcing_projection_outcomes where id = 'projection-partial'
    `).get()).toEqual({
      id: 'projection-partial',
      canonical_candidate_id: 'candidate-partial',
      finding_id: 'finding-partial',
      status: 'projected',
    })
    expect(database.prepare(`select count(*) as count from connector_runs where id = 'run-partial'`).get())
      .toEqual({ count: 0 })
    expect(database.prepare('pragma foreign_key_check').all()).toEqual([])
    database.close()
  })

  it('does not repair a database that already applied the published cleanup migrations', () => {
    const database = createInMemoryDatabase()
    migrateDatabase(database, { migrationsFolder: migrationFolderThrough(24) })
    database.exec('drop trigger connector_runs_status_insert')
    database.exec('drop trigger connector_runs_status_update')
    seedReferencedPartialRun(database)

    migrateDatabase(database)

    expect(database.prepare(`
      select trigger_occurrence_id, trigger_connector_instance_id, trigger_connector_run_id
      from normalization_runs where id = 'normalization-partial'
    `).get()).toEqual({
      trigger_occurrence_id: 'occurrence-partial',
      trigger_connector_instance_id: 'instance-partial',
      trigger_connector_run_id: 'run-partial',
    })
    expect(database.prepare(`select count(*) as count from connector_runs where id = 'run-partial'`).get())
      .toEqual({ count: 1 })
    expect(database.prepare('pragma foreign_key_check').all()).toEqual([])
    database.close()
  })

  it('rolls back the repair when a later pending migration fails', () => {
    const database = createInMemoryDatabase()
    migrateDatabase(database, { migrationsFolder: migrationFolderThrough(22) })
    seedReferencedPartialRun(database)
    const before = database.prepare(`
      select trigger_occurrence_id, trigger_connector_instance_id, trigger_connector_run_id
      from normalization_runs where id = 'normalization-partial'
    `).get()
    const failingMigrations = failingMigrationFolder()

    expect(() => migrateDatabase(database, { migrationsFolder: failingMigrations }))
      .toThrow(/intentionally_missing_installed_migration_table/)

    expect(database.prepare(`
      select trigger_occurrence_id, trigger_connector_instance_id, trigger_connector_run_id
      from normalization_runs where id = 'normalization-partial'
    `).get()).toEqual(before)
    expect(database.prepare(`select count(*) as count from connector_runs where id = 'run-partial'`).get())
      .toEqual({ count: 1 })
    expect(database.prepare('select count(*) as count from __drizzle_migrations').get())
      .toEqual({ count: 23 })
    expect(database.prepare('pragma foreign_key_check').all()).toEqual([])
    database.close()
  })
})

function failingMigrationFolder() {
  const folder = migrationFolderThrough(25)
  fs.appendFileSync(
    path.join(folder, '0025_black_rhodey.sql'),
    '\n--> statement-breakpoint\nselect * from intentionally_missing_installed_migration_table;\n',
  )
  return folder
}

function migrationFolderThrough(maxIndex: number) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), `valedictorian-installed-through-${maxIndex}-`))
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

function seedReferencedPartialRun(database: ReturnType<typeof createInMemoryDatabase>) {
  const scoped = database.prepare(`
    select count(*) as count from pragma_table_info('connector_instances')
    where name = 'execution_scope_id'
  `).get() as { count: number }
  database.exec(`
    ${scoped.count === 1 ? `insert into source_execution_scopes (id, created_at, updated_at)
    values ('scope-partial', '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z');` : ''}
    insert into connector_instances (
      id, ${scoped.count === 1 ? 'execution_scope_id,' : ''} connector_id, connector_version, display_name, enabled, config_json, auth_json,
      filters_json, created_at, updated_at
    ) values (
      'instance-partial', ${scoped.count === 1 ? "'scope-partial'," : ''} 'fixture.connector', '1.0.0', 'Fixture', 1, '{}', '[]', '{}',
      '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z'
    );
    insert into connector_runs (
      id, ${scoped.count === 1 ? 'execution_scope_id,' : ''} connector_instance_id, mode, status, started_at, config_json, filters_json,
      filter_signature, observation_count, warning_count, stats_json, warnings_json,
      retry_hints_json, created_at, updated_at
    ) values (
      'run-partial', ${scoped.count === 1 ? "'scope-partial'," : ''} 'instance-partial', 'manual', 'completed',
      '2026-07-10T12:00:00.000Z', '{}', '{}', 'filters:{}', 1, 0, '{}', '[]', '{}',
      '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z'
    );
    insert into source_entities (id, identity_kind, identity_namespace, identity_value, created_at)
    values ('entity-partial', 'provider_job', 'fixture', 'job-partial', '2026-07-10T12:00:00.000Z');
    insert into raw_source_records (id, source_entity_id, created_at)
    values ('record-partial', 'entity-partial', '2026-07-10T12:00:00.000Z');
    insert into raw_source_revisions (
      id, raw_record_id, revision, content_hash, adapter_id, adapter_kind, adapter_version,
      observed_at, payload_json, evidence_json, created_at
    ) values (
      'revision-partial', 'record-partial', 1, 'sha256:partial', 'fixture', 'connector',
      '1.0.0', '2026-07-10T12:00:00.000Z', '{}', '[]', '2026-07-10T12:00:00.000Z'
    );
    insert into raw_source_occurrences (
      id, raw_record_id, raw_revision_id, connector_instance_id, connector_run_id,
      ${scoped.count === 1 ? 'execution_scope_id,' : ''} observed_at, received_at
    ) values (
      'occurrence-partial', 'record-partial', 'revision-partial', 'instance-partial',
      'run-partial', ${scoped.count === 1 ? "'scope-partial'," : ''} '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:01.000Z'
    );
    insert into normalization_runs (
      id, raw_record_id, raw_revision_id, trigger_occurrence_id,
      trigger_connector_instance_id, trigger_connector_run_id, input_hash, resolver_set_hash,
      canonical_schema_version, gate_policy_version, trigger_kind, status, created_at, updated_at
    ) values (
      'normalization-partial', 'record-partial', 'revision-partial', 'occurrence-partial',
      'instance-partial', 'run-partial', 'sha256:input', 'sha256:resolvers',
      'candidate/v1', 'gate/v1', 'intake', 'completed',
      '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z'
    );
    insert into canonical_source_candidates (
      id, run_id, source_entity_id, raw_record_id, raw_revision_id, schema_version,
      candidate_json, created_at
    ) values (
      'candidate-partial', 'normalization-partial', 'entity-partial', 'record-partial',
      'revision-partial', 'candidate/v1', '{}', '2026-07-10T12:00:00.000Z'
    );
    insert into normalization_gates (
      id, run_id, policy_version, status, candidate_id, gate_json, evaluated_at
    ) values (
      'gate-partial', 'normalization-partial', 'gate/v1', 'passed', 'candidate-partial', '{}',
      '2026-07-10T12:00:00.000Z'
    );
    insert into sources (id, name, created_at, updated_at)
    values ('source-partial', 'Fixture source', '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z');
    insert into workflow_runs (
      id, run_type, status, actor_type, source_id, started_at, input_json, metadata_json,
      created_at, updated_at
    ) values (
      'workflow-partial', 'sourcing', 'completed', 'system', 'source-partial',
      '2026-07-10T12:00:00.000Z', '{}', '{}',
      '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z'
    );
    insert into sourcing_findings (
      id, projection_identity_key, source_entity_id, canonical_candidate_id, raw_revision_id,
      adapter_id, adapter_kind, adapter_version, workflow_run_id, source_id, company_name,
      role_title, role_kind, work_mode, merge_status, discovered_at, created_at, updated_at
    ) values (
      'finding-partial', 'fixture:finding-partial', 'entity-partial', 'candidate-partial',
      'revision-partial', 'fixture', 'connector', '1.0.0', 'workflow-partial', 'source-partial',
      'Fixture Company', 'Fixture Role', 'full_time', 'remote', 'unmerged',
      '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z'
    );
    insert into sourcing_projection_outcomes (
      id, raw_record_id, raw_revision_id, canonical_candidate_id, status, created_at, updated_at
    ) values (
      'projection-partial', 'record-partial', 'revision-partial', 'candidate-partial', 'pending',
      '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z'
    );
    update sourcing_projection_outcomes
    set status = 'projected', finding_id = 'finding-partial', projected_at = '2026-07-10T12:00:01.000Z'
    where id = 'projection-partial';
  `)
  database.prepare('update connector_runs set status = ? where id = ?')
    .run(['partial', 'success'].join('_'), 'run-partial')
}
