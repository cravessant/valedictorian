/**
 * Opportunity aggregate write ownership (issue #298 AC8, adopted by #301).
 *
 * The Opportunity module owns every write to canonical Opportunity state through
 * these thin repository conversations.
 *
 * The state-ownership scanner (src/test/lifecycle-state-ownership.ts) attributes
 * these `.insert/.update(table)` calls to the opportunity module; every other module
 * composes them as function calls rather than writing the tables directly.
 */
import { opportunities, opportunityHistory } from './opportunity.schema.js'
import type { PgliteDatabase } from '../../db/pglite.js'

/** Insert-only surface (the workspace database or an open transaction). */
export type OpportunityWriteExecutor = Pick<PgliteDatabase, 'insert'>
/** Insert + update surface, for canonical Opportunity head mutations (versions, tombstone). */
export type OpportunityMutateExecutor = Pick<PgliteDatabase, 'insert' | 'update'>
// Canonical (the #301 user-controlled Opportunity aggregate + Job→Opportunity promotion).
export const insertOpportunities = (exec: OpportunityWriteExecutor) => exec.insert(opportunities)
export const insertOpportunityHistory = (exec: OpportunityWriteExecutor) => exec.insert(opportunityHistory)
export const updateOpportunities = (exec: OpportunityMutateExecutor) => exec.update(opportunities)
