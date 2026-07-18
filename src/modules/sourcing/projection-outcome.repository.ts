import crypto from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import type { RawSourceProjectionResult, SourcingProjectionFindingReference } from 'sparxie'
import {
  jobFactVersions,
  normalizationGates,
  normalizationRuns,
  captureEvidenceVersions,
  opportunities,
  sourcingProjectionOutcomes,
} from '../../db/schema'
import type { PgliteDatabase } from '../../db/pglite'

type Transaction = Parameters<Parameters<PgliteDatabase['transaction']>[0]>[0]

export function createPgliteProjectionOutcomeRepository(database: PgliteDatabase) {
  return {
    async stagePending(transaction: Transaction, input: {
      rawRecordId: string
      rawRevisionId: string
      canonicalCandidateId: string
      now: string
    }) {
      await transaction.insert(sourcingProjectionOutcomes).values({
        id: crypto.randomUUID(),
        captureLineageId: input.rawRecordId,
        captureEvidenceVersionId: input.rawRevisionId,
        jobFactVersionId: input.canonicalCandidateId,
        status: 'pending',
        opportunityId: null,
        failureCode: null,
        failureRetryable: null,
        projectedAt: null,
        failedAt: null,
        createdAt: input.now,
        updatedAt: input.now,
      }).onConflictDoNothing({ target: sourcingProjectionOutcomes.jobFactVersionId })
        .returning({ id: sourcingProjectionOutcomes.id })
    },
    async markProjected(
      transaction: Transaction,
      canonicalCandidateId: string,
      findingId: string,
      projectedAt: string,
    ) {
      const [updated] = await transaction.update(sourcingProjectionOutcomes).set({
        status: 'projected', opportunityId: findingId, projectedAt, updatedAt: projectedAt,
      }).where(and(
        eq(sourcingProjectionOutcomes.jobFactVersionId, canonicalCandidateId),
        eq(sourcingProjectionOutcomes.status, 'pending'),
      )).returning({ id: sourcingProjectionOutcomes.id })
      if (!updated) throw new Error('Pending projection outcome was not found')
    },
    async markFailed(canonicalCandidateId: string, failedAt: string) {
      const [updated] = await database.update(sourcingProjectionOutcomes).set({
        status: 'failed', failureCode: 'projection_failed', failureRetryable: false,
        failedAt, updatedAt: failedAt,
      }).where(and(
        eq(sourcingProjectionOutcomes.jobFactVersionId, canonicalCandidateId),
        eq(sourcingProjectionOutcomes.status, 'pending'),
      )).returning({ id: sourcingProjectionOutcomes.id })
      if (!updated) throw new Error('Pending projection outcome was not found')
    },
    async get(rawRevisionId: string): Promise<RawSourceProjectionResult | null> {
      const [revision] = await database.select().from(captureEvidenceVersions)
        .where(eq(captureEvidenceVersions.id, rawRevisionId)).limit(1)
      if (!revision) return null
      const [outcome] = await database.select().from(sourcingProjectionOutcomes)
        .where(eq(sourcingProjectionOutcomes.captureEvidenceVersionId, rawRevisionId))
        .orderBy(
          desc(sourcingProjectionOutcomes.createdAt),
          desc(sourcingProjectionOutcomes.id),
        ).limit(1)
      if (outcome) {
        const base = {
          rawRecordId: outcome.captureLineageId,
          rawRevisionId: outcome.captureEvidenceVersionId,
          normalizationStatus: 'completed' as const,
          gateStatus: 'passed' as const,
          canonicalCandidateId: outcome.jobFactVersionId,
          updatedAt: outcome.updatedAt,
        }
        if (outcome.status === 'pending') return { ...base, status: 'pending' }
        if (outcome.status === 'failed') return {
          ...base, status: 'failed', failedAt: outcome.failedAt!,
          failure: { code: outcome.failureCode as 'projection_failed', retryable: outcome.failureRetryable! },
        }
        const [finding] = await database.select({
          id: opportunities.id,
          mergeStatus: opportunities.mergeStatus,
          mergedApplicationId: opportunities.applicationId,
        }).from(opportunities).where(eq(opportunities.id, outcome.opportunityId!)).limit(1)
        if (!finding) throw new Error('Projected finding reference is missing')
        return {
          ...base, status: 'projected', projectedAt: outcome.projectedAt!,
          finding: finding as SourcingProjectionFindingReference,
        }
      }

      const [latest] = await database.select({
        status: normalizationRuns.status,
        updatedAt: normalizationRuns.updatedAt,
        candidateId: jobFactVersions.id,
        gateStatus: normalizationGates.status,
      }).from(normalizationRuns)
        .leftJoin(jobFactVersions, eq(jobFactVersions.runId, normalizationRuns.id))
        .leftJoin(normalizationGates, eq(normalizationGates.runId, normalizationRuns.id))
        .where(eq(normalizationRuns.captureEvidenceVersionId, rawRevisionId))
        .orderBy(
          desc(normalizationRuns.updatedAt),
          desc(normalizationRuns.createdAt),
          desc(normalizationRuns.id),
        ).limit(1)
      if (!latest) return {
        status: 'not_eligible', rawRecordId: revision.captureLineageId, rawRevisionId,
        normalizationStatus: null, canonicalCandidateId: null, gateStatus: null,
        updatedAt: revision.createdAt,
      }
      const normalizationStatus = latest.status as RawSourceProjectionResult['normalizationStatus']
      return {
        status: 'not_eligible', rawRecordId: revision.captureLineageId, rawRevisionId,
        normalizationStatus,
        canonicalCandidateId: null,
        gateStatus: normalizationStatus === 'completed' ? latest.gateStatus as 'needs_enrichment' | 'rejected' : null,
        updatedAt: latest.updatedAt,
      } as RawSourceProjectionResult
    },
  }
}
