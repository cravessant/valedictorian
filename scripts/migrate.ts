import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { migrateDatabase } from '../src/db/sqlite'
import { resolveDatabaseFilePath } from '../src/workspace/workspace.paths'

const pgliteDataPath =
  process.env.VALEDICTORIAN_PGLITE_DATA_PATH ??
  path.join('.data', 'pglite')
const databasePath = resolveDatabaseFilePath(pgliteDataPath)

fs.mkdirSync(pgliteDataPath, { recursive: true })

const database = new Database(databasePath)
migrateDatabase(database)
database.close()

console.log(`Migrated database at ${pgliteDataPath}`)
