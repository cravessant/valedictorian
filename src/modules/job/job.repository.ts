/**
 * Job aggregate write ownership (issue #298 AC8, adopted by #300).
 *
 * The Job module owns every write to canonical Job state through these thin
 * repository conversations.
 */
import {
  jobCaptureEvidenceReferences,
  jobExternalIdentities,
  jobHistory,
  jobs,
} from '../../db/schema'
import type { PgliteDatabase } from '../../db/pglite'

/** Insert-only surface (the workspace database or an open transaction). */
export type JobWriteExecutor = Pick<PgliteDatabase, 'insert'>
/** Insert + update surface, for canonical Job head mutations (versions, tombstone). */
export type JobMutateExecutor = Pick<PgliteDatabase, 'insert' | 'update'>
/** Insert + update + delete surface, for the merge lineage re-point. */
export type JobDeleteExecutor = Pick<PgliteDatabase, 'insert' | 'update' | 'delete'>

// Canonical (the #300 user-controlled Job aggregate).
export const insertJobs = (exec: JobWriteExecutor) => exec.insert(jobs)
export const insertJobHistory = (exec: JobWriteExecutor) => exec.insert(jobHistory)
export const updateJobs = (exec: JobMutateExecutor) => exec.update(jobs)
export const insertJobExternalIdentities = (exec: JobWriteExecutor) => exec.insert(jobExternalIdentities)
// Job external identities are append-only except the one-way removal transition
// (set removed_at); the enforce trigger rejects any other update. Strengthen and
// merge tombstone-then-insert rather than mutating in place.
export const updateJobExternalIdentities = (exec: JobMutateExecutor) => exec.update(jobExternalIdentities)
// Lineage re-point (merge): job_capture_evidence_references permits delete (only a
// workspace-consistency trigger guards it), so the loser's references are deleted
// after being re-inserted on the winner.
export const deleteJobCaptureEvidenceReferences = (exec: JobDeleteExecutor) => exec.delete(jobCaptureEvidenceReferences)

/**
 * Canonical Capture→Job lineage minting conversation (#299 slice 2 seam).
 *
 * `job_capture_evidence_references` is the SOLE owner of the Capture→Job answer:
 * `captures` carries no `job_id`, so there is no competing owner to
 * diverge from (the legacy captures.job_id vs fact-version.job_id divergence the
 * 0001 transform resolved cannot recur). The unique index
 * `(job_id, capture_id, capture_revision)` makes each produced Job's lineage to a
 * Capture revision unambiguous, and the FK to `capture_revisions` forces the link
 * to reference a real capture revision. Job promotion (#300) mints these rows from
 * Capture's evidence-reference read conversation (capture.lineage.ts); #299 lands
 * the seam and its constraint proofs but wires NO production writer.
 */
export const insertJobCaptureEvidenceReferences = (exec: JobWriteExecutor) =>
  exec.insert(jobCaptureEvidenceReferences)
