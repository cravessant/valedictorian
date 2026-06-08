import { applications } from '../../db/schema'
import { createDrizzleDatabase, migrateDatabase, type SqliteDatabase } from '../../db/sqlite'
import { seedReferenceTrackerApplications } from './application.fixtures'
import { createSqliteApplicationRepository } from './application.repository'
import { createApplicationService } from './application.service'

export function createApplicationServiceFromSqlite(sqlite: SqliteDatabase) {
  migrateDatabase(sqlite)

  const database = createDrizzleDatabase(sqlite)
  const existingApplication = database.select().from(applications).limit(1).get()

  if (!existingApplication) {
    seedReferenceTrackerApplications(database)
  }

  return createApplicationService(createSqliteApplicationRepository(database))
}
