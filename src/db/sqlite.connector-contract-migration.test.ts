import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createInMemoryDatabase, migrateDatabase } from './sqlite'
import { doomedConnectorRunMigrationState, seedDoomedConnectorRunFixture } from './sqlite.schema-test-helpers'

const obsolete = {
  browserMode: ['browser', '_session'].join(''),
  maxResolution: ['max', 'ResolutionCount'].join(''),
  maxRequests: ['max', 'RequestsPerRun'].join(''),
  partialSuccess: ['partial', '_success'].join(''),
  remaining: ['remaining', 'Target'].join(''),
  role: ['role', 'Terms'].join(''),
  sessionField: ['session', 'Key'].join(''),
  useful: ['useful', 'Target'].join(''),
}

describe('continuous connector contract migration', () => {
  it.each(['0.8.0', '0.9.0', '0.10.0'])(
    'upgrades Jobright %s while preserving protected sourcing history',
    (legacyVersion) => {
    const database = createInMemoryDatabase()
    migrateDatabase(database, { migrationsFolder: migrationFolderThrough(23) })
    database.exec(`
      insert into source_execution_scopes (id, created_at, updated_at)
      values ('scope_contract_fixture', '2026-07-12T12:00:00.000Z', '2026-07-12T12:00:00.000Z');
      insert into connector_instances (
        id, execution_scope_id, connector_id, connector_version, display_name, enabled,
        config_json, auth_json, filters_json, earliest_backfill_date, created_at, updated_at
      ) values (
        'jobright-contract', 'scope_contract_fixture', 'jobright.resolver', '${legacyVersion}',
        'Jobright contract fixture', 1,
        '{"discoveryCount":20,"${obsolete.useful}":100,"${obsolete.maxRequests}":10,"maxRunElapsedMs":120000}',
        '[{"id":"jobright","mode":"username_password","secretKey":"jobright_secret"},{"id":"legacy","mode":"${obsolete.browserMode}","${obsolete.sessionField}":"session"}]',
        '{"${obsolete.maxResolution}":10,"${obsolete.role}":["intern"]}', '2026-07-01',
        '2026-07-12T12:00:00.000Z', '2026-07-12T12:00:00.000Z'
      );
      insert into connector_runs (
        id, execution_scope_id, connector_instance_id, mode, status, started_at, completed_at,
        config_json, filters_json, filter_signature, observation_count, warning_count,
        stats_json, warnings_json, retry_hints_json, created_at, updated_at
      ) values (
        'contract-run', 'scope_contract_fixture', 'jobright-contract', 'manual', 'completed',
        '2026-07-12T12:00:00.000Z', '2026-07-12T12:01:00.000Z',
        '{"discoveryCount":20,"${obsolete.useful}":100,"${obsolete.maxRequests}":10}',
        '{"${obsolete.maxResolution}":10}', 'provider-state:jobright.resolver', 1, 0,
        '{"observations":1,"${obsolete.remaining}":99,"${obsolete.maxRequests}":10}', '[]', 'null',
        '2026-07-12T12:00:00.000Z', '2026-07-12T12:01:00.000Z'
      );
      insert into connector_checkpoints (
        connector_instance_id, filter_signature, checkpoint_json, schema_version,
        saved_at, created_at, updated_at
      ) values (
        'jobright-contract', 'provider-state:jobright.resolver',
        '{"schemaVersion":"jobright-resolution-checkpoint@5"}',
        'jobright-resolution-checkpoint@5', '2026-07-12T12:01:00.000Z',
        '2026-07-12T12:01:00.000Z', '2026-07-12T12:01:00.000Z'
      );
      insert into source_entities (id, identity_kind, identity_namespace, identity_value, created_at)
      values ('contract-entity', 'provider_job', 'jobright', 'job-1', '2026-07-12T12:00:00.000Z');
      insert into raw_source_records (id, source_entity_id, created_at)
      values ('contract-record', 'contract-entity', '2026-07-12T12:00:00.000Z');
      insert into raw_source_revisions (
        id, raw_record_id, revision, content_hash, adapter_id, adapter_kind, adapter_version,
        observed_at, provider_record_id, provider_schema, payload_json, evidence_json, created_at
      ) values (
        'contract-revision', 'contract-record', 1, 'sha256:contract', 'jobright.resolver',
        'connector', '${legacyVersion}', '2026-07-12T12:00:00.000Z', 'job-1',
        'jobright-visitor-list@1', '{}', '[]', '2026-07-12T12:00:00.000Z'
      );
      insert into raw_source_occurrences (
        id, raw_record_id, raw_revision_id, connector_instance_id, connector_run_id,
        execution_scope_id, observed_at, received_at
      ) values (
        'contract-occurrence', 'contract-record', 'contract-revision', 'jobright-contract',
        'contract-run', 'scope_contract_fixture', '2026-07-12T12:00:00.000Z', '2026-07-12T12:00:01.000Z'
      );
      insert into normalization_runs (
        id, raw_record_id, raw_revision_id, trigger_occurrence_id, trigger_connector_instance_id,
        trigger_connector_run_id, input_hash, resolver_set_hash, canonical_schema_version,
        gate_policy_version, trigger_kind, status, created_at, updated_at
      ) values (
        'contract-normalization', 'contract-record', 'contract-revision', 'contract-occurrence',
        'jobright-contract', 'contract-run', 'sha256:input', 'sha256:resolvers', 'candidate/v1',
        'gate/v1', 'intake', 'completed', '2026-07-12T12:00:01.000Z', '2026-07-12T12:00:01.000Z'
      );
      insert into canonical_source_candidates (
        id, run_id, source_entity_id, raw_record_id, raw_revision_id, schema_version, candidate_json, created_at
      ) values (
        'contract-candidate', 'contract-normalization', 'contract-entity', 'contract-record',
        'contract-revision', 'candidate/v1', '{}', '2026-07-12T12:00:01.000Z'
      );
      insert into sources (id, name, created_at, updated_at)
      values ('contract-source', 'Contract source', '2026-07-12T12:00:01.000Z', '2026-07-12T12:00:01.000Z');
      insert into workflow_runs (
        id, run_type, status, actor_type, actor_name, source_id, started_at, completed_at,
        input_json, summary, outcome, metadata_json, created_at, updated_at
      ) values (
        'contract-workflow', 'sourcing', 'completed', 'system', 'fixture', 'contract-source',
        '2026-07-12T12:00:01.000Z', '2026-07-12T12:00:01.000Z', '{}', 'fixture',
        'projected', '{}', '2026-07-12T12:00:01.000Z', '2026-07-12T12:00:01.000Z'
      );
      insert into sourcing_findings (
        id, projection_identity_key, source_entity_id, canonical_candidate_id, raw_revision_id,
        adapter_id, adapter_kind, adapter_version, workflow_run_id, source_id, company_name,
        role_title, role_kind, work_mode, merge_status, discovered_at, created_at, updated_at
      ) values (
        'contract-finding', 'source_entity:contract-entity', 'contract-entity', 'contract-candidate',
        'contract-revision', 'jobright.resolver', 'connector', '${legacyVersion}', 'contract-workflow',
        'contract-source', 'Contract Co', 'Contract Intern', 'internship', 'unclear', 'new',
        '2026-07-12T12:00:01.000Z', '2026-07-12T12:00:01.000Z', '2026-07-12T12:00:01.000Z'
      );
      insert into retry_work (
        id, kind, execution_scope_id, connector_instance_id, filter_signature,
        checkpoint_schema_version, checkpoint_generation, reason, attempt, max_attempts,
        last_attempt_at, computed_delay_ms, next_attempt_at, horizon_at, state,
        owner_version, lineage_json, created_at, updated_at
      ) values (
        'contract-capture-retry', 'connector_capture', 'scope_contract_fixture',
        'jobright-contract', 'provider-state:jobright.resolver',
        'jobright-resolution-checkpoint@5', '${legacyVersion}', 'server_failure', 1, 3,
        '2026-07-12T12:01:00.000Z', 1000, '2026-07-12T12:01:01.000Z',
        '2026-07-12T13:00:00.000Z', 'scheduled', '${legacyVersion}', '{}',
        '2026-07-12T12:01:00.000Z', '2026-07-12T12:01:00.000Z'
      );
    `)

    migrateDatabase(database)

    expect(database.prepare(`
      select connector_version, config_json, auth_json, filters_json
      from connector_instances where id = 'jobright-contract'
    `).get()).toEqual({
      connector_version: '0.11.0',
      config_json: '{"discoveryCount":20,"maxRunElapsedMs":120000}',
      auth_json: '[{"id":"jobright","mode":"username_password","secretKey":"jobright_secret"}]',
      filters_json: '{}',
    })
    expect(database.prepare(`
      select config_json, filters_json, stats_json from connector_runs where id = 'contract-run'
    `).get()).toEqual({
      config_json: '{"discoveryCount":20}',
      filters_json: '{}',
      stats_json: '{"observations":1}',
    })
    expect(database.prepare("select count(*) as count from connector_checkpoints where connector_instance_id = 'jobright-contract'").get())
      .toEqual({ count: 1 })
    expect(database.prepare("select count(*) as count from raw_source_revisions where id = 'contract-revision'").get())
      .toEqual({ count: 1 })
    for (const [table, id] of [
      ['normalization_runs', 'contract-normalization'],
      ['canonical_source_candidates', 'contract-candidate'],
      ['sourcing_findings', 'contract-finding'],
      ['source_execution_scopes', 'scope_contract_fixture'],
    ]) {
      expect(database.prepare(`select count(*) as count from ${table} where id = ?`).get(id), table)
        .toEqual({ count: 1 })
    }
    expect(database.prepare("select connector_run_id, execution_scope_id from raw_source_occurrences where id = 'contract-occurrence'").get())
      .toEqual({ connector_run_id: 'contract-run', execution_scope_id: 'scope_contract_fixture' })
    expect(database.prepare("select count(*) as count from retry_work where id = 'contract-capture-retry'").get())
      .toEqual({ count: 0 })
    expect(() => database.prepare(
      `update connector_runs set status = '${obsolete.partialSuccess}' where id = 'contract-run'`,
    ).run()).toThrow(/invalid connector run status/i)
    expect(database.prepare('pragma foreign_key_check').all()).toEqual([])
    database.close()
    },
  )
  it('removes every dependent of a partial run created after migration 0023', () => {
    const database = createInMemoryDatabase()
    migrateDatabase(database, { migrationsFolder: migrationFolderThrough(23) })
    seedDoomedConnectorRunFixture(database)
    expect(() => migrateDatabase(database)).not.toThrow()
    for (const table of ['canonical_source_candidates', 'connector_observations', 'connector_run_synchronizations',
      'connector_runs', 'connector_schedule_occurrences', 'normalization_attempts', 'normalization_field_outcomes',
      'normalization_gates', 'normalization_replay_items', 'normalization_runs', 'retry_work', 'sourcing_projection_outcomes']) {
      expect(database.prepare(`select count(*) as count from ${table}`).get(), table).toEqual({ count: 0 })
    }
    expect(database.prepare("select connector_instance_id, connector_run_id from raw_source_occurrences where id = 'preserved-occurrence'").get())
      .toEqual({ connector_instance_id: null, connector_run_id: null })
    expect(database.prepare("select count(*) as count from raw_source_revisions where id = 'doomed-revision'").get()).toEqual({ count: 1 })
    expect(database.prepare("select count(*) as count from source_execution_scopes where id = 'scope_doomed_fixture'").get()).toEqual({ count: 1 })
    expect(database.prepare("select count(*) as count from normalization_replay_requests where id = 'doomed-replay'").get()).toEqual({ count: 1 })
    expect(database.prepare('pragma foreign_key_check').all()).toEqual([])
    database.close()
  })
  it('preserves projected finding history while removing its obsolete partial connector run', () => {
    const database = createInMemoryDatabase()
    migrateDatabase(database, { migrationsFolder: migrationFolderThrough(23) })
    seedDoomedConnectorRunFixture(database)
    seedProtectedDoomedFinding(database)
    const lineageTriggers = connectorLineageTriggers(database)

    expect(() => migrateDatabase(database)).not.toThrow()
    for (const table of ['connector_observations', 'connector_run_synchronizations',
      'connector_schedule_occurrences', 'retry_work']) {
      expect(database.prepare(`select count(*) as count from ${table}`).get(), table).toEqual({ count: 0 })
    }
    expect(database.prepare("select count(*) as count from connector_runs where id = 'doomed-run'").get())
      .toEqual({ count: 0 })
    for (const [table, id] of [['normalization_runs', 'doomed-normalization'],
      ['normalization_attempts', 'doomed-attempt'], ['normalization_field_outcomes', 'doomed-field'],
      ['normalization_gates', 'doomed-gate'], ['canonical_source_candidates', 'doomed-candidate'],
      ['sourcing_projection_outcomes', 'doomed-projection'], ['sourcing_findings', 'protected-finding'],
      ['normalization_replay_requests', 'doomed-replay'], ['normalization_replay_items', 'doomed-replay-item'],
      ['raw_source_records', 'doomed-record'], ['raw_source_revisions', 'doomed-revision'],
      ['source_entities', 'doomed-entity'], ['source_execution_scopes', 'scope_doomed_fixture']] as const) {
      expect(database.prepare(`select count(*) as count from ${table} where id = ?`).get(id), table).toEqual({ count: 1 })
    }
    expect(database.prepare(`select trigger_occurrence_id, trigger_connector_instance_id, trigger_connector_run_id
      from normalization_runs where id = 'doomed-normalization'`).get()).toEqual({
      trigger_occurrence_id: null, trigger_connector_instance_id: null, trigger_connector_run_id: null,
    })
    expect(database.prepare(`select connector_instance_id, connector_run_id, execution_scope_id
      from raw_source_occurrences where id = 'preserved-occurrence'`).get()).toEqual({
      connector_instance_id: null, connector_run_id: null, execution_scope_id: 'scope_doomed_fixture',
    })
    expect(database.prepare(`select connector_id, connector_version, config_json from connector_instances
      where id = 'unrelated-instance'`).get()).toEqual({
      connector_id: 'fixture.unrelated', connector_version: '1.0.0', config_json: '{"keep":true}',
    })
    expect(database.prepare("select status from connector_runs where id = 'unrelated-run'").get())
      .toEqual({ status: 'completed' })
    expect(database.prepare('pragma foreign_key_check').all()).toEqual([])
    expect(connectorLineageTriggers(database)).toEqual(lineageTriggers)
    database.close()
  })
  it('rolls back migration 0024 partial-run cleanup atomically on failure', () => {
    const database = createInMemoryDatabase()
    migrateDatabase(database, { migrationsFolder: migrationFolderThrough(23) })
    seedDoomedConnectorRunFixture(database)
    seedProtectedDoomedFinding(database)
    const before = doomedConnectorRunMigrationState(database)
    const protectedBefore = protectedDoomedHistory(database)
    const failingMigrations = fs.mkdtempSync(path.join(os.tmpdir(), 'connector-contract-failure-'))
    fs.cpSync(path.resolve('drizzle'), failingMigrations, { recursive: true })
    fs.appendFileSync(path.join(failingMigrations, '0024_remove_stale_connector_interfaces.sql'),
      '\n--> statement-breakpoint\nselect * from intentionally_missing_contract_table;\n')
    expect(() => migrateDatabase(database, { migrationsFolder: failingMigrations }))
      .toThrow(/intentionally_missing_contract_table/)
    expect(doomedConnectorRunMigrationState(database)).toEqual(before)
    expect(protectedDoomedHistory(database)).toEqual(protectedBefore)
    expect(database.prepare('pragma foreign_key_check').all()).toEqual([])
    expect(database.prepare('select count(*) as count from __drizzle_migrations').get()).toEqual({ count: 24 })
    database.close()
  })
})

function migrationFolderThrough(maxIndex: number) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), `valedictorian-contract-through-${maxIndex}-`))
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

function seedProtectedDoomedFinding(database: ReturnType<typeof createInMemoryDatabase>) {
  database.exec(`
    insert into sources (id, name, created_at, updated_at)
    values ('protected-source', 'Protected source', '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z');
    insert into workflow_runs (
      id, run_type, status, actor_type, actor_name, source_id, started_at, completed_at,
      input_json, summary, outcome, metadata_json, created_at, updated_at
    ) values (
      'protected-workflow', 'sourcing', 'completed', 'system', 'fixture', 'protected-source',
      '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z', '{}', 'fixture', 'projected', '{}',
      '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z'
    );
    insert into sourcing_findings (
      id, projection_identity_key, source_entity_id, canonical_candidate_id, raw_revision_id,
      adapter_id, adapter_kind, adapter_version, workflow_run_id, source_id, company_name,
      role_title, role_kind, work_mode, merge_status, discovered_at, created_at, updated_at
    ) values (
      'protected-finding', 'source_entity:doomed-entity', 'doomed-entity', 'doomed-candidate',
      'doomed-revision', 'fixture.doomed', 'connector', '1.0.0', 'protected-workflow', 'protected-source',
      'Protected Co', 'Protected Role', 'internship', 'unclear', 'new', '2026-07-10T12:00:00.000Z',
      '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z'
    );
    update sourcing_projection_outcomes set status = 'projected', finding_id = 'protected-finding',
      projected_at = '2026-07-10T12:00:00.000Z' where id = 'doomed-projection';
    insert into source_execution_scopes (id, created_at, updated_at)
    values ('scope_unrelated_fixture', '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z');
    insert into connector_instances (
      id, execution_scope_id, connector_id, connector_version, display_name, enabled,
      config_json, auth_json, filters_json, created_at, updated_at
    ) values (
      'unrelated-instance', 'scope_unrelated_fixture', 'fixture.unrelated', '1.0.0', 'Unrelated', 1,
      '{"keep":true}', '[]', '{}', '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z'
    );
    insert into connector_runs (
      id, execution_scope_id, connector_instance_id, mode, status, started_at, completed_at,
      config_json, filters_json, filter_signature, observation_count, warning_count, stats_json,
      warnings_json, retry_hints_json, created_at, updated_at
    ) values (
      'unrelated-run', 'scope_unrelated_fixture', 'unrelated-instance', 'manual', 'completed',
      '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:01.000Z', '{"keep":true}', '{}',
      'filters:{}', 0, 0, '{}', '[]', 'null', '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:01.000Z'
    );
  `)
}

function protectedDoomedHistory(database: ReturnType<typeof createInMemoryDatabase>) {
  return {
    candidate: database.prepare("select * from canonical_source_candidates where id = 'doomed-candidate'").get(),
    finding: database.prepare("select * from sourcing_findings where id = 'protected-finding'").get(),
    normalization: database.prepare("select * from normalization_runs where id = 'doomed-normalization'").get(),
    occurrence: database.prepare("select * from raw_source_occurrences where id = 'preserved-occurrence'").get(),
    projection: database.prepare("select * from sourcing_projection_outcomes where id = 'doomed-projection'").get(),
    unrelated: database.prepare("select * from connector_runs where id = 'unrelated-run'").get(),
  }
}

function connectorLineageTriggers(database: ReturnType<typeof createInMemoryDatabase>) {
  return database.prepare(`select name, sql from sqlite_master where type = 'trigger' and name in (
    'trg_normalization_runs_trigger_lineage_insert', 'trg_normalization_runs_trigger_lineage_update',
    'trg_raw_source_occurrences_normalization_lineage_update', 'trg_raw_source_occurrences_normalization_lineage_delete'
  ) order by name`).all()
}
