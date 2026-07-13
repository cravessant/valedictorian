import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createInMemoryDatabase, migrateDatabase } from './sqlite'

describe('connector schedule migration', () => {
  it('adds schedule tables without changing protected connector or profile data', () => {
    const database = createInMemoryDatabase()
    migrateDatabase(database, { migrationsFolder: migrationFolderThrough(19) })

    database.exec(`
      insert into connector_instances (
        id, connector_id, connector_version, display_name, enabled,
        config_json, auth_json, filters_json, earliest_backfill_date,
        created_at, updated_at, deleted_at
      ) values (
        'protected-connector', 'jobright.resolver', '0.8.0', 'Protected Jobright', 1,
        '{"region":"us"}', '[{"id":"jobright","mode":"username_password","secretKey":"cred"}]',
        '{"roleKeywords":["intern"]}', '2026-07-04',
        '2026-07-11T15:30:00.000Z', '2026-07-11T15:30:00.000Z', null
      );
      insert into connector_runs (
        id, connector_instance_id, mode, status, started_at, completed_at,
        coverage_started_at, coverage_ended_at, config_json, filters_json, filter_signature,
        observation_count, warning_count, stats_json, warnings_json, retry_hints_json,
        created_at, updated_at, deleted_at
      ) values (
        'protected-run', 'protected-connector', 'manual', 'completed',
        '2026-07-11T15:31:00.000Z', '2026-07-11T15:32:00.000Z',
        '2026-07-04T00:00:00.000Z', '2026-07-11T15:31:00.000Z',
        '{}', '{}', 'filters:{}', 0, 0, '{}', '[]', 'null',
        '2026-07-11T15:31:00.000Z', '2026-07-11T15:32:00.000Z', null
      );
      insert into user_profile (
        id, full_name, email, phone, created_at, updated_at, deleted_at
      ) values (
        'profile-1', 'Protected User', 'user@example.com', null,
        '2026-07-11T15:30:00.000Z', '2026-07-11T15:30:00.000Z', null
      );
    `)

    const protectedBefore = {
      connector_instances: database.prepare(`
        select id, connector_id, display_name, enabled, config_json, auth_json, filters_json,
               earliest_backfill_date, created_at from connector_instances order by id
      `).all(),
      connector_runs: database.prepare('select id, mode, status from connector_runs order by id').all(),
      user_profile: database.prepare('select id, full_name, email from user_profile order by id').all(),
    }

    migrateDatabase(database)

    expect(tables(database)).toEqual(expect.arrayContaining([
      'connector_schedules',
      'connector_schedule_events',
      'connector_schedule_occurrences',
      'connector_schedule_revisions',
    ]))
    expect(protectedBefore).toEqual({
      connector_instances: database.prepare(`
        select id, connector_id, display_name, enabled, config_json, auth_json, filters_json,
               earliest_backfill_date, created_at from connector_instances order by id
      `).all(),
      connector_runs: database.prepare('select id, mode, status from connector_runs order by id').all(),
      user_profile: database.prepare('select id, full_name, email from user_profile order by id').all(),
    })
    expect(database.prepare('select count(*) as count from __drizzle_migrations').get())
      .toEqual({ count: 24 })
    database.close()
  })
})

function migrationFolderThrough(maxIndex: number) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), `valedictorian-schedule-through-${maxIndex}-`))
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

function tables(database: ReturnType<typeof createInMemoryDatabase>) {
  return database
    .prepare(`select name from sqlite_master where type = 'table' order by name`)
    .all()
    .map((row) => (row as { name: string }).name)
}
