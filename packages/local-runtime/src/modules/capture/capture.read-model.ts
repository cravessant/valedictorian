/**
 * Capture read-model (issue #304, stage 3).
 *
 * The read half of the Capture HTTP surface: it loads canonical
 * `captures` / `capture_evidence_items` rows and hands them to the
 * pure serializers in capture.dto.ts, producing the sparxie `Capture` resource
 * and `CaptureListResult` page the typed client re-parses. It performs reads
 * only — every mutation still flows through the Capture service, which owns all
 * validation and policy. Kept separate from the service so the HTTP boundary
 * composes read + write without either reaching into the other's SQL.
 */
import { and, asc, eq, exists, isNull, sql, type SQL } from 'drizzle-orm'
import type {
  Capture,
  CaptureHistoryResult,
  CaptureListInput,
  CaptureListResult,
  HistoryListInput,
} from '@sparxie/sdk'
import type { PgliteDatabase } from '../../db/pglite.js'
import { captureEvidenceItems, captureOccurrences, captureRevisions, captures } from './capture.schema.js'
import {
  reconstructCaptureHistory,
  toCaptureResource,
  type CaptureEvidenceRow,
  type CaptureHeadRow,
  type CaptureRevisionRow,
} from './capture.dto.js'
import {
  emptyLifecyclePage,
  encodeKeysetCursor,
  readPageWindow,
  toLifecyclePage,
} from '../lifecycle/lifecycle-page.dto.js'
import {
  createLifecycleAdjacencyProbe,
  lifecycleKeysetOrder,
  lifecycleKeysetWindow,
} from '../lifecycle/lifecycle-keyset.js'

/** Read surface only — the workspace database or an open transaction. */
export type CaptureReadExec = Pick<PgliteDatabase, 'select'>

export interface CaptureReadModel {
  getCapture(workspaceId: string, captureId: string): Promise<Capture | null>
  listCaptures(workspaceId: string, input?: CaptureListInput): Promise<CaptureListResult>
  historyCaptures(workspaceId: string, input: HistoryListInput): Promise<CaptureHistoryResult>
}

/** The stable (createdAt, id) ordering every Capture page walks. */
const captureKeyset = { primary: captures.createdAt, id: captures.id }

const captureCursor = (row: { createdAt: string; id: string }) =>
  encodeKeysetCursor({ primary: row.createdAt, id: row.id })

async function selectEvidence(
  exec: CaptureReadExec,
  captureIds: readonly string[],
): Promise<Map<string, CaptureEvidenceRow[]>> {
  const grouped = new Map<string, CaptureEvidenceRow[]>()
  if (captureIds.length === 0) return grouped
  const ids = new Set(captureIds)
  const rows = await exec
    .select({
      captureId: captureEvidenceItems.captureId,
      captureRevision: captureEvidenceItems.captureRevision,
      evidenceIndex: captureEvidenceItems.evidenceIndex,
      kind: captureEvidenceItems.kind,
      label: captureEvidenceItems.label,
      valueJson: captureEvidenceItems.valueJson,
    })
    .from(captureEvidenceItems)
    .orderBy(asc(captureEvidenceItems.captureRevision), asc(captureEvidenceItems.evidenceIndex))
  for (const row of rows) {
    if (!ids.has(row.captureId)) continue
    const bucket = grouped.get(row.captureId) ?? []
    bucket.push({
      captureRevision: row.captureRevision,
      evidenceIndex: row.evidenceIndex,
      kind: row.kind,
      label: row.label,
      valueJson: row.valueJson,
    })
    grouped.set(row.captureId, bucket)
  }
  return grouped
}

export function createPgliteCaptureReadModel(database: PgliteDatabase): CaptureReadModel {
  async function selectHead(workspaceId: string, captureId: string): Promise<CaptureHeadRow | null> {
    const [row] = await database
      .select()
      .from(captures)
      .where(and(eq(captures.workspaceId, workspaceId), eq(captures.id, captureId)))
      .limit(1)
    return (row as CaptureHeadRow | undefined) ?? null
  }

  return {
    async getCapture(workspaceId, captureId) {
      const head = await selectHead(workspaceId, captureId)
      if (!head) return null
      const evidence = await selectEvidence(database, [captureId])
      return toCaptureResource(head, evidence.get(captureId) ?? [])
    },

    async listCaptures(workspaceId, input = {}) {
      const window = readPageWindow(input)
      const filters: SQL[] = [eq(captures.workspaceId, workspaceId)]
      if (input.evidenceMode !== undefined) {
        filters.push(eq(captures.evidenceMode, input.evidenceMode))
      }
      if (input.adapterId !== undefined) {
        filters.push(eq(captures.adapterId, input.adapterId))
      }
      if (input.connectorRunId !== undefined) {
        filters.push(exists(
          database
            .select({ value: sql`1` })
            .from(captureOccurrences)
            .where(and(
              eq(captureOccurrences.captureId, captures.id),
              eq(captureOccurrences.connectorRunId, input.connectorRunId),
            )),
        ))
      }
      if (input.includeRemoved !== true) {
        filters.push(isNull(captures.removedAt))
      }
      const rows = (await database
        .select()
        .from(captures)
        .where(and(...filters, ...lifecycleKeysetWindow(captureKeyset, window)))
        .orderBy(...lifecycleKeysetOrder(captureKeyset, window))
        .limit(window.limit + 1)) as CaptureHeadRow[]

      const page = await toLifecyclePage(rows, window, captureCursor,
        createLifecycleAdjacencyProbe(database, captures, filters, captureKeyset))
      const evidence = await selectEvidence(database, page.rows.map((row) => row.id))
      return {
        items: page.rows.map((row) => toCaptureResource(row, evidence.get(row.id) ?? [])),
        pageInfo: page.pageInfo,
      }
    },

    async historyCaptures(workspaceId, input) {
      const window = readPageWindow(input)
      const head = await selectHead(workspaceId, input.id)
      if (!head) return emptyLifecyclePage()

      const revisionRows = (await database
        .select({
          revision: captureRevisions.revision,
          kind: captureRevisions.kind,
          auditJson: captureRevisions.auditJson,
          connectorInstanceId: captureRevisions.connectorInstanceId,
          connectorRunId: captureRevisions.connectorRunId,
          executionScopeId: captureRevisions.executionScopeId,
          reportedOriginJson: captureRevisions.reportedOriginJson,
          createdAt: captureRevisions.createdAt,
        })
        .from(captureRevisions)
        .where(eq(captureRevisions.captureId, input.id))
        .orderBy(asc(captureRevisions.revision))) as CaptureRevisionRow[]

      const evidence = await selectEvidence(database, [input.id])
      return reconstructCaptureHistory(head, revisionRows, evidence.get(input.id) ?? [], window)
    },
  }
}
