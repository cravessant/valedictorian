import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
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

    expect(workflowRunIndexes).toContain('idx_workflow_runs_source_id')
    expect(workflowRunIndexes).toContain('idx_workflow_runs_source_type_status_started')
    expect(sourcingFindingIndexes).toContain('idx_sourcing_findings_source_id')
    expect(sourcingFindingIndexes).toContain('idx_sourcing_findings_source_status_discovered')
    expect(sourceIndexes).toContain('idx_sources_name')
  })

  it('migrates legacy policy queue config to action queue config', () => {
    const database = createInMemoryDatabase()

    migrateDatabase(database)
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
