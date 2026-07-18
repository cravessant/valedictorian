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
import type { PgliteDatabase } from '../../db/pglite'
import {
  DEFAULT_APPLICATION_LIST_OFFSET,
  isApplicationListSort,
  isApplicationStatus,
  stringifyJobTerms,
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
export function createPgliteApplicationRepository(
  database: PgliteDatabase,
): ApplicationRepository {
  return {
    async createApplication(input) {
      const now = new Date().toISOString()
      const normalizedInput = normalizeCreateApplicationInput(input)
      const applicationId = randomUUID()

      return database.transaction(async (transaction) => {
        const tx = transaction
        const company = await findOrCreateCompany(tx, normalizedInput.companyName, now)
        const source = await findOrCreateSource(tx, normalizedInput.sourceName, now)

        if (normalizedInput.primaryLink?.kind === 'official' || normalizedInput.sourceLink?.kind === 'official') {
          const officialUrl =
            normalizedInput.primaryLink?.kind === 'official'
              ? normalizedInput.primaryLink.url
              : normalizedInput.sourceLink?.url

          if (officialUrl && await hasActiveOfficialUrl(tx, officialUrl)) {
            throw new Error('Duplicate application official URL')
          }
        }

        if (await hasActiveApplicationFingerprint(tx, company.id, source.id, normalizedInput.roleTitle)) {
          throw new Error('Duplicate application fingerprint')
        }

        await tx
          .insert(applications)
          .values({
            id: applicationId,
            companyId: company.id,
            sourceId: source.id,
            roleTitle: normalizedInput.roleTitle,
            roleKind: normalizedInput.roleKind,
            term: normalizedInput.term ?? null,
            timingMode: normalizedInput.timingMode ?? 'unknown',
            termsJson: stringifyJobTerms(normalizedInput.terms ?? []),
            startDate: normalizedInput.startDate ?? null,
            endDate: normalizedInput.endDate ?? null,
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

        if (normalizedInput.primaryLink) {
          await insertApplicationLink(tx, {
            applicationId,
            discoveredAt: now,
            isPrimary: true,
            link: normalizedInput.primaryLink,
            now,
          })
        }

        if (normalizedInput.sourceLink) {
          await insertApplicationLink(tx, {
            applicationId,
            discoveredAt: now,
            isPrimary: !normalizedInput.primaryLink,
            link: normalizedInput.sourceLink,
            now,
          })
        }

        await insertApplicationEvent(tx, {
          applicationId,
          message: 'Application created.',
          payload: normalizedInput,
          type: 'application_created',
          now,
        })

        if (normalizedInput.initialNote) {
          await insertApplicationEvent(tx, {
            applicationId,
            message: normalizedInput.initialNote,
            payload: {},
            type: 'note',
            now,
          })
        }

        const created = await selectApplicationById(tx, applicationId)

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

      return database.transaction(async (transaction) => {
        const tx = transaction

        const [changed] = await tx
          .update(applications)
          .set({
            ...patch,
            updatedAt: now,
          })
          .where(and(eq(applications.id, normalizedInput.applicationId), isNull(applications.deletedAt)))
          .returning({ id: applications.id })

        if (!changed) {
          throw new Error(`Application not found: ${normalizedInput.applicationId}`)
        }

        await insertApplicationEvent(tx, {
          applicationId: normalizedInput.applicationId,
          message: 'Application metadata updated.',
          payload: normalizedInput,
          type: 'application_updated',
          now,
        })

        const updated = await selectApplicationById(tx, normalizedInput.applicationId)

        if (!updated) {
          throw new Error(`Application not found: ${normalizedInput.applicationId}`)
        }

        return updated
      })
    },
    async appendApplicationNote(input) {
      const now = new Date().toISOString()
      const message = requiredText(input.message, 'note message')

      return database.transaction(async (transaction) => {
        const tx = transaction

        const [changed] = await tx
          .update(applications)
          .set({
            notes: message,
            updatedAt: now,
          })
          .where(eq(applications.id, input.applicationId))
          .returning({ id: applications.id })

        if (!changed) {
          throw new Error(`Application not found: ${input.applicationId}`)
        }

        await insertApplicationEvent(tx, {
          applicationId: input.applicationId,
          message,
          payload: {},
          type: 'note',
          now,
        })

        const updated = await selectApplicationById(tx, input.applicationId)

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

      return database.transaction(async (transaction) => {
        const tx = transaction
        const [existing] = await tx
          .select({ id: applications.id })
          .from(applications)
          .where(and(eq(applications.id, input.applicationId), isNull(applications.deletedAt)))
          .limit(1)

        if (!existing) {
          throw new Error(`Application not found: ${input.applicationId}`)
        }

        await tx
          .update(applications)
          .set({
            deletedAt: now,
            updatedAt: now,
          })
          .where(eq(applications.id, input.applicationId))

        await insertApplicationEvent(tx, {
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

      return database.transaction(async (transaction) => {
        const tx = transaction
        const [application] = await tx
          .select({ id: applications.id })
          .from(applications)
          .where(and(eq(applications.id, input.applicationId), isNull(applications.deletedAt)))
          .limit(1)

        if (!application) {
          throw new Error(`Application not found: ${input.applicationId}`)
        }

        const [existing] = await tx
          .select()
          .from(applicationWorkflowStates)
          .where(eq(applicationWorkflowStates.applicationId, input.applicationId))
          .limit(1)

        if (existing) {
          await tx
            .update(applicationWorkflowStates)
            .set({
              ...patch,
              updatedAt: now,
            })
            .where(eq(applicationWorkflowStates.applicationId, input.applicationId))
        } else {
          await tx
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
        }

        await tx
          .update(applications)
          .set({ updatedAt: now })
          .where(eq(applications.id, input.applicationId))

        await insertApplicationEvent(tx, {
          applicationId: input.applicationId,
          message: 'Workflow state updated.',
          payload: input,
          type: 'workflow_updated',
          now,
        })

        const updated = await selectApplicationById(tx, input.applicationId)

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

      return database.transaction(async (transaction) => {
        const tx = transaction
        const [existingApplication] = await tx
          .select({ id: applications.id })
          .from(applications)
          .where(and(eq(applications.id, normalizedInput.applicationId), isNull(applications.deletedAt)))
          .limit(1)

        if (!existingApplication) {
          throw new Error(`Application not found: ${normalizedInput.applicationId}`)
        }

        if (await hasActiveApplicationAttempt(tx, normalizedInput.applicationId)) {
          throw new Error(`Application attempt already in progress: ${normalizedInput.applicationId}`)
        }

        await tx
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

        await insertWorkflowRunStep(tx, {
          workflowRunId: attemptId,
          actor: attemptActor(normalizedInput.actorType, normalizedInput.actorName),
          message,
          now,
          payload: normalizedInput,
          sequence: FIRST_ATTEMPT_STEP_SEQUENCE,
          type: 'attempt_started',
        })

        await upsertApplicationWorkflowState(tx, {
          applicationId: normalizedInput.applicationId,
          now,
          patch: {
            lockStartedAt: now,
          },
        })

        await tx
          .update(applications)
          .set({
            status: 'in_progress',
            updatedAt: now,
          })
          .where(eq(applications.id, normalizedInput.applicationId))

        await insertApplicationEvent(tx, {
          applicationId: normalizedInput.applicationId,
          message,
          payload: {
            attemptId,
          },
          type: 'attempt_started',
          now,
        })

        const attempt = await selectApplicationAttemptById(tx, attemptId)

        if (!attempt) {
          throw new Error(`Application attempt not found: ${attemptId}`)
        }

        return attempt
      })
    },
    async createApplicationAttemptStep(input) {
      const now = new Date().toISOString()
      const normalizedInput = normalizeCreateApplicationAttemptStepInput(input)

      return database.transaction(async (transaction) => {
        const tx = transaction
        const [attempt] = await tx
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
          .limit(1)

        if (!attempt) {
          throw new Error(`Active application attempt not found: ${normalizedInput.attemptId}`)
        }

        const [previousStep] = await tx
          .select({ sequence: workflowRunSteps.sequence })
          .from(workflowRunSteps)
          .where(eq(workflowRunSteps.workflowRunId, normalizedInput.attemptId))
          .orderBy(desc(workflowRunSteps.sequence))
          .limit(1)
        const sequence = (previousStep?.sequence ?? 0) + 1

        await insertWorkflowRunStep(tx, {
          workflowRunId: normalizedInput.attemptId,
          actor: normalizedInput.actor ?? 'agent',
          message: normalizedInput.message,
          now,
          payload: normalizedInput.payload ?? {},
          sequence,
          type: normalizedInput.type,
        })

        const [step] = await tx
          .select()
          .from(workflowRunSteps)
          .where(
            and(
              eq(workflowRunSteps.workflowRunId, normalizedInput.attemptId),
              eq(workflowRunSteps.sequence, sequence),
            ),
          )
          .limit(1)

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

      return database.transaction(async (transaction) => {
        const tx = transaction
        const [existingAttempt] = await tx
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
          .limit(1)

        if (!existingAttempt) {
          throw new Error(`Active application attempt not found: ${normalizedInput.attemptId}`)
        }

        await validateVerificationReceiptForOutcome(
          tx,
          normalizedInput.attemptId,
          normalizedInput.outcome,
        )

        const policyDecision = await evaluateApplicationPolicy(tx, await readPolicyConfig(tx), {
          applicationId: normalizedInput.applicationId,
          attemptId: normalizedInput.attemptId,
          outcome: normalizedInput.outcome,
        })

        if (policyDecision.status !== 'allow') {
          throw new Error(policyDecision.reasons[0]?.message ?? 'Policy blocked application outcome')
        }

        const [previousStep] = await tx
          .select({ sequence: workflowRunSteps.sequence })
          .from(workflowRunSteps)
          .where(eq(workflowRunSteps.workflowRunId, normalizedInput.attemptId))
          .orderBy(desc(workflowRunSteps.sequence))
          .limit(1)
        const existingMetadata = parseAttemptMetadata(existingAttempt.metadataJson)

        await tx
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

        await insertWorkflowRunStep(tx, {
          workflowRunId: normalizedInput.attemptId,
          actor: attemptActor(existingAttempt.actorType, existingAttempt.actorName),
          message,
          now,
          payload: normalizedInput,
          sequence: (previousStep?.sequence ?? 0) + 1,
          type: 'attempt_completed',
        })

        await upsertApplicationWorkflowState(tx, {
          applicationId: normalizedInput.applicationId,
          now,
          patch: workflowPatchForAttemptOutcome(normalizedInput, now),
        })

        await tx
          .update(applications)
          .set({
            status: normalizedInput.outcome,
            updatedAt: now,
            ...(normalizedInput.outcome === 'submitted' || normalizedInput.outcome === 'already_applied'
              ? { hasApplied: true }
              : {}),
          })
          .where(eq(applications.id, normalizedInput.applicationId))

        await insertApplicationEvent(tx, {
          applicationId: normalizedInput.applicationId,
          message,
          payload: {
            attemptId: normalizedInput.attemptId,
            outcome: normalizedInput.outcome,
          },
          type: 'attempt_completed',
          now,
        })

        const attempt = await selectApplicationAttemptById(tx, normalizedInput.attemptId)

        if (!attempt) {
          throw new Error(`Application attempt not found: ${normalizedInput.attemptId}`)
        }

        return attempt
      })
    },
    async createApplicationLink(input) {
      const now = new Date().toISOString()
      const normalizedInput = normalizeApplicationLinkInput(input)

      return database.transaction(async (transaction) => {
        const tx = transaction

        const [application] = await tx
          .select({ id: applications.id })
          .from(applications)
          .where(and(eq(applications.id, normalizedInput.applicationId), isNull(applications.deletedAt)))
          .limit(1)

        if (!application) {
          throw new Error(`Application not found: ${normalizedInput.applicationId}`)
        }

        if (normalizedInput.kind === 'official' && await hasActiveOfficialUrl(tx, normalizedInput.url)) {
          throw new Error('Duplicate application official URL')
        }

        if (normalizedInput.isPrimary) {
          await clearPrimaryApplicationLinks(tx, normalizedInput.applicationId, now)
        }

        const link = await insertApplicationLink(tx, {
          applicationId: normalizedInput.applicationId,
          discoveredAt: now,
          isPrimary: normalizedInput.isPrimary ?? false,
          link: normalizedInput,
          now,
        })

        await tx
          .update(applications)
          .set({ updatedAt: now })
          .where(eq(applications.id, normalizedInput.applicationId))

        await insertApplicationEvent(tx, {
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

      return database.transaction(async (transaction) => {
        const tx = transaction
        const [existing] = await tx
          .select()
          .from(applicationLinks)
          .where(
            and(
              eq(applicationLinks.id, normalizedInput.linkId),
              eq(applicationLinks.applicationId, normalizedInput.applicationId),
            ),
          )
          .limit(1)

        if (!existing) {
          throw new Error(`Application link not found: ${normalizedInput.linkId}`)
        }

        const nextKind = normalizedInput.kind ?? existing.kind
        const nextUrl = normalizedInput.url ?? existing.url

        if (
          !normalizedInput.archived &&
          nextKind === 'official' &&
          await hasActiveOfficialUrl(tx, nextUrl, existing.id)
        ) {
          throw new Error('Duplicate application official URL')
        }

        if (normalizedInput.isPrimary) {
          await clearPrimaryApplicationLinks(tx, normalizedInput.applicationId, now)
        }

        await tx
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

        await tx
          .update(applications)
          .set({ updatedAt: now })
          .where(eq(applications.id, normalizedInput.applicationId))

        await insertApplicationEvent(tx, {
          applicationId: normalizedInput.applicationId,
          message: 'Application link updated.',
          payload: normalizedInput,
          type: 'link_updated',
          now,
        })

        const [updated] = await tx
          .select()
          .from(applicationLinks)
          .where(eq(applicationLinks.id, normalizedInput.linkId))
          .limit(1)

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
      const [totalRow] = await database
        .select({ value: count() })
        .from(applicationLinks)
        .where(where)
      const items = (await database
        .select()
        .from(applicationLinks)
        .where(where)
        .orderBy(desc(applicationLinks.isPrimary), desc(applicationLinks.discoveredAt))
        .limit(limit)
        .offset(offset))
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
      const [totalRow] = await database
        .select({ value: count() })
        .from(applicationEvents)
        .where(where)
      const items = await database
        .select()
        .from(applicationEvents)
        .where(where)
        .orderBy(desc(applicationEvents.createdAt))
        .limit(limit)
        .offset(offset)

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
      const [totalRow] = await database
        .select({ value: count() })
        .from(workflowRuns)
        .where(where)
      const rows = await database
        .select()
        .from(workflowRuns)
        .where(where)
        .orderBy(desc(workflowRuns.startedAt))
        .limit(limit)
        .offset(offset)
      const items = []
      for (const row of rows) {
        const steps = await selectApplicationAttemptSteps(database, row.id)
        items.push(mapApplicationAttempt(row, steps))
      }
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
      const [totalRow] = await database
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
      const rows = await database
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

      return database.transaction(async (transaction) => {
        const tx = transaction

        const [changed] = await tx
          .update(applications)
          .set({
            status: input.status,
            updatedAt: now,
            ...(noteMessage !== undefined ? { notes: noteMessage } : {}),
          })
          .where(eq(applications.id, input.applicationId))
          .returning({ id: applications.id })

        if (!changed) {
          throw new Error(`Application not found: ${input.applicationId}`)
        }

        await insertApplicationEvent(tx, {
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
          await insertApplicationEvent(tx, {
            applicationId: input.applicationId,
            message: noteMessage,
            payload: {},
            type: 'note',
            now,
          })
        }

        const updated = await selectApplicationById(tx, input.applicationId)

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
