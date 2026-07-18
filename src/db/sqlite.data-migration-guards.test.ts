import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertDataMigrationHistoryIsKnown,
  createDataMigrationUmzug,
  runDataMigrations
} from './data-migrations'
import { createFileDatabase, createInMemoryDatabase, migrateDatabase } from './sqlite'


describe('SQLite database', () => {
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
      'database.sqlite',
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
