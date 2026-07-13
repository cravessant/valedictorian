import type { createInMemoryDatabase } from './sqlite'

type TestDatabase = ReturnType<typeof createInMemoryDatabase>

export function tableDefinition(database: TestDatabase, tableName: string) {
  const row = database.prepare("select sql from sqlite_master where type = 'table' and name = ?")
    .get(tableName) as { sql: string }
  return {
    checks: [...row.sql.matchAll(/constraint\s+["`]?([a-z0-9_]+)/gi)].map((match) => match[1]),
    columns: database.prepare(`pragma table_info('${tableName}')`).all(),
    foreignKeys: (database.prepare(`pragma foreign_key_list('${tableName}')`).all() as Array<Record<string, unknown>>)
      .map(({ id: _id, ...foreignKey }) => foreignKey)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  }
}

export function indexDefinition(database: TestDatabase, indexName: string) {
  const row = database.prepare("select sql from sqlite_master where type = 'index' and name = ?")
    .get(indexName) as { sql: string }
  return {
    columns: database.prepare(`pragma index_info('${indexName}')`).all(),
    predicate: row.sql.match(/\swhere\s(.+)$/i)?.[1] ?? null,
    unique: /^create unique index/i.test(row.sql),
  }
}

export function seedDoomedConnectorRunFixture(database: TestDatabase) {
  const obsoletePartialSuccess = ['partial', '_success'].join('')
  const hasExecutionScope = (database.prepare("pragma table_info('connector_instances')").all() as Array<{ name: string }>)
    .some(({ name }) => name === 'execution_scope_id')
  if (hasExecutionScope) {
    database.exec(`
      insert into source_execution_scopes (id, created_at, updated_at)
      values ('scope_doomed_fixture', '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z');
    `)
  }
  const scopeColumn = hasExecutionScope ? ', execution_scope_id' : ''
  const scopeValue = hasExecutionScope ? ", 'scope_doomed_fixture'" : ''
  database.exec(`
    insert into connector_instances (id, connector_id, connector_version, display_name, enabled, config_json, auth_json, filters_json, created_at, updated_at${scopeColumn})
    values ('doomed-instance', 'fixture.doomed', '1.0.0', 'Doomed', 1, '{}', '[]', '{}', '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z'${scopeValue});
    insert into connector_runs (id, connector_instance_id, mode, status, started_at, completed_at, config_json, filters_json, filter_signature, observation_count, warning_count, stats_json, warnings_json, retry_hints_json, created_at, updated_at${scopeColumn})
    values ('doomed-run', 'doomed-instance', 'manual', '${obsoletePartialSuccess}', '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:01.000Z', '{}', '{}', 'filters:{}', 1, 0, '{}', '[]', 'null', '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:01.000Z'${scopeValue});
    insert into connector_observations (id, connector_instance_id, connector_run_id, connector_id, connector_version, source_record_key, observed_at, company_name, role_title, pay_json, links_json, resolution_json, dedupe_keys_json, source_metadata_json, evidence_json, raw_json, created_at, updated_at)
    values ('doomed-observation', 'doomed-instance', 'doomed-run', 'fixture.doomed', '1.0.0', 'job-1', '2026-07-10T12:00:00.000Z', 'Co', 'Role', 'null', '[]', 'null', '[]', '{}', '[]', '{}', '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z');
    insert into connector_schedules (id, connector_instance_id, revision, state, cadence_json, timezone, next_eligible_at, created_at, updated_at)
    values ('doomed-schedule', 'doomed-instance', 'rev-1', 'active', '{}', 'UTC', '2026-07-11T12:00:00.000Z', '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z');
    insert into connector_schedule_occurrences (id, schedule_id, schedule_revision, nominal_at, idempotency_key, admitted_mode, outcome, connector_run_id, created_at)
    values ('doomed-schedule-occurrence', 'doomed-schedule', 'rev-1', '2026-07-10T12:00:00.000Z', 'doomed-key', 'scheduled', 'completed', 'doomed-run', '2026-07-10T12:00:00.000Z');
    insert into source_entities (id, identity_kind, identity_namespace, identity_value, created_at)
    values ('doomed-entity', 'provider_job', 'fixture.doomed', 'job-1', '2026-07-10T12:00:00.000Z');
    insert into raw_source_records (id, source_entity_id, created_at) values ('doomed-record', 'doomed-entity', '2026-07-10T12:00:00.000Z');
    insert into raw_source_revisions (id, raw_record_id, revision, content_hash, adapter_id, adapter_kind, adapter_version, observed_at, evidence_json, created_at)
    values ('doomed-revision', 'doomed-record', 1, 'sha256:doomed', 'fixture.doomed', 'connector', '1.0.0', '2026-07-10T12:00:00.000Z', '[]', '2026-07-10T12:00:00.000Z');
    insert into raw_source_occurrences (id, raw_record_id, raw_revision_id, connector_instance_id, connector_run_id, observed_at, received_at${scopeColumn})
    values ('preserved-occurrence', 'doomed-record', 'doomed-revision', 'doomed-instance', 'doomed-run', '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:01.000Z'${scopeValue});
    insert into normalization_runs (id, raw_record_id, raw_revision_id, trigger_occurrence_id, trigger_connector_instance_id, trigger_connector_run_id, input_hash, resolver_set_hash, canonical_schema_version, gate_policy_version, trigger_kind, status, created_at, updated_at)
    values ('doomed-normalization', 'doomed-record', 'doomed-revision', 'preserved-occurrence', 'doomed-instance', 'doomed-run', 'sha256:input', 'sha256:resolvers', 'candidate/v1', 'gate/v1', 'intake', 'completed', '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z');
    insert into normalization_attempts (id, run_id, raw_revision_id, sequence, resolver_id, resolver_version, input_hash, declaration_json, applicability_json, status, started_at, completed_at)
    values ('doomed-attempt', 'doomed-normalization', 'doomed-revision', 0, 'fixture', '1', 'sha256:attempt', '{}', '[]', 'completed', '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z');
    insert into normalization_field_outcomes (id, run_id, attempt_id, sequence, attempt_sequence, outcome_index, field, status, resolver_id, resolver_version, input_hash, outcome_json)
    values ('doomed-field', 'doomed-normalization', 'doomed-attempt', 0, 0, 0, 'officialUrl', 'resolved', 'fixture', '1', 'sha256:attempt', '{}');
    insert into normalization_replay_requests (id, selector_json, invalidation_json, field_directives_json, status, accepted_at, completed_at)
    values ('doomed-replay', '{}', '{}', '{}', 'completed', '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z');
    insert into normalization_replay_items (id, replay_id, raw_record_id, raw_revision_id, input_hash, sequence, status, normalization_run_id, completed_at)
    values ('doomed-replay-item', 'doomed-replay', 'doomed-record', 'doomed-revision', 'sha256:input', 0, 'completed', 'doomed-normalization', '2026-07-10T12:00:00.000Z');
    insert into canonical_source_candidates (id, run_id, source_entity_id, raw_record_id, raw_revision_id, schema_version, candidate_json, created_at)
    values ('doomed-candidate', 'doomed-normalization', 'doomed-entity', 'doomed-record', 'doomed-revision', 'candidate/v1', '{}', '2026-07-10T12:00:00.000Z');
    insert into normalization_gates (id, run_id, policy_version, status, candidate_id, gate_json, evaluated_at)
    values ('doomed-gate', 'doomed-normalization', 'gate/v1', 'passed', 'doomed-candidate', '{}', '2026-07-10T12:00:00.000Z');
    insert into sourcing_projection_outcomes (id, raw_record_id, raw_revision_id, canonical_candidate_id, status, created_at, updated_at)
    values ('doomed-projection', 'doomed-record', 'doomed-revision', 'doomed-candidate', 'pending', '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z');
    insert into retry_work (id, kind, connector_instance_id, filter_signature, checkpoint_schema_version, checkpoint_generation, reason, attempt, max_attempts, last_attempt_at, computed_delay_ms, next_attempt_at, horizon_at, state, owner_version, lineage_json, acquired_at, acquisition_token, acquisition_run_id, skipped_run_id, created_at, updated_at${scopeColumn})
    values ('doomed-retry', 'connector_capture', 'doomed-instance', 'filters:{}', 'fixture@1', '1.0.0', 'server_failure', 1, 3, '2026-07-10T12:00:00.000Z', 1000, '2026-07-10T12:00:01.000Z', '2026-07-10T13:00:00.000Z', 'acquired', '1.0.0', '{}', '2026-07-10T12:00:00.000Z', 'token', 'doomed-run', 'doomed-run', '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z'${scopeValue});
  `)
  if (hasExecutionScope) {
    database.exec(`
      insert into connector_run_synchronizations (connector_run_id, snapshot_json, created_at, updated_at)
      values ('doomed-run', '{}', '2026-07-10T12:00:01.000Z', '2026-07-10T12:00:01.000Z');
    `)
  }
}

export function doomedConnectorRunMigrationState(database: TestDatabase) {
  const dependentCounts = ['connector_runs', 'connector_observations', 'connector_schedule_occurrences', 'retry_work'].map((table) => {
    const column = table === 'connector_runs' ? 'id' : table === 'retry_work' ? 'id' : 'connector_run_id'
    return database.prepare(`select count(*) as count from ${table} where ${column} = ?`).get(table === 'retry_work' ? 'doomed-retry' : 'doomed-run')
  })
  const runReferences = (database.prepare("select name from sqlite_schema where type = 'table'").all() as Array<{ name: string }>)
    .flatMap(({ name }) => (database.prepare(`pragma foreign_key_list('${name}')`).all() as Array<{ table: string; from: string }>)
      .filter(({ table }) => table === 'connector_runs').map(({ from }) => `${name}.${from}`))
  return {
    dependentCounts,
    foreignKeyErrors: database.prepare('pragma foreign_key_check').all(),
    occurrence: database.prepare("select connector_instance_id, connector_run_id from raw_source_occurrences where id = 'preserved-occurrence'").get(),
    revision: database.prepare("select count(*) as count from raw_source_revisions where id = 'doomed-revision'").get(),
    runReferences: [...new Set(runReferences)].sort(),
  }
}
