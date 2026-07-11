import crypto from 'node:crypto'
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import type {
  CanonicalSourceCandidate,
  FieldResolutionOutcome,
  NormalizationAttempt,
  NormalizationGateOutcome,
  NormalizationStatus,
  RawSourceNormalizationResult,
  RawSourceRevision,
} from 'sparxie'
import {
  canonicalSourceCandidates,
  normalizationAttempts,
  normalizationFieldOutcomes,
  normalizationGates,
  normalizationRuns,
  rawSourceRecords,
  rawSourceRevisions,
  sourceEntities,
} from '../../db/schema'
import type { DrizzleDatabase } from '../../db/sqlite'

export interface NormalizationRawContext {
  revision: RawSourceRevision
  sourceEntity: { id: string; identityKind: string; identityNamespace: string; identityValue: string } | null
}

export interface PersistNormalizationInput {
  runId: string
  rawRecordId: string
  rawRevisionId: string
  inputHash: string
  resolverSetHash: string
  canonicalSchemaVersion: string
  gatePolicyVersion: string
  status: NormalizationStatus
  attempts: NormalizationAttempt[]
  candidate: CanonicalSourceCandidate | null
  gate: NormalizationGateOutcome
  now: string
}

export function createSqliteNormalizationRepository(database: DrizzleDatabase) {
  return {
    getRawContext(rawRevisionId: string): NormalizationRawContext | null {
      const revision = database.select().from(rawSourceRevisions).where(eq(rawSourceRevisions.id, rawRevisionId)).get()
      if (!revision) return null
      const record = database.select().from(rawSourceRecords).where(eq(rawSourceRecords.id, revision.rawRecordId)).get()
      if (!record) return null
      const entity = record.sourceEntityId ? database.select().from(sourceEntities).where(eq(sourceEntities.id, record.sourceEntityId)).get() : null
      return { revision: mapRevision(revision), sourceEntity: entity ?? null }
    },
    findCached(rawRevisionId: string, inputHash: string, resolverSetHash: string, canonicalSchemaVersion: string, gatePolicyVersion: string) {
      const run = database.select().from(normalizationRuns).where(and(
        eq(normalizationRuns.rawRevisionId, rawRevisionId), eq(normalizationRuns.inputHash, inputHash),
        eq(normalizationRuns.resolverSetHash, resolverSetHash), eq(normalizationRuns.canonicalSchemaVersion, canonicalSchemaVersion),
        eq(normalizationRuns.gatePolicyVersion, gatePolicyVersion),
        eq(normalizationRuns.triggerKind, 'intake'),
        isNull(normalizationRuns.triggerId),
      )).get()
      return run && ['completed','failed','blocked'].includes(run.status) ? mapResult(database, run) : null
    },
    ensureDestinationSourceEntity(destinationUrl: string, createdAt: string) {
      const identityKind = 'destination_url'
      const identityNamespace = 'deterministic-destination/v1'
      const existing = database.select().from(sourceEntities).where(and(eq(sourceEntities.identityKind, identityKind), eq(sourceEntities.identityNamespace, identityNamespace), eq(sourceEntities.identityValue, destinationUrl))).get()
      if (existing) return existing
      const entity = { id: crypto.randomUUID(), identityKind, identityNamespace, identityValue: destinationUrl, createdAt }
      database.insert(sourceEntities).values(entity).run()
      return entity
    },
    persist(input: PersistNormalizationInput & { triggerId?: string }) {
      database.transaction((transaction) => {
        transaction.insert(normalizationRuns).values({
          id: input.runId, rawRecordId: input.rawRecordId, rawRevisionId: input.rawRevisionId,
          inputHash: input.inputHash, resolverSetHash: input.resolverSetHash,
          canonicalSchemaVersion: input.canonicalSchemaVersion, gatePolicyVersion: input.gatePolicyVersion,
          triggerKind: 'intake', triggerId: input.triggerId ?? null, status: input.status, createdAt: input.now, updatedAt: input.now,
        }).run()
        let outcomeSequence = 0
        input.attempts.forEach((attempt, attemptSequence) => {
          transaction.insert(normalizationAttempts).values({
            id: attempt.id, runId: input.runId, rawRevisionId: input.rawRevisionId, sequence: attemptSequence,
            resolverId: attempt.resolver.id, resolverVersion: attempt.resolver.version, inputHash: attempt.inputHash,
            declarationJson: JSON.stringify(attempt.resolver), applicabilityJson: JSON.stringify(attempt.applicability ?? []),
            status: attempt.status, startedAt: attempt.startedAt, completedAt: attempt.completedAt,
          }).run()
          attempt.outcomes.forEach((outcome, outcomeIndex) => transaction.insert(normalizationFieldOutcomes).values({
            id: crypto.randomUUID(), runId: input.runId, attemptId: attempt.id, sequence: outcomeSequence++,
            attemptSequence, outcomeIndex, field: outcome.field, status: outcome.status,
            resolverId: outcome.resolverId, resolverVersion: outcome.resolverVersion, inputHash: outcome.inputHash,
            outcomeJson: JSON.stringify(outcome),
          }).run())
        })
        if (input.candidate) transaction.insert(canonicalSourceCandidates).values({
          id: input.candidate.id, runId: input.runId, sourceEntityId: input.candidate.sourceEntityId,
          rawRecordId: input.rawRecordId, rawRevisionId: input.rawRevisionId, schemaVersion: input.canonicalSchemaVersion,
          candidateJson: JSON.stringify(input.candidate), createdAt: input.now,
        }).run()
        transaction.insert(normalizationGates).values({
          id: crypto.randomUUID(), runId: input.runId, policyVersion: input.gatePolicyVersion, status: input.gate.status,
          candidateId: input.candidate?.id ?? null, gateJson: JSON.stringify(input.gate), evaluatedAt: input.gate.evaluatedAt,
        }).run()
      })
      const run = database.select().from(normalizationRuns).where(eq(normalizationRuns.id, input.runId)).get()
      if (!run) throw new Error('Normalization run was not persisted')
      return mapResult(database, run)
    },
    getLatest(rawRecordId: string) {
      const run = database.select({ run: normalizationRuns }).from(normalizationRuns)
        .innerJoin(rawSourceRevisions, eq(rawSourceRevisions.id, normalizationRuns.rawRevisionId))
        .where(eq(normalizationRuns.rawRecordId, rawRecordId))
        .orderBy(
          desc(rawSourceRevisions.revision),
          desc(normalizationRuns.createdAt),
          sql`${normalizationRuns}.rowid desc`,
        ).get()?.run
      return run ? mapResult(database, run) : null
    },
    listHistory(rawRecordId: string) {
      return database.select({ run: normalizationRuns }).from(normalizationRuns)
        .innerJoin(rawSourceRevisions, eq(rawSourceRevisions.id, normalizationRuns.rawRevisionId))
        .where(eq(normalizationRuns.rawRecordId, rawRecordId))
        .orderBy(
          desc(rawSourceRevisions.revision),
          desc(normalizationRuns.createdAt),
          sql`${normalizationRuns}.rowid desc`,
        ).all().map(({ run }) => mapResult(database, run))
    },
  }
}

function mapResult(database: DrizzleDatabase, run: typeof normalizationRuns.$inferSelect): RawSourceNormalizationResult {
  const attemptRows = database.select().from(normalizationAttempts).where(eq(normalizationAttempts.runId, run.id)).orderBy(asc(normalizationAttempts.sequence)).all()
  const outcomes = database.select().from(normalizationFieldOutcomes).where(eq(normalizationFieldOutcomes.runId, run.id)).orderBy(asc(normalizationFieldOutcomes.sequence)).all().map((row) => JSON.parse(row.outcomeJson) as FieldResolutionOutcome)
  const attempts = attemptRows.map((row) => ({ id: row.id, rawRevisionId: row.rawRevisionId, resolver: JSON.parse(row.declarationJson), inputHash: row.inputHash, status: row.status, applicability: JSON.parse(row.applicabilityJson), startedAt: row.startedAt, completedAt: row.completedAt, outcomes: outcomes.filter((outcome) => outcome.resolverId === row.resolverId && outcome.resolverVersion === row.resolverVersion) })) as NormalizationAttempt[]
  const gateRow = database.select().from(normalizationGates).where(eq(normalizationGates.runId, run.id)).get()
  const candidateRow = database.select().from(canonicalSourceCandidates).where(eq(canonicalSourceCandidates.runId, run.id)).get()
  return { rawRecordId: run.rawRecordId, rawRevisionId: run.rawRevisionId, canonicalSchemaVersion: run.canonicalSchemaVersion, status: run.status, attempts, fieldOutcomes: outcomes, updatedAt: run.updatedAt, gate: gateRow ? JSON.parse(gateRow.gateJson) : null, canonicalCandidate: candidateRow ? JSON.parse(candidateRow.candidateJson) : null } as RawSourceNormalizationResult
}

function mapRevision(row: typeof rawSourceRevisions.$inferSelect): RawSourceRevision {
  return {
    id: row.id, rawRecordId: row.rawRecordId, revision: row.revision, contentHash: row.contentHash,
    adapter: { id: row.adapterId, kind: row.adapterKind as RawSourceRevision['adapter']['kind'], version: row.adapterVersion },
    reportedOrigin: row.reportedOriginKind && row.reportedOriginName ? { kind: row.reportedOriginKind as NonNullable<RawSourceRevision['reportedOrigin']>['kind'], name: row.reportedOriginName, providerId: row.reportedOriginProviderId, url: row.reportedOriginUrl } : null,
    observedAt: row.observedAt, providerRecordId: row.providerRecordId, providerSchema: row.providerSchema,
    payload: row.payloadJson ? JSON.parse(row.payloadJson) : null, evidence: JSON.parse(row.evidenceJson), createdAt: row.createdAt,
  }
}
