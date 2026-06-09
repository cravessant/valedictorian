import { createDrizzleDatabase, migrateDatabase, type SqliteDatabase } from '../../db/sqlite'
import { createSqliteApplicationRepository } from './application.repository'
import { createApplicationService } from './application.service'

export function createApplicationServiceFromSqlite(sqlite: SqliteDatabase) {
  migrateDatabase(sqlite)

  const database = createDrizzleDatabase(sqlite)

  return createApplicationService(createSqliteApplicationRepository(database))
}
