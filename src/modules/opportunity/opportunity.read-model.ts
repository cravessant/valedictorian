/**
 * Opportunity read-model (issue #304, stage 3).
 *
 * The read half of the Opportunity HTTP surface: loads canonical
 * `lifecycle_opportunities` and `opportunity_history` rows and hands them to the
 * pure serializers in opportunity.dto.ts, producing the sparxie `Opportunity`
 * resource, the `OpportunityListResult` page, and the reconstructed
 * `OpportunityHistoryResult`. Reads only — every mutation still flows through the
 * Opportunity service, which owns validation and policy.
 */
import { and, asc, eq, gt, isNull, or } from 'drizzle-orm'
import type {
  Opportunity,
  OpportunityHistoryResult,
  OpportunityListInput,
  OpportunityListResult,
} from 'sparxie'
import type { PgliteDatabase } from '../../db/pglite'
import { lifecycleOpportunities, opportunityHistory } from './opportunity.schema'
import {
  decodeOpportunityCursor,
  reconstructOpportunityHistory,
  toOpportunityListResult,
  toOpportunityResource,
  type OpportunityHeadRow,
  type OpportunityHistoryRow,
} from './opportunity.dto'

const DEFAULT_LIST_LIMIT = 50
const MAX_LIST_LIMIT = 200
const DEFAULT_HISTORY_LIMIT = 50
const MAX_HISTORY_LIMIT = 200

export interface OpportunityHistoryReadInput {
  readonly id: string
  readonly limit?: number
  readonly cursor?: string
}

export interface OpportunityReadModel {
  getOpportunity(workspaceId: string, opportunityId: string): Promise<Opportunity | null>
  listOpportunities(workspaceId: string, input?: OpportunityListInput): Promise<OpportunityListResult>
  historyOpportunities(workspaceId: string, input: OpportunityHistoryReadInput): Promise<OpportunityHistoryResult>
}

function clampLimit(requested: number | undefined, fallback: number, max: number): number {
  if (requested === undefined || !Number.isFinite(requested)) return Math.min(fallback, max)
  const floored = Math.floor(requested)
  if (floored < 1) return 1
  if (floored > max) return max
  return floored
}

export function createPgliteOpportunityReadModel(database: PgliteDatabase): OpportunityReadModel {
  async function selectHead(workspaceId: string, opportunityId: string): Promise<OpportunityHeadRow | null> {
    const [row] = await database
      .select()
      .from(lifecycleOpportunities)
      .where(and(eq(lifecycleOpportunities.workspaceId, workspaceId), eq(lifecycleOpportunities.id, opportunityId)))
      .limit(1)
    return (row as OpportunityHeadRow | undefined) ?? null
  }

  return {
    async getOpportunity(workspaceId, opportunityId) {
      const head = await selectHead(workspaceId, opportunityId)
      return head ? toOpportunityResource(head) : null
    },

    async listOpportunities(workspaceId, input = {}) {
      const limit = clampLimit(input.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
      const cursor = input.cursor ? decodeOpportunityCursor(input.cursor) : null

      const filters = [eq(lifecycleOpportunities.workspaceId, workspaceId)]
      if (input.jobId !== undefined) filters.push(eq(lifecycleOpportunities.jobId, input.jobId))
      if (input.fit !== undefined) filters.push(eq(lifecycleOpportunities.fit, input.fit))
      if (input.disposition !== undefined) filters.push(eq(lifecycleOpportunities.disposition, input.disposition))
      if (input.includeRemoved !== true) filters.push(isNull(lifecycleOpportunities.removedAt))
      if (cursor) {
        const keyset = or(
          gt(lifecycleOpportunities.createdAt, cursor.createdAt),
          and(eq(lifecycleOpportunities.createdAt, cursor.createdAt), gt(lifecycleOpportunities.id, cursor.id)),
        )
        if (keyset) filters.push(keyset)
      }

      const rows = (await database
        .select()
        .from(lifecycleOpportunities)
        .where(and(...filters))
        .orderBy(asc(lifecycleOpportunities.createdAt), asc(lifecycleOpportunities.id))
        .limit(limit + 1)) as OpportunityHeadRow[]

      const hasMore = rows.length > limit
      const pageRows = hasMore ? rows.slice(0, limit) : rows
      return toOpportunityListResult(pageRows.map(toOpportunityResource), limit, hasMore)
    },

    async historyOpportunities(workspaceId, input) {
      const limit = clampLimit(input.limit, DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT)
      const head = await selectHead(workspaceId, input.id)
      if (!head) return { limit, nextCursor: null, items: [] }

      const historyRows = (await database
        .select({
          revision: opportunityHistory.revision,
          kind: opportunityHistory.kind,
          snapshotJson: opportunityHistory.snapshotJson,
          auditJson: opportunityHistory.auditJson,
          createdAt: opportunityHistory.createdAt,
        })
        .from(opportunityHistory)
        .where(eq(opportunityHistory.opportunityId, input.id))
        .orderBy(asc(opportunityHistory.revision))) as OpportunityHistoryRow[]

      const afterRevision = input.cursor !== undefined ? Number.parseInt(input.cursor, 10) : undefined
      return reconstructOpportunityHistory(head, historyRows, {
        limit,
        afterRevision: afterRevision !== undefined && Number.isFinite(afterRevision) ? afterRevision : undefined,
      })
    },
  }
}
