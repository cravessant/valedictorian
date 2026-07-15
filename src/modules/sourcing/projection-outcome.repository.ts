import crypto from 'node:crypto'
import { and, desc, eq, sql } from 'drizzle-orm'
import type { RawSourceProjectionResult, SourcingProjectionFindingReference } from 'sparxie'
import {
  jobFactVersions,
  normalizationGates,
  normalizationRuns,
  captureEvidenceVersions,
  opportunities,
  sourcingProjectionOutcomes,
} from '../../db/schema'
import type { DrizzleDatabase } from '../../db/sqlite'

type Transaction = Parameters<Parameters<DrizzleDatabase['transaction']>[0]>[0]

export function createSqliteProjectionOutcomeRepository(database: DrizzleDatabase) {
  return {
    stagePending(transaction: Transaction, input: {
      rawRecordId: string
      rawRevisionId: string
      canonicalCandidateId: string
      now: string
    }) {
      transaction.insert(sourcingProjectionOutcomes).values({
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
      }).onConflictDoNothing({ target: sourcingProjectionOutcomes.jobFactVersionId }).run()
    },
    markProjected(transaction: Transaction, canonicalCandidateId: string, findingId: string, projectedAt: string) {
      const result = transaction.update(sourcingProjectionOutcomes).set({
        status: 'projected', opportunityId: findingId, projectedAt, updatedAt: projectedAt,
      }).where(and(
        eq(sourcingProjectionOutcomes.jobFactVersionId, canonicalCandidateId),
        eq(sourcingProjectionOutcomes.status, 'pending'),
      )).run()
      if (result.changes !== 1) throw new Error('Pending projection outcome was not found')
    },
    markFailed(canonicalCandidateId: string, failedAt: string) {
      const result = database.update(sourcingProjectionOutcomes).set({
        status: 'failed', failureCode: 'projection_failed', failureRetryable: false,
        failedAt, updatedAt: failedAt,
      }).where(and(
        eq(sourcingProjectionOutcomes.jobFactVersionId, canonicalCandidateId),
        eq(sourcingProjectionOutcomes.status, 'pending'),
      )).run()
      if (result.changes !== 1) throw new Error('Pending projection outcome was not found')
    },
    get(rawRevisionId: string): RawSourceProjectionResult | null {
      const revision = database.select().from(captureEvidenceVersions)
        .where(eq(captureEvidenceVersions.id, rawRevisionId)).get()
      if (!revision) return null
      const outcome = database.select().from(sourcingProjectionOutcomes)
        .where(eq(sourcingProjectionOutcomes.captureEvidenceVersionId, rawRevisionId))
        .orderBy(desc(sourcingProjectionOutcomes.createdAt), sql`${sourcingProjectionOutcomes}.rowid desc`).get()
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
        const finding = database.select({
          id: opportunities.id,
          mergeStatus: opportunities.mergeStatus,
          mergedApplicationId: opportunities.applicationId,
        }).from(opportunities).where(eq(opportunities.id, outcome.opportunityId!)).get()
        if (!finding) throw new Error('Projected finding reference is missing')
        return {
          ...base, status: 'projected', projectedAt: outcome.projectedAt!,
          finding: finding as SourcingProjectionFindingReference,
        }
      }

      const latest = database.select({
        status: normalizationRuns.status,
        updatedAt: normalizationRuns.updatedAt,
        candidateId: jobFactVersions.id,
        gateStatus: normalizationGates.status,
      }).from(normalizationRuns)
        .leftJoin(jobFactVersions, eq(jobFactVersions.runId, normalizationRuns.id))
        .leftJoin(normalizationGates, eq(normalizationGates.runId, normalizationRuns.id))
        .where(eq(normalizationRuns.captureEvidenceVersionId, rawRevisionId))
        .orderBy(desc(normalizationRuns.updatedAt), sql`${normalizationRuns}.rowid desc`).get()
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
