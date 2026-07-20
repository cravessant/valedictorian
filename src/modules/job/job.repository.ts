/**
 * Job aggregate write ownership (issue #298, AC8). See capture.repository.ts for
 * the module-boundary rationale (legacy-backed now; the Job leaf #300 repoints
 * these onto the canonical `lifecycle_*` tables — drizzle/lifecycle-migration.md).
 */
import {
  jobCaptureEvidenceReferences,
  jobFactVersions,
  jobIdentities,
  jobIdentityConflicts,
  jobs,
} from '../../db/schema'
import type { PgliteDatabase } from '../../db/pglite'

export type JobWriteExecutor = Pick<PgliteDatabase, 'insert'>

export const insertJobs = (exec: JobWriteExecutor) => exec.insert(jobs)
export const insertJobIdentities = (exec: JobWriteExecutor) => exec.insert(jobIdentities)
export const insertJobIdentityConflicts = (exec: JobWriteExecutor) => exec.insert(jobIdentityConflicts)
export const insertJobFactVersions = (exec: JobWriteExecutor) => exec.insert(jobFactVersions)

/**
 * Canonical Capture→Job lineage minting conversation (#299 slice 2 seam).
 *
 * `job_capture_evidence_references` is the SOLE owner of the Capture→Job answer:
 * `lifecycle_captures` carries no `job_id`, so there is no competing owner to
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
