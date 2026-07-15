import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { ProcessSourcingCandidateInput, SourcingFinding } from 'sparxie'
import { applicationEvents, applications, opportunities } from '../../db/schema'
import type { DrizzleDatabase } from '../../db/sqlite'
import { createSqliteApplicationRepository } from '../applications/application.repository'
import { createSqliteScoringRepository } from '../scoring/scoring.repository'
import { createSqliteWorkflowRunRepository } from '../workflow-runs/workflow-run.repository'
import {
  createSqliteSourcingRepository,
  findDuplicateApplication,
} from './sourcing.repository'

export function createSqliteSourcingProcessor(database: DrizzleDatabase) {
  const applicationRepository = createSqliteApplicationRepository(database)
  const scoringRepository = createSqliteScoringRepository(database)
  const sourcingRepository = createSqliteSourcingRepository(database)
  const workflowRunRepository = createSqliteWorkflowRunRepository(database)

  return {
    async processCandidate(input: ProcessSourcingCandidateInput): Promise<SourcingFinding> {
      const finding = await sourcingRepository.createFinding({
        workflowRunId: input.workflowRunId,
        sourceId: input.sourceId,
        sourceName: input.sourceName,
        companyName: input.companyName,
        roleTitle: input.roleTitle,
        roleKind: input.roleKind,
        term: input.term,
        terms: input.terms,
        timingMode: input.timingMode,
        startDate: input.startDate,
        endDate: input.endDate,
        city: input.city,
        region: input.region,
        country: input.country,
        workMode: input.workMode,
        locationRaw: input.locationRaw,
        officialUrl: input.officialUrl,
        sourceUrl: input.sourceUrl,
        postedAge: input.postedAge,
        fitNotes: input.score?.rationale ?? null,
      })
      const blockedReason = promotionBlocker(finding)

      if (blockedReason) {
        const blocked = await updateFindingDecision(database, finding.id, {
          blocker: blockedReason,
          mergeNotes: blockedReason,
          mergeStatus: 'blocked',
        })

        await recordProcessingStep(workflowRunRepository, blocked, 'blocked', blockedReason)
        return blocked
      }

      const duplicate = findDuplicateApplication(database, finding)

      if (duplicate) {
        const duplicated = await updateFindingDecision(database, finding.id, {
          duplicateNotes: duplicate.note,
          mergeNotes: duplicate.note,
          mergeStatus: 'duplicate',
          mergedApplicationId: duplicate.applicationId,
        })

        await recordProcessingStep(
          workflowRunRepository,
          duplicated,
          'duplicate',
          duplicate.reason,
        )
        return duplicated
      }

      const promoted = await sourcingRepository.promoteFinding({ findingId: finding.id })

      if (promoted.mergedApplicationId && input.score) {
        await scoringRepository.recordScore({
          applicationId: promoted.mergedApplicationId,
          ...input.score,
        })
        insertScoreEvent(database, promoted.mergedApplicationId, input.score)

        if (
          input.cutoffScore !== undefined &&
          input.cutoffScore !== null &&
          input.score.score < input.cutoffScore
        ) {
          await applicationRepository.updateApplicationStatus({
            applicationId: promoted.mergedApplicationId,
            status: 'not_fit',
            notes: `Post-promotion score ${input.score.score} is below sourcing cutoff ${input.cutoffScore}.`,
          })
        }
      }

      const processed = await selectProcessedFinding(database, promoted.id)
      await recordProcessingStep(workflowRunRepository, processed, 'merged', 'promoted')

      return processed
    },
  }
}

function promotionBlocker(finding: SourcingFinding) {
  return finding.officialUrl || finding.sourceUrl
    ? null
    : 'Candidate requires an officialUrl or sourceUrl before promotion.'
}

async function updateFindingDecision(
  database: DrizzleDatabase,
  findingId: string,
  patch: {
    blocker?: string
    duplicateNotes?: string
    mergeNotes: string
    mergeStatus: 'blocked' | 'duplicate'
    mergedApplicationId?: string
  },
) {
  const now = new Date().toISOString()

  database
    .update(opportunities)
    .set({
      blocker: patch.blocker ?? null,
      duplicateNotes: patch.duplicateNotes ?? null,
      mergeStatus: patch.mergeStatus,
      applicationId: patch.mergedApplicationId ?? null,
      mergeNotes: patch.mergeNotes,
      updatedAt: now,
    })
    .where(eq(opportunities.id, findingId))
    .run()

  return selectProcessedFinding(database, findingId)
}

async function selectProcessedFinding(database: DrizzleDatabase, findingId: string) {
  const result = await createSqliteSourcingRepository(database).listFindings()
  const finding = result.items.find((item) => item.id === findingId)

  if (!finding) {
    throw new Error(`Sourcing finding not found: ${findingId}`)
  }

  return finding
}

async function recordProcessingStep(
  workflowRunRepository: ReturnType<typeof createSqliteWorkflowRunRepository>,
  finding: SourcingFinding,
  decision: string,
  reason: string,
) {
  await workflowRunRepository.createRunStep({
    workflowRunId: finding.workflowRunId,
    type: 'sourcing_candidate_processed',
    message: `Processed sourcing candidate: ${decision}.`,
    payload: {
      decision,
      findingId: finding.id,
      mergedApplicationId: finding.mergedApplicationId,
      reason,
    },
    actor: 'agent:sourcing',
  })
}

function insertScoreEvent(
  database: DrizzleDatabase,
  applicationId: string,
  score: NonNullable<ProcessSourcingCandidateInput['score']>,
) {
  const now = new Date().toISOString()
  const existing = database
    .select({ id: applications.id })
    .from(applications)
    .where(eq(applications.id, applicationId))
    .get()

  if (!existing) {
    throw new Error(`Application not found: ${applicationId}`)
  }

  database
    .insert(applicationEvents)
    .values({
      id: randomUUID(),
      applicationId,
      type: 'score_recorded',
      message: `Application scored ${score.score}/${10}.`,
      payloadJson: JSON.stringify(score),
      actor: 'agent:sourcing',
      createdAt: now,
    })
    .run()
}
