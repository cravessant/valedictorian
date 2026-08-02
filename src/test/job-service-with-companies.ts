import type { PgliteDatabase } from '@sparxie/valedictorian-local-runtime/database'
import { createInitialCompanyAssignment } from '@sparxie/valedictorian-local-runtime/company'
import {
  createPgliteJobService,
  type JobServiceOptions,
} from '@sparxie/valedictorian-local-runtime/testing/modules/job/job.service'

export function createPgliteJobServiceWithCompanies(
  database: PgliteDatabase,
  options: Omit<JobServiceOptions, 'initialCompanyAssignment'> = {},
) {
  return createPgliteJobService(database, {
    ...options,
    initialCompanyAssignment: createInitialCompanyAssignment(),
  })
}
