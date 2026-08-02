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
} from '@sparxie/valedictorian-local-runtime/database'
import { schema } from '@sparxie/valedictorian-local-runtime/testing/db/schema'
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
  const registeredNames: Set<string> = new Set(Object.values(schema).map((table) => getTableName(table)))
  const existing = await database.execute<{ table_name: string }>(sql`
    select table_name from information_schema.tables where table_schema = 'public'
  `)
  const tableNames = [...new Set(existing.rows
    .map((row) => row.table_name)
    .filter((name) => registeredNames.has(name)))]
    .map(quoteIdentifier)
  await database.execute(sql.raw(
    `truncate table ${tableNames.join(', ')} restart identity cascade`,
  ))
  await database.execute(sql`
    insert into workspaces (id, name, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', 'default', '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z')
  `)
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`
}
