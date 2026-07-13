import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createSqliteConnectorRepository } from '../modules/connectors/connector.repository'
import { sourceExecutionScopes } from './schema'
import { createDrizzleDatabase, createInMemoryDatabase, migrateDatabase } from './sqlite'

describe('source execution scope migration continuity', () => {
  it('keeps migration scope, cooldown, and generation through first upsert and auth edit', async () => {
    const sqlite = createInMemoryDatabase(); migrateDatabase(sqlite, { migrationsFolder: migrationsThrough22() })
    sqlite.exec("insert into connector_instances (id, connector_id, connector_version, display_name, enabled, config_json, auth_json, filters_json, created_at, updated_at) values ('migrated-instance', 'fixture.jobs', '1.0.0', 'Migrated', 1, '{}', '[{\"id\":\"old\",\"mode\":\"api_key\",\"secretKey\":\"old\"}]', '{}', '2026-07-12T12:00:00.000Z', '2026-07-12T12:00:00.000Z')")
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite); const repository = createSqliteConnectorRepository(database)
    const scopeId = `scope_${Buffer.from('migrated-instance').toString('hex')}`
    database.update(sourceExecutionScopes).set({ status: 'cooldown', blockedUntil: '2026-07-12T13:00:00.000Z', authGeneration: 7 }).where(eq(sourceExecutionScopes.id, scopeId)).run()
    const updated = await repository.upsertInstance({ id: 'migrated-instance', connectorId: 'fixture.jobs', connectorVersion: '1.0.0', displayName: 'Migrated', enabled: true, earliestBackfillDate: '2026-01-01', auth: [{ id: 'new', mode: 'bearer_token', secretKey: 'new' }] })
    expect(updated.executionScopeId).toBe(scopeId)
    expect(database.select().from(sourceExecutionScopes).where(eq(sourceExecutionScopes.id, scopeId)).get()).toMatchObject({ status: 'cooldown', blockedUntil: '2026-07-12T13:00:00.000Z', authGeneration: 7 })
    sqlite.close()
  })
})

function migrationsThrough22() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-through-22-')); fs.cpSync(path.resolve('drizzle'), folder, { recursive: true })
  for (const name of fs.readdirSync(folder)) if (Number.parseInt(name.slice(0, 4), 10) > 22) fs.rmSync(path.join(folder, name))
  const journalPath = path.join(folder, 'meta', '_journal.json'); const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as { entries: Array<{ idx: number }> }
  journal.entries = journal.entries.filter(({ idx }) => idx <= 22); fs.writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`)
  return folder
}
