/**
 * Job read-model (issue #304, stage 3).
 *
 * The read half of the Job HTTP surface: loads canonical `jobs`,
 * `job_external_identities`, `job_capture_evidence_references`, and `job_history`
 * rows and hands them to the pure serializers in job.dto.ts, producing the sparxie
 * `Job` resource, the `JobListResult` page, and the reconstructed
 * `JobHistoryResult`. Reads only — every mutation still flows through the Job
 * service, which owns validation and policy.
 */
import { and, asc, eq, isNull, type SQL } from 'drizzle-orm'
import type { Job, JobHistoryResult, JobListInput, JobListResult } from '@sparxie/sdk'
import type { PgliteDatabase } from '../../db/pglite'
import {
  jobCaptureEvidenceReferences,
  jobExternalIdentities,
  jobHistory,
  jobs,
} from './job.schema'
import {
  reconstructJobHistory,
  toJobResource,
  type JobEvidenceRefRow,
  type JobHeadRow,
  type JobHistoryRow,
  type JobIdentityRow,
} from './job.dto'
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

/** Read surface only — the workspace database or an open transaction. */
export type JobReadExec = Pick<PgliteDatabase, 'select'>

export interface JobHistoryReadInput extends LifecyclePageRequest {
  readonly id: string
}

export interface JobReadModel {
  getJob(workspaceId: string, jobId: string): Promise<Job | null>
  listJobs(workspaceId: string, input?: JobListInput): Promise<JobListResult>
  historyJobs(workspaceId: string, input: JobHistoryReadInput): Promise<JobHistoryResult>
}

/** The stable (createdAt, id) ordering every Job page walks. */
const jobKeyset = { primary: jobs.createdAt, id: jobs.id }

const jobCursor = (row: { createdAt: string; id: string }) =>
  encodeKeysetCursor({ primary: row.createdAt, id: row.id })

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
      .from(jobs)
      .where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.id, jobId)))
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
      const window = readPageWindow(input)
      const filters: SQL[] = [eq(jobs.workspaceId, workspaceId)]
      if (input.availability !== undefined) {
        filters.push(eq(jobs.availabilityState, input.availability))
      }
      if (input.includeRemoved !== true) {
        filters.push(isNull(jobs.removedAt))
      }
      const rows = (await database
        .select()
        .from(jobs)
        .where(and(...filters, ...lifecycleKeysetWindow(jobKeyset, window)))
        .orderBy(...lifecycleKeysetOrder(jobKeyset, window))
        .limit(window.limit + 1)) as JobHeadRow[]

      const page = await toLifecyclePage(rows, window, jobCursor,
        createLifecycleAdjacencyProbe(database, jobs, filters, jobKeyset))
      const items = await Promise.all(
        page.rows.map(async (head) => {
          const [identities, evidenceRefs] = await Promise.all([
            selectIdentities(database, head.id, { activeOnly: true }),
            selectEvidenceRefs(database, head.id),
          ])
          return toJobResource(head, identities, evidenceRefs)
        }),
      )
      return { items, pageInfo: page.pageInfo }
    },

    async historyJobs(workspaceId, input) {
      const window = readPageWindow(input)
      const head = await selectHead(workspaceId, input.id)
      if (!head) return emptyLifecyclePage()

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

      return reconstructJobHistory(head, historyRows, identities, evidenceRefs, window)
    },
  }
}
