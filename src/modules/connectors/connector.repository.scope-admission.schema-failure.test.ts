import { describe, expect, it } from 'vitest'
import { sourceExecutionScopes } from '../../db/schema'
import { createPgliteTestOwner } from '../../test/pglite-test-owner'
import { createPgliteConnectorRepository } from './connector.repository'

describe('connector scope admission schema failures', () => {
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
})
