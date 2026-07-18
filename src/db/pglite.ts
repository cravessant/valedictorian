import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { schema } from './schema'

export type PgliteClient = PGlite
export type PgliteDatabase = ReturnType<typeof createPgliteDatabase>
export type PgliteRepositoryDatabase = Omit<PgliteDatabase, '$client'>

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export interface CreatePgliteClientOptions {
  /** Caller-owned on-disk data directory. Omit for an in-memory database. */
  dataDir?: string
}

export interface MigratePgliteDatabaseOptions {
  migrationsFolder?: string
}

export async function createPgliteClient(options: CreatePgliteClientOptions = {}) {
  if (options.dataDir) {
    fs.mkdirSync(options.dataDir, { recursive: true })
    return new PGlite(options.dataDir)
  }
  return new PGlite()
}

export function createPgliteDatabase(client: PgliteClient) {
  return drizzle(client, { schema })
}

export function resolvePgliteMigrationsFolder(migrationsFolder?: string) {
  if (migrationsFolder) return migrationsFolder
  return path.resolve(__dirname, '../../drizzle')
}

/**
 * Applies the bundled PostgreSQL operational baseline to a caller-owned PGlite
 * instance. Does not own long-lived workspace caching or shutdown lifecycle.
 */
export async function migratePgliteDatabase(
  client: PgliteClient,
  options: MigratePgliteDatabaseOptions = {},
) {
  const database = createPgliteDatabase(client)
  await migrate(database, {
    migrationsFolder: resolvePgliteMigrationsFolder(options.migrationsFolder),
  })
  return database
}
