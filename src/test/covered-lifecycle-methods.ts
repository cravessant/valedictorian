import type { PgliteDatabase } from '../db/pglite'
import { createCompanyCoverageService } from '../modules/company/company.coverage'
import {
  createLocalLifecycleMethods,
  type LocalLifecycleMethodsOptions,
} from '../runtime/local-lifecycle-methods'

export function createCoveredLocalLifecycleMethods(
  database: PgliteDatabase,
  options: Omit<LocalLifecycleMethodsOptions, 'jobCreationCoverage'>,
) {
  const jobCreationCoverage = createCompanyCoverageService(database).jobCreationCoverage
  return createLocalLifecycleMethods(database, { ...options, jobCreationCoverage })
}
