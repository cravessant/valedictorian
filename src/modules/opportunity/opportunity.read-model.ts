/**
 * Opportunity read-model (issue #304, stage 3).
 *
 * The read half of the Opportunity HTTP surface: loads canonical
 * `opportunities` and `opportunity_history` rows and hands them to the
 * pure serializers in opportunity.dto.ts, producing the sparxie `Opportunity`
 * resource, the `OpportunityListResult` page, and the reconstructed
 * `OpportunityHistoryResult`. Reads only — every mutation still flows through the
 * Opportunity service, which owns validation and policy.
 */
import { and, asc, eq, isNull, type SQL } from 'drizzle-orm'
import type {
  Opportunity,
  OpportunityHistoryResult,
  OpportunityListInput,
  OpportunityListResult,
} from '@sparxie/sdk'
import type { PgliteDatabase } from '../../db/pglite'
import { opportunities, opportunityHistory } from './opportunity.schema'
import {
  reconstructOpportunityHistory,
  toOpportunityResource,
  type OpportunityHeadRow,
  type OpportunityHistoryRow,
} from './opportunity.dto'
import {
  emptyLifecyclePage,
  encodeKeysetCursor,
  readPageWindow,
  toLifecyclePage,
  type LifecyclePageRequest,
} from '../lifecycle/lifecycle-page.dto'
import {
  createLifecycleAdjacencyProbe,
  lifecycleKeysetOrder,
  lifecycleKeysetWindow,
} from '../lifecycle/lifecycle-keyset'

export interface OpportunityHistoryReadInput extends LifecyclePageRequest {
  readonly id: string
}

export interface OpportunityReadModel {
  getOpportunity(workspaceId: string, opportunityId: string): Promise<Opportunity | null>
  listOpportunities(workspaceId: string, input?: OpportunityListInput): Promise<OpportunityListResult>
  historyOpportunities(workspaceId: string, input: OpportunityHistoryReadInput): Promise<OpportunityHistoryResult>
}

/** The stable (createdAt, id) ordering every Opportunity page walks. */
const opportunityKeyset = { primary: opportunities.createdAt, id: opportunities.id }

const opportunityCursor = (row: { createdAt: string; id: string }) =>
  encodeKeysetCursor({ primary: row.createdAt, id: row.id })

export function createPgliteOpportunityReadModel(database: PgliteDatabase): OpportunityReadModel {
  async function selectHead(workspaceId: string, opportunityId: string): Promise<OpportunityHeadRow | null> {
    const [row] = await database
      .select()
      .from(opportunities)
      .where(and(eq(opportunities.workspaceId, workspaceId), eq(opportunities.id, opportunityId)))
      .limit(1)
    return (row as OpportunityHeadRow | undefined) ?? null
  }

  return {
    async getOpportunity(workspaceId, opportunityId) {
      const head = await selectHead(workspaceId, opportunityId)
      return head ? toOpportunityResource(head) : null
    },

    async listOpportunities(workspaceId, input = {}) {
      const window = readPageWindow(input)
      const filters: SQL[] = [eq(opportunities.workspaceId, workspaceId)]
      if (input.jobId !== undefined) filters.push(eq(opportunities.jobId, input.jobId))
      if (input.fit !== undefined) filters.push(eq(opportunities.fit, input.fit))
      if (input.disposition !== undefined) filters.push(eq(opportunities.disposition, input.disposition))
      if (input.includeRemoved !== true) filters.push(isNull(opportunities.removedAt))
      const rows = (await database
        .select()
        .from(opportunities)
        .where(and(...filters, ...lifecycleKeysetWindow(opportunityKeyset, window)))
        .orderBy(...lifecycleKeysetOrder(opportunityKeyset, window))
        .limit(window.limit + 1)) as OpportunityHeadRow[]

      const page = await toLifecyclePage(rows, window, opportunityCursor,
        createLifecycleAdjacencyProbe(database, opportunities, filters, opportunityKeyset))
      return { items: page.rows.map(toOpportunityResource), pageInfo: page.pageInfo }
    },

    async historyOpportunities(workspaceId, input) {
      const window = readPageWindow(input)
      const head = await selectHead(workspaceId, input.id)
      if (!head) return emptyLifecyclePage()

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

      return reconstructOpportunityHistory(head, historyRows, window)
    },
  }
}
