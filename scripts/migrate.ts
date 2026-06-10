import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { migrateDatabase } from '../src/db/sqlite'

const databasePath =
  process.env.VALEDICTORIAN_SQLITE_PATH ??
  path.join('.data', 'valedictorian.sqlite')

fs.mkdirSync(path.dirname(databasePath), { recursive: true })

const database = new Database(databasePath)
migrateDatabase(database)
database.close()

console.log(`Migrated SQLite database at ${databasePath}`)
