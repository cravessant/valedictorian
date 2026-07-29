/**
 * Opportunity dependent queries (issue #327).
 *
 * The narrow owner-provided reads the lifecycle transport needs to render a
 * blocked Job removal and to name the deterministic-duplicate conflict target
 * when promoting a Job. They replace the runtime's direct read of the
 * `opportunities` table, so only the Opportunity module touches Opportunity
 * state.
 */
import { and, eq, isNull } from 'drizzle-orm'
import type { PgliteDatabase } from '../../db/pglite'
import { opportunities } from './opportunity.schema'

export interface OpportunityDependentQueries {
  /** Distinct active Opportunities projecting the Job, in row order. */
  activeOpportunityIdsForJob(jobId: string): Promise<string[]>
  /** The first active Opportunity projecting the Job, or null. */
  activeOpportunityIdForJob(jobId: string): Promise<string | null>
}

export function createPgliteOpportunityDependentQueries(
  database: PgliteDatabase,
): OpportunityDependentQueries {
  const activeForJob = (jobId: string) =>
    database
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(and(eq(opportunities.jobId, jobId), isNull(opportunities.removedAt)))

  return {
    async activeOpportunityIdsForJob(jobId) {
      const rows = await activeForJob(jobId)
      return [...new Set(rows.map((row) => row.id))]
    },
    async activeOpportunityIdForJob(jobId) {
      const [row] = await activeForJob(jobId).limit(1)
      return row?.id ?? null
    },
  }
}
