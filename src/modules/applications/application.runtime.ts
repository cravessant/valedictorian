import type { PgliteDatabase } from '../../db/pglite'
import { createPgliteApplicationRepository } from './application.repository'
import { createApplicationService } from './application.service'

export function createApplicationServiceFromPglite(database: PgliteDatabase) {
  return createApplicationService(createPgliteApplicationRepository(database))
}
