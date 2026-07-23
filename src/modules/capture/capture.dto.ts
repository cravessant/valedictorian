/**
 * Capture domain -> sparxie DTO serialization (issue #304, stage 3).
 *
 * Pure functions that flatten the canonical `captures` head row plus
 * its `capture_evidence_items` into the sparxie `Capture` contract resource and
 * assemble the `CaptureListResult` page envelope. These are read-side mappers:
 * they carry no policy, open no transaction, and never write. The Capture
 * service (src/modules/capture/capture.service.ts) remains the sole owner of
 * validation, idempotency, and mutation; this module only re-shapes rows the
 * read-model has already loaded into the shapes the typed client re-parses.
 *
 * Faithful field provenance (verified against capture.service.ts):
 *  - `adapter`/`observedAt`/`receivedAt`/`providerRecordId`/`providerSchema`/
 *    `payload`/`evidenceMode` are set once at create and never mutated by
 *    correct/remove/restore/re-observation, so the head row is authoritative.
 *  - `evidence` mirrors the service `evidence()` view: every evidence item
 *    across revisions, ordered by (captureRevision, evidenceIndex).
 */
import type {
  Capture,
  CaptureConnectorProvenance,
  CaptureHistoryResult,
  CaptureListResult,
  CaptureRevision,
} from '@sparxie/sdk'
import { toContractActor, toLifecycleAuditFromJson } from '../lifecycle/lifecycle-audit.dto'

export { toContractActor }

/** The subset of `captures` the read-model selects for a resource. */
export interface CaptureHeadRow {
  readonly id: string
  readonly workspaceId: string
  readonly evidenceMode: string
  readonly adapterId: string
  readonly adapterKind: string
  readonly adapterVersion: string
  readonly observedAt: string
  readonly receivedAt: string
  readonly providerRecordId: string | null
  readonly providerSchema: string | null
  readonly payloadJson: string | null
  readonly revision: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly removedAt: string | null
}

/** The subset of `capture_evidence_items` the read-model selects. */
export interface CaptureEvidenceRow {
  readonly captureRevision: number
  readonly evidenceIndex: number
  readonly kind: string
  readonly label: string
  readonly valueJson: string
}

function parseJson(text: string | null): unknown {
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function orderEvidence(rows: readonly CaptureEvidenceRow[]): CaptureEvidenceRow[] {
  return [...rows].sort((left, right) =>
    left.captureRevision === right.captureRevision
      ? left.evidenceIndex - right.evidenceIndex
      : left.captureRevision - right.captureRevision,
  )
}

/**
 * Flatten one capture head row plus its evidence into the sparxie `Capture`
 * resource. `evidence` is every supplied item; `payload` is the (immutable)
 * head payload. The result matches `captureSchema` exactly.
 */
export function toCaptureResource(
  head: CaptureHeadRow,
  evidence: readonly CaptureEvidenceRow[],
): Capture {
  return {
    evidenceMode: head.evidenceMode as Capture['evidenceMode'],
    adapter: {
      id: head.adapterId,
      kind: head.adapterKind as Capture['adapter']['kind'],
      version: head.adapterVersion,
    },
    observedAt: head.observedAt,
    receivedAt: head.receivedAt,
    providerRecordId: head.providerRecordId,
    providerSchema: head.providerSchema,
    payload: parseJson(head.payloadJson) as Capture['payload'],
    evidence: orderEvidence(evidence).map((item) => ({
      kind: item.kind,
      label: item.label,
      value: parseJson(item.valueJson),
    })),
    id: head.id,
    workspaceId: head.workspaceId,
    revision: head.revision,
    createdAt: head.createdAt,
    updatedAt: head.updatedAt,
    removedAt: head.removedAt,
  }
}

/** One capture revision row as loaded from `capture_revisions`, ordered ascending. */
export interface CaptureRevisionRow {
  readonly revision: number
  readonly kind: string
  readonly auditJson: string
  readonly connectorInstanceId?: string | null
  readonly connectorRunId?: string | null
  readonly executionScopeId?: string | null
  readonly reportedOriginJson?: string | null
  readonly createdAt: string
}

function toConnectorProvenance(
  row: CaptureRevisionRow,
): CaptureConnectorProvenance | null {
  if (
    row.connectorInstanceId == null
    || row.connectorRunId == null
    || row.executionScopeId == null
  ) {
    return null
  }
  return {
    connectorInstanceId: row.connectorInstanceId,
    connectorRunId: row.connectorRunId,
    executionScopeId: row.executionScopeId,
    reportedOrigin: parseJson(row.reportedOriginJson ?? null) as CaptureConnectorProvenance['reportedOrigin'],
  }
}

/**
 * Reconstruct the per-revision `CaptureRevision` history from the head row, the
 * ascending revision rows, and all evidence rows.
 *
 * Every snapshot is a full `Capture`. The fields that never change after create
 * (adapter, observedAt, receivedAt, provider*, payload, evidenceMode, createdAt)
 * come from the head — matching what `toCaptureResource` presents. The fields
 * that DO vary are reconstructed as of each revision: `revision`, `updatedAt`
 * (the revision's own timestamp), `removedAt` (the tombstone state after the
 * revision's kind is applied), and `evidence` (cumulative through the revision).
 */
export function reconstructCaptureHistory(
  head: CaptureHeadRow,
  revisions: readonly CaptureRevisionRow[],
  evidence: readonly CaptureEvidenceRow[],
  options: { readonly limit: number; readonly afterRevision?: number },
): CaptureHistoryResult {
  const ordered = orderEvidence(evidence)
  const sortedRevisions = [...revisions].sort((left, right) => left.revision - right.revision)

  // Reconstruct every snapshot first: tombstone and cumulative evidence state at a
  // given revision depend on all earlier revisions, so the page cannot be windowed
  // before reconstruction. Cursor/limit slicing is applied to the finished list.
  const all: CaptureRevision[] = []
  let tombstonedAt: string | null = null
  for (const revision of sortedRevisions) {
    if (revision.kind === 'removed') tombstonedAt = revision.createdAt
    else if (revision.kind === 'restored') tombstonedAt = null
    const cumulativeEvidence = ordered.filter((item) => item.captureRevision <= revision.revision)
    const snapshot: Capture = {
      ...toCaptureResource(head, cumulativeEvidence),
      revision: revision.revision,
      updatedAt: revision.createdAt,
      removedAt: tombstonedAt,
    }
    const connectorProvenance = toConnectorProvenance(revision)
    all.push({
      captureId: head.id,
      revision: revision.revision,
      kind: revision.kind as CaptureRevision['kind'],
      snapshot,
      audit: toLifecycleAuditFromJson(revision.auditJson, revision.createdAt),
      ...(connectorProvenance ? { connectorProvenance } : {}),
    })
  }

  const afterRevision = options.afterRevision
  const windowed = afterRevision === undefined
    ? all
    : all.filter((item) => item.revision > afterRevision)
  const page = windowed.slice(0, options.limit)
  const hasMore = windowed.length > options.limit
  return {
    limit: options.limit,
    nextCursor: hasMore ? String(page.at(-1)?.revision ?? '') : null,
    items: page,
  }
}

/** Opaque keyset cursor over the stable (createdAt, id) capture ordering. */
export interface CaptureListCursor {
  readonly createdAt: string
  readonly id: string
}

export function encodeCaptureCursor(cursor: CaptureListCursor): string {
  return Buffer.from(JSON.stringify([cursor.createdAt, cursor.id]), 'utf8').toString('base64url')
}

export function decodeCaptureCursor(cursor: string): CaptureListCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (
      Array.isArray(parsed)
      && parsed.length === 2
      && typeof parsed[0] === 'string'
      && typeof parsed[1] === 'string'
    ) {
      return { createdAt: parsed[0], id: parsed[1] }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Assemble a `CaptureListResult` page from an already-fetched, already-ordered
 * page (length up to `limit`) plus the sentinel row that signals a further page.
 * The caller fetches `limit + 1` rows; if a sentinel is present it is dropped and
 * its predecessor becomes the `nextCursor` anchor.
 */
export function toCaptureListResult(
  page: readonly Capture[],
  limit: number,
  hasMore: boolean,
): CaptureListResult {
  const last = page.at(-1)
  return {
    limit,
    nextCursor: hasMore && last ? encodeCaptureCursor({ createdAt: last.createdAt, id: last.id }) : null,
    items: [...page],
  }
}
