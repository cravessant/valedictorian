/**
 * Opportunity aggregate write ownership (issue #298 AC8, adopted by #301).
 *
 * Two write surfaces coexist during the umbrella cutover (mirrors job.repository.ts):
 *  - LEGACY conversations (`insertOpportunities` / `updateOpportunities` /
 *    `insertSourcingProjectionOutcomes` / `updateSourcingProjectionOutcomes`) back
 *    the still-live sourcing projection + action-queue disposition path. #301 does
 *    NOT repoint these — the legacy projection stays live until #304 (see
 *    drizzle/lifecycle-migration.md), because a dual-write is forbidden and the
 *    legacy reads stay on legacy tables.
 *  - CANONICAL conversations (`insertLifecycleOpportunities` / `insertOpportunityHistory`
 *    / `updateLifecycleOpportunities`) back the new user-controlled Opportunity
 *    aggregate + Job→Opportunity promotion (#301), writing the canonical
 *    `lifecycle_opportunities` and append-only `opportunity_history` tables through
 *    the Opportunity service and orchestration.
 *
 * The state-ownership scanner (src/test/lifecycle-state-ownership.ts) attributes
 * these `.insert/.update(table)` calls to the opportunity module; every other module
 * composes them as function calls rather than writing the tables directly.
 */
import { opportunities, sourcingProjectionOutcomes } from '../../db/schema'
import { lifecycleOpportunities, opportunityHistory } from './opportunity.schema'
import type { PgliteDatabase } from '../../db/pglite'

/** Insert-only surface (the workspace database or an open transaction). */
export type OpportunityWriteExecutor = Pick<PgliteDatabase, 'insert'>
/** Insert + update surface, for canonical Opportunity head mutations (versions, tombstone). */
export type OpportunityMutateExecutor = Pick<PgliteDatabase, 'insert' | 'update'>
type UpdateExecutor = Pick<PgliteDatabase, 'update'>

// Legacy (sourcing projection + action-queue disposition; repointed at #304, not #301).
export const insertOpportunities = (exec: OpportunityWriteExecutor) => exec.insert(opportunities)
export const updateOpportunities = (exec: UpdateExecutor) => exec.update(opportunities)
export const insertSourcingProjectionOutcomes = (exec: OpportunityWriteExecutor) => exec.insert(sourcingProjectionOutcomes)
export const updateSourcingProjectionOutcomes = (exec: UpdateExecutor) => exec.update(sourcingProjectionOutcomes)

// Canonical (the #301 user-controlled Opportunity aggregate + Job→Opportunity promotion).
export const insertLifecycleOpportunities = (exec: OpportunityWriteExecutor) => exec.insert(lifecycleOpportunities)
export const insertOpportunityHistory = (exec: OpportunityWriteExecutor) => exec.insert(opportunityHistory)
export const updateLifecycleOpportunities = (exec: OpportunityMutateExecutor) => exec.update(lifecycleOpportunities)
