import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { schema } from './schema'

export type SqliteDatabase = Database.Database
export type DrizzleDatabase = ReturnType<typeof createDrizzleDatabase>

/**
 * Transitional better-sqlite3 helpers retained until #239/#240 convert repositories
 * and composition to the PGlite migrator in `./pglite`. Operational schema upgrades
 * no longer run through this module.
 */
export function createInMemoryDatabase() {
  return new Database(':memory:')
}

export function createFileDatabase(databasePath: string) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true })
  const database = new Database(databasePath)
  database.pragma('foreign_keys = on')
  database.pragma('journal_mode = wal')
  database.pragma('busy_timeout = 5000')
  return database
}

export function createDrizzleDatabase(database: SqliteDatabase) {
  return drizzle(database, { schema })
}

export function migrateDatabase(
  _database: SqliteDatabase,
  _options: {
    backupDirectory?: string
    createBackup?: boolean
    migrationsFolder?: string
    now?: () => Date
  } = {},
): never {
  throw new Error(
    'Operational SQLite migrations were removed in #238. Use migratePgliteDatabase from src/db/pglite.ts.',
  )
}
