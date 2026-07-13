import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { sourceExecutionScopes } from '../../db/schema'
import { createDrizzleDatabase, createInMemoryDatabase, migrateDatabase } from '../../db/sqlite'
import { createSqliteConnectorRepository } from './connector.repository'

describe('connector scope admission', () => {
  it('rolls back scope creation when connector instance persistence fails', async () => {
    const sqlite = createInMemoryDatabase(); migrateDatabase(sqlite)
    sqlite.exec("create trigger reject_connector before insert on connector_instances begin select raise(abort, 'reject'); end")
    const database = createDrizzleDatabase(sqlite)
    await expect(createSqliteConnectorRepository(database).upsertInstance({ id: 'orphan', connectorId: 'fixture',
      connectorVersion: '1', displayName: 'Orphan', enabled: true })).rejects.toThrow()
    expect(sqlite.prepare('select count(*) as count from source_execution_scopes').get()).toEqual({ count: 0 })
    sqlite.close()
  })
  it.each(['action_required', 'refreshing'] as const)('skips fresh discovery while scope is %s', async (status) => {
    const sqlite = createInMemoryDatabase(); migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite); const repository = createSqliteConnectorRepository(database)
    const instance = await repository.upsertInstance({ id: `blocked-${status}`, connectorId: 'fixture.jobs', connectorVersion: '1.0.0', displayName: 'Blocked', enabled: true })
    database.update(sourceExecutionScopes).set({ status, actionReason: status === 'action_required' ? 'session_refresh_failed' : null,
      refreshLeaseToken: status === 'refreshing' ? 'lease' : null, refreshLeaseExpiresAt: status === 'refreshing' ? '2026-07-12T13:00:00.000Z' : null })
      .where(eq(sourceExecutionScopes.id, instance.executionScopeId)).run()

    const request = await repository.recordRunRequest({ connectorInstanceId: instance.id, mode: 'manual', startedAt: '2026-07-12T12:00:00.000Z', coverageEndedAt: '2026-07-12T12:00:00.000Z' })
    expect(request).toMatchObject({ acquired: false, acquiredWork: null, run: { status: 'skipped' } })
    expect(repository.getRunSynchronization(request.run.id)).toMatchObject({ outcome: { kind: 'action_required' } })
    sqlite.close()
  })
})
