import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createInMemoryDatabase, migrateDatabase } from './sqlite'

describe('earliest backfill date migration', () => {
  it('adds earliest_backfill_date and backfills existing instances from created_at minus 7 UTC days', () => {
    const database = createInMemoryDatabase()
    migrateDatabase(database, { migrationsFolder: migrationFolderThrough(18) })

    database.exec(`
      insert into connector_instances (
        id, connector_id, connector_version, display_name, enabled,
        config_json, auth_json, filters_json, created_at, updated_at, deleted_at
      ) values (
        'legacy-jobright', 'jobright.resolver', '0.7.0', 'Legacy Jobright', 1,
        '{}', '[]', '{}', '2026-07-11T15:30:00.000Z', '2026-07-11T15:30:00.000Z', null
      );
      insert into connector_instances (
        id, connector_id, connector_version, display_name, enabled,
        config_json, auth_json, filters_json, created_at, updated_at, deleted_at
      ) values (
        'legacy-year-boundary', 'fixture.connector', '1.0.0', 'Year boundary', 1,
        '{}', '[]', '{}', '2026-01-03T01:00:00.000Z', '2026-01-03T01:00:00.000Z', null
      );
    `)

    seedObsoleteJobrightV4State(database)
    const protectedBefore = snapshotProtectedHistory(database)

    migrateDatabase(database)

    expect(tableColumns(database, 'connector_instances')).toEqual(
      expect.arrayContaining(['earliest_backfill_date']),
    )
    expect(
      database.prepare(`
        select id, earliest_backfill_date, connector_version
        from connector_instances
        where id in ('legacy-jobright', 'legacy-year-boundary')
        order by id
      `).all(),
    ).toEqual([
      {
        id: 'legacy-jobright',
        earliest_backfill_date: '2026-07-04',
        connector_version: '0.11.0',
      },
      {
        id: 'legacy-year-boundary',
        earliest_backfill_date: '2025-12-27',
        connector_version: '1.0.0',
      },
    ])
    expect(snapshotProtectedHistory(database)).toEqual(protectedBefore)
    expect(database.prepare(`
      select count(*) as count from connector_checkpoints
      where schema_version = 'jobright-resolution-checkpoint@4'
    `).get()).toEqual({ count: 0 })
    expect(database.prepare(`
      select count(*) as count from retry_work
      where checkpoint_schema_version = 'jobright-resolution-checkpoint@4'
    `).get()).toEqual({ count: 0 })
    expect(database.prepare(`
      select count(*) as count from retry_work where id = 'keep-normalization-retry'
    `).get()).toEqual({ count: 1 })
    expect(database.prepare('select count(*) as count from __drizzle_migrations').get())
      .toEqual({ count: 27 })

    migrateDatabase(database)
    expect(
      database.prepare(`
        select earliest_backfill_date from connector_instances where id = 'legacy-jobright'
      `).get(),
    ).toEqual({ earliest_backfill_date: '2026-07-04' })
    database.close()
  })

  it('creates earliest_backfill_date on fresh schema migrations', () => {
    const database = createInMemoryDatabase()
    migrateDatabase(database)
    expect(tableColumns(database, 'connector_instances')).toEqual(
      expect.arrayContaining(['earliest_backfill_date']),
    )
    expect(database.prepare('select count(*) as count from __drizzle_migrations').get())
      .toEqual({ count: 27 })
    database.close()
  })
})

function migrationFolderThrough(maxIndex: number) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), `valedictorian-earliest-through-${maxIndex}-`))
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

function tableColumns(database: ReturnType<typeof createInMemoryDatabase>, tableName: string) {
  return database
    .prepare(`pragma table_info('${tableName}')`)
    .all()
    .map((row) => (row as { name: string }).name)
}

function seedObsoleteJobrightV4State(database: ReturnType<typeof createInMemoryDatabase>) {
  database.exec(`
    insert into connector_runs (
      id, connector_instance_id, mode, status, started_at, completed_at,
      coverage_started_at, coverage_ended_at, config_json, filters_json, filter_signature,
      observation_count, warning_count, stats_json, warnings_json, retry_hints_json,
      created_at, updated_at, deleted_at
    ) values (
      'run-keep', 'legacy-jobright', 'manual', 'completed', '2026-07-11T15:31:00.000Z',
      '2026-07-11T15:32:00.000Z', '2026-07-04T00:00:00.000Z', '2026-07-11T15:31:00.000Z',
      '{}', '{}', 'provider-state:jobright.resolver@0.7.0', 0, 0, '{}', '[]', 'null',
      '2026-07-11T15:31:00.000Z', '2026-07-11T15:32:00.000Z', null
    );
    insert into connector_observations (
      id, connector_instance_id, connector_run_id, connector_id, connector_version,
      source_record_key, observed_at, company_name, role_title, location_raw,
      description_text, pay_json, links_json, resolution_json, dedupe_keys_json,
      source_metadata_json, evidence_json, raw_json, created_at, updated_at, deleted_at
    ) values (
      'obs-keep', 'legacy-jobright', 'run-keep', 'jobright.resolver', '0.7.0',
      'jobright.public:job-1', '2026-07-11T15:31:00.000Z', 'Acme', 'Intern', null,
      null, 'null', '{"source":null,"intermediary":null,"official":null}',
      '{"status":"unresolved","method":null,"reason":null}', '[]', '{}', '[]', '{}',
      '2026-07-11T15:31:00.000Z', '2026-07-11T15:31:00.000Z', null
    );
    insert into connector_checkpoints (
      connector_instance_id, filter_signature, checkpoint_json, schema_version,
      coverage_started_at, coverage_ended_at, saved_at, created_at, updated_at, deleted_at
    ) values (
      'legacy-jobright', 'provider-state:jobright.resolver@0.7.0',
      '{"schemaVersion":"jobright-resolution-checkpoint@4","retryState":[]}',
      'jobright-resolution-checkpoint@4',
      '2026-07-04T00:00:00.000Z', '2026-07-11T15:31:00.000Z', '2026-07-11T15:32:00.000Z',
      '2026-07-11T15:32:00.000Z', '2026-07-11T15:32:00.000Z', null
    );
    insert into retry_work (
      id, kind, connector_instance_id, filter_signature, checkpoint_schema_version,
      checkpoint_generation, raw_revision_id, resolver_id, resolver_version, input_hash,
      reason, attempt, max_attempts, last_attempt_at, computed_delay_ms, server_minimum_delay_ms,
      next_attempt_at, horizon_at, state, owner_version, lineage_json,
      acquired_at, acquisition_token, acquisition_run_id, skipped_run_id,
      created_at, updated_at, deleted_at
    ) values (
      'delete-v4-capture', 'connector_capture', 'legacy-jobright',
      'provider-state:jobright.resolver@0.7.0', 'jobright-resolution-checkpoint@4',
      '0.7.0', null, null, null, null,
      'rate_limit', 1, 3, '2026-07-11T15:32:00.000Z', 60000, null,
      '2026-07-11T15:33:00.000Z', '2026-07-11T16:32:00.000Z', 'scheduled', '0.7.0',
      '{"connectorRunId":"run-keep"}', null, null, null, null,
      '2026-07-11T15:32:00.000Z', '2026-07-11T15:32:00.000Z', null
    );
    insert into source_entities (
      id, identity_kind, identity_namespace, identity_value, created_at
    ) values (
      'entity-keep', 'provider_job', 'jobright', 'job-1', '2026-07-11T15:31:00.000Z'
    );
    insert into raw_source_records (
      id, source_entity_id, created_at
    ) values (
      'raw-keep', 'entity-keep', '2026-07-11T15:31:00.000Z'
    );
    insert into raw_source_revisions (
      id, raw_record_id, revision, content_hash, adapter_id, adapter_kind, adapter_version,
      observed_at, provider_record_id, provider_schema, payload_json, evidence_json, created_at
    ) values (
      'rev-keep', 'raw-keep', 1, 'hash-keep', 'jobright.resolver', 'connector', '0.7.0',
      '2026-07-11T15:31:00.000Z', 'job-1', 'jobright.jobs/v1', '{}', '[]',
      '2026-07-11T15:31:00.000Z'
    );
    insert into raw_source_occurrences (
      id, raw_record_id, raw_revision_id, connector_instance_id, connector_run_id,
      observed_at, received_at
    ) values (
      'occ-keep', 'raw-keep', 'rev-keep', 'legacy-jobright', 'run-keep',
      '2026-07-11T15:31:00.000Z', '2026-07-11T15:31:00.000Z'
    );
    insert into retry_work (
      id, kind, connector_instance_id, filter_signature, checkpoint_schema_version,
      checkpoint_generation, raw_revision_id, resolver_id, resolver_version, input_hash,
      reason, attempt, max_attempts, last_attempt_at, computed_delay_ms, server_minimum_delay_ms,
      next_attempt_at, horizon_at, state, owner_version, lineage_json,
      acquired_at, acquisition_token, acquisition_run_id, skipped_run_id,
      created_at, updated_at, deleted_at
    ) values (
      'keep-normalization-retry', 'normalization', null, null, null, null,
      'rev-keep', 'jobright.authenticated-destination',
      'jobright-authenticated-destination@1', 'hash-input',
      'server_failure', 1, 3, '2026-07-11T15:32:00.000Z', 60000, null,
      '2026-07-11T15:33:00.000Z', '2026-07-11T16:32:00.000Z', 'scheduled', '0.7.0',
      '{"connectorInstanceId":"legacy-jobright","connectorRunId":"run-keep"}',
      null, null, null, null,
      '2026-07-11T15:32:00.000Z', '2026-07-11T15:32:00.000Z', null
    );
  `)
}

function snapshotProtectedHistory(database: ReturnType<typeof createInMemoryDatabase>) {
  return {
    connector_instances: database.prepare(`
      select id, connector_id, display_name, enabled, config_json, auth_json, filters_json,
             created_at from connector_instances order by id
    `).all(),
    connector_runs: database.prepare('select id from connector_runs order by id').all(),
    connector_observations: database.prepare('select id from connector_observations order by id').all(),
    raw_source_records: database.prepare('select id from raw_source_records order by id').all(),
    raw_source_revisions: database.prepare('select id from raw_source_revisions order by id').all(),
    raw_source_occurrences: database.prepare('select id from raw_source_occurrences order by id').all(),
    normalization_retry: database.prepare(`
      select id from retry_work where id = 'keep-normalization-retry'
    `).all(),
  }
}
