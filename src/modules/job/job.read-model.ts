/**
 * Job read-model (issue #304, stage 3).
 *
 * The read half of the Job HTTP surface: loads canonical `lifecycle_jobs`,
 * `job_external_identities`, `job_capture_evidence_references`, and `job_history`
 * rows and hands them to the pure serializers in job.dto.ts, producing the sparxie
 * `Job` resource, the `JobListResult` page, and the reconstructed
 * `JobHistoryResult`. Reads only — every mutation still flows through the Job
 * service, which owns validation and policy.
 */
import { and, asc, eq, gt, isNull, or } from 'drizzle-orm'
import type { Job, JobHistoryResult, JobListInput, JobListResult } from 'sparxie'
import type { PgliteDatabase } from '../../db/pglite'
import {
  jobCaptureEvidenceReferences,
  jobExternalIdentities,
  jobHistory,
  lifecycleJobs,
} from './job.schema'
import {
  decodeJobCursor,
  reconstructJobHistory,
  toJobListResult,
  toJobResource,
  type JobEvidenceRefRow,
  type JobHeadRow,
  type JobHistoryRow,
  type JobIdentityRow,
} from './job.dto'

const DEFAULT_LIST_LIMIT = 50
const MAX_LIST_LIMIT = 200
const DEFAULT_HISTORY_LIMIT = 50
const MAX_HISTORY_LIMIT = 200

/** Read surface only — the workspace database or an open transaction. */
export type JobReadExec = Pick<PgliteDatabase, 'select'>

export interface JobHistoryReadInput {
  readonly id: string
  readonly limit?: number
  readonly cursor?: string
}

export interface JobReadModel {
  getJob(workspaceId: string, jobId: string): Promise<Job | null>
  listJobs(workspaceId: string, input?: JobListInput): Promise<JobListResult>
  historyJobs(workspaceId: string, input: JobHistoryReadInput): Promise<JobHistoryResult>
}

function clampLimit(requested: number | undefined, fallback: number, max: number): number {
  if (requested === undefined || !Number.isFinite(requested)) return Math.min(fallback, max)
  const floored = Math.floor(requested)
  if (floored < 1) return 1
  if (floored > max) return max
  return floored
}

async function selectIdentities(
  exec: JobReadExec,
  jobId: string,
  options: { readonly activeOnly: boolean },
): Promise<JobIdentityRow[]> {
  const filters = [eq(jobExternalIdentities.jobId, jobId)]
  if (options.activeOnly) filters.push(isNull(jobExternalIdentities.removedAt))
  const rows = await exec
    .select({
      id: jobExternalIdentities.id,
      kind: jobExternalIdentities.kind,
      provider: jobExternalIdentities.provider,
      account: jobExternalIdentities.account,
      value: jobExternalIdentities.value,
      strength: jobExternalIdentities.strength,
      createdAt: jobExternalIdentities.createdAt,
      removedAt: jobExternalIdentities.removedAt,
    })
    .from(jobExternalIdentities)
    .where(and(...filters))
  return rows as JobIdentityRow[]
}

async function selectEvidenceRefs(exec: JobReadExec, jobId: string): Promise<JobEvidenceRefRow[]> {
  const rows = await exec
    .select({
      id: jobCaptureEvidenceReferences.id,
      captureId: jobCaptureEvidenceReferences.captureId,
      captureRevision: jobCaptureEvidenceReferences.captureRevision,
      evidenceIndexesJson: jobCaptureEvidenceReferences.evidenceIndexesJson,
      createdAt: jobCaptureEvidenceReferences.createdAt,
    })
    .from(jobCaptureEvidenceReferences)
    .where(eq(jobCaptureEvidenceReferences.jobId, jobId))
  return rows as JobEvidenceRefRow[]
}

export function createPgliteJobReadModel(database: PgliteDatabase): JobReadModel {
  async function selectHead(workspaceId: string, jobId: string): Promise<JobHeadRow | null> {
    const [row] = await database
      .select()
      .from(lifecycleJobs)
      .where(and(eq(lifecycleJobs.workspaceId, workspaceId), eq(lifecycleJobs.id, jobId)))
      .limit(1)
    return (row as JobHeadRow | undefined) ?? null
  }

  return {
    async getJob(workspaceId, jobId) {
      const head = await selectHead(workspaceId, jobId)
      if (!head) return null
      const [identities, evidenceRefs] = await Promise.all([
        selectIdentities(database, jobId, { activeOnly: true }),
        selectEvidenceRefs(database, jobId),
      ])
      return toJobResource(head, identities, evidenceRefs)
    },

    async listJobs(workspaceId, input = {}) {
      const limit = clampLimit(input.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
      const cursor = input.cursor ? decodeJobCursor(input.cursor) : null

      const filters = [eq(lifecycleJobs.workspaceId, workspaceId)]
      if (input.availability !== undefined) {
        filters.push(eq(lifecycleJobs.availabilityState, input.availability))
      }
      if (input.includeRemoved !== true) {
        filters.push(isNull(lifecycleJobs.removedAt))
      }
      if (cursor) {
        const keyset = or(
          gt(lifecycleJobs.createdAt, cursor.createdAt),
          and(eq(lifecycleJobs.createdAt, cursor.createdAt), gt(lifecycleJobs.id, cursor.id)),
        )
        if (keyset) filters.push(keyset)
      }

      const rows = (await database
        .select()
        .from(lifecycleJobs)
        .where(and(...filters))
        .orderBy(asc(lifecycleJobs.createdAt), asc(lifecycleJobs.id))
        .limit(limit + 1)) as JobHeadRow[]

      const hasMore = rows.length > limit
      const pageRows = hasMore ? rows.slice(0, limit) : rows
      const items = await Promise.all(
        pageRows.map(async (head) => {
          const [identities, evidenceRefs] = await Promise.all([
            selectIdentities(database, head.id, { activeOnly: true }),
            selectEvidenceRefs(database, head.id),
          ])
          return toJobResource(head, identities, evidenceRefs)
        }),
      )
      return toJobListResult(items, limit, hasMore)
    },

    async historyJobs(workspaceId, input) {
      const limit = clampLimit(input.limit, DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT)
      const head = await selectHead(workspaceId, input.id)
      if (!head) return { limit, nextCursor: null, items: [] }

      const [historyRows, identities, evidenceRefs] = await Promise.all([
        database
          .select({
            sequence: jobHistory.sequence,
            kind: jobHistory.kind,
            snapshotJson: jobHistory.snapshotJson,
            auditJson: jobHistory.auditJson,
            createdAt: jobHistory.createdAt,
          })
          .from(jobHistory)
          .where(eq(jobHistory.jobId, input.id))
          .orderBy(asc(jobHistory.sequence)) as Promise<JobHistoryRow[]>,
        selectIdentities(database, input.id, { activeOnly: false }),
        selectEvidenceRefs(database, input.id),
      ])

      const afterSequence = input.cursor !== undefined ? Number.parseInt(input.cursor, 10) : undefined
      return reconstructJobHistory(head, historyRows, identities, evidenceRefs, {
        limit,
        afterSequence: afterSequence !== undefined && Number.isFinite(afterSequence) ? afterSequence : undefined,
      })
    },
  }
}
