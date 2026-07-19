import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest'
import { getTableName, sql } from 'drizzle-orm'
import {
  createPgliteClient,
  createPgliteDatabase,
  type PgliteClient,
  type PgliteDatabase,
} from '../db/pglite'
import { schema } from '../db/schema'
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
  return createPgliteTestOwnerWithLifetime(true)
}

async function createPgliteTestOwnerWithLifetime(closeAfterEach: boolean) {
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
  if (closeAfterEach) activeOwners.add(owner)
  return owner
}

export async function createPgliteTestDatabase() {
  return (await createPgliteTestOwner()).database
}

export function useResettablePgliteTestDatabase() {
  const owner = useResettablePgliteTestOwner()
  return () => owner().database
}

export function useResettablePgliteTestOwner() {
  let owner: PgliteTestOwner | null = null

  beforeAll(async () => {
    owner = await createPgliteTestOwnerWithLifetime(false)
  })
  beforeEach(async () => {
    if (!owner) throw new Error('Resettable PGlite test owner is not initialized')
    await resetPgliteTestDatabase(owner.database)
  })
  afterAll(async () => {
    await owner?.close()
    owner = null
  })

  return () => {
    if (!owner) throw new Error('Resettable PGlite test owner is not initialized')
    return owner
  }
}

async function resetPgliteTestDatabase(database: PgliteDatabase) {
  await database.execute(sql.raw('reset all'))
  const tableNames = Object.values(schema).map((table) => quoteIdentifier(getTableName(table)))
  await database.execute(sql.raw(
    `truncate table ${tableNames.join(', ')} restart identity cascade`,
  ))
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`
}
