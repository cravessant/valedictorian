import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { rawSourceProjectionResultSchema } from 'sparxie'
import { createSqliteConnectorRepository } from '../modules/connectors/connector.repository'
import { createSqliteProjectionOutcomeRepository } from '../modules/sourcing/projection-outcome.repository'
import { createDrizzleDatabase, createInMemoryDatabase, migrateDatabase } from './sqlite'
import { doomedConnectorRunMigrationState, indexDefinition, seedDoomedConnectorRunFixture, tableDefinition } from './sqlite.schema-test-helpers'
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
    expect(migrationRows).toHaveLength(24)
    expect(applicationTables).toHaveLength(1)
    expect(connectorTables).toHaveLength(1)
  })
  it('executes migration 0018 for unmanaged legacy baselines and supports retry-ledger run requests', async () => {
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
    expect(database.prepare("select name from sqlite_master where type = 'table' and name = 'retry_work'").get())
      .toEqual({ name: 'retry_work' })
    expect(database.prepare('select count(*) as count from retry_work').get()).toEqual({ count: 0 })
    expect(database.prepare('select count(*) as count from __drizzle_migrations').get()).toEqual({ count: 24 })
    const stampedTags = database
      .prepare('select created_at from __drizzle_migrations order by created_at')
      .all()
      .map((row) => Number((row as { created_at: number | string }).created_at))
    expect(stampedTags).toContain(1783785250659)
    expect(stampedTags).toContain(1783797592818)
    expect(database.prepare('pragma foreign_key_check').all()).toEqual([])
    const repository = createSqliteConnectorRepository(createDrizzleDatabase(database))
    await repository.upsertInstance({
      id: 'legacy-retry', connectorId: 'fixture.retry', connectorVersion: '1.0.0',
      displayName: 'Legacy retry', enabled: true, filters: {}, createdAt: '2026-07-11T12:00:00.000Z',
    })
    await repository.recordRefreshResult({
      connectorInstanceId: 'legacy-retry', mode: 'manual',
      startedAt: '2026-07-11T12:00:00.000Z', completedAt: '2026-07-11T12:00:01.000Z',
      config: {}, filters: {}, filterSignature: 'filters:{}',
      result: {
        observations: [], warnings: [], stats: { observations: 0 },
        coverage: { start: '2026-07-11T11:00:00.000Z', end: '2026-07-11T12:00:00.000Z' },
        nextCheckpoint: { checkpoint: {}, schemaVersion: 'fixture-retry@1' },
        retryHints: {
          state: 'scheduled', reason: 'rate_limit', attempt: 1, maxAttempts: 3,
          lastAttemptAt: '2026-07-11T12:00:00.000Z', computedDelayMs: 60_000,
          nextAttemptAt: '2026-07-11T12:01:00.000Z', horizonAt: '2026-07-11T13:00:00.000Z',
        },
      },
    })
    const skipped = await repository.recordRunRequest({
      connectorInstanceId: 'legacy-retry', mode: 'manual', startedAt: '2026-07-11T12:00:30.000Z',
      filterSignature: 'filters:{}',
    })
    expect(skipped).toMatchObject({
      acquired: false,
      acquiredWork: null,
      run: { status: 'skipped', retryHints: { state: 'not_due', reason: 'rate_limit' } },
    })
    expect(database.prepare('select count(*) as count from retry_work').get()).toEqual({ count: 1 })
    database.close()
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
      'idx_raw_source_revisions_provider_current',
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
    ).toEqual({ count: 24 })
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
        connector_version: '0.8.0',
        earliest_backfill_date: '2026-07-03',
        execution_scope_id: `scope_${Buffer.from(String(row.id)).toString('hex')}`,
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
  it('removes pre-ledger projection state without touching protected or connector capture rows', () => {
    const database = createInMemoryDatabase(); migrateDatabase(database, { migrationsFolder: migrationFolderThrough(21) })
    seedResetMigrationFixture(database)
    database.prepare("update raw_source_revisions set created_at = '2026-07-10T12:00:00.000Z'").run()
    const protectedBefore = snapshotProtectedTables(database), occurrencesBefore = database.prepare('select * from raw_source_occurrences order by rowid').all()
    const revision = database.prepare('select id from raw_source_revisions limit 1').get() as { id: string }
    migrateDatabase(database)
    expect(snapshotProtectedTables(database)).toEqual({
      ...protectedBefore,
      connector_instances: protectedBefore.connector_instances.map((row) => ({
        ...row,
        execution_scope_id: `scope_${Buffer.from(String(row.id)).toString('hex')}`,
      })),
    })
    expect(database.prepare('select * from connector_runs order by rowid').all()).toEqual([])
    expect(database.prepare('select * from raw_source_occurrences order by rowid').all()).toEqual(occurrencesBefore.map((row) => ({
      ...row as object,
      execution_scope_id: (row as { connector_instance_id: string | null }).connector_instance_id === null
        ? null
        : `scope_${Buffer.from((row as { connector_instance_id: string }).connector_instance_id).toString('hex')}`,
    })))
    const cleared = ['sourcing_findings', 'normalization_field_outcomes', 'normalization_gates', 'canonical_source_candidates', 'normalization_replay_items', 'normalization_attempts', 'normalization_runs', 'normalization_replay_requests']
    for (const table of cleared) {
      expect(database.prepare(`select count(*) as count from ${table}`).get()).toEqual({ count: 0 })
    }
    expect(rawSourceProjectionResultSchema.parse(createSqliteProjectionOutcomeRepository(createDrizzleDatabase(database)).get(revision.id))).toMatchObject({ status: 'not_eligible', normalizationStatus: null, canonicalCandidateId: null, gateStatus: null })
    expect(database.prepare("select name from sqlite_master where type = 'trigger' and name like 'trg_sourcing_projection_outcomes_%' order by name").all()).toEqual(['lineage_immutable', 'no_delete', 'pending_insert', 'terminal_transition'].map((name) => ({ name: `trg_sourcing_projection_outcomes_${name}` }))); database.close()
  })
  it('rolls back an unstamped legacy reset when current schema creation fails', () => {
    const database = createInMemoryDatabase()
    migrateDatabase(database, { migrationsFolder: migrationFolderThrough(14) })
    seedResetMigrationFixture(database)
    database.exec(`
      drop table __drizzle_migrations;
      create trigger inject_legacy_reset_failure
      before update on connector_instances
      begin select raise(abort, 'injected legacy reset failure'); end;
    `)
    const before = snapshotAllResetTables(database)
    expect(() => migrateDatabase(database)).toThrow(
      /injected legacy reset failure|Failed to run the query/,
    )
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
        connector_version: '0.8.0',
        earliest_backfill_date: '2026-07-03',
        execution_scope_id: `scope_${Buffer.from(String(row.id)).toString('hex')}`,
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
      .toEqual({ count: 24 })
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
  it('migrates to an empty retry ledger while preserving raw records and revisions', () => {
    const database = createInMemoryDatabase()
    migrateDatabase(database, { migrationsFolder: migrationFolderThrough(17) })
    seedReferencedOccurrenceFixture(database)
    database.prepare("update connector_instances set connector_id = 'jobright.resolver', connector_version = '0.6.0' where id = 'instance-one'").run()
    const records = database.prepare('select * from raw_source_records order by id').all()
    const revisions = database.prepare('select * from raw_source_revisions order by id').all()
    migrateDatabase(database)
    expect(database.prepare('select count(*) as count from retry_work').get()).toEqual({ count: 0 })
    expect(database.prepare('select * from raw_source_records order by id').all()).toEqual(records)
    expect(database.prepare('select * from raw_source_revisions order by id').all()).toEqual(revisions)
    expect(database.prepare('select count(*) as count from raw_source_occurrences').get()).toEqual({ count: 0 })
    expect(database.prepare('select count(*) as count from connector_runs').get()).toEqual({ count: 0 })
    expect(database.prepare("select connector_version from connector_instances where connector_id = 'jobright.resolver'").get())
      .toEqual({ connector_version: '0.8.0' })
    expect(database.prepare('pragma foreign_key_check').all()).toEqual([])
    database.close()
  })
  it('deletes every derived dependent before removing an obsolete partial connector run', () => {
    const database = createInMemoryDatabase(); migrateDatabase(database, { migrationsFolder: migrationFolderThrough(22) }); seedDoomedConnectorRunFixture(database)
    expect(() => migrateDatabase(database)).not.toThrow(); expect(doomedConnectorRunMigrationState(database)).toEqual({ dependentCounts: [{ count: 0 }, { count: 0 }, { count: 0 }, { count: 0 }], foreignKeyErrors: [],
      occurrence: { connector_instance_id: null, connector_run_id: null }, revision: { count: 1 }, runReferences: ['connector_observations.connector_run_id', 'connector_run_synchronizations.connector_run_id', 'connector_schedule_occurrences.connector_run_id', 'raw_source_occurrences.connector_instance_id', 'raw_source_occurrences.connector_run_id', 'retry_work.acquisition_run_id', 'retry_work.skipped_run_id'],
    })
    database.close()
  })
  it('rolls back the retry-ledger reset when migration 0018 fails', () => {
    const failingMigrations = fs.mkdtempSync(path.join(os.tmpdir(), 'retry-ledger-failure-'))
    fs.cpSync(path.resolve('drizzle'), failingMigrations, { recursive: true })
    const migrationName = fs.readdirSync(failingMigrations).find((name) => name.startsWith('0018_'))
    if (!migrationName) throw new Error('Retry ledger migration fixture is missing')
    fs.appendFileSync(path.join(failingMigrations, migrationName), '\n--> statement-breakpoint\nselect * from intentionally_missing_retry_table;\n')
    const database = createInMemoryDatabase()
    migrateDatabase(database, { migrationsFolder: migrationFolderThrough(17) })
    seedReferencedOccurrenceFixture(database)
    const before = {
      instances: database.prepare('select * from connector_instances order by id').all(),
      occurrences: database.prepare('select * from raw_source_occurrences order by id').all(),
      records: database.prepare('select * from raw_source_records order by id').all(),
      revisions: database.prepare('select * from raw_source_revisions order by id').all(),
      runs: database.prepare('select * from connector_runs order by id').all(),
    }
    expect(() => migrateDatabase(database, { migrationsFolder: failingMigrations }))
      .toThrow(/intentionally_missing_retry_table/)
    expect(database.prepare("select count(*) as count from sqlite_master where type = 'table' and name = 'retry_work'").get())
      .toEqual({ count: 0 })
    expect({
      instances: database.prepare('select * from connector_instances order by id').all(),
      occurrences: database.prepare('select * from raw_source_occurrences order by id').all(),
      records: database.prepare('select * from raw_source_records order by id').all(),
      revisions: database.prepare('select * from raw_source_revisions order by id').all(),
      runs: database.prepare('select * from connector_runs order by id').all(),
    }).toEqual(before)
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
      `).run()).toThrow(/normalization trigger occurrence is immutable|raw source occurrence scope owner mismatch/i)
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
  const scoped = (database.prepare("pragma table_info('connector_instances')").all() as Array<{ name: string }>)
    .some(({ name }) => name === 'execution_scope_id')
  database.exec(`
    ${scoped ? `insert into source_execution_scopes (id, created_at, updated_at) values
      ('scope-instance-one', '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z'),
      ('scope-instance-two', '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z');` : ''}
    insert into connector_instances (
      id, ${scoped ? 'execution_scope_id,' : ''} connector_id, connector_version, display_name, enabled, config_json, auth_json,
      filters_json, created_at, updated_at
    ) values
      ('instance-one', ${scoped ? "'scope-instance-one'," : ''} 'fixture.one', '1.0.0', 'One', 1, '{}', '[]', '{}', '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z'),
      ('instance-two', ${scoped ? "'scope-instance-two'," : ''} 'fixture.two', '1.0.0', 'Two', 1, '{}', '[]', '{}', '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z');
    insert into connector_runs (
      id, ${scoped ? 'execution_scope_id,' : ''} connector_instance_id, mode, status, started_at, config_json, filters_json,
      filter_signature, observation_count, warning_count, stats_json, warnings_json,
      retry_hints_json, created_at, updated_at
    ) values
      ('connector-run-one', ${scoped ? "'scope-instance-one'," : ''} 'instance-one', 'manual', 'completed', '2026-07-10T12:00:00.000Z', '{}', '{}', 'filters:{}', 0, 0, '{}', '[]', '{}', '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z'),
      ('connector-run-two', ${scoped ? "'scope-instance-two'," : ''} 'instance-two', 'manual', 'completed', '2026-07-10T12:00:00.000Z', '{}', '{}', 'filters:{}', 0, 0, '{}', '[]', '{}', '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z');
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
      id, raw_record_id, raw_revision_id, connector_instance_id, connector_run_id, ${scoped ? 'execution_scope_id,' : ''}
      observed_at, received_at
    ) values
      ('occurrence-one', 'record-one', 'revision-one', 'instance-one', 'connector-run-one', ${scoped ? "'scope-instance-one'," : ''} '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:01.000Z'),
      ('occurrence-two', 'record-one', 'revision-one', 'instance-two', 'connector-run-two', ${scoped ? "'scope-instance-two'," : ''} '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:01.000Z');
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
