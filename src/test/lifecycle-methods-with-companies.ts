import type { PgliteDatabase } from '../db/pglite'
import { createInitialCompanyAssignment } from '../modules/company/company.assignment.service'
import {
  createLocalLifecycleMethods,
  type LocalLifecycleMethodsOptions,
} from '../runtime/local-lifecycle-methods'

export function createLocalLifecycleMethodsWithCompanies(
  database: PgliteDatabase,
  options: Omit<LocalLifecycleMethodsOptions, 'initialCompanyAssignment'>,
) {
  return createLocalLifecycleMethods(database, {
    ...options,
    initialCompanyAssignment: createInitialCompanyAssignment(),
  })
}
