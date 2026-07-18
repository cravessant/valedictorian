import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach } from 'vitest'
import {
  createPgliteClient,
  createPgliteDatabase,
  type PgliteClient,
} from '../../db/pglite'
import { cloneConfiguredPgliteTemplate } from '../../test/pglite-template'
import { createPgliteConnectorRepository } from './connector.repository'

const clients = new Set<PgliteClient>()
const tempPaths = new Set<string>()

afterEach(async () => {
  await Promise.all([...clients].map((client) => client.close()))
  clients.clear()
  for (const tempPath of tempPaths) fs.rmSync(tempPath, { force: true, recursive: true })
  tempPaths.clear()
})

export async function createConnectorRepositoryTestContext() {
  const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-connector-pglite-'))
  tempPaths.add(dataPath)
  cloneConfiguredPgliteTemplate(dataPath)
  const client = await createPgliteClient({ dataDir: dataPath })
  clients.add(client)
  const database = createPgliteDatabase(client)
  return {
    client,
    database,
    repository: createPgliteConnectorRepository(database),
  }
}

export function releaseConnectorRepositoryTestClient(client: PgliteClient) {
  clients.delete(client)
}
