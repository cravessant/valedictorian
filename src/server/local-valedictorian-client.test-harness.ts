import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach } from 'vitest'
import {
  createPgliteClient,
  createPgliteDatabase,
  migratePgliteDatabase,
  type PgliteClient,
  type PgliteDatabase,
} from '@sparxie/valedictorian-local-runtime/database'
import type { LocalValedictorianClient } from '@sparxie/valedictorian-local-runtime/local-client'
import {
  createLocalValedictorianClient as createRuntimeLocalValedictorianClient,
} from '@sparxie/valedictorian-local-runtime/local-client'
import type { LocalValedictorianClientOptions } from '@sparxie/valedictorian-local-runtime/testing/runtime/local-valedictorian-runtime-options'
import { prepareConfiguredPgliteDataPath } from '../test/pglite-template'

type LocalTestClientOptions = Omit<LocalValedictorianClientOptions, 'database'>

export interface OwnedPgliteTestDatabase {
  client: PgliteClient
  database: PgliteDatabase
  close(): Promise<void>
}

const activeOwners = new Set<OwnedPgliteTestDatabase>()
const clientOwners = new WeakMap<LocalValedictorianClient, OwnedPgliteTestDatabase>()
const ownedDataPaths = new Set<string>()

/**
 * Temporary PGlite directory the caller may close and reopen freely for the whole test.
 * Removal is sequenced with this module's teardown, which closes every database owner
 * before deleting any directory.
 */
export function createOwnedPgliteTestDataPath(prefix = 'valedictorian-server-pglite-') {
  const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  ownedDataPaths.add(dataPath)
  return dataPath
}

export async function openPgliteTestDatabase(
  pgliteDataPath?: string,
): Promise<OwnedPgliteTestDatabase> {
  const dataPath = pgliteDataPath
    ?? fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-server-pglite-'))
  const clonedFromTemplate = prepareConfiguredPgliteDataPath(dataPath)
  if (clonedFromTemplate) ownedDataPaths.add(dataPath)
  const client = await createPgliteClient({ dataDir: dataPath })
  const database = clonedFromTemplate
    ? createPgliteDatabase(client)
    : await migratePgliteDatabase(client)
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
  for (const dataPath of ownedDataPaths) fs.rmSync(dataPath, { force: true, recursive: true })
  ownedDataPaths.clear()
})
