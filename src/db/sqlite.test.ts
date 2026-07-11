import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertDataMigrationHistoryIsKnown,
  createDataMigrationUmzug,
  runDataMigrations,
} from './data-migrations'
import { createFileDatabase, createInMemoryDatabase, migrateDatabase } from './sqlite'

const expectedIdentityTriggers = [
  'trg_source_entity_identities_bound',
  'trg_source_entity_identities_no_delete',
  'trg_source_entity_identities_no_update',
  'trg_source_identity_conflicts_no_delete',
  'trg_source_identity_conflicts_no_update',
]

describe('SQLite database', () => {
  it('migrates the core tracker tables', () => {
    const database = createInMemoryDatabase()

    migrateDatabase(database)

    const tables = database
      .prepare("select name from sqlite_master where type = 'table' order by name")
      .all()
      .map((row) => (row as { name: string }).name)

    expect(tables).toContain('companies')
    expect(tables).toContain('sources')
    expect(tables).toContain('applications')
    expect(tables).toContain('application_links')
    expect(tables).toContain('application_scores')
    expect(tables).toContain('application_attempts')
    expect(tables).toContain('application_attempt_steps')
    expect(tables).toContain('workflow_runs')
    expect(tables).toContain('workflow_run_steps')
    expect(tables).toContain('sourcing_findings')
    expect(tables).toContain('connector_instances')
    expect(tables).toContain('connector_runs')
    expect(tables).toContain('connector_checkpoints')
    expect(tables).toContain('connector_observations')
    expect(tables).not.toContain('connector_projection_keys')
    expect(tables).toContain('source_entities')
    expect(tables).toContain('raw_source_records')
    expect(tables).toContain('raw_source_revisions')
    expect(tables).toContain('raw_source_occurrences')

    expect(tableColumns(database, 'applications')).toEqual(
      expect.arrayContaining(['timing_mode', 'terms_json', 'start_date', 'end_date']),
    )
    expect(tableColumns(database, 'sourcing_findings')).toEqual(
      expect.arrayContaining([
        'projection_identity_key', 'source_entity_id', 'canonical_candidate_id',
        'raw_revision_id', 'adapter_id', 'adapter_kind', 'adapter_version',
        'employment_type', 'seniority', 'location_json', 'compensation_json',
        'posted_at_json', 'timing_mode', 'terms_json', 'start_date', 'end_date',
      ]),
    )
    expect(database.prepare("select \"notnull\" as is_not_null from pragma_table_info('sourcing_findings') where name = 'country'").get())
      .toEqual({ is_not_null: 0 })
    expect(tableColumns(database, 'connector_instances')).toEqual(
      expect.arrayContaining(['config_json', 'auth_json', 'filters_json']),
    )
    expect(tableColumns(database, 'connector_runs')).toEqual(
      expect.arrayContaining(['config_json', 'filters_json', 'filter_signature']),
    )
    expect(tableColumns(database, 'connector_checkpoints')).toEqual(
      expect.arrayContaining(['filter_signature']),
    )
    expect(tableColumns(database, 'connector_observations')).toEqual(
      expect.arrayContaining(['parser_version', 'observation_schema_version']),
    )
  })

  it('creates source indexes for workflow run and sourcing filters', () => {
    const database = createInMemoryDatabase()

    migrateDatabase(database)

    const workflowRunIndexes = database
      .prepare("pragma index_list('workflow_runs')")
      .all()
      .map((row) => (row as { name: string }).name)
    const sourcingFindingIndexes = database
      .prepare("pragma index_list('sourcing_findings')")
      .all()
      .map((row) => (row as { name: string }).name)
    const sourceIndexes = database
      .prepare("pragma index_list('sources')")
      .all()
      .map((row) => (row as { name: string }).name)
    const connectorRunIndexes = database
      .prepare("pragma index_list('connector_runs')")
      .all()
      .map((row) => (row as { name: string }).name)
    const connectorObservationIndexes = database
      .prepare("pragma index_list('connector_observations')")
      .all()
      .map((row) => (row as { name: string }).name)
    const connectorCheckpointIndexes = database
      .prepare("pragma index_list('connector_checkpoints')")
      .all()
      .map((row) => (row as { name: string }).name)

    expect(workflowRunIndexes).toContain('idx_workflow_runs_source_id')
    expect(workflowRunIndexes).toContain('idx_workflow_runs_source_type_status_started')
    expect(sourcingFindingIndexes).toContain('idx_sourcing_findings_source_id')
    expect(sourcingFindingIndexes).toContain('idx_sourcing_findings_source_status_discovered')
    expect(sourcingFindingIndexes).toContain('idx_sourcing_findings_projection_identity')
    expect(sourcingFindingIndexes).toContain('idx_sourcing_findings_source_entity')
    expect(sourcingFindingIndexes).toContain('idx_sourcing_findings_canonical_candidate')
    expect(sourceIndexes).toContain('idx_sources_name')
    expect(connectorRunIndexes).toContain('idx_connector_runs_instance')
    expect(connectorRunIndexes).toContain('idx_connector_runs_instance_status_started')
    expect(connectorObservationIndexes).toContain('idx_connector_observations_instance')
    expect(connectorObservationIndexes).toContain('idx_connector_observations_run')
    expect(connectorCheckpointIndexes).toContain('idx_connector_checkpoints_instance')
  })

  it('baselines legacy app databases into Drizzle migration history', () => {
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
    `)

    migrateDatabase(database)

    const migrationRows = database
      .prepare('select created_at from __drizzle_migrations order by created_at')
      .all()
    const applicationTables = database
      .prepare("select name from sqlite_master where type = 'table' and name = 'applications'")
      .all()
    const connectorTables = database
      .prepare("select name from sqlite_master where type = 'table' and name = 'connector_observations'")
      .all()

    expect(migrationRows).toHaveLength(18)
    expect(applicationTables).toHaveLength(1)
    expect(connectorTables).toHaveLength(1)
  })

  it('creates raw source ledger tables and indexes before stamping a legacy workspace', () => {
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
    `)

    migrateDatabase(database)

    const tables = database
      .prepare(
        "select name from sqlite_master where type = 'table' and (name like '%raw_source%' or name = 'source_entities') order by name",
      )
      .all()
      .map((row) => (row as { name: string }).name)
    const indexes = database
      .prepare("select name from sqlite_master where type = 'index' and (name like 'idx_raw_source_%' or name = 'idx_source_entities_identity') order by name")
      .all()
      .map((row) => (row as { name: string }).name)

    expect(tables).toEqual([
      'raw_source_occurrences',
      'raw_source_records',
      'raw_source_revisions',
      'source_entities',
    ])
    expect(indexes).toEqual([
      'idx_raw_source_occurrences_connector_lineage',
      'idx_raw_source_occurrences_connector_run',
      'idx_raw_source_occurrences_lineage',
      'idx_raw_source_occurrences_record_chronology',
      'idx_raw_source_occurrences_revision',
      'idx_raw_source_records_source_entity',
      'idx_raw_source_revisions_id_record',
      'idx_raw_source_revisions_record_hash',
      'idx_raw_source_revisions_record_revision',
      'idx_source_entities_identity',
    ])
    expect(tableColumns(database, 'source_entities')).toEqual([
      'id',
      'identity_kind',
      'identity_namespace',
      'identity_value',
      'created_at',
    ])
    expect(
      database.prepare('select count(*) as count from __drizzle_migrations').get(),
    ).toEqual({ count: 18 })

    const freshlyMigrated = createInMemoryDatabase()
    migrateDatabase(freshlyMigrated)

    for (const table of tables) {
      expect(tableDefinition(database, table)).toEqual(tableDefinition(freshlyMigrated, table))
    }
    for (const index of indexes) {
      expect(indexDefinition(database, index)).toEqual(indexDefinition(freshlyMigrated, index))
    }
    freshlyMigrated.close()
  })

  it('transactionally resets derived connector state while preserving protected workspace state', () => {
    const oldMigrations = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-capture-migrations-'))
    fs.cpSync(path.resolve('drizzle'), oldMigrations, { recursive: true })
    const captureMigration = fs.readdirSync(oldMigrations).find((name) => name.startsWith('0015_'))
    if (!captureMigration) throw new Error('Connector capture migration fixture is missing')
    fs.rmSync(path.join(oldMigrations, captureMigration))
    const oldJournalPath = path.join(oldMigrations, 'meta', '_journal.json')
    const oldJournal = JSON.parse(fs.readFileSync(oldJournalPath, 'utf8')) as {
      entries: Array<{ idx: number }>
    }
    oldJournal.entries = oldJournal.entries.filter(({ idx }) => idx <= 14)
    fs.writeFileSync(oldJournalPath, `${JSON.stringify(oldJournal, null, 2)}\n`)
    const database = createInMemoryDatabase()
    migrateDatabase(database, { migrationsFolder: oldMigrations })
    seedResetMigrationFixture(database)
    const before = snapshotProtectedTables(database)

    migrateDatabase(database)

    expect(snapshotProtectedTables(database)).toEqual({
      ...before,
      connector_instances: before.connector_instances.map((row) => ({
        ...row,
        connector_version: '0.6.0',
      })),
    })
    for (const table of disposableResetTables) {
      expect(database.prepare(`select count(*) as count from ${table}`).get()).toEqual({ count: 0 })
    }
    expect(tableColumns(database, 'normalization_runs')).toEqual(expect.arrayContaining([
      'trigger_occurrence_id', 'trigger_connector_instance_id', 'trigger_connector_run_id',
    ]))
    expect(database.prepare(`
      select name from sqlite_master
      where type = 'index' and name in (
        'idx_raw_source_occurrences_lineage',
        'idx_raw_source_occurrences_connector_lineage',
        'idx_raw_source_occurrences_connector_run'
      ) order by name
    `).all()).toEqual([
      { name: 'idx_raw_source_occurrences_connector_lineage' },
      { name: 'idx_raw_source_occurrences_connector_run' },
      { name: 'idx_raw_source_occurrences_lineage' },
    ])
    expect(normalizationLineageTriggerNames(database)).toEqual([
      'trg_normalization_runs_trigger_lineage_insert',
      'trg_normalization_runs_trigger_lineage_update',
      'trg_raw_source_occurrences_normalization_lineage_delete',
      'trg_raw_source_occurrences_normalization_lineage_update',
    ])
    expect(database.prepare('pragma foreign_key_check').all()).toEqual([])
    database.close()
  })

  it('rolls back an unstamped legacy reset when current schema creation fails', () => {
    const database = createInMemoryDatabase()
    migrateDatabase(database, { migrationsFolder: migrationFolderThrough(14) })
    seedResetMigrationFixture(database)
    database.exec(`
      drop table __drizzle_migrations;
      create trigger inject_legacy_reset_failure
      before update of connector_version on connector_instances
      when new.connector_version = '0.6.0'
      begin select raise(abort, 'injected legacy reset failure'); end;
    `)
    const before = snapshotAllResetTables(database)

    expect(() => migrateDatabase(database)).toThrow(/injected legacy reset failure/)
    expect(snapshotAllResetTables(database)).toEqual(before)
    expect(database.prepare(`
      select count(*) as count from sqlite_master
      where type = 'table' and name = '__drizzle_migrations'
    `).get()).toEqual({ count: 0 })
    database.close()
  })

  it('resets and stamps an unstamped application database shaped through 0014', () => {
    const database = createInMemoryDatabase()
    migrateDatabase(database, { migrationsFolder: migrationFolderThrough(14) })
    seedResetMigrationFixture(database)
    const before = snapshotProtectedTables(database)
    database.exec('drop table __drizzle_migrations')

    migrateDatabase(database)

    expect(snapshotProtectedTables(database)).toEqual({
      ...before,
      connector_instances: before.connector_instances.map((row) => ({
        ...row,
        connector_version: '0.6.0',
      })),
    })
    for (const table of disposableResetTables) {
      expect(database.prepare(`select count(*) as count from ${table}`).get()).toEqual({ count: 0 })
    }
    expect(tableColumns(database, 'raw_source_occurrences')).toEqual(expect.arrayContaining([
      'connector_instance_id', 'connector_run_id',
    ]))
    expect(tableColumns(database, 'normalization_runs')).toEqual(expect.arrayContaining([
      'trigger_occurrence_id', 'trigger_connector_instance_id', 'trigger_connector_run_id',
    ]))
    expect(database.prepare('select count(*) as count from __drizzle_migrations').get())
      .toEqual({ count: 18 })
    expect(database.prepare('pragma foreign_key_check').all()).toEqual([])
    database.close()
  })

  it('rolls back the reset and version update when the migration fails', () => {
    const failingMigrations = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-failing-reset-'))
    fs.cpSync(path.resolve('drizzle'), failingMigrations, { recursive: true })
    const migrationName = fs.readdirSync(failingMigrations).find((name) => name.startsWith('0015_'))
    if (!migrationName) throw new Error('Connector reset migration fixture is missing')
    fs.appendFileSync(path.join(failingMigrations, migrationName), '\n--> statement-breakpoint\nselect * from intentionally_missing_table;\n')
    const oldMigrations = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-pre-reset-'))
    fs.cpSync(path.resolve('drizzle'), oldMigrations, { recursive: true })
    fs.rmSync(path.join(oldMigrations, migrationName))
    const journalPath = path.join(oldMigrations, 'meta', '_journal.json')
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as { entries: Array<{ idx: number }> }
    journal.entries = journal.entries.filter(({ idx }) => idx <= 14)
    fs.writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`)
    const database = createInMemoryDatabase()
    migrateDatabase(database, { migrationsFolder: oldMigrations })
    seedResetMigrationFixture(database)
    const before = snapshotAllResetTables(database)

    expect(() => migrateDatabase(database, { migrationsFolder: failingMigrations })).toThrow(/intentionally_missing_table/)
    expect(snapshotAllResetTables(database)).toEqual(before)
    expect(database.prepare('select count(*) as count from __drizzle_migrations').get()).toEqual({ count: 15 })
    database.close()
  })

  it.each(['fresh', 'migrated'] as const)(
    'keeps referenced occurrence lineage immutable in a %s current schema',
    (schemaKind) => {
      const database = createInMemoryDatabase()
      if (schemaKind === 'migrated') {
        migrateDatabase(database, { migrationsFolder: migrationFolderThrough(14) })
      }
      migrateDatabase(database)
      seedReferencedOccurrenceFixture(database)

      expect(() => database.prepare(`
        insert into normalization_runs (
          id, raw_record_id, raw_revision_id, trigger_occurrence_id,
          trigger_connector_instance_id, trigger_connector_run_id, input_hash,
          resolver_set_hash, canonical_schema_version, gate_policy_version, trigger_kind,
          status, created_at, updated_at
        ) values (
          'normalization-mismatch', 'record-one', 'revision-two', 'occurrence-one',
          'instance-one', 'connector-run-one', 'sha256:mismatch', 'sha256:resolvers',
          'candidate/v1', 'gate/v1', 'intake', 'completed',
          '2026-07-10T12:02:00.000Z', '2026-07-10T12:02:00.000Z'
        )
      `).run()).toThrow(/normalization trigger lineage mismatch/i)

      expect(() => database.prepare(`
        update raw_source_occurrences
        set connector_instance_id = 'instance-two', connector_run_id = 'connector-run-two'
        where id = 'occurrence-one'
      `).run()).toThrow(/normalization trigger occurrence is immutable/i)
      expect(() => database.prepare(`
        update raw_source_occurrences
        set raw_revision_id = 'revision-two'
        where id = 'occurrence-one'
      `).run()).toThrow(/normalization trigger occurrence is immutable/i)
      expect(() => database.prepare(`
        update raw_source_occurrences set id = 'occurrence-renamed'
        where id = 'occurrence-one'
      `).run()).toThrow(/normalization trigger occurrence is immutable/i)
      expect(() => database.prepare(`
        delete from raw_source_occurrences where id = 'occurrence-one'
      `).run()).toThrow(/normalization trigger occurrence is immutable/i)
      expect(() => database.prepare(`
        update raw_source_occurrences set observed_at = '2026-07-10T12:05:00.000Z'
        where id = 'occurrence-one'
      `).run()).not.toThrow()
      expect(database.prepare(`
        select connector_instance_id, connector_run_id, raw_revision_id
        from raw_source_occurrences where id = 'occurrence-one'
      `).get()).toEqual({
        connector_instance_id: 'instance-one',
        connector_run_id: 'connector-run-one',
        raw_revision_id: 'revision-one',
      })
      expect(() => database.prepare(`
        delete from raw_source_occurrences where id = 'occurrence-two'
      `).run()).not.toThrow()
      expect(database.prepare('pragma foreign_key_check').all()).toEqual([])
      database.close()
    },
  )

  it('creates structurally equivalent normalization history for fresh and legacy workspaces', () => {
    const legacy = createInMemoryDatabase()
    legacy.exec(`
      create table companies (
        id text primary key,
        name text not null,
        normalized_name text not null,
        website_url text,
        created_at text not null,
        updated_at text not null,
        deleted_at text
      );
    `)
    migrateDatabase(legacy)
    const fresh = createInMemoryDatabase()
    migrateDatabase(fresh)
    const tables = [
      'source_entity_identities', 'source_identity_conflicts',
      'normalization_runs', 'normalization_attempts', 'normalization_field_outcomes',
      'canonical_source_candidates', 'normalization_gates',
      'normalization_replay_requests', 'normalization_replay_items',
    ]
    const indexes = [
      'idx_source_entity_identities_identity', 'idx_source_entity_identities_entity_chronology',
      'idx_source_identity_conflicts_occurrence', 'idx_source_identity_conflicts_chronology',
      'idx_normalization_runs_cache', 'idx_normalization_runs_raw_record',
      'idx_normalization_attempts_run_sequence', 'idx_normalization_attempts_resolver',
      'idx_normalization_field_outcomes_run_sequence', 'idx_normalization_field_outcomes_selector',
      'idx_normalization_field_outcomes_resolver', 'idx_canonical_source_candidates_run',
      'idx_canonical_source_candidates_revision_schema', 'idx_normalization_gates_run',
      'idx_normalization_gates_policy',
      'idx_normalization_replay_requests_chronology',
      'idx_normalization_replay_items_sequence', 'idx_normalization_replay_items_revision',
    ]
    for (const table of tables) expect(tableDefinition(legacy, table)).toEqual(tableDefinition(fresh, table))
    for (const index of indexes) expect(indexDefinition(legacy, index)).toEqual(indexDefinition(fresh, index))
    expect(identityTriggerNames(legacy)).toEqual(expectedIdentityTriggers)
    expect(identityTriggerNames(fresh)).toEqual(expectedIdentityTriggers)
    expect(indexDefinition(fresh, 'idx_normalization_runs_cache')).toMatchObject({
      unique: true,
      predicate: expect.stringMatching(/trigger_id.*is null/i),
    })
    expect(tableDefinition(fresh, 'normalization_gates').checks).toEqual([
      'chk_normalization_gates_status', 'chk_normalization_gates_candidate',
    ])
    expect(tableDefinition(fresh, 'normalization_replay_requests').checks).toEqual([
      'chk_normalization_replay_requests_status',
    ])
    expect(tableDefinition(fresh, 'normalization_replay_items').checks).toEqual([
      'chk_normalization_replay_items_status',
    ])
    expect(tableDefinition(fresh, 'source_entity_identities').checks).toEqual([
      'chk_source_entity_identities_kind',
      'chk_source_entity_identities_namespace_length',
      'chk_source_entity_identities_value_length',
      'chk_source_entity_identities_provenance_kind',
      'chk_source_entity_identities_provenance_version_length',
      'chk_source_entity_identities_evidence_length',
    ])
    expect(fresh.prepare('pragma foreign_key_check').all()).toEqual([])
    fresh.close()
    legacy.close()
  })

  it('backfills bounded source identities without changing ledger ownership or history', () => {
    const oldMigrations = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-identity-migrations-'))
    fs.cpSync(path.resolve('drizzle'), oldMigrations, { recursive: true })
    const identityMigration = fs.readdirSync(oldMigrations).find((name) => name.startsWith('0013_'))
    if (!identityMigration) throw new Error('Source identity migration fixture is missing')
    fs.rmSync(path.join(oldMigrations, identityMigration))
    const oldJournalPath = path.join(oldMigrations, 'meta', '_journal.json')
    const oldJournal = JSON.parse(fs.readFileSync(oldJournalPath, 'utf8')) as {
      entries: Array<{ idx: number }>
    }
    oldJournal.entries = oldJournal.entries.filter(({ idx }) => idx <= 12)
    fs.writeFileSync(oldJournalPath, `${JSON.stringify(oldJournal, null, 2)}\n`)
    const database = createInMemoryDatabase()
    migrateDatabase(database, { migrationsFolder: oldMigrations })
    database.prepare("delete from __valedictorian_data_migrations where name = '20260711000000_source_identity_backfill'").run()
    database.exec(`
      insert into source_entities (id, identity_kind, identity_namespace, identity_value, created_at)
      values
        ('entity-provider', 'provider_job', 'connector:fixture:schema:v1', 'job-1', '2026-07-10T12:00:00.000Z'),
        ('entity-destination', 'destination_url', 'deterministic-destination/v1', 'https://jobs.lever.co/acme/job-2', '2026-07-10T12:01:00.000Z');
      insert into raw_source_records (id, source_entity_id, created_at)
      values
        ('record-provider', 'entity-provider', '2026-07-10T12:00:00.000Z'),
        ('record-destination', 'entity-destination', '2026-07-10T12:01:00.000Z');
      insert into raw_source_revisions (
        id, raw_record_id, revision, content_hash, adapter_id, adapter_kind, adapter_version,
        observed_at, payload_json, evidence_json, created_at
      ) values
        ('revision-provider', 'record-provider', 1, 'sha256:provider', 'fixture', 'connector', '1.0.0',
         '2026-07-10T12:00:00.000Z', '{}', '[]', '2026-07-10T12:00:00.000Z'),
        ('revision-destination', 'record-destination', 1, 'sha256:destination', 'fixture', 'manual', '1.0.0',
         '2026-07-10T12:01:00.000Z', '{}', '[]', '2026-07-10T12:01:00.000Z');
    `)

    migrateDatabase(database, { migrationsFolder: migrationFolderThrough(14) })
    migrateDatabase(database, { migrationsFolder: migrationFolderThrough(14) })

    expect(database.prepare(`
      select source_entity_id, identity_kind, identity_namespace, identity_value,
        provenance_kind, provenance_version, evidence_json, created_at
      from source_entity_identities order by source_entity_id
    `).all()).toEqual([
      {
        source_entity_id: 'entity-destination', identity_kind: 'canonical_destination',
        identity_namespace: 'deterministic-destination/v1', identity_value: 'https://jobs.lever.co/acme/job-2',
        provenance_kind: 'primary_backfill', provenance_version: 'source-identity-backfill/v1',
        evidence_json: '{"legacyIdentityKind":"destination_url"}', created_at: '2026-07-10T12:01:00.000Z',
      },
      {
        source_entity_id: 'entity-provider', identity_kind: 'provider_job',
        identity_namespace: 'connector:fixture:schema:v1', identity_value: 'job-1',
        provenance_kind: 'primary_backfill', provenance_version: 'source-identity-backfill/v1',
        evidence_json: '{"legacyIdentityKind":"provider_job"}', created_at: '2026-07-10T12:00:00.000Z',
      },
    ])
    expect(database.prepare('select id, source_entity_id from raw_source_records order by id').all()).toEqual([
      { id: 'record-destination', source_entity_id: 'entity-destination' },
      { id: 'record-provider', source_entity_id: 'entity-provider' },
    ])
    expect(database.prepare('select id, raw_record_id from raw_source_revisions order by id').all()).toEqual([
      { id: 'revision-destination', raw_record_id: 'record-destination' },
      { id: 'revision-provider', raw_record_id: 'record-provider' },
    ])
    const insertManagedIdentity = database.prepare(`
      insert into source_entity_identities (
        id, source_entity_id, identity_kind, identity_namespace, identity_value,
        provenance_kind, provenance_version, evidence_json, created_at
      ) values (?, 'entity-provider', 'destination_alias', 'managed-bound/v1', ?,
        'normalization', 'source-identity-reconciliation/v1', '{}', '2026-07-10T12:02:00.000Z')
    `)
    for (let index = 0; index < 31; index += 1) {
      insertManagedIdentity.run(`managed-bound-${index}`, `https://jobs.lever.co/acme/managed-${index}`)
    }
    expect(() => insertManagedIdentity.run('managed-bound-overflow', 'https://jobs.lever.co/acme/managed-overflow')).toThrow(/identity bound/i)
    expect(database.prepare('pragma foreign_key_check').all()).toEqual([])
    expect(identityTriggerNames(database)).toEqual(expectedIdentityTriggers)
    database.close()
  })

  it('enforces append-only identity and conflict provenance in SQLite', () => {
    const database = createInMemoryDatabase()
    migrateDatabase(database, { migrationsFolder: migrationFolderThrough(14) })
    database.exec(`
      insert into source_entities (id, identity_kind, identity_namespace, identity_value, created_at)
      values ('entity-1', 'provider_job', 'fixture', 'job-1', '2026-07-10T12:00:00.000Z');
      insert into raw_source_records (id, source_entity_id, created_at)
      values ('record-1', 'entity-1', '2026-07-10T12:00:00.000Z');
      insert into raw_source_revisions (
        id, raw_record_id, revision, content_hash, adapter_id, adapter_kind, adapter_version,
        observed_at, payload_json, evidence_json, created_at
      ) values (
        'revision-1', 'record-1', 1, 'sha256:one', 'fixture', 'connector', '1.0.0',
        '2026-07-10T12:00:00.000Z', '{}', '[]', '2026-07-10T12:00:00.000Z'
      );
      insert into source_entity_identities (
        id, source_entity_id, identity_kind, identity_namespace, identity_value,
        provenance_kind, provenance_version, evidence_json, raw_revision_id, created_at
      ) values (
        'identity-1', 'entity-1', 'provider_job', 'fixture', 'job-1',
        'capture', 'raw-source-capture/v1', '{}', 'revision-1', '2026-07-10T12:00:00.000Z'
      );
      insert into source_identity_conflicts (
        id, source_entity_id, raw_revision_id, identity_kind, identity_namespace,
        identity_value, reason, provenance_version, evidence_json, created_at
      ) values (
        'conflict-1', 'entity-1', 'revision-1', 'canonical_destination',
        'deterministic-destination/v1', 'https://jobs.lever.co/acme/job-2', 'fixture conflict',
        'source-identity-reconciliation/v1', '{}', '2026-07-10T12:00:00.000Z'
      );
    `)

    expect(() => database.prepare("update source_entity_identities set evidence_json = '{\"changed\":true}' where id = 'identity-1'").run()).toThrow(/append-only/i)
    expect(() => database.prepare("delete from source_entity_identities where id = 'identity-1'").run()).toThrow(/append-only/i)
    expect(() => database.prepare("update source_identity_conflicts set reason = 'changed' where id = 'conflict-1'").run()).toThrow(/append-only/i)
    expect(() => database.prepare("delete from source_identity_conflicts where id = 'conflict-1'").run()).toThrow(/append-only/i)
    const insertIdentity = database.prepare(`
      insert into source_entity_identities (
        id, source_entity_id, identity_kind, identity_namespace, identity_value,
        provenance_kind, provenance_version, evidence_json, created_at
      ) values (?, 'entity-1', 'destination_alias', 'fixture-bound/v1', ?,
        'normalization', 'source-identity-reconciliation/v1', '{}', '2026-07-10T12:01:00.000Z')
    `)
    for (let index = 0; index < 31; index += 1) {
      insertIdentity.run(`bounded-${index}`, `https://jobs.lever.co/acme/bounded-${index}`)
    }
    expect(() => insertIdentity.run('bounded-overflow', 'https://jobs.lever.co/acme/bounded-overflow')).toThrow(/identity bound/i)
    expect(database.prepare("select count(*) as count from source_entity_identities where source_entity_id = 'entity-1'").get()).toEqual({ count: 32 })
    expect(database.prepare('pragma foreign_key_check').all()).toEqual([])
    database.close()
  })

  it('upgrades persisted normalization history to replay support without breaking foreign keys', () => {
    const oldMigrations = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-old-migrations-'))
    fs.cpSync(path.resolve('drizzle'), oldMigrations, { recursive: true })
    const replayMigration = fs.readdirSync(oldMigrations).find((name) => name.startsWith('0012_'))
    if (!replayMigration) throw new Error('Replay migration fixture is missing')
    fs.rmSync(path.join(oldMigrations, replayMigration))
    const oldJournalPath = path.join(oldMigrations, 'meta', '_journal.json')
    const oldJournal = JSON.parse(fs.readFileSync(oldJournalPath, 'utf8')) as {
      entries: Array<{ idx: number }>
    }
    oldJournal.entries = oldJournal.entries.filter(({ idx }) => idx <= 11)
    fs.writeFileSync(oldJournalPath, `${JSON.stringify(oldJournal, null, 2)}\n`)

    const database = createInMemoryDatabase()
    migrateDatabase(database, { migrationsFolder: oldMigrations })
    database.exec(`
      insert into source_entities (id, identity_kind, identity_namespace, identity_value, created_at)
      values ('entity-1', 'provider_job', 'fixture', 'job-1', '2026-07-10T12:00:00.000Z');
      insert into raw_source_records (id, source_entity_id, created_at)
      values ('record-1', 'entity-1', '2026-07-10T12:00:00.000Z');
      insert into raw_source_revisions (
        id, raw_record_id, revision, content_hash, adapter_id, adapter_kind, adapter_version,
        observed_at, provider_record_id, payload_json, evidence_json, created_at
      ) values (
        'revision-1', 'record-1', 1, 'sha256:fixture', 'fixture', 'manual', '1.0.0',
        '2026-07-10T12:00:00.000Z', 'job-1', '{}', '[]', '2026-07-10T12:00:00.000Z'
      );
      insert into normalization_runs (
        id, raw_record_id, raw_revision_id, input_hash, resolver_set_hash,
        canonical_schema_version, gate_policy_version, trigger_kind, trigger_id,
        status, created_at, updated_at
      ) values (
        'run-1', 'record-1', 'revision-1', 'sha256:input', 'sha256:resolvers',
        'canonical-source-candidate/v1', 'sourcing-admission/v1', 'intake', null,
        'completed', '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z'
      );
      insert into normalization_attempts (
        id, run_id, raw_revision_id, sequence, resolver_id, resolver_version, input_hash,
        declaration_json, applicability_json, status, started_at, completed_at
      ) values (
        'attempt-1', 'run-1', 'revision-1', 0, 'fixture', '1.0.0', 'sha256:attempt',
        '{}', '[]', 'completed', '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z'
      );
    `)

    migrateDatabase(database, { migrationsFolder: migrationFolderThrough(14) })

    expect(database.prepare('select id, trigger_kind, trigger_id from normalization_runs').all())
      .toEqual([{ id: 'run-1', trigger_kind: 'intake', trigger_id: null }])
    expect(database.prepare('select id, run_id from normalization_attempts').all())
      .toEqual([{ id: 'attempt-1', run_id: 'run-1' }])
    expect(() => database.exec(`
      insert into normalization_runs (
        id, raw_record_id, raw_revision_id, input_hash, resolver_set_hash,
        canonical_schema_version, gate_policy_version, trigger_kind, trigger_id,
        status, created_at, updated_at
      ) values (
        'run-duplicate-intake', 'record-1', 'revision-1', 'sha256:input', 'sha256:resolvers',
        'canonical-source-candidate/v1', 'sourcing-admission/v1', 'intake', null,
        'completed', '2026-07-10T12:01:00.000Z', '2026-07-10T12:01:00.000Z'
      );
    `)).toThrow(/unique/i)
    database.exec(`
      insert into normalization_runs (
        id, raw_record_id, raw_revision_id, input_hash, resolver_set_hash,
        canonical_schema_version, gate_policy_version, trigger_kind, trigger_id,
        status, created_at, updated_at
      ) values
      (
        'run-replay-1', 'record-1', 'revision-1', 'sha256:input', 'sha256:resolvers',
        'canonical-source-candidate/v1', 'sourcing-admission/v1', 'intake', 'replay-1',
        'completed', '2026-07-10T12:02:00.000Z', '2026-07-10T12:02:00.000Z'
      ),
      (
        'run-replay-2', 'record-1', 'revision-1', 'sha256:input', 'sha256:resolvers',
        'canonical-source-candidate/v1', 'sourcing-admission/v1', 'intake', 'replay-2',
        'completed', '2026-07-10T12:03:00.000Z', '2026-07-10T12:03:00.000Z'
      );
    `)
    expect(database.prepare("select id from normalization_runs where trigger_id is not null order by id").all())
      .toEqual([{ id: 'run-replay-1' }, { id: 'run-replay-2' }])
    expect(database.prepare('pragma foreign_key_check').all()).toEqual([])
    expect(tableColumns(database, 'normalization_replay_requests')).toContain('completed_at')
    database.close()
  })

  it('removes legacy observation projection linkage while retaining version metadata', () => {
    const database = createInMemoryDatabase()
    database.exec(`
      create table connector_observations (
        id text primary key,
        connector_instance_id text not null,
        connector_run_id text not null,
        connector_id text not null,
        connector_version text not null,
        source_record_key text not null,
        observed_at text not null,
        company_name text not null,
        role_title text not null,
        location_raw text,
        description_text text,
        pay_json text not null,
        links_json text not null,
        resolution_json text not null,
        dedupe_keys_json text not null,
        source_metadata_json text not null,
        evidence_json text not null,
        raw_json text not null,
        created_at text not null,
        updated_at text not null,
        deleted_at text
      );
    `)

    migrateDatabase(database)

    const connectorObservationIndexes = database
      .prepare("pragma index_list('connector_observations')")
      .all()
      .map((row) => (row as { name: string }).name)

    expect(tableColumns(database, 'connector_observations')).toEqual(
      expect.arrayContaining([
        'parser_version',
        'observation_schema_version',
      ]),
    )
    expect(tableColumns(database, 'connector_observations')).not.toContain('sourcing_finding_id')
    expect(connectorObservationIndexes).not.toContain('idx_connector_observations_sourcing_finding')
    expect(
      database
        .prepare("select name from sqlite_master where type = 'table' and name = 'connector_projection_keys'")
        .all(),
    ).toHaveLength(0)
  })

  it('recreates current scoped checkpoints without legacy execution state', () => {
    const database = createInMemoryDatabase()
    database.exec(`
      create table connector_instances (
        id text primary key,
        connector_id text not null,
        connector_version text not null,
        display_name text not null,
        enabled integer not null,
        config_json text not null,
        created_at text not null,
        updated_at text not null,
        deleted_at text
      );

      create table connector_runs (
        id text primary key,
        connector_instance_id text not null references connector_instances(id),
        mode text not null,
        status text not null,
        started_at text not null,
        completed_at text,
        coverage_started_at text,
        coverage_ended_at text,
        observation_count integer not null,
        warning_count integer not null,
        stats_json text not null,
        warnings_json text not null,
        retry_hints_json text not null,
        created_at text not null,
        updated_at text not null,
        deleted_at text
      );

      create table connector_checkpoints (
        connector_instance_id text primary key references connector_instances(id),
        checkpoint_json text not null,
        schema_version text not null,
        coverage_started_at text,
        coverage_ended_at text,
        saved_at text not null,
        created_at text not null,
        updated_at text not null,
        deleted_at text
      );

      insert into connector_instances (
        id,
        connector_id,
        connector_version,
        display_name,
        enabled,
        config_json,
        created_at,
        updated_at,
        deleted_at
      ) values (
        'connector-instance-fixture',
        'fixture.jobs',
        '0.0.0-fixture',
        'Fixture jobs',
        1,
        '{}',
        '2026-07-08T15:00:00.000Z',
        '2026-07-08T15:00:00.000Z',
        null
      );

      insert into connector_checkpoints (
        connector_instance_id,
        checkpoint_json,
        schema_version,
        coverage_started_at,
        coverage_ended_at,
        saved_at,
        created_at,
        updated_at,
        deleted_at
      ) values (
        'connector-instance-fixture',
        '{"cursor":"legacy"}',
        'fixture-checkpoint@1',
        '2026-07-01T00:00:00.000Z',
        '2026-07-08T16:00:00.000Z',
        '2026-07-08T16:00:01.000Z',
        '2026-07-08T16:00:01.000Z',
        '2026-07-08T16:00:01.000Z',
        null
      );
    `)

    migrateDatabase(database)

    expect(tableColumns(database, 'connector_instances')).toEqual(
      expect.arrayContaining(['auth_json', 'filters_json']),
    )
    expect(tableColumns(database, 'connector_runs')).toEqual(
      expect.arrayContaining(['config_json', 'filters_json', 'filter_signature']),
    )
    expect(tableColumns(database, 'connector_checkpoints')).toContain('filter_signature')
    expect(database.prepare('select * from connector_checkpoints').all()).toEqual([])

    database
      .prepare(
        `
          insert into connector_checkpoints (
            connector_instance_id,
            filter_signature,
            checkpoint_json,
            schema_version,
            saved_at,
            created_at,
            updated_at
          ) values (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        'connector-instance-fixture',
        'filters:{"roleKeywords":["intern"]}',
        '{"cursor":"intern"}',
        'fixture-checkpoint@1',
        '2026-07-08T17:00:01.000Z',
        '2026-07-08T17:00:01.000Z',
        '2026-07-08T17:00:01.000Z',
      )

    expect(
      database
        .prepare('select filter_signature from connector_checkpoints order by filter_signature')
        .all(),
    ).toEqual([{ filter_signature: 'filters:{"roleKeywords":["intern"]}' }])
  })

  it('migrates legacy policy queue config to action queue config', () => {
    const database = createInMemoryDatabase()
    database.exec(`
      create table policy_config (
        id text primary key,
        config_json text not null,
        created_at text not null,
        updated_at text not null
      );
    `)
    database
      .prepare(
        `
          insert into policy_config (id, config_json, created_at, updated_at)
          values (?, ?, ?, ?)
        `,
      )
      .run(
        'active',
        JSON.stringify({
          version: 1,
          scoring: { applyCutoff: 7 },
          queue: { staleLockHours: 5 },
        }),
        '2026-06-04T16:00:00.000Z',
        '2026-06-04T16:00:00.000Z',
      )

    migrateDatabase(database)

    const row = database.prepare('select config_json from policy_config where id = ?').get('active') as {
      config_json: string
    }
    const config = JSON.parse(row.config_json) as Record<string, unknown>

    expect(config).toMatchObject({
      version: 2,
      scoring: { applyCutoff: 7 },
      actionQueue: { staleLockHours: 5 },
    })
    expect(config).not.toHaveProperty('queue')

    const dataMigrationRows = database
      .prepare('select name from __valedictorian_data_migrations')
      .all()
    expect(dataMigrationRows).toEqual([
      {
        name: '20260630000000_policy_config_v2',
      },
      {
        name: '20260702000000_job_timing_terms',
      },
      {
        name: '20260711000000_source_identity_backfill',
      },
    ])
  })

  it('backfills recognized legacy timing terms and preserves unrecognized labels', async () => {
    const database = createInMemoryDatabase()
    database.exec(`
      create table policy_config (
        id text primary key,
        config_json text not null,
        created_at text not null,
        updated_at text not null
      );

      create table applications (
        id text primary key,
        term text,
        timing_mode text not null default 'unknown',
        terms_json text not null default '[]',
        start_date text,
        end_date text
      );

      create table sourcing_findings (
        id text primary key,
        term text,
        timing_mode text not null default 'unknown',
        terms_json text not null default '[]',
        start_date text,
        end_date text
      );

      insert into applications (id, term) values
        ('application-recognized', 'Fall 2026 internship'),
        ('application-display-only', 'Internship');

      insert into sourcing_findings (id, term) values
        ('finding-recognized', 'Academic Year 2026');
    `)

    await createDataMigrationUmzug(database).up()

    expect(database.prepare('select timing_mode, terms_json from applications where id = ?').get('application-recognized')).toEqual({
      timing_mode: 'terms',
      terms_json: '[{"season":"fall","year":2026}]',
    })
    expect(database.prepare('select timing_mode, terms_json from applications where id = ?').get('application-display-only')).toEqual({
      timing_mode: 'unknown',
      terms_json: '[]',
    })
    expect(database.prepare('select timing_mode, terms_json from sourcing_findings where id = ?').get('finding-recognized')).toEqual({
      timing_mode: 'terms',
      terms_json: '[{"season":"fall","year":2026},{"season":"spring","year":2027}]',
    })
  })

  it('accepts the historical projection ledger without mutating legacy findings', () => {
    const database = createInMemoryDatabase()
    database.exec(`
      create table policy_config (
        id text primary key,
        config_json text not null,
        created_at text not null,
        updated_at text not null
      );
      create table sourcing_findings (
        id text primary key,
        term text,
        timing_mode text not null default 'unknown',
        terms_json text not null default '[]',
        start_date text,
        end_date text,
        official_url text,
        source_url text,
        destination_class text,
        destination_url text,
        intermediary_url text,
        usability text,
        blocker text,
        merge_status text not null,
        merge_notes text,
        updated_at text not null
      );
      create table connector_observations (
        id text primary key,
        connector_id text not null,
        connector_version text not null,
        links_json text not null,
        sourcing_finding_id text,
        observed_at text not null,
        deleted_at text
      );
      insert into sourcing_findings (
        id, official_url, source_url, merge_status, updated_at
      ) values (
        'finding-legacy',
        'https://www.linkedin.com/jobs/view/123456',
        'https://jobright.ai/jobs/info/job-123456',
        'new',
        '2026-07-09T18:00:00.000Z'
      );
      insert into sourcing_findings (
        id, official_url, source_url, destination_class, destination_url,
        intermediary_url, usability, merge_status, updated_at
      ) values (
        'finding-current',
        'https://jobs.lever.co/example/current-role',
        'https://jobright.ai/jobs/info/job-current',
        'employer_or_ats',
        'https://jobs.lever.co/example/current-role',
        'https://jobright.ai/jobs/info/job-current',
        'usable',
        'new',
        '2026-07-10T18:00:00.000Z'
      );
      insert into sourcing_findings (
        id, official_url, source_url, merge_status, updated_at
      ) values (
        'finding-external-source',
        'https://www.linkedin.com/jobs/view/external-role',
        'https://www.linkedin.com/jobs/view/external-role',
        'new',
        '2026-07-09T19:00:00.000Z'
      );
      insert into sourcing_findings (
        id, official_url, source_url, destination_class, destination_url,
        intermediary_url, usability, merge_status, updated_at
      ) values
        (
          'finding-prerelease',
          'https://jobs.lever.co/example/prerelease',
          'https://jobright.ai/jobs/info/prerelease',
          'employer_or_ats',
          'https://jobs.lever.co/example/prerelease',
          'https://jobright.ai/jobs/info/prerelease',
          'usable', 'new', '2026-07-09T20:00:00.000Z'
        ),
        (
          'finding-garbage-version',
          'https://jobs.lever.co/example/garbage',
          'https://jobright.ai/jobs/info/garbage',
          'employer_or_ats',
          'https://jobs.lever.co/example/garbage',
          'https://jobright.ai/jobs/info/garbage',
          'usable', 'new', '2026-07-09T20:01:00.000Z'
        ),
        (
          'finding-later-stable',
          'https://jobs.lever.co/example/later',
          'https://jobright.ai/jobs/info/later',
          'employer_or_ats',
          'https://jobs.lever.co/example/later',
          'https://jobright.ai/jobs/info/later',
          'usable', 'new', '2026-07-09T20:02:00.000Z'
        );
      insert into connector_observations (
        id, connector_id, connector_version, links_json, sourcing_finding_id, observed_at, deleted_at
      ) values (
        'observation-legacy',
        'jobright.resolver',
        '0.4.1',
        '{"source":"https://jobright.ai/jobs/info/job-123456","intermediary":"https://jobright.ai/jobs/info/job-123456","official":"https://www.linkedin.com/jobs/view/123456"}',
        'finding-legacy',
        '2026-07-09T18:00:00.000Z',
        null
      );
      insert into connector_observations (
        id, connector_id, connector_version, links_json, sourcing_finding_id, observed_at, deleted_at
      ) values
        (
          'observation-prerelease', 'jobright.resolver', '0.4.3-beta.1',
          '{"source":"https://jobright.ai/jobs/info/prerelease","intermediary":"https://jobright.ai/jobs/info/prerelease","official":"https://jobs.lever.co/example/prerelease"}',
          'finding-prerelease', '2026-07-09T20:00:00.000Z', null
        ),
        (
          'observation-garbage-version', 'jobright.resolver', '0.4.3garbage',
          '{"source":"https://jobright.ai/jobs/info/garbage","intermediary":"https://jobright.ai/jobs/info/garbage","official":"https://jobs.lever.co/example/garbage"}',
          'finding-garbage-version', '2026-07-09T20:01:00.000Z', null
        ),
        (
          'observation-later-stable', 'jobright.resolver', '0.4.4',
          '{"source":"https://jobright.ai/jobs/info/later","intermediary":"https://jobright.ai/jobs/info/later","official":"https://jobs.lever.co/example/later"}',
          'finding-later-stable', '2026-07-09T20:02:00.000Z', null
        );
      insert into connector_observations (
        id, connector_id, connector_version, links_json, sourcing_finding_id, observed_at, deleted_at
      ) values
        (
          'observation-current-newest', 'jobright.resolver', '0.4.3',
          '{"source":"https://jobright.ai/jobs/info/job-current","intermediary":"https://jobright.ai/jobs/info/job-current","official":"https://jobs.lever.co/example/current-role"}',
          'finding-current', '2026-07-10T18:00:00.000Z', null
        ),
        (
          'observation-current-older', 'jobright.resolver', '0.4.1',
          '{"source":"https://jobright.ai/jobs/info/job-current","intermediary":"https://jobright.ai/jobs/info/job-current","official":"https://www.linkedin.com/jobs/view/stale"}',
          'finding-current', '2026-07-09T17:00:00.000Z', null
        );
      insert into connector_observations (
        id, connector_id, connector_version, links_json, sourcing_finding_id, observed_at, deleted_at
      ) values (
        'observation-external-source',
        'jobright.resolver',
        '0.4.1',
        '{"source":"https://www.linkedin.com/jobs/view/external-role","intermediary":null,"official":"https://www.linkedin.com/jobs/view/external-role"}',
        'finding-external-source',
        '2026-07-09T19:00:00.000Z',
        null
      );
    `)

    database.exec(`
      create table __valedictorian_data_migrations (
        name text primary key,
        created_at text not null
      );
      insert into __valedictorian_data_migrations (name, created_at)
      values ('20260710000000_sourcing_destination_projection', '2026-07-10T00:00:00.000Z');
    `)
    expect(() => assertDataMigrationHistoryIsKnown(database)).not.toThrow()
    runDataMigrations(database)

    expect(database.prepare(`
      select destination_class, destination_url, intermediary_url, usability,
        official_url, source_url, merge_status
      from sourcing_findings where id = 'finding-legacy'
    `).get()).toEqual({
      destination_class: null,
      destination_url: null,
      intermediary_url: null,
      usability: null,
      official_url: 'https://www.linkedin.com/jobs/view/123456',
      source_url: 'https://jobright.ai/jobs/info/job-123456',
      merge_status: 'new',
    })
    expect(JSON.parse((database.prepare(`
      select links_json from connector_observations where id = 'observation-legacy'
    `).get() as { links_json: string }).links_json)).toEqual({
      source: 'https://jobright.ai/jobs/info/job-123456',
      intermediary: 'https://jobright.ai/jobs/info/job-123456',
      official: 'https://www.linkedin.com/jobs/view/123456',
    })
    expect(database.prepare(`
      select destination_class, destination_url, intermediary_url, usability, official_url
      from sourcing_findings where id = 'finding-current'
    `).get()).toEqual({
      destination_class: 'employer_or_ats',
      destination_url: 'https://jobs.lever.co/example/current-role',
      intermediary_url: 'https://jobright.ai/jobs/info/job-current',
      usability: 'usable',
      official_url: 'https://jobs.lever.co/example/current-role',
    })
    expect(database.prepare(`
      select destination_class, destination_url, intermediary_url, usability,
        official_url, source_url, merge_status
      from sourcing_findings where id = 'finding-external-source'
    `).get()).toEqual({
      destination_class: null,
      destination_url: null,
      intermediary_url: null,
      usability: null,
      official_url: 'https://www.linkedin.com/jobs/view/external-role',
      source_url: 'https://www.linkedin.com/jobs/view/external-role',
      merge_status: 'new',
    })
    expect(JSON.parse((database.prepare(`
      select links_json from connector_observations where id = 'observation-external-source'
    `).get() as { links_json: string }).links_json)).toEqual({
      source: 'https://www.linkedin.com/jobs/view/external-role',
      intermediary: null,
      official: 'https://www.linkedin.com/jobs/view/external-role',
    })
    expect(database.prepare(`
      select id, destination_class, destination_url, usability, official_url, merge_status
      from sourcing_findings
      where id in ('finding-prerelease', 'finding-garbage-version', 'finding-later-stable')
      order by id
    `).all()).toEqual([
      {
        id: 'finding-garbage-version',
        destination_class: 'employer_or_ats',
        destination_url: 'https://jobs.lever.co/example/garbage',
        usability: 'usable',
        official_url: 'https://jobs.lever.co/example/garbage',
        merge_status: 'new',
      },
      {
        id: 'finding-later-stable',
        destination_class: 'employer_or_ats',
        destination_url: 'https://jobs.lever.co/example/later',
        usability: 'usable',
        official_url: 'https://jobs.lever.co/example/later',
        merge_status: 'new',
      },
      {
        id: 'finding-prerelease',
        destination_class: 'employer_or_ats',
        destination_url: 'https://jobs.lever.co/example/prerelease',
        usability: 'usable',
        official_url: 'https://jobs.lever.co/example/prerelease',
        merge_status: 'new',
      },
    ])
  })

  it('records data migrations through Umzug SQLite storage', async () => {
    const database = createInMemoryDatabase()
    database.exec(`
      create table policy_config (
        id text primary key,
        config_json text not null,
        created_at text not null,
        updated_at text not null
      );
    `)

    await createDataMigrationUmzug(database).up()

    const dataMigrationRows = database
      .prepare('select name from __valedictorian_data_migrations')
      .all()
    expect(dataMigrationRows).toEqual([
      {
        name: '20260630000000_policy_config_v2',
      },
      {
        name: '20260702000000_job_timing_terms',
      },
      {
        name: '20260711000000_source_identity_backfill',
      },
    ])
  })

  it('backs up non-empty file databases before migration', () => {
    const databaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-backup-'))
    const databasePath = path.join(databaseRoot, 'valedictorian.sqlite')
    const backupDirectory = path.join(databaseRoot, 'backups')
    const database = createFileDatabase(databasePath)
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
    `)

    migrateDatabase(database, {
      backupDirectory,
      now: () => new Date('2026-06-30T17:00:00.000Z'),
    })
    database.close()

    const backupFileName = 'valedictorian.sqlite.2026-06-30T17-00-00-000Z.bak'
    expect(fs.readdirSync(backupDirectory)).toEqual([backupFileName])

    const backup = createFileDatabase(path.join(backupDirectory, backupFileName))
    const backupTables = backup
      .prepare("select name from sqlite_master where type = 'table' and name = 'companies'")
      .all()
    backup.close()

    expect(backupTables).toHaveLength(1)
  })

  it('rejects databases with newer Drizzle schema history', () => {
    const database = createInMemoryDatabase()
    database.exec(`
      create table __drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text not null,
        created_at numeric
      );

      insert into __drizzle_migrations (hash, created_at)
      values ('future', 9999999999999);
    `)

    expect(() => migrateDatabase(database)).toThrow('Workspace schema is newer')
  })

  it('rejects databases with unrecognized Drizzle schema history', () => {
    const database = createInMemoryDatabase()
    database.exec(`
      create table __drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text not null,
        created_at numeric
      );

      insert into __drizzle_migrations (hash, created_at)
      values ('unknown', 1);
    `)

    expect(() => migrateDatabase(database)).toThrow('schema migration history is not recognized')
  })

  it('rejects databases with newer data migration history', () => {
    const database = createInMemoryDatabase()
    database.exec(`
      create table __valedictorian_data_migrations (
        name text primary key,
        created_at text not null
      );

      insert into __valedictorian_data_migrations (name, created_at)
      values ('29990101000000_future_data_change', '2999-01-01T00:00:00.000Z');
    `)

    expect(() => migrateDatabase(database)).toThrow('Workspace data migrations are newer')
  })

  it('enables local file database pragmas for agent access', () => {
    const databasePath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-pragmas-')),
      'valedictorian.sqlite',
    )
    const database = createFileDatabase(databasePath)

    expect(database.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(database.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(database.pragma('busy_timeout', { simple: true })).toBeGreaterThan(0)

    database.close()
  })
})

const protectedResetTables = [
  'companies', 'sources', 'applications', 'application_links', 'application_scores',
  'application_workflow_states', 'application_events', 'application_attempts',
  'application_attempt_steps', 'workflow_runs', 'workflow_run_steps', 'user_profile',
  'profile_education', 'profile_answers', 'profile_secrets', 'profile_sensitive_details',
  'policy_config', 'policy_evidence', 'connector_instances',
] as const

const disposableResetTables = [
  'connector_runs', 'connector_checkpoints', 'connector_observations', 'source_entities',
  'source_entity_identities', 'source_identity_conflicts', 'raw_source_records',
  'raw_source_revisions', 'raw_source_occurrences', 'normalization_runs',
  'normalization_replay_requests', 'normalization_replay_items', 'normalization_attempts',
  'normalization_field_outcomes', 'canonical_source_candidates', 'normalization_gates',
  'sourcing_findings',
] as const

function seedResetMigrationFixture(database: ReturnType<typeof createInMemoryDatabase>) {
  database.exec(`
    insert into connector_instances (
      id, connector_id, connector_version, display_name, enabled, config_json, auth_json,
      filters_json, created_at, updated_at
    ) values (
      'jobright-instance', 'jobright.resolver', '0.4.3', 'Jobright', 1,
      '{"region":"us"}', '[{"secretKey":"jobright.password"}]', '{"remote":true}',
      '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z'
    );
    insert into user_profile (id, full_name, email, created_at, updated_at)
    values ('default', 'Protected User', 'protected@example.com', '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z');
    insert into profile_secrets (key, label, kind, encrypted_value, created_at, updated_at)
    values ('jobright.password', 'Jobright password', 'credential', 'ciphertext:nonce:key-v7', '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z');
    insert into profile_sensitive_details (id, date_of_birth_encrypted, ssn_last_4_encrypted, created_at, updated_at)
    values ('default', 'ciphertext:dob', 'ciphertext:ssn', '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z');
    insert into policy_config (id, config_json, created_at, updated_at)
    values ('default', '{"autoApply":false}', '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z');
    insert into policy_evidence (id, subject_type, subject_id, tag, source, note, payload_json, created_at)
    values ('evidence-1', 'profile', 'default', 'protected', 'user', 'keep me', '{}', '2026-07-10T12:00:00.000Z');
  `)
  database.pragma('foreign_keys = OFF')
  database.pragma('ignore_check_constraints = ON')
  for (const table of disposableResetTables) insertSyntheticRow(database, table)
  database.pragma('ignore_check_constraints = OFF')
  database.pragma('foreign_keys = ON')
}

function seedReferencedOccurrenceFixture(database: ReturnType<typeof createInMemoryDatabase>) {
  database.exec(`
    insert into connector_instances (
      id, connector_id, connector_version, display_name, enabled, config_json, auth_json,
      filters_json, created_at, updated_at
    ) values
      ('instance-one', 'fixture.one', '1.0.0', 'One', 1, '{}', '[]', '{}', '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z'),
      ('instance-two', 'fixture.two', '1.0.0', 'Two', 1, '{}', '[]', '{}', '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z');
    insert into connector_runs (
      id, connector_instance_id, mode, status, started_at, config_json, filters_json,
      filter_signature, observation_count, warning_count, stats_json, warnings_json,
      retry_hints_json, created_at, updated_at
    ) values
      ('connector-run-one', 'instance-one', 'manual', 'completed', '2026-07-10T12:00:00.000Z', '{}', '{}', 'filters:{}', 0, 0, '{}', '[]', '{}', '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z'),
      ('connector-run-two', 'instance-two', 'manual', 'completed', '2026-07-10T12:00:00.000Z', '{}', '{}', 'filters:{}', 0, 0, '{}', '[]', '{}', '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z');
    insert into source_entities (id, identity_kind, identity_namespace, identity_value, created_at)
    values ('entity-one', 'provider_job', 'fixture', 'job-one', '2026-07-10T12:00:00.000Z');
    insert into raw_source_records (id, source_entity_id, created_at)
    values ('record-one', 'entity-one', '2026-07-10T12:00:00.000Z');
    insert into raw_source_revisions (
      id, raw_record_id, revision, content_hash, adapter_id, adapter_kind, adapter_version,
      observed_at, payload_json, evidence_json, created_at
    ) values
      ('revision-one', 'record-one', 1, 'sha256:one', 'fixture', 'connector', '1.0.0', '2026-07-10T12:00:00.000Z', '{}', '[]', '2026-07-10T12:00:00.000Z'),
      ('revision-two', 'record-one', 2, 'sha256:two', 'fixture', 'connector', '1.0.0', '2026-07-10T12:01:00.000Z', '{}', '[]', '2026-07-10T12:01:00.000Z');
    insert into raw_source_occurrences (
      id, raw_record_id, raw_revision_id, connector_instance_id, connector_run_id,
      observed_at, received_at
    ) values
      ('occurrence-one', 'record-one', 'revision-one', 'instance-one', 'connector-run-one', '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:01.000Z'),
      ('occurrence-two', 'record-one', 'revision-one', 'instance-two', 'connector-run-two', '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:01.000Z');
    insert into normalization_runs (
      id, raw_record_id, raw_revision_id, trigger_occurrence_id,
      trigger_connector_instance_id, trigger_connector_run_id, input_hash, resolver_set_hash,
      canonical_schema_version, gate_policy_version, trigger_kind, status, created_at, updated_at
    ) values
      ('normalization-one', 'record-one', 'revision-one', 'occurrence-one', 'instance-one',
       'connector-run-one', 'sha256:one', 'sha256:resolvers', 'candidate/v1', 'gate/v1',
       'intake', 'completed', '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z'),
      ('normalization-manual', 'record-one', 'revision-two', null, null, null,
       'sha256:manual', 'sha256:resolvers', 'candidate/v1', 'gate/v1', 'intake',
       'completed', '2026-07-10T12:01:00.000Z', '2026-07-10T12:01:00.000Z');
  `)
}

function migrationFolderThrough(maxIndex: number) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), `valedictorian-through-${maxIndex}-`))
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

function insertSyntheticRow(
  database: ReturnType<typeof createInMemoryDatabase>,
  table: string,
) {
  const columns = database.prepare(`pragma table_info('${table}')`).all() as Array<{
    name: string
    notnull: number
    dflt_value: unknown
    type: string
    pk: number
  }>
  const required = columns.filter((column) => column.pk > 0 || (column.notnull === 1 && column.dflt_value === null))
  const names = required.map(({ name }) => `"${name}"`).join(', ')
  const values = required.map((column) => {
    if (/INT/i.test(column.type)) return 1
    if (column.name.endsWith('_json')) return '{}'
    return `${table}:${column.name}`
  })
  database.prepare(`insert into "${table}" (${names}) values (${required.map(() => '?').join(', ')})`).run(...values)
}

function snapshotProtectedTables(database: ReturnType<typeof createInMemoryDatabase>) {
  return Object.fromEntries(protectedResetTables.map((table) => [
    table,
    database.prepare(`select * from "${table}" order by rowid`).all(),
  ])) as Record<(typeof protectedResetTables)[number], Array<Record<string, unknown>>>
}

function snapshotAllResetTables(database: ReturnType<typeof createInMemoryDatabase>) {
  return Object.fromEntries([...protectedResetTables, ...disposableResetTables].map((table) => [
    table,
    database.prepare(`select * from "${table}" order by rowid`).all(),
  ]))
}

function tableColumns(database: ReturnType<typeof createInMemoryDatabase>, tableName: string) {
  return database
    .prepare(`pragma table_info('${tableName}')`)
    .all()
    .map((row) => (row as { name: string }).name)
}

function tableDefinition(
  database: ReturnType<typeof createInMemoryDatabase>,
  tableName: string,
) {
  const row = database
    .prepare("select sql from sqlite_master where type = 'table' and name = ?")
    .get(tableName) as { sql: string }

  return {
    checks: [...row.sql.matchAll(/constraint\s+["`]?([a-z0-9_]+)/gi)].map((match) => match[1]),
    columns: database.prepare(`pragma table_info('${tableName}')`).all(),
    foreignKeys: database.prepare(`pragma foreign_key_list('${tableName}')`).all(),
  }
}

function indexDefinition(
  database: ReturnType<typeof createInMemoryDatabase>,
  indexName: string,
) {
  const row = database
    .prepare("select sql from sqlite_master where type = 'index' and name = ?")
    .get(indexName) as { sql: string }

  return {
    columns: database.prepare(`pragma index_info('${indexName}')`).all(),
    predicate: row.sql.match(/\swhere\s(.+)$/i)?.[1] ?? null,
    unique: /^create unique index/i.test(row.sql),
  }
}

function identityTriggerNames(database: ReturnType<typeof createInMemoryDatabase>) {
  return database.prepare(`
    select name from sqlite_master
    where type = 'trigger'
      and (name like 'trg_source_entity%' or name like 'trg_source_identity%')
    order by name
  `).all().map((row) => (row as { name: string }).name)
}

function normalizationLineageTriggerNames(database: ReturnType<typeof createInMemoryDatabase>) {
  return database.prepare(`
    select name from sqlite_master
    where type = 'trigger'
      and (name like 'trg_normalization_runs_trigger_lineage_%'
        or name like 'trg_raw_source_occurrences_normalization_lineage_%')
    order by name
  `).all().map((row) => (row as { name: string }).name)
}
