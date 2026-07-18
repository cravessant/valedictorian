import { afterEach } from 'vitest'
import {
  createPgliteClient,
  migratePgliteDatabase,
  type PgliteClient,
} from '../../db/pglite'
import { createPgliteConnectorRepository } from './connector.repository'

const clients = new Set<PgliteClient>()

afterEach(async () => {
  await Promise.all([...clients].map((client) => client.close()))
  clients.clear()
})

export async function createConnectorRepositoryTestContext() {
  const client = await createPgliteClient()
  clients.add(client)
  const database = await migratePgliteDatabase(client)
  return {
    client,
    database,
    repository: createPgliteConnectorRepository(database),
  }
}

export function releaseConnectorRepositoryTestClient(client: PgliteClient) {
  clients.delete(client)
}
