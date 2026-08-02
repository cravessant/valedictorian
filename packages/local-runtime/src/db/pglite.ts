import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import type { PgliteClient } from '../pglite.js'
import { schema } from './schema.js'
import { DEFAULT_WORKSPACE_ID, workspaces } from './workspaces.schema.js'

export {
  createPgliteClient,
  type CreatePgliteClientOptions,
  type PgliteClient,
} from '../pglite.js'
export type PgliteDatabase = ReturnType<typeof createPgliteDatabase>
export type PgliteRepositoryDatabase = Omit<PgliteDatabase, '$client'>

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export interface MigratePgliteDatabaseOptions {
  migrationsFolder?: string
}

export function createPgliteDatabase(client: PgliteClient) {
  return drizzle(client, { schema })
}

export function resolvePgliteMigrationsFolder(
  migrationsFolder?: string,
  options: { moduleDirectory?: string; resourcesPath?: string } = {},
) {
  if (migrationsFolder) return migrationsFolder

  const moduleDirectory = options.moduleDirectory ?? __dirname
  const resourcesPath = options.resourcesPath
    ?? (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  const candidates = [
    ...(resourcesPath ? [path.join(resourcesPath, 'drizzle')] : []),
    path.resolve(moduleDirectory, '../../drizzle'),
    path.resolve(moduleDirectory, '../drizzle'),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, '0000_pglite_operational_baseline.sql'))) {
      return candidate
    }
  }

  throw new Error('Unable to resolve the bundled PGlite migrations folder')
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
  const migratedAt = new Date().toISOString()
  await database.insert(workspaces).values({
    id: DEFAULT_WORKSPACE_ID,
    name: 'default',
    createdAt: migratedAt,
    updatedAt: migratedAt,
  }).onConflictDoNothing()
  return database
}
