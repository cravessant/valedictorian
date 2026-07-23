/**
 * Application read-model (issue #304, stage 3).
 *
 * The read half of the Application HTTP surface: loads canonical
 * `applications`, `pursuit_links`, `application_attempt_records`,
 * `application_event_records`, and `application_history` rows and hands them to the
 * pure serializers in application.dto.ts, producing the sparxie `Application`
 * resource, the list page, the attempt/event technical-list pages, and the
 * reconstructed history. Reads only — every mutation still flows through the
 * Application aggregate service, which owns validation and policy.
 */
import { and, asc, eq, gt, isNull, or } from 'drizzle-orm'
import type {
  Application,
  ApplicationAttemptsListResult,
  ApplicationEventsListResult,
  LifecycleApplicationHistoryResult,
  LifecycleApplicationListInput,
  LifecycleApplicationListResult,
} from '@sparxie/sdk'
import type { PgliteDatabase } from '../../db/pglite'
import {
  applicationAttemptRecords,
  applicationEventRecords,
  applicationHistory,
  applications,
  pursuitLinks,
} from '../application/application.schema'
import {
  decodeApplicationCursor,
  reconstructApplicationHistory,
  toApplicationListResult,
  toApplicationResource,
  toAttemptRecord,
  toAttemptsListResult,
  toEventRecord,
  toEventsListResult,
  type ApplicationAttemptRow,
  type ApplicationEventRow,
  type ApplicationHeadRow,
  type ApplicationHistoryRow,
  type ApplicationLinkRow,
} from './application.dto'

const DEFAULT_LIST_LIMIT = 50
const MAX_LIST_LIMIT = 200
const DEFAULT_HISTORY_LIMIT = 50
const MAX_HISTORY_LIMIT = 200

export interface ApplicationHistoryReadInput {
  readonly id: string
  readonly limit?: number
  readonly cursor?: string
}

export interface ApplicationTechnicalReadInput {
  readonly applicationId: string
  readonly limit?: number
  readonly cursor?: string
}

export interface ApplicationReadModel {
  getApplication(workspaceId: string, applicationId: string): Promise<Application | null>
  listApplications(workspaceId: string, input?: LifecycleApplicationListInput): Promise<LifecycleApplicationListResult>
  historyApplications(workspaceId: string, input: ApplicationHistoryReadInput): Promise<LifecycleApplicationHistoryResult>
  listAttempts(workspaceId: string, input: ApplicationTechnicalReadInput): Promise<ApplicationAttemptsListResult>
  listEvents(workspaceId: string, input: ApplicationTechnicalReadInput): Promise<ApplicationEventsListResult>
}

function clampLimit(requested: number | undefined, fallback: number, max: number): number {
  if (requested === undefined || !Number.isFinite(requested)) return Math.min(fallback, max)
  const floored = Math.floor(requested)
  if (floored < 1) return 1
  if (floored > max) return max
  return floored
}

export function createPgliteApplicationReadModel(database: PgliteDatabase): ApplicationReadModel {
  async function selectHead(workspaceId: string, applicationId: string): Promise<ApplicationHeadRow | null> {
    const [row] = await database
      .select()
      .from(applications)
      .where(and(eq(applications.workspaceId, workspaceId), eq(applications.id, applicationId)))
      .limit(1)
    return (row as ApplicationHeadRow | undefined) ?? null
  }

  async function selectLinks(applicationId: string): Promise<ApplicationLinkRow[]> {
    const rows = await database
      .select({
        id: pursuitLinks.id,
        kind: pursuitLinks.kind,
        label: pursuitLinks.label,
        url: pursuitLinks.url,
        isPrimary: pursuitLinks.isPrimary,
        createdAt: pursuitLinks.createdAt,
      })
      .from(pursuitLinks)
      .where(eq(pursuitLinks.applicationId, applicationId))
    return rows as ApplicationLinkRow[]
  }

  /** Confirm the application exists in the workspace before a sidecar/history read. */
  async function applicationExists(workspaceId: string, applicationId: string): Promise<boolean> {
    return (await selectHead(workspaceId, applicationId)) !== null
  }

  return {
    async getApplication(workspaceId, applicationId) {
      const head = await selectHead(workspaceId, applicationId)
      if (!head) return null
      return toApplicationResource(head, await selectLinks(applicationId))
    },

    async listApplications(workspaceId, input = {}) {
      const limit = clampLimit(input.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
      const cursor = input.cursor ? decodeApplicationCursor(input.cursor) : null

      const filters = [eq(applications.workspaceId, workspaceId)]
      if (input.opportunityId !== undefined) filters.push(eq(applications.opportunityId, input.opportunityId))
      if (input.jobId !== undefined) filters.push(eq(applications.jobId, input.jobId))
      if (input.status !== undefined) filters.push(eq(applications.status, input.status))
      if (input.includeRemoved !== true) filters.push(isNull(applications.removedAt))
      if (cursor) {
        const keyset = or(
          gt(applications.createdAt, cursor.primary),
          and(eq(applications.createdAt, cursor.primary), gt(applications.id, cursor.id)),
        )
        if (keyset) filters.push(keyset)
      }

      const rows = (await database
        .select()
        .from(applications)
        .where(and(...filters))
        .orderBy(asc(applications.createdAt), asc(applications.id))
        .limit(limit + 1)) as ApplicationHeadRow[]

      const hasMore = rows.length > limit
      const pageRows = hasMore ? rows.slice(0, limit) : rows
      const items = await Promise.all(pageRows.map(async (head) => toApplicationResource(head, await selectLinks(head.id))))
      return toApplicationListResult(items, limit, hasMore)
    },

    async historyApplications(workspaceId, input) {
      const limit = clampLimit(input.limit, DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT)
      const head = await selectHead(workspaceId, input.id)
      if (!head) return { limit, nextCursor: null, items: [] }

      const [historyRows, links] = await Promise.all([
        database
          .select({
            revision: applicationHistory.revision,
            kind: applicationHistory.kind,
            snapshotJson: applicationHistory.snapshotJson,
            auditJson: applicationHistory.auditJson,
            createdAt: applicationHistory.createdAt,
          })
          .from(applicationHistory)
          .where(eq(applicationHistory.applicationId, input.id))
          .orderBy(asc(applicationHistory.revision)) as Promise<ApplicationHistoryRow[]>,
        selectLinks(input.id),
      ])

      const afterRevision = input.cursor !== undefined ? Number.parseInt(input.cursor, 10) : undefined
      return reconstructApplicationHistory(head, historyRows, links, {
        limit,
        afterRevision: afterRevision !== undefined && Number.isFinite(afterRevision) ? afterRevision : undefined,
      })
    },

    async listAttempts(workspaceId, input) {
      const limit = clampLimit(input.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
      if (!(await applicationExists(workspaceId, input.applicationId))) return { limit, nextCursor: null, items: [] }
      const cursor = input.cursor ? decodeApplicationCursor(input.cursor) : null

      const filters = [
        eq(applicationAttemptRecords.workspaceId, workspaceId),
        eq(applicationAttemptRecords.applicationId, input.applicationId),
      ]
      if (cursor) {
        const keyset = or(
          gt(applicationAttemptRecords.startedAt, cursor.primary),
          and(eq(applicationAttemptRecords.startedAt, cursor.primary), gt(applicationAttemptRecords.id, cursor.id)),
        )
        if (keyset) filters.push(keyset)
      }

      const rows = (await database
        .select({
          id: applicationAttemptRecords.id,
          workspaceId: applicationAttemptRecords.workspaceId,
          applicationId: applicationAttemptRecords.applicationId,
          state: applicationAttemptRecords.state,
          startedAt: applicationAttemptRecords.startedAt,
          completedAt: applicationAttemptRecords.completedAt,
          summary: applicationAttemptRecords.summary,
        })
        .from(applicationAttemptRecords)
        .where(and(...filters))
        .orderBy(asc(applicationAttemptRecords.startedAt), asc(applicationAttemptRecords.id))
        .limit(limit + 1)) as ApplicationAttemptRow[]

      const hasMore = rows.length > limit
      const pageRows = hasMore ? rows.slice(0, limit) : rows
      return toAttemptsListResult(pageRows.map(toAttemptRecord), limit, hasMore)
    },

    async listEvents(workspaceId, input) {
      const limit = clampLimit(input.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
      if (!(await applicationExists(workspaceId, input.applicationId))) return { limit, nextCursor: null, items: [] }
      const cursor = input.cursor ? decodeApplicationCursor(input.cursor) : null

      const filters = [
        eq(applicationEventRecords.workspaceId, workspaceId),
        eq(applicationEventRecords.applicationId, input.applicationId),
      ]
      if (cursor) {
        const keyset = or(
          gt(applicationEventRecords.occurredAt, cursor.primary),
          and(eq(applicationEventRecords.occurredAt, cursor.primary), gt(applicationEventRecords.id, cursor.id)),
        )
        if (keyset) filters.push(keyset)
      }

      const rows = (await database
        .select({
          id: applicationEventRecords.id,
          workspaceId: applicationEventRecords.workspaceId,
          applicationId: applicationEventRecords.applicationId,
          type: applicationEventRecords.type,
          occurredAt: applicationEventRecords.occurredAt,
          actorId: applicationEventRecords.actorId,
          actorType: applicationEventRecords.actorType,
          actorDisplayName: applicationEventRecords.actorDisplayName,
          summary: applicationEventRecords.summary,
        })
        .from(applicationEventRecords)
        .where(and(...filters))
        .orderBy(asc(applicationEventRecords.occurredAt), asc(applicationEventRecords.id))
        .limit(limit + 1)) as ApplicationEventRow[]

      const hasMore = rows.length > limit
      const pageRows = hasMore ? rows.slice(0, limit) : rows
      return toEventsListResult(pageRows.map(toEventRecord), limit, hasMore)
    },
  }
}
