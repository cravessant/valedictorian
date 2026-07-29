/**
 * Application dependent queries (issue #327).
 *
 * The narrow owner-provided reads the lifecycle transport needs to render a
 * blocked Opportunity or Application removal and to name the
 * deterministic-duplicate conflict target when promoting an Opportunity. They
 * replace the runtime's direct read of the `applications`, `pursuit_links`,
 * `application_event_records`, and `application_attempt_records` tables, so only
 * the Applications module touches Application state.
 */
import { and, eq, isNull } from 'drizzle-orm'
import type { PgliteDatabase } from '../../db/pglite'
import {
  applicationAttemptRecords,
  applicationEventRecords,
  applications,
  pursuitLinks,
} from '../application/application.schema'

export interface ApplicationDependentQueries {
  /** Distinct active Applications pursuing the Opportunity, in row order. */
  activeApplicationIdsForOpportunity(opportunityId: string): Promise<string[]>
  /** The first active Application pursuing the Opportunity, or null. */
  activeApplicationIdForOpportunity(opportunityId: string): Promise<string | null>
  /** The Application's own link, event, and attempt rows, links first. */
  applicationChildIds(applicationId: string): Promise<string[]>
}

export function createPgliteApplicationDependentQueries(
  database: PgliteDatabase,
): ApplicationDependentQueries {
  const activeForOpportunity = (opportunityId: string) =>
    database
      .select({ id: applications.id })
      .from(applications)
      .where(and(eq(applications.opportunityId, opportunityId), isNull(applications.removedAt)))

  return {
    async activeApplicationIdsForOpportunity(opportunityId) {
      const rows = await activeForOpportunity(opportunityId)
      return [...new Set(rows.map((row) => row.id))]
    },
    async activeApplicationIdForOpportunity(opportunityId) {
      const [row] = await activeForOpportunity(opportunityId).limit(1)
      return row?.id ?? null
    },
    async applicationChildIds(applicationId) {
      const [links, events, attempts] = await Promise.all([
        database.select({ id: pursuitLinks.id }).from(pursuitLinks)
          .where(eq(pursuitLinks.applicationId, applicationId)),
        database.select({ id: applicationEventRecords.id }).from(applicationEventRecords)
          .where(eq(applicationEventRecords.applicationId, applicationId)),
        database.select({ id: applicationAttemptRecords.id }).from(applicationAttemptRecords)
          .where(eq(applicationAttemptRecords.applicationId, applicationId)),
      ])
      return [...links, ...events, ...attempts].map((row) => row.id)
    },
  }
}
