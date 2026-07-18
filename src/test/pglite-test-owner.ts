import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach } from 'vitest'
import {
  createPgliteClient,
  createPgliteDatabase,
  type PgliteClient,
  type PgliteDatabase,
} from '../db/pglite'
import { cloneConfiguredPgliteTemplate } from './pglite-template'

export interface PgliteTestOwner {
  client: PgliteClient
  database: PgliteDatabase
  dataPath: string
  close(): Promise<void>
}

const activeOwners = new Set<PgliteTestOwner>()

afterEach(async () => {
  const owners = [...activeOwners]
  await Promise.all(owners.map((owner) => owner.close()))
})

export async function createPgliteTestOwner(): Promise<PgliteTestOwner> {
  const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-test-pglite-'))
  cloneConfiguredPgliteTemplate(dataPath)
  const client = await createPgliteClient({ dataDir: dataPath })
  const closeClient = client.close.bind(client)
  let closed = false
  const owner: PgliteTestOwner = {
    client,
    database: createPgliteDatabase(client),
    dataPath,
    async close() {
      if (closed) return
      closed = true
      activeOwners.delete(owner)
      try {
        await closeClient()
      } finally {
        fs.rmSync(dataPath, { force: true, recursive: true })
      }
    },
  }
  client.close = () => owner.close()
  activeOwners.add(owner)
  return owner
}

export async function createPgliteTestDatabase() {
  return (await createPgliteTestOwner()).database
}
