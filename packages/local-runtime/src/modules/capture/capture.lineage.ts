/**
 * Capture → Job lineage: the evidence-reference READ conversation (#299 slice 2).
 *
 * Capture owns "what observed evidence backs this capture revision"; the Job
 * module owns minting the `job_capture_evidence_references` row from it
 * (job.repository.ts `insertJobCaptureEvidenceReferences`). This narrow read
 * conversation is the seam lifecycle orchestration composes: given a capture and
 * a revision, it yields the capture id, the revision, and the observed evidence
 * indexes present at that revision — exactly the material a produced Job records
 * as its unambiguous lineage. It is workspace-scoped, so a lineage can never be
 * built across a workspace boundary.
 *
 * Evidence-mode retrieval AUTHORITY split (recorded for #300): #299's Capture
 * aggregate makes `evidence_mode` immutable and merely EXPOSES it (capture
 * service `evidence()`, and `mode` here). The reported-vs-ats_details_provided
 * retrieval-rule ENFORCEMENT is a promotion-boundary concern that lands in #300's
 * Capture→Job promotion operation, which reads the mode exposed here — the
 * umbrella keeps external retrieval exclusively inside Capture→Job. #299 does not
 * enforce per-mode authority and mints no reference (promotion is #300).
 */
import { and, asc, eq } from 'drizzle-orm'
import type { PgliteDatabase } from '../../db/pglite.js'
import { captureEvidenceItems, captures } from './capture.schema.js'
import type { CaptureEvidenceMode } from './capture.service.js'

export interface CaptureEvidenceReference {
  readonly captureId: string
  readonly captureRevision: number
  readonly evidenceMode: CaptureEvidenceMode
  readonly evidenceIndexes: readonly number[]
}

export interface ReadCaptureEvidenceReferenceInput {
  readonly workspaceId: string
  readonly captureId: string
  /** Defaults to the capture's head revision. */
  readonly revision?: number
}

/** Read surface only (the workspace database or an open transaction). */
export type CaptureReadExecutor = Pick<PgliteDatabase, 'select'>

/**
 * Resolve the evidence reference a produced Job would record for a capture
 * revision. Returns null when the capture does not exist in the workspace, so a
 * lineage is never built for a foreign or absent capture.
 */
export async function readCaptureEvidenceReference(
  database: CaptureReadExecutor,
  input: ReadCaptureEvidenceReferenceInput,
): Promise<CaptureEvidenceReference | null> {
  const [capture] = await database
    .select({
      revision: captures.revision,
      evidenceMode: captures.evidenceMode,
    })
    .from(captures)
    .where(
      and(eq(captures.workspaceId, input.workspaceId), eq(captures.id, input.captureId)),
    )
    .limit(1)
  if (!capture) return null

  // Seam caveat for #300 promotion: `capture.revision` is the HEAD revision, which
  // a user correction advances WITHOUT adding evidence items (observed evidence lives
  // at observation revisions only — see capture.service.ts). So after a correction,
  // defaulting to head yields EMPTY evidenceIndexes. #300's promotion must pass the
  // evidence-bearing observation revision explicitly, not blindly default to head.
  const captureRevision = input.revision ?? capture.revision
  const rows = await database
    .select({ evidenceIndex: captureEvidenceItems.evidenceIndex })
    .from(captureEvidenceItems)
    .where(
      and(
        eq(captureEvidenceItems.captureId, input.captureId),
        eq(captureEvidenceItems.captureRevision, captureRevision),
      ),
    )
    .orderBy(asc(captureEvidenceItems.evidenceIndex))

  return {
    captureId: input.captureId,
    captureRevision,
    evidenceMode: capture.evidenceMode as CaptureEvidenceMode,
    evidenceIndexes: rows.map((row) => row.evidenceIndex),
  }
}
