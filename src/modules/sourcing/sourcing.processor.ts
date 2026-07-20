import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { ProcessSourcingCandidateInput, SourcingFinding } from 'sparxie'
import { applications, opportunities } from '../../db/schema'
import { updateOpportunities } from '../opportunity/opportunity.repository'
import { insertApplicationEvents } from '../applications/application.cross-writes'
import type { PgliteDatabase, PgliteRepositoryDatabase } from '../../db/pglite'
import { createPgliteApplicationRepository } from '../applications/application.repository'
import { createPgliteScoringRepository } from '../scoring/scoring.repository'
import { createPgliteWorkflowRunRepository } from '../workflow-runs/workflow-run.repository'
import {
  createPgliteSourcingRepository,
  findDuplicateApplication,
} from './sourcing.repository'

/**
 * The transaction-owning lifecycle orchestration conversation (issue #298, AC8).
 *
 * Cross-phase flows (Capture -> ... -> Opportunity -> Application) are composed
 * here from the owning modules' public repositories. This conversation opens the
 * transaction boundary for the cross-aggregate work and delegates every write to
 * a module repository; it issues no direct lifecycle-table writes of its own, so
 * the state-ownership scanner needs no orchestrator exemption.
 */
export function createPgliteSourcingProcessor(database: PgliteDatabase) {
  const sourcingRepository = createPgliteSourcingRepository(database)
  const workflowRunRepository = createPgliteWorkflowRunRepository(database)

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

      const duplicate = await findDuplicateApplication(database, finding)

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

      return database.transaction(async (transaction) => {
        const transactionalApplicationRepository = createPgliteApplicationRepository(transaction)
        const transactionalScoringRepository = createPgliteScoringRepository(transaction)
        const transactionalWorkflowRunRepository = createPgliteWorkflowRunRepository(transaction)

        if (promoted.mergedApplicationId && input.score) {
          await transactionalScoringRepository.recordScore({
            applicationId: promoted.mergedApplicationId,
            ...input.score,
          })
          await insertScoreEvent(transaction, promoted.mergedApplicationId, input.score)

          if (
            input.cutoffScore !== undefined &&
            input.cutoffScore !== null &&
            input.score.score < input.cutoffScore
          ) {
            await transactionalApplicationRepository.updateApplicationStatus({
              applicationId: promoted.mergedApplicationId,
              status: 'not_fit',
              notes: `Post-promotion score ${input.score.score} is below sourcing cutoff ${input.cutoffScore}.`,
            })
          }
        }

        const processed = await selectProcessedFinding(transaction, promoted.id)
        await recordProcessingStep(
          transactionalWorkflowRunRepository,
          processed,
          'merged',
          'promoted',
        )

        return processed
      })
    },
  }
}

function promotionBlocker(finding: SourcingFinding) {
  return finding.officialUrl || finding.sourceUrl
    ? null
    : 'Candidate requires an officialUrl or sourceUrl before promotion.'
}

async function updateFindingDecision(
  database: PgliteDatabase,
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

  const [changed] = await updateOpportunities(database)
    .set({
      blocker: patch.blocker ?? null,
      duplicateNotes: patch.duplicateNotes ?? null,
      mergeStatus: patch.mergeStatus,
      applicationId: patch.mergedApplicationId ?? null,
      mergeNotes: patch.mergeNotes,
      updatedAt: now,
    })
    .where(eq(opportunities.id, findingId))
    .returning({ id: opportunities.id })

  if (!changed) {
    throw new Error(`Sourcing finding not found: ${findingId}`)
  }

  return selectProcessedFinding(database, findingId)
}

async function selectProcessedFinding(database: PgliteRepositoryDatabase, findingId: string) {
  const result = await createPgliteSourcingRepository(database).listFindings()
  const finding = result.items.find((item) => item.id === findingId)

  if (!finding) {
    throw new Error(`Sourcing finding not found: ${findingId}`)
  }

  return finding
}

async function recordProcessingStep(
  workflowRunRepository: ReturnType<typeof createPgliteWorkflowRunRepository>,
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

async function insertScoreEvent(
  database: Pick<PgliteRepositoryDatabase, 'insert' | 'select'>,
  applicationId: string,
  score: NonNullable<ProcessSourcingCandidateInput['score']>,
) {
  const now = new Date().toISOString()
  const [existing] = await database
    .select({ id: applications.id })
    .from(applications)
    .where(eq(applications.id, applicationId))
    .limit(1)

  if (!existing) {
    throw new Error(`Application not found: ${applicationId}`)
  }

  await insertApplicationEvents(database)
    .values({
      id: randomUUID(),
      applicationId,
      type: 'score_recorded',
      message: `Application scored ${score.score}/${10}.`,
      payloadJson: JSON.stringify(score),
      actor: 'agent:sourcing',
      createdAt: now,
    })
}
