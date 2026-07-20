/**
 * Job aggregate write ownership (issue #298, AC8). See capture.repository.ts for
 * the module-boundary rationale (legacy-backed now; the Job leaf #300 repoints
 * these onto the canonical `lifecycle_*` tables — drizzle/lifecycle-migration.md).
 */
import { jobFactVersions, jobIdentities, jobIdentityConflicts, jobs } from '../../db/schema'
import type { PgliteDatabase } from '../../db/pglite'

export type JobWriteExecutor = Pick<PgliteDatabase, 'insert'>

export const insertJobs = (exec: JobWriteExecutor) => exec.insert(jobs)
export const insertJobIdentities = (exec: JobWriteExecutor) => exec.insert(jobIdentities)
export const insertJobIdentityConflicts = (exec: JobWriteExecutor) => exec.insert(jobIdentityConflicts)
export const insertJobFactVersions = (exec: JobWriteExecutor) => exec.insert(jobFactVersions)
