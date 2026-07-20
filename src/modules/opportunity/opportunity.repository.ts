/**
 * Opportunity aggregate write ownership (issue #298, AC8). See
 * capture.repository.ts for the module-boundary rationale (legacy-backed now; the
 * Opportunity leaf #301 repoints these onto the canonical `lifecycle_*` tables —
 * drizzle/lifecycle-migration.md).
 */
import { opportunities, sourcingProjectionOutcomes } from '../../db/schema'
import type { PgliteDatabase } from '../../db/pglite'

type InsertExecutor = Pick<PgliteDatabase, 'insert'>
type UpdateExecutor = Pick<PgliteDatabase, 'update'>

export const insertOpportunities = (exec: InsertExecutor) => exec.insert(opportunities)
export const updateOpportunities = (exec: UpdateExecutor) => exec.update(opportunities)
export const insertSourcingProjectionOutcomes = (exec: InsertExecutor) => exec.insert(sourcingProjectionOutcomes)
export const updateSourcingProjectionOutcomes = (exec: UpdateExecutor) => exec.update(sourcingProjectionOutcomes)
