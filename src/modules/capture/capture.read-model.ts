/**
 * Capture read-model (issue #304, stage 3).
 *
 * The read half of the Capture HTTP surface: it loads canonical
 * `lifecycle_captures` / `capture_evidence_items` rows and hands them to the
 * pure serializers in capture.dto.ts, producing the sparxie `Capture` resource
 * and `CaptureListResult` page the typed client re-parses. It performs reads
 * only — every mutation still flows through the Capture service, which owns all
 * validation and policy. Kept separate from the service so the HTTP boundary
 * composes read + write without either reaching into the other's SQL.
 */
import { and, asc, eq, gt, isNull, or } from 'drizzle-orm'
import type { Capture, CaptureListInput, CaptureListResult } from 'sparxie'
import type { PgliteDatabase } from '../../db/pglite'
import { captureEvidenceItems, lifecycleCaptures } from './capture.schema'
import {
  decodeCaptureCursor,
  toCaptureListResult,
  toCaptureResource,
  type CaptureEvidenceRow,
  type CaptureHeadRow,
} from './capture.dto'

const DEFAULT_LIST_LIMIT = 50
const MAX_LIST_LIMIT = 200

/** Read surface only — the workspace database or an open transaction. */
export type CaptureReadExec = Pick<PgliteDatabase, 'select'>

export interface CaptureReadModel {
  getCapture(workspaceId: string, captureId: string): Promise<Capture | null>
  listCaptures(workspaceId: string, input?: CaptureListInput): Promise<CaptureListResult>
}

function clampLimit(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return DEFAULT_LIST_LIMIT
  const floored = Math.floor(requested)
  if (floored < 1) return 1
  if (floored > MAX_LIST_LIMIT) return MAX_LIST_LIMIT
  return floored
}

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
      .from(lifecycleCaptures)
      .where(and(eq(lifecycleCaptures.workspaceId, workspaceId), eq(lifecycleCaptures.id, captureId)))
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
      const limit = clampLimit(input.limit)
      const cursor = input.cursor ? decodeCaptureCursor(input.cursor) : null

      const filters = [eq(lifecycleCaptures.workspaceId, workspaceId)]
      if (input.evidenceMode !== undefined) {
        filters.push(eq(lifecycleCaptures.evidenceMode, input.evidenceMode))
      }
      if (input.adapterId !== undefined) {
        filters.push(eq(lifecycleCaptures.adapterId, input.adapterId))
      }
      if (input.includeRemoved !== true) {
        filters.push(isNull(lifecycleCaptures.removedAt))
      }
      if (cursor) {
        const keyset = or(
          gt(lifecycleCaptures.createdAt, cursor.createdAt),
          and(eq(lifecycleCaptures.createdAt, cursor.createdAt), gt(lifecycleCaptures.id, cursor.id)),
        )
        if (keyset) filters.push(keyset)
      }

      const rows = (await database
        .select()
        .from(lifecycleCaptures)
        .where(and(...filters))
        .orderBy(asc(lifecycleCaptures.createdAt), asc(lifecycleCaptures.id))
        .limit(limit + 1)) as CaptureHeadRow[]

      const hasMore = rows.length > limit
      const pageRows = hasMore ? rows.slice(0, limit) : rows
      const evidence = await selectEvidence(database, pageRows.map((row) => row.id))
      const items = pageRows.map((row) => toCaptureResource(row, evidence.get(row.id) ?? []))
      return toCaptureListResult(items, limit, hasMore)
    },
  }
}
