import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { describe, expect, it } from 'vitest'
import { schema, sourceExecutionScopes } from '../../db/schema'
import { createPgliteTestOwner } from '../../test/pglite-test-owner'
import { createPgliteConnectorRepository } from './connector.repository'

describe('connector scope admission', () => {
  it('locks the live instance row to serialize admission against retirement', async () => {
    const owner = await createPgliteTestOwner()
    const queries: string[] = []
    const database = drizzle(owner.client, {
      schema,
      logger: { logQuery(query) { queries.push(query) } },
    })
    const repository = createPgliteConnectorRepository(database)
    const instance = await repository.upsertInstance({
      id: 'retirement-admission-race', connectorId: 'fixture.jobs', connectorVersion: '1.0.0',
      displayName: 'Retirement admission race', enabled: true,
    })
    queries.length = 0

    await repository.recordRunRequest({
      connectorInstanceId: instance.id,
      mode: 'manual',
      startedAt: '2026-07-12T12:00:00.000Z',
    })

    expect(queries.some((query) => /from "connector_instances"[\s\S]*for update/i.test(query)))
      .toBe(true)
  })

  it('rolls back scope creation when connector instance persistence fails', async () => {
    const { client, database } = await createPgliteTestOwner()
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
  })
  it.each(['action_required', 'refreshing'] as const)('skips fresh discovery while scope is %s', async (status) => {
    const { database } = await createPgliteTestOwner()
    const repository = createPgliteConnectorRepository(database)
    const instance = await repository.upsertInstance({ id: `blocked-${status}`, connectorId: 'fixture.jobs', connectorVersion: '1.0.0', displayName: 'Blocked', enabled: true })
    await database.update(sourceExecutionScopes).set({ status, actionReason: status === 'action_required' ? 'session_refresh_failed' : null,
      refreshLeaseToken: status === 'refreshing' ? 'lease' : null, refreshLeaseExpiresAt: status === 'refreshing' ? '2026-07-12T13:00:00.000Z' : null })
      .where(eq(sourceExecutionScopes.id, instance.executionScopeId))

    const request = await repository.recordRunRequest({ connectorInstanceId: instance.id, mode: 'manual', startedAt: '2026-07-12T12:00:00.000Z', coverageEndedAt: '2026-07-12T12:00:00.000Z' })
    expect(request).toMatchObject({ acquired: false, acquiredWork: null, run: { status: 'skipped' } })
    await expect(repository.getRunSynchronization(request.run.id)).resolves.toMatchObject({ outcome: { kind: 'action_required' } })
  })
})
