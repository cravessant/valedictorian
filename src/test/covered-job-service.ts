import type { PgliteDatabase } from '../db/pglite'
import { createCompanyCoverageService } from '../modules/company/company.coverage'
import {
  createPgliteJobService,
  type JobServiceOptions,
} from '../modules/job/job.service'

export function createCoveredPgliteJobService(
  database: PgliteDatabase,
  options: Omit<JobServiceOptions, 'creationCoverage'> = {},
) {
  const creationCoverage = createCompanyCoverageService(database).jobCreationCoverage
  return createPgliteJobService(database, { ...options, creationCoverage })
}
