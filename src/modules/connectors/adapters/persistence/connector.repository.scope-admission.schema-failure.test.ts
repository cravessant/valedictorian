import { describe, expect, it } from 'vitest'
import { sourceExecutionScopes } from '@sparxie/valedictorian-local-runtime/testing/db/schema'
import { createPgliteTestOwner } from '../../../../test/pglite-test-owner'
import { createPgliteConnectorRepository } from '@sparxie/valedictorian-local-runtime/testing/modules/connectors/adapters/persistence/connector.repository'

type ConnectorRepository = ReturnType<typeof createPgliteConnectorRepository>

const instanceInput = (id: string) => ({
  id, connectorId: 'fixture', connectorVersion: '1', displayName: 'Orphan', enabled: true,
})

/**
 * Both entry points create the execution scope through the source-execution owner
 * inside the caller's transaction, so a later connector failure leaves no scope
 * behind for a connector instance that does not exist.
 */
describe('connector scope admission schema failures', () => {
  it.each([
    ['creating', (repository: ConnectorRepository) =>
      repository.createInstance(instanceInput('orphan-create'))],
    ['upserting', (repository: ConnectorRepository) =>
      repository.upsertInstance(instanceInput('orphan-upsert'))],
  ])('rolls back scope creation when %s the connector instance fails', async (_label, persist) => {
    const { client, database } = await createPgliteTestOwner()
    await client.exec(`
      create function reject_connector() returns trigger as $$
      begin raise exception 'reject'; end;
      $$ language plpgsql;
      create trigger reject_connector before insert on connector_instances
      for each row execute function reject_connector();
    `)

    await expect(persist(createPgliteConnectorRepository(database))).rejects.toThrow()

    await expect(database.select().from(sourceExecutionScopes)).resolves.toHaveLength(0)
  })
})
