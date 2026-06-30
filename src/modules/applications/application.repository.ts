import { randomUUID } from 'node:crypto'
import { and, count, desc, eq, isNull, or, sql } from 'drizzle-orm'
import {
  applicationEvents,
  applicationLinks,
  applications,
  applicationWorkflowStates,
  companies,
  sources,
  workflowRunSteps,
  workflowRuns,
} from '../../db/schema'
import type { DrizzleDatabase } from '../../db/sqlite'
import {
  DEFAULT_APPLICATION_LIST_OFFSET,
  isApplicationListSort,
  isApplicationStatus,
  type ApplicationListQuery,
  type ApplicationLinksListInput,
  type ApplicationRepository,
} from './application.types'
import {
  applicationLinkPatch,
  attemptActor,
  applicationPatch,
  applicationSelection,
  assertNonEmptyPatch,
  buildApplicationListOrder,
  buildApplicationListWhere,
  clearPrimaryApplicationLinks,
  findOrCreateCompany,
  findOrCreateSource,
  hasActiveApplicationAttempt,
  hasActiveApplicationFingerprint,
  hasActiveOfficialUrl,
  insertApplicationEvent,
  insertApplicationLink,
  insertWorkflowRunStep,
  mapApplicationAttempt,
  mapApplicationAttemptStep,
  mapApplicationLinkRecord,
  mapApplicationRow,
  normalizeApplicationLinkInput,
  normalizeApplicationLinkUpdateInput,
  normalizeApplicationUpdateInput,
  normalizeCompleteApplicationAttemptInput,
  normalizeCreateApplicationAttemptStepInput,
  normalizeCreateApplicationInput,
  normalizeStartApplicationAttemptInput,
  parseAttemptMetadata,
  requiredText,
  selectApplicationAttemptById,
  selectApplicationAttemptSteps,
  selectApplicationById,
  upsertApplicationWorkflowState,
  validateListLimit,
  validateVerificationReceiptForOutcome,
  validateWorkflowInput,
  workflowPatch,
  workflowPatchForAttemptOutcome,
} from './application.repository.helpers'
import {
  evaluateApplicationPolicy,
  readPolicyConfig,
} from '../policy/policy.repository'


const DEFAULT_EVENT_LIST_LIMIT = 50
const DEFAULT_ATTEMPT_LIST_LIMIT = 50
const DEFAULT_LINK_LIST_LIMIT = 50
const FIRST_ATTEMPT_STEP_SEQUENCE = 1
const APPLICATION_ATTEMPT_METADATA_KIND = 'application_attempt'
export function createSqliteApplicationRepository(
  database: DrizzleDatabase,
): ApplicationRepository {
  return {
    async createApplication(input) {
      const now = new Date().toISOString()
      const normalizedInput = normalizeCreateApplicationInput(input)
      const applicationId = randomUUID()

      return database.transaction((transaction) => {
        const tx = transaction
        const company = findOrCreateCompany(tx, normalizedInput.companyName, now)
        const source = findOrCreateSource(tx, normalizedInput.sourceName, now)

        if (normalizedInput.primaryLink?.kind === 'official' || normalizedInput.sourceLink?.kind === 'official') {
          const officialUrl =
            normalizedInput.primaryLink?.kind === 'official'
              ? normalizedInput.primaryLink.url
              : normalizedInput.sourceLink?.url

          if (officialUrl && hasActiveOfficialUrl(tx, officialUrl)) {
            throw new Error('Duplicate application official URL')
          }
        }

        if (hasActiveApplicationFingerprint(tx, company.id, source.id, normalizedInput.roleTitle)) {
          throw new Error('Duplicate application fingerprint')
        }

        tx
          .insert(applications)
          .values({
            id: applicationId,
            companyId: company.id,
            sourceId: source.id,
            roleTitle: normalizedInput.roleTitle,
            roleKind: normalizedInput.roleKind,
            term: normalizedInput.term ?? null,
            city: normalizedInput.city ?? null,
            region: normalizedInput.region ?? null,
            country: normalizedInput.country,
            workMode: normalizedInput.workMode,
            locationRaw: normalizedInput.locationRaw ?? null,
            status: normalizedInput.status,
            hasApplied: normalizedInput.hasApplied ?? false,
            currentPriorityScore: null,
            currentPriorityBand: null,
            currentResumeVariant: normalizedInput.currentResumeVariant ?? null,
            notes: normalizedInput.initialNote ?? null,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          })
          .run()

        if (normalizedInput.primaryLink) {
          insertApplicationLink(tx, {
            applicationId,
            discoveredAt: now,
            isPrimary: true,
            link: normalizedInput.primaryLink,
            now,
          })
        }

        if (normalizedInput.sourceLink) {
          insertApplicationLink(tx, {
            applicationId,
            discoveredAt: now,
            isPrimary: !normalizedInput.primaryLink,
            link: normalizedInput.sourceLink,
            now,
          })
        }

        insertApplicationEvent(tx, {
          applicationId,
          message: 'Application created.',
          payload: normalizedInput,
          type: 'application_created',
          now,
        })

        if (normalizedInput.initialNote) {
          insertApplicationEvent(tx, {
            applicationId,
            message: normalizedInput.initialNote,
            payload: {},
            type: 'note',
            now,
          })
        }

        const created = selectApplicationById(tx, applicationId)

        if (!created) {
          throw new Error(`Application not found: ${applicationId}`)
        }

        return created
      })
    },
    async updateApplication(input) {
      const now = new Date().toISOString()
      const normalizedInput = normalizeApplicationUpdateInput(input)
      const patch = applicationPatch(normalizedInput)

      assertNonEmptyPatch(patch, 'Application metadata update requires at least one field')

      return database.transaction((transaction) => {
        const tx = transaction

        tx
          .update(applications)
          .set({
            ...patch,
            updatedAt: now,
          })
          .where(and(eq(applications.id, normalizedInput.applicationId), isNull(applications.deletedAt)))
          .run()

        insertApplicationEvent(tx, {
          applicationId: normalizedInput.applicationId,
          message: 'Application metadata updated.',
          payload: normalizedInput,
          type: 'application_updated',
          now,
        })

        const updated = selectApplicationById(tx, normalizedInput.applicationId)

        if (!updated) {
          throw new Error(`Application not found: ${normalizedInput.applicationId}`)
        }

        return updated
      })
    },
    async appendApplicationNote(input) {
      const now = new Date().toISOString()
      const message = requiredText(input.message, 'note message')

      return database.transaction((transaction) => {
        const tx = transaction

        tx
          .update(applications)
          .set({
            notes: message,
            updatedAt: now,
          })
          .where(eq(applications.id, input.applicationId))
          .run()

        insertApplicationEvent(tx, {
          applicationId: input.applicationId,
          message,
          payload: {},
          type: 'note',
          now,
        })

        const updated = selectApplicationById(tx, input.applicationId)

        if (!updated) {
          throw new Error(`Application not found: ${input.applicationId}`)
        }

        return updated
      })
    },
    async archiveApplication(input) {
      const now = new Date().toISOString()
      const message =
        input.note !== undefined ? requiredText(input.note, 'archive note') : 'Application archived.'

      return database.transaction((transaction) => {
        const tx = transaction
        const existing = tx
          .select({ id: applications.id })
          .from(applications)
          .where(and(eq(applications.id, input.applicationId), isNull(applications.deletedAt)))
          .get()

        if (!existing) {
          throw new Error(`Application not found: ${input.applicationId}`)
        }

        tx
          .update(applications)
          .set({
            deletedAt: now,
            updatedAt: now,
          })
          .where(eq(applications.id, input.applicationId))
          .run()

        insertApplicationEvent(tx, {
          applicationId: input.applicationId,
          message,
          payload: {
            ...input,
            ...(input.note !== undefined ? { note: message } : {}),
          },
          type: 'application_archived',
          now,
        })
      })
    },
    async updateApplicationWorkflow(input) {
      const now = new Date().toISOString()
      const patch = workflowPatch(input)

      assertNonEmptyPatch(patch, 'Workflow update requires at least one field')

      validateWorkflowInput(input)

      return database.transaction((transaction) => {
        const tx = transaction
        const existing = tx
          .select()
          .from(applicationWorkflowStates)
          .where(eq(applicationWorkflowStates.applicationId, input.applicationId))
          .get()

        if (existing) {
          tx
            .update(applicationWorkflowStates)
            .set({
              ...patch,
              updatedAt: now,
            })
            .where(eq(applicationWorkflowStates.applicationId, input.applicationId))
            .run()
        } else {
          tx
            .insert(applicationWorkflowStates)
            .values({
              applicationId: input.applicationId,
              lockStartedAt: patch.lockStartedAt ?? null,
              holdStartedAt: patch.holdStartedAt ?? null,
              manualReviewKind: patch.manualReviewKind ?? null,
              missingUserInfo: patch.missingUserInfo ?? null,
              blockerReason: patch.blockerReason ?? null,
              createdAt: now,
              updatedAt: now,
            })
            .run()
        }

        tx
          .update(applications)
          .set({ updatedAt: now })
          .where(eq(applications.id, input.applicationId))
          .run()

        insertApplicationEvent(tx, {
          applicationId: input.applicationId,
          message: 'Workflow state updated.',
          payload: input,
          type: 'workflow_updated',
          now,
        })

        const updated = selectApplicationById(tx, input.applicationId)

        if (!updated) {
          throw new Error(`Application not found: ${input.applicationId}`)
        }

        return updated
      })
    },
    async startApplicationAttempt(input) {
      const now = new Date().toISOString()
      const normalizedInput = normalizeStartApplicationAttemptInput(input)
      const attemptId = randomUUID()
      const message = normalizedInput.summary ?? 'Application attempt started.'

      return database.transaction((transaction) => {
        const tx = transaction
        const existingApplication = tx
          .select({ id: applications.id })
          .from(applications)
          .where(and(eq(applications.id, normalizedInput.applicationId), isNull(applications.deletedAt)))
          .get()

        if (!existingApplication) {
          throw new Error(`Application not found: ${normalizedInput.applicationId}`)
        }

        if (hasActiveApplicationAttempt(tx, normalizedInput.applicationId)) {
          throw new Error(`Application attempt already in progress: ${normalizedInput.applicationId}`)
        }

        tx
          .insert(workflowRuns)
          .values({
            id: attemptId,
            runType: 'application_attempt',
            status: 'in_progress',
            actorType: normalizedInput.actorType,
            actorName: normalizedInput.actorName ?? null,
            sourceId: null,
            subjectApplicationId: normalizedInput.applicationId,
            summary: normalizedInput.summary ?? null,
            outcome: null,
            blocker: null,
            coverageStartedAt: null,
            coverageEndedAt: null,
            timezone: null,
            inputJson: JSON.stringify(normalizedInput),
            metadataJson: JSON.stringify({
              kind: APPLICATION_ATTEMPT_METADATA_KIND,
              entryUrl: normalizedInput.entryUrl ?? null,
              resumeVariant: normalizedInput.resumeVariant ?? null,
              resumeArtifactPath: normalizedInput.resumeArtifactPath ?? null,
              stopReason: null,
              confirmationUrl: null,
              confirmationText: null,
            }),
            startedAt: now,
            completedAt: null,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          })
          .run()

        insertWorkflowRunStep(tx, {
          workflowRunId: attemptId,
          actor: attemptActor(normalizedInput.actorType, normalizedInput.actorName),
          message,
          now,
          payload: normalizedInput,
          sequence: FIRST_ATTEMPT_STEP_SEQUENCE,
          type: 'attempt_started',
        })

        upsertApplicationWorkflowState(tx, {
          applicationId: normalizedInput.applicationId,
          now,
          patch: {
            lockStartedAt: now,
          },
        })

        tx
          .update(applications)
          .set({
            status: 'in_progress',
            updatedAt: now,
          })
          .where(eq(applications.id, normalizedInput.applicationId))
          .run()

        insertApplicationEvent(tx, {
          applicationId: normalizedInput.applicationId,
          message,
          payload: {
            attemptId,
          },
          type: 'attempt_started',
          now,
        })

        const attempt = selectApplicationAttemptById(tx, attemptId)

        if (!attempt) {
          throw new Error(`Application attempt not found: ${attemptId}`)
        }

        return attempt
      })
    },
    async createApplicationAttemptStep(input) {
      const now = new Date().toISOString()
      const normalizedInput = normalizeCreateApplicationAttemptStepInput(input)

      return database.transaction((transaction) => {
        const tx = transaction
        const attempt = tx
          .select({ id: workflowRuns.id })
          .from(workflowRuns)
          .where(
            and(
              eq(workflowRuns.id, normalizedInput.attemptId),
              eq(workflowRuns.subjectApplicationId, normalizedInput.applicationId),
              eq(workflowRuns.runType, 'application_attempt'),
              eq(workflowRuns.status, 'in_progress'),
            ),
          )
          .get()

        if (!attempt) {
          throw new Error(`Active application attempt not found: ${normalizedInput.attemptId}`)
        }

        const previousStep = tx
          .select({ sequence: workflowRunSteps.sequence })
          .from(workflowRunSteps)
          .where(eq(workflowRunSteps.workflowRunId, normalizedInput.attemptId))
          .orderBy(desc(workflowRunSteps.sequence))
          .get()
        const sequence = (previousStep?.sequence ?? 0) + 1

        insertWorkflowRunStep(tx, {
          workflowRunId: normalizedInput.attemptId,
          actor: normalizedInput.actor ?? 'agent',
          message: normalizedInput.message,
          now,
          payload: normalizedInput.payload ?? {},
          sequence,
          type: normalizedInput.type,
        })

        const step = tx
          .select()
          .from(workflowRunSteps)
          .where(
            and(
              eq(workflowRunSteps.workflowRunId, normalizedInput.attemptId),
              eq(workflowRunSteps.sequence, sequence),
            ),
          )
          .get()

        if (!step) {
          throw new Error(`Application attempt step not found: ${normalizedInput.attemptId}`)
        }

        return mapApplicationAttemptStep(step, normalizedInput.applicationId)
      })
    },
    async completeApplicationAttempt(input) {
      const now = new Date().toISOString()
      const normalizedInput = normalizeCompleteApplicationAttemptInput(input)
      const message =
        normalizedInput.summary ??
        `Application attempt completed with outcome ${normalizedInput.outcome}.`

      return database.transaction((transaction) => {
        const tx = transaction
        const existingAttempt = tx
          .select()
          .from(workflowRuns)
          .where(
            and(
              eq(workflowRuns.id, normalizedInput.attemptId),
              eq(workflowRuns.subjectApplicationId, normalizedInput.applicationId),
              eq(workflowRuns.runType, 'application_attempt'),
              eq(workflowRuns.status, 'in_progress'),
            ),
          )
          .get()

        if (!existingAttempt) {
          throw new Error(`Active application attempt not found: ${normalizedInput.attemptId}`)
        }

        validateVerificationReceiptForOutcome(
          tx,
          normalizedInput.attemptId,
          normalizedInput.outcome,
        )

        const policyDecision = evaluateApplicationPolicy(tx, readPolicyConfig(tx), {
          applicationId: normalizedInput.applicationId,
          attemptId: normalizedInput.attemptId,
          outcome: normalizedInput.outcome,
        })

        if (policyDecision.status !== 'allow') {
          throw new Error(policyDecision.reasons[0]?.message ?? 'Policy blocked application outcome')
        }

        const previousStep = tx
          .select({ sequence: workflowRunSteps.sequence })
          .from(workflowRunSteps)
          .where(eq(workflowRunSteps.workflowRunId, normalizedInput.attemptId))
          .orderBy(desc(workflowRunSteps.sequence))
          .get()
        const existingMetadata = parseAttemptMetadata(existingAttempt.metadataJson)

        tx
          .update(workflowRuns)
          .set({
            status: 'completed',
            outcome: normalizedInput.outcome,
            summary: normalizedInput.summary ?? existingAttempt.summary,
            blocker: normalizedInput.blockerReason ?? null,
            metadataJson: JSON.stringify({
              ...existingMetadata,
              stopReason: normalizedInput.stopReason ?? null,
              confirmationUrl: normalizedInput.confirmationUrl ?? null,
              confirmationText: normalizedInput.confirmationText ?? null,
            }),
            completedAt: now,
            updatedAt: now,
          })
          .where(eq(workflowRuns.id, normalizedInput.attemptId))
          .run()

        insertWorkflowRunStep(tx, {
          workflowRunId: normalizedInput.attemptId,
          actor: attemptActor(existingAttempt.actorType, existingAttempt.actorName),
          message,
          now,
          payload: normalizedInput,
          sequence: (previousStep?.sequence ?? 0) + 1,
          type: 'attempt_completed',
        })

        upsertApplicationWorkflowState(tx, {
          applicationId: normalizedInput.applicationId,
          now,
          patch: workflowPatchForAttemptOutcome(normalizedInput, now),
        })

        tx
          .update(applications)
          .set({
            status: normalizedInput.outcome,
            updatedAt: now,
            ...(normalizedInput.outcome === 'submitted' || normalizedInput.outcome === 'already_applied'
              ? { hasApplied: true }
              : {}),
          })
          .where(eq(applications.id, normalizedInput.applicationId))
          .run()

        insertApplicationEvent(tx, {
          applicationId: normalizedInput.applicationId,
          message,
          payload: {
            attemptId: normalizedInput.attemptId,
            outcome: normalizedInput.outcome,
          },
          type: 'attempt_completed',
          now,
        })

        const attempt = selectApplicationAttemptById(tx, normalizedInput.attemptId)

        if (!attempt) {
          throw new Error(`Application attempt not found: ${normalizedInput.attemptId}`)
        }

        return attempt
      })
    },
    async createApplicationLink(input) {
      const now = new Date().toISOString()
      const normalizedInput = normalizeApplicationLinkInput(input)

      return database.transaction((transaction) => {
        const tx = transaction

        if (normalizedInput.kind === 'official' && hasActiveOfficialUrl(tx, normalizedInput.url)) {
          throw new Error('Duplicate application official URL')
        }

        if (normalizedInput.isPrimary) {
          clearPrimaryApplicationLinks(tx, normalizedInput.applicationId, now)
        }

        const link = insertApplicationLink(tx, {
          applicationId: normalizedInput.applicationId,
          discoveredAt: now,
          isPrimary: normalizedInput.isPrimary ?? false,
          link: normalizedInput,
          now,
        })

        tx
          .update(applications)
          .set({ updatedAt: now })
          .where(eq(applications.id, normalizedInput.applicationId))
          .run()

        insertApplicationEvent(tx, {
          applicationId: normalizedInput.applicationId,
          message: 'Application link created.',
          payload: normalizedInput,
          type: 'link_created',
          now,
        })

        return link
      })
    },
    async updateApplicationLink(input) {
      const now = new Date().toISOString()
      const normalizedInput = normalizeApplicationLinkUpdateInput(input)
      const patch = applicationLinkPatch(normalizedInput)

      assertNonEmptyPatch(
        {
          ...patch,
          ...(normalizedInput.archived !== undefined ? { archived: normalizedInput.archived } : {}),
        },
        'Application link update requires at least one field',
      )

      return database.transaction((transaction) => {
        const tx = transaction
        const existing = tx
          .select()
          .from(applicationLinks)
          .where(
            and(
              eq(applicationLinks.id, normalizedInput.linkId),
              eq(applicationLinks.applicationId, normalizedInput.applicationId),
            ),
          )
          .get()

        if (!existing) {
          throw new Error(`Application link not found: ${normalizedInput.linkId}`)
        }

        const nextKind = normalizedInput.kind ?? existing.kind
        const nextUrl = normalizedInput.url ?? existing.url

        if (
          !normalizedInput.archived &&
          nextKind === 'official' &&
          hasActiveOfficialUrl(tx, nextUrl, existing.id)
        ) {
          throw new Error('Duplicate application official URL')
        }

        if (normalizedInput.isPrimary) {
          clearPrimaryApplicationLinks(tx, normalizedInput.applicationId, now)
        }

        tx
          .update(applicationLinks)
          .set({
            ...patch,
            ...(normalizedInput.archived ? { deletedAt: now, isPrimary: false } : {}),
            updatedAt: now,
          })
          .where(
            and(
              eq(applicationLinks.id, normalizedInput.linkId),
              eq(applicationLinks.applicationId, normalizedInput.applicationId),
            ),
          )
          .run()

        tx
          .update(applications)
          .set({ updatedAt: now })
          .where(eq(applications.id, normalizedInput.applicationId))
          .run()

        insertApplicationEvent(tx, {
          applicationId: normalizedInput.applicationId,
          message: 'Application link updated.',
          payload: normalizedInput,
          type: 'link_updated',
          now,
        })

        const updated = tx
          .select()
          .from(applicationLinks)
          .where(eq(applicationLinks.id, normalizedInput.linkId))
          .get()

        if (!updated) {
          throw new Error(`Application link not found: ${normalizedInput.linkId}`)
        }

        return mapApplicationLinkRecord(updated)
      })
    },
    async listApplicationLinks(input: ApplicationLinksListInput) {
      const applicationId = requiredText(input.applicationId, 'applicationId')
      const limit = input.limit ?? DEFAULT_LINK_LIST_LIMIT
      const offset = input.offset ?? 0
      const where = and(
        eq(applicationLinks.applicationId, applicationId),
        isNull(applicationLinks.deletedAt),
      )
      const totalRow = database
        .select({ value: count() })
        .from(applicationLinks)
        .where(where)
        .get()
      const items = database
        .select()
        .from(applicationLinks)
        .where(where)
        .orderBy(desc(applicationLinks.isPrimary), desc(applicationLinks.discoveredAt))
        .limit(limit)
        .offset(offset)
        .all()
        .map(mapApplicationLinkRecord)
      const total = totalRow?.value ?? 0

      return {
        items,
        total,
        limit,
        offset,
        hasMore: offset + items.length < total,
      }
    },
    async listApplicationEvents(input) {
      const limit = input.limit ?? DEFAULT_EVENT_LIST_LIMIT
      const offset = input.offset ?? 0
      const where = eq(applicationEvents.applicationId, input.applicationId)
      const totalRow = database
        .select({ value: count() })
        .from(applicationEvents)
        .where(where)
        .get()
      const items = database
        .select()
        .from(applicationEvents)
        .where(where)
        .orderBy(desc(applicationEvents.createdAt))
        .limit(limit)
        .offset(offset)
        .all()

      const total = totalRow?.value ?? 0

      return {
        items,
        total,
        limit,
        offset,
        hasMore: offset + items.length < total,
      }
    },
    async listApplicationAttempts(input) {
      const applicationId = requiredText(input.applicationId, 'applicationId')
      const limit = input.limit ?? DEFAULT_ATTEMPT_LIST_LIMIT
      const offset = input.offset ?? 0
      const where = and(
        eq(workflowRuns.subjectApplicationId, applicationId),
        eq(workflowRuns.runType, 'application_attempt'),
        isNull(workflowRuns.deletedAt),
        isApplicationAttemptLifecycleRun(),
      )
      const totalRow = database
        .select({ value: count() })
        .from(workflowRuns)
        .where(where)
        .get()
      const rows = database
        .select()
        .from(workflowRuns)
        .where(where)
        .orderBy(desc(workflowRuns.startedAt))
        .limit(limit)
        .offset(offset)
        .all()
      const items = rows.map((row) =>
        mapApplicationAttempt(row, selectApplicationAttemptSteps(database, row.id)),
      )
      const total = totalRow?.value ?? 0

      return {
        items,
        total,
        limit,
        offset,
        hasMore: offset + items.length < total,
      }
    },
    async listApplications(query: ApplicationListQuery = {}) {
      if (query.sort && !isApplicationListSort(query.sort)) {
        throw new Error(`Invalid application list sort: ${String(query.sort)}`)
      }

      const limit = validateListLimit(query.limit)
      const offset = query.offset ?? DEFAULT_APPLICATION_LIST_OFFSET
      const where = buildApplicationListWhere(query)
      const totalRow = database
        .select({
          value: count(),
        })
        .from(applications)
        .innerJoin(companies, eq(applications.companyId, companies.id))
        .innerJoin(sources, eq(applications.sourceId, sources.id))
        .leftJoin(
          applicationLinks,
          and(
            eq(applicationLinks.applicationId, applications.id),
            eq(applicationLinks.isPrimary, true),
            isNull(applicationLinks.deletedAt),
          ),
        )
        .where(where)
        .get()
      const rows = database
        .select(applicationSelection)
        .from(applications)
        .innerJoin(companies, eq(applications.companyId, companies.id))
        .innerJoin(sources, eq(applications.sourceId, sources.id))
        .leftJoin(
          applicationLinks,
          and(
            eq(applicationLinks.applicationId, applications.id),
            eq(applicationLinks.isPrimary, true),
            isNull(applicationLinks.deletedAt),
          ),
        )
        .where(where)
        .orderBy(...buildApplicationListOrder(query))
        .limit(limit)
        .offset(offset)
        .all()

      const items = rows.map(mapApplicationRow)

      const total = totalRow?.value ?? 0

      return {
        items,
        total,
        limit,
        offset,
        hasMore: offset + items.length < total,
      }
    },
    async getApplication(id) {
      return selectApplicationById(database, id)
    },
    async updateApplicationStatus(input) {
      if (!isApplicationStatus(input.status)) {
        throw new Error(`Invalid application status: ${String(input.status)}`)
      }

      const now = new Date().toISOString()
      const noteMessage =
        input.notes !== undefined ? requiredText(input.notes, 'note message') : undefined

      return database.transaction((transaction) => {
        const tx = transaction

        tx
          .update(applications)
          .set({
            status: input.status,
            updatedAt: now,
            ...(noteMessage !== undefined ? { notes: noteMessage } : {}),
          })
          .where(eq(applications.id, input.applicationId))
          .run()

        insertApplicationEvent(tx, {
          applicationId: input.applicationId,
          message: `Application status updated to ${input.status}.`,
          payload: {
            ...input,
            ...(noteMessage !== undefined ? { notes: noteMessage } : {}),
          },
          type: 'status_updated',
          now,
        })

        if (noteMessage !== undefined) {
          insertApplicationEvent(tx, {
            applicationId: input.applicationId,
            message: noteMessage,
            payload: {},
            type: 'note',
            now,
          })
        }

        const updated = selectApplicationById(tx, input.applicationId)

        if (!updated) {
          throw new Error(`Application not found: ${input.applicationId}`)
        }

        return updated
      })
    },
  }
}

function isApplicationAttemptLifecycleRun() {
  return or(
    sql`${workflowRuns.metadataJson} like ${'%"kind":"application_attempt"%'}`,
    sql`exists (
      select 1
      from ${workflowRunSteps}
      where ${workflowRunSteps.workflowRunId} = ${workflowRuns.id}
        and ${workflowRunSteps.sequence} = ${FIRST_ATTEMPT_STEP_SEQUENCE}
        and ${workflowRunSteps.type} = 'attempt_started'
    )`,
  )
}
