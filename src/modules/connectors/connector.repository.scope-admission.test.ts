import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { sourceExecutionScopes } from '../../db/schema'
import { createPgliteClient, migratePgliteDatabase } from '../../db/pglite'
import { createPgliteConnectorRepository } from './connector.repository'

describe('connector scope admission', () => {
  it('rolls back scope creation when connector instance persistence fails', async () => {
    const client = await createPgliteClient()
    try {
      const database = await migratePgliteDatabase(client)
      await client.exec(`
        create function reject_connector() returns trigger as $$
        begin raise exception 'reject'; end;
        $$ language plpgsql;
        create trigger reject_connector before insert on connector_instances
        for each row execute function reject_connector();
      `)
      await expect(createPgliteConnectorRepository(database).upsertInstance({
        id: 'orphan', connectorId: 'fixture', connectorVersion: '1',
        displayName: 'Orphan', enabled: true,
      })).rejects.toThrow()
      await expect(database.select().from(sourceExecutionScopes)).resolves.toHaveLength(0)
    } finally {
      await client.close()
    }
  })
  it.each(['action_required', 'refreshing'] as const)('skips fresh discovery while scope is %s', async (status) => {
    const client = await createPgliteClient()
    try {
      const database = await migratePgliteDatabase(client)
      const repository = createPgliteConnectorRepository(database)
      const instance = await repository.upsertInstance({ id: `blocked-${status}`, connectorId: 'fixture.jobs', connectorVersion: '1.0.0', displayName: 'Blocked', enabled: true })
      await database.update(sourceExecutionScopes).set({ status, actionReason: status === 'action_required' ? 'session_refresh_failed' : null,
        refreshLeaseToken: status === 'refreshing' ? 'lease' : null, refreshLeaseExpiresAt: status === 'refreshing' ? '2026-07-12T13:00:00.000Z' : null })
        .where(eq(sourceExecutionScopes.id, instance.executionScopeId))

      const request = await repository.recordRunRequest({ connectorInstanceId: instance.id, mode: 'manual', startedAt: '2026-07-12T12:00:00.000Z', coverageEndedAt: '2026-07-12T12:00:00.000Z' })
      expect(request).toMatchObject({ acquired: false, acquiredWork: null, run: { status: 'skipped' } })
      await expect(repository.getRunSynchronization(request.run.id)).resolves.toMatchObject({ outcome: { kind: 'action_required' } })
    } finally {
      await client.close()
    }
  })
})
