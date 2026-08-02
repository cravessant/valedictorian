import type { PgliteDatabase } from '@sparxie/valedictorian-local-runtime/database'
import { createInitialCompanyAssignment } from '@sparxie/valedictorian-local-runtime/company'
import {
  createLocalLifecycleMethods,
  type LocalLifecycleMethodsOptions,
} from '@sparxie/valedictorian-local-runtime/testing/runtime/local-lifecycle-methods'

export function createLocalLifecycleMethodsWithCompanies(
  database: PgliteDatabase,
  options: Omit<LocalLifecycleMethodsOptions, 'initialCompanyAssignment'>,
) {
  return createLocalLifecycleMethods(database, {
    ...options,
    initialCompanyAssignment: createInitialCompanyAssignment(),
  })
}
