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
