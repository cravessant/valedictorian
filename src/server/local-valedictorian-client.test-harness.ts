import { afterEach } from 'vitest'
import {
  createPgliteClient,
  migratePgliteDatabase,
  type PgliteClient,
  type PgliteDatabase,
} from '../db/pglite'
import type { LocalValedictorianClient } from '../runtime/local-connector-client.contract'
import {
  createLocalValedictorianClient as createRuntimeLocalValedictorianClient,
} from '../runtime/local-valedictorian-client'
import type { LocalValedictorianClientOptions } from '../runtime/local-valedictorian-runtime-options'

type LocalTestClientOptions = Omit<LocalValedictorianClientOptions, 'database'>

export interface OwnedPgliteTestDatabase {
  client: PgliteClient
  database: PgliteDatabase
  close(): Promise<void>
}

const activeOwners = new Set<OwnedPgliteTestDatabase>()
const clientOwners = new WeakMap<LocalValedictorianClient, OwnedPgliteTestDatabase>()

export async function openPgliteTestDatabase(
  pgliteDataPath?: string,
): Promise<OwnedPgliteTestDatabase> {
  const client = await createPgliteClient(
    pgliteDataPath ? { dataDir: pgliteDataPath } : {},
  )
  const database = await migratePgliteDatabase(client)
  let closed = false
  const owner: OwnedPgliteTestDatabase = {
    client,
    database,
    async close() {
      if (closed) return
      closed = true
      activeOwners.delete(owner)
      await client.close()
    },
  }
  activeOwners.add(owner)
  return owner
}

export async function createLocalValedictorianClient(
  options: LocalTestClientOptions,
): Promise<LocalValedictorianClient> {
  const owner = await openPgliteTestDatabase(options.pgliteDataPath)
  try {
    const client = await createRuntimeLocalValedictorianClient({
      ...options,
      database: owner.database,
    })
    clientOwners.set(client, owner)
    return client
  } catch (error) {
    await owner.close()
    throw error
  }
}

export async function closeLocalValedictorianClient(
  client: LocalValedictorianClient,
): Promise<void> {
  const owner = clientOwners.get(client)
  if (!owner) return
  clientOwners.delete(client)
  await owner.close()
}

export function getLocalValedictorianTestDatabase(
  client: LocalValedictorianClient,
): PgliteDatabase {
  const owner = clientOwners.get(client)
  if (!owner) throw new Error('Local test client does not have an active PGlite owner')
  return owner.database
}

afterEach(async () => {
  const owners = [...activeOwners].reverse()
  for (const owner of owners) await owner.close()
})
