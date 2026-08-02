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
import { and, asc, eq, isNull, type SQL } from 'drizzle-orm'
import type {
  Application,
  ApplicationAttemptsListResult,
  ApplicationEventsListResult,
  LifecycleApplicationHistoryResult,
  LifecycleApplicationListInput,
  LifecycleApplicationListResult,
} from '@sparxie/sdk'
import type { PgliteDatabase } from '../../db/pglite.js'
import {
  applicationAttemptRecords,
  applicationEventRecords,
  applicationHistory,
  applications,
  pursuitLinks,
} from '../application/application.schema.js'
import {
  reconstructApplicationHistory,
  toApplicationResource,
  toAttemptRecord,
  toEventRecord,
  type ApplicationAttemptRow,
  type ApplicationEventRow,
  type ApplicationHeadRow,
  type ApplicationHistoryRow,
  type ApplicationLinkRow,
} from './application.dto.js'
import {
  emptyLifecyclePage,
  encodeKeysetCursor,
  readPageWindow,
  toLifecyclePage,
  type LifecyclePageRequest,
} from '../lifecycle/lifecycle-page.dto.js'
import {
  createLifecycleAdjacencyProbe,
  lifecycleKeysetOrder,
  lifecycleKeysetWindow,
} from '../lifecycle/lifecycle-keyset.js'

export interface ApplicationHistoryReadInput extends LifecyclePageRequest {
  readonly id: string
}

export interface ApplicationTechnicalReadInput extends LifecyclePageRequest {
  readonly applicationId: string
}

export interface ApplicationReadModel {
  getApplication(workspaceId: string, applicationId: string): Promise<Application | null>
  listApplications(workspaceId: string, input?: LifecycleApplicationListInput): Promise<LifecycleApplicationListResult>
  historyApplications(workspaceId: string, input: ApplicationHistoryReadInput): Promise<LifecycleApplicationHistoryResult>
  listAttempts(workspaceId: string, input: ApplicationTechnicalReadInput): Promise<ApplicationAttemptsListResult>
  listEvents(workspaceId: string, input: ApplicationTechnicalReadInput): Promise<ApplicationEventsListResult>
}

/** The stable (primary, id) ordering each Application-side page walks. */
const applicationKeyset = { primary: applications.createdAt, id: applications.id }
const attemptKeyset = { primary: applicationAttemptRecords.startedAt, id: applicationAttemptRecords.id }
const eventKeyset = { primary: applicationEventRecords.occurredAt, id: applicationEventRecords.id }

const keysetCursor = (primary: string, id: string) => encodeKeysetCursor({ primary, id })

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
      const window = readPageWindow(input)
      const filters: SQL[] = [eq(applications.workspaceId, workspaceId)]
      if (input.opportunityId !== undefined) filters.push(eq(applications.opportunityId, input.opportunityId))
      if (input.jobId !== undefined) filters.push(eq(applications.jobId, input.jobId))
      if (input.status !== undefined) filters.push(eq(applications.status, input.status))
      if (input.includeRemoved !== true) filters.push(isNull(applications.removedAt))
      const rows = (await database
        .select()
        .from(applications)
        .where(and(...filters, ...lifecycleKeysetWindow(applicationKeyset, window)))
        .orderBy(...lifecycleKeysetOrder(applicationKeyset, window))
        .limit(window.limit + 1)) as ApplicationHeadRow[]

      const page = await toLifecyclePage(rows, window, (row) => keysetCursor(row.createdAt, row.id),
        createLifecycleAdjacencyProbe(database, applications, filters, applicationKeyset))
      const items = await Promise.all(
        page.rows.map(async (head) => toApplicationResource(head, await selectLinks(head.id))),
      )
      return { items, pageInfo: page.pageInfo }
    },

    async historyApplications(workspaceId, input) {
      const window = readPageWindow(input)
      const head = await selectHead(workspaceId, input.id)
      if (!head) return emptyLifecyclePage()

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

      return reconstructApplicationHistory(head, historyRows, links, window)
    },

    async listAttempts(workspaceId, input) {
      const window = readPageWindow(input)
      if (!(await applicationExists(workspaceId, input.applicationId))) return emptyLifecyclePage()

      const filters: SQL[] = [
        eq(applicationAttemptRecords.workspaceId, workspaceId),
        eq(applicationAttemptRecords.applicationId, input.applicationId),
      ]

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
        .where(and(...filters, ...lifecycleKeysetWindow(attemptKeyset, window)))
        .orderBy(...lifecycleKeysetOrder(attemptKeyset, window))
        .limit(window.limit + 1)) as ApplicationAttemptRow[]

      const page = await toLifecyclePage(rows, window, (row) => keysetCursor(row.startedAt, row.id),
        createLifecycleAdjacencyProbe(database, applicationAttemptRecords, filters, attemptKeyset))
      return { items: page.rows.map(toAttemptRecord), pageInfo: page.pageInfo }
    },

    async listEvents(workspaceId, input) {
      const window = readPageWindow(input)
      if (!(await applicationExists(workspaceId, input.applicationId))) return emptyLifecyclePage()

      const filters: SQL[] = [
        eq(applicationEventRecords.workspaceId, workspaceId),
        eq(applicationEventRecords.applicationId, input.applicationId),
      ]

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
        .where(and(...filters, ...lifecycleKeysetWindow(eventKeyset, window)))
        .orderBy(...lifecycleKeysetOrder(eventKeyset, window))
        .limit(window.limit + 1)) as ApplicationEventRow[]

      const page = await toLifecyclePage(rows, window, (row) => keysetCursor(row.occurredAt, row.id),
        createLifecycleAdjacencyProbe(database, applicationEventRecords, filters, eventKeyset))
      return { items: page.rows.map(toEventRecord), pageInfo: page.pageInfo }
    },
  }
}
