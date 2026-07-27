import type { PgliteDatabase } from '../db/pglite'
import { createInitialCompanyAssignment } from '../modules/company/company.assignment.service'
import {
  createPgliteJobService,
  type JobServiceOptions,
} from '../modules/job/job.service'

export function createPgliteJobServiceWithCompanies(
  database: PgliteDatabase,
  options: Omit<JobServiceOptions, 'initialCompanyAssignment'> = {},
) {
  return createPgliteJobService(database, {
    ...options,
    initialCompanyAssignment: createInitialCompanyAssignment(),
  })
}
