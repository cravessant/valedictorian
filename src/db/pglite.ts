import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { loadPgliteRuntimeAssets } from './pglite-runtime-assets'
import { schema } from './schema'
import { DEFAULT_WORKSPACE_ID, workspaces } from './workspaces.schema'

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
  const runtimeAssets = await loadPgliteRuntimeAssets()
  const pgliteOptions = {
    pgliteWasmModule: runtimeAssets.pgliteWasmModule,
    initdbWasmModule: runtimeAssets.initdbWasmModule,
    fsBundle: runtimeAssets.fsBundle,
  }

  if (options.dataDir) {
    fs.mkdirSync(options.dataDir, { recursive: true })
    return new PGlite(options.dataDir, pgliteOptions)
  }
  return new PGlite(pgliteOptions)
}

export function createPgliteDatabase(client: PgliteClient) {
  return drizzle(client, { schema })
}

export function resolvePgliteMigrationsFolder(
  migrationsFolder?: string,
  options: { moduleDirectory?: string } = {},
) {
  if (migrationsFolder) return migrationsFolder

  const moduleDirectory = options.moduleDirectory ?? __dirname
  const candidates = [
    path.resolve(moduleDirectory, '../../drizzle'),
    path.resolve(moduleDirectory, '../drizzle'),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
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
