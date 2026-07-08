import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDataMigrationUmzug } from './data-migrations'
import { createFileDatabase, createInMemoryDatabase, migrateDatabase } from './sqlite'

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

    expect(tableColumns(database, 'applications')).toEqual(
      expect.arrayContaining(['timing_mode', 'terms_json', 'start_date', 'end_date']),
    )
    expect(tableColumns(database, 'sourcing_findings')).toEqual(
      expect.arrayContaining(['timing_mode', 'terms_json', 'start_date', 'end_date']),
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

    expect(workflowRunIndexes).toContain('idx_workflow_runs_source_id')
    expect(workflowRunIndexes).toContain('idx_workflow_runs_source_type_status_started')
    expect(sourcingFindingIndexes).toContain('idx_sourcing_findings_source_id')
    expect(sourcingFindingIndexes).toContain('idx_sourcing_findings_source_status_discovered')
    expect(sourceIndexes).toContain('idx_sources_name')
    expect(connectorRunIndexes).toContain('idx_connector_runs_instance')
    expect(connectorRunIndexes).toContain('idx_connector_runs_instance_status_started')
    expect(connectorObservationIndexes).toContain('idx_connector_observations_instance')
    expect(connectorObservationIndexes).toContain('idx_connector_observations_run')
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

    expect(migrationRows).toHaveLength(5)
    expect(applicationTables).toHaveLength(1)
    expect(connectorTables).toHaveLength(1)
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

function tableColumns(database: ReturnType<typeof createInMemoryDatabase>, tableName: string) {
  return database
    .prepare(`pragma table_info('${tableName}')`)
    .all()
    .map((row) => (row as { name: string }).name)
}
