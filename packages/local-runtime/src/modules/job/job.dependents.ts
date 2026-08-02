/**
 * Job dependent queries (issue #327).
 *
 * The narrow owner-provided read the lifecycle transport needs to render a
 * blocked capture removal: which active Jobs claim a Capture as evidence. It
 * replaces the runtime's direct read of the `jobs` and
 * `job_capture_evidence_references` tables, so only the Job module touches Job
 * state.
 */
import { and, eq, isNull } from 'drizzle-orm'
import type { PgliteDatabase } from '../../db/pglite.js'
import { jobCaptureEvidenceReferences, jobs } from './job.schema.js'

export interface JobDependentQueries {
  /** Distinct active Jobs whose evidence references the Capture, in row order. */
  activeJobIdsForCapture(captureId: string): Promise<string[]>
}

export function createPgliteJobDependentQueries(database: PgliteDatabase): JobDependentQueries {
  return {
    async activeJobIdsForCapture(captureId) {
      const rows = await database
        .select({ jobId: jobCaptureEvidenceReferences.jobId })
        .from(jobCaptureEvidenceReferences)
        .innerJoin(jobs, eq(jobs.id, jobCaptureEvidenceReferences.jobId))
        .where(and(eq(jobCaptureEvidenceReferences.captureId, captureId), isNull(jobs.removedAt)))
      return [...new Set(rows.map((row) => row.jobId))]
    },
  }
}
