import crypto from 'node:crypto'
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import type {
  CanonicalSourceCandidate,
  FieldResolutionOutcome,
  NormalizationAttempt,
  NormalizationGateOutcome,
  NormalizationStatus,
  RawSourceNormalizationResult,
  RawSourceOccurrenceReceipt,
  RawSourceRevision,
} from 'sparxie'
import { retryAdviceSchema } from 'sparxie'
import {
  canonicalSourceCandidates,
  normalizationAttempts,
  normalizationFieldOutcomes,
  normalizationGates,
  normalizationRuns,
  rawSourceOccurrences,
  rawSourceRecords,
  rawSourceRevisions,
  retryWork,
  sourceEntities,
  sourceEntityIdentities,
  sourceIdentityConflicts,
} from '../../db/schema'
import type { DrizzleDatabase } from '../../db/sqlite'
import { classifyExplicitIntermediaryAlias, DESTINATION_TAXONOMY_VERSION } from './destination-classifier'

export const SOURCE_IDENTITY_RECONCILIATION_VERSION = 'source-identity-reconciliation/v1'
const DESTINATION_ALIAS_NAMESPACE = 'canonicalized-job-destination/v1'
const INTERMEDIARY_ALIAS_NAMESPACE = 'job-intermediary/v1'
const MAX_IDENTITIES_PER_SOURCE_ENTITY = 32

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
  acquiredRetryWork?: {
    acquisitionRunId: string
    retryWorkId: string
  }
  deferAcquiredRetryCompletion?: boolean
  triggerOccurrence?: RawSourceOccurrenceReceipt
}

export type PersistedRawSourceNormalizationResult = RawSourceNormalizationResult & {
  triggerOccurrence: RawSourceOccurrenceReceipt | null
}

export interface StrongDestinationReconciliation {
  sourceEntity: NonNullable<NormalizationRawContext['sourceEntity']>
  conflict: boolean
}

type PersistNormalizationWithTriggerInput = PersistNormalizationInput & { triggerId?: string }

export function createSqliteNormalizationRepository(
  database: DrizzleDatabase,
  options: {
    projectPassedCandidate?: (
      transaction: Parameters<Parameters<DrizzleDatabase['transaction']>[0]>[0],
      candidateId: string,
      rawRevisionId: string,
    ) => unknown
  } = {},
) {
  const persist = (
    transaction: Parameters<Parameters<DrizzleDatabase['transaction']>[0]>[0],
    input: PersistNormalizationWithTriggerInput,
  ) => {
    persistNormalization(transaction, input)
    if (input.gate.status === 'passed' && input.candidate) {
      options.projectPassedCandidate?.(transaction, input.candidate.id, input.rawRevisionId)
    }
  }
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
    persistWithStrongDestination(input: {
      sourceEntity: NormalizationRawContext['sourceEntity']
      rawRevisionId: string
      destination: NonNullable<CanonicalSourceCandidate['destination']>
      destinationOutcome: Extract<FieldResolutionOutcome, { status: 'resolved' | 'locked' }>
      createdAt: string
      materialize: (reconciliation: StrongDestinationReconciliation) => PersistNormalizationWithTriggerInput
    }) {
      const runId = database.transaction((transaction) => {
        const persistReconciliation = (reconciliation: StrongDestinationReconciliation) => {
          const persistence = input.materialize(reconciliation)
          persist(transaction, persistence)
          return persistence.runId
        }
        const canonical = {
          kind: 'canonical_destination' as const,
          namespace: DESTINATION_TAXONOMY_VERSION,
          value: input.destination.url,
        }
        const targetIdentity = transaction.select().from(sourceEntityIdentities).where(and(
          eq(sourceEntityIdentities.identityKind, canonical.kind),
          eq(sourceEntityIdentities.identityNamespace, canonical.namespace),
          eq(sourceEntityIdentities.identityValue, canonical.value),
        )).get()
        const destinationOwner = targetIdentity ? null : transaction.select().from(sourceEntities).where(and(
          eq(sourceEntities.identityKind, 'destination_url'),
          eq(sourceEntities.identityNamespace, canonical.namespace),
          eq(sourceEntities.identityValue, canonical.value),
        )).get()
        const priorOwners = input.sourceEntity
          ? transaction.selectDistinct({ sourceEntityId: canonicalSourceCandidates.sourceEntityId })
              .from(canonicalSourceCandidates)
              .innerJoin(rawSourceRecords, eq(rawSourceRecords.id, canonicalSourceCandidates.rawRecordId))
              .where(eq(rawSourceRecords.sourceEntityId, input.sourceEntity.id)).all()
              .map(({ sourceEntityId }) => sourceEntityId)
          : []
        const currentCanonical = input.sourceEntity
          ? transaction.select().from(sourceEntityIdentities).where(and(
              eq(sourceEntityIdentities.sourceEntityId, input.sourceEntity.id),
              eq(sourceEntityIdentities.identityKind, canonical.kind),
            )).all()
          : []
        const targetOwnerId = targetIdentity?.sourceEntityId ?? destinationOwner?.id ?? input.sourceEntity?.id ?? crypto.randomUUID()
        const conflictingOwner = priorOwners.find((ownerId) => ownerId !== targetOwnerId)
        const conflictingIdentity = currentCanonical.find(({ identityNamespace, identityValue }) =>
          identityNamespace !== canonical.namespace || identityValue !== canonical.value)

        if (input.sourceEntity && (conflictingOwner || conflictingIdentity)) {
          recordIdentityConflict(transaction, {
            sourceEntityId: input.sourceEntity.id,
            conflictingSourceEntityId: targetIdentity?.sourceEntityId ?? conflictingOwner ?? null,
            rawRevisionId: input.rawRevisionId,
            identityKind: canonical.kind,
            identityNamespace: canonical.namespace,
            identityValue: canonical.value,
            reason: 'Source entity already has a different strong destination association',
            evidenceJson: identityEvidence(input),
            createdAt: input.createdAt,
          })
          return persistReconciliation({ sourceEntity: input.sourceEntity, conflict: true })
        }

        let owner = transaction.select().from(sourceEntities).where(eq(sourceEntities.id, targetOwnerId)).get()
        if (!owner) {
          owner = {
            id: targetOwnerId,
            identityKind: 'destination_url',
            identityNamespace: DESTINATION_TAXONOMY_VERSION,
            identityValue: canonical.value,
            createdAt: input.createdAt,
          }
          transaction.insert(sourceEntities).values(owner).run()
        }
        const proposedIdentities: Array<{
          kind: 'canonical_destination' | 'destination_alias' | 'intermediary_alias'
          namespace: string
          value: string
        }> = [
          canonical,
          { kind: 'destination_alias' as const, namespace: DESTINATION_ALIAS_NAMESPACE, value: canonical.value },
        ]
        const intermediary = input.destination.intermediaryUrl
          ? classifyExplicitIntermediaryAlias(input.destination.intermediaryUrl)
          : null
        if (intermediary) proposedIdentities.push({
          kind: 'intermediary_alias', namespace: INTERMEDIARY_ALIAS_NAMESPACE, value: intermediary,
        })
        const identities = [...new Map(proposedIdentities.map((identity) => [
          `${identity.kind}\u0000${identity.namespace}\u0000${identity.value}`,
          identity,
        ])).values()]
        const preflight = identities.map((identity) => ({
          identity,
          existing: transaction.select().from(sourceEntityIdentities).where(and(
            eq(sourceEntityIdentities.identityKind, identity.kind),
            eq(sourceEntityIdentities.identityNamespace, identity.namespace),
            eq(sourceEntityIdentities.identityValue, identity.value),
          )).get(),
        }))
        const ownershipCollisions = preflight.filter(({ existing }) =>
          existing && existing.sourceEntityId !== targetOwnerId)
        if (ownershipCollisions.length > 0) {
          for (const { identity, existing } of ownershipCollisions) {
            recordIdentityConflict(transaction, {
              sourceEntityId: input.sourceEntity?.id ?? owner.id,
              conflictingSourceEntityId: existing!.sourceEntityId,
              rawRevisionId: input.rawRevisionId,
              identityKind: identity.kind,
              identityNamespace: identity.namespace,
              identityValue: identity.value,
              reason: 'Strong identity is already owned by another source entity',
              evidenceJson: identityEvidence(input),
              createdAt: input.createdAt,
            })
          }
          return persistReconciliation({ sourceEntity: input.sourceEntity ?? owner, conflict: true })
        }
        const newIdentities = preflight.filter(({ existing }) => !existing)
        const currentCount = transaction.select({ count: sql<number>`count(*)` }).from(sourceEntityIdentities)
          .where(eq(sourceEntityIdentities.sourceEntityId, targetOwnerId)).get()?.count ?? 0
        if (currentCount + newIdentities.length > MAX_IDENTITIES_PER_SOURCE_ENTITY) {
          const overflowIdentity = newIdentities[0]?.identity ?? canonical
          recordIdentityConflict(transaction, {
            sourceEntityId: input.sourceEntity?.id ?? owner.id,
            conflictingSourceEntityId: targetOwnerId,
            rawRevisionId: input.rawRevisionId,
            identityKind: overflowIdentity.kind,
            identityNamespace: overflowIdentity.namespace,
            identityValue: overflowIdentity.value,
            reason: 'Source entity identity bound is exhausted',
            evidenceJson: JSON.stringify({
              maximum: MAX_IDENTITIES_PER_SOURCE_ENTITY,
              currentCount,
              proposedNewCount: newIdentities.length,
            }),
            createdAt: input.createdAt,
          })
          return persistReconciliation({ sourceEntity: input.sourceEntity ?? owner, conflict: true })
        }

        for (const { identity } of newIdentities) {
          transaction.insert(sourceEntityIdentities).values({
            id: crypto.randomUUID(), sourceEntityId: owner.id,
            identityKind: identity.kind, identityNamespace: identity.namespace, identityValue: identity.value,
            provenanceKind: 'normalization', provenanceVersion: SOURCE_IDENTITY_RECONCILIATION_VERSION,
            evidenceJson: identityEvidence(input),
            rawRevisionId: input.rawRevisionId, createdAt: input.createdAt,
          }).run()
        }
        return persistReconciliation({ sourceEntity: owner, conflict: false })
      })
      return mapPersistedRun(database, runId)
    },
    persist(input: PersistNormalizationWithTriggerInput) {
      database.transaction((transaction) => persist(transaction, input))
      return mapPersistedRun(database, input.runId)
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
    hasExactSuccessfulNormalizationAttempt(input: {
      inputHash: string
      rawRevisionId: string
      resolverId: string
      resolverVersion: string
      retryWindowStartedAt: string
    }): boolean {
      return hasPersistedExactSuccessfulNormalizationAttempt(database, input)
    },
  }
}

export function hasPersistedExactSuccessfulNormalizationAttempt(
  database: Pick<DrizzleDatabase, 'select'>,
  input: {
    inputHash: string
    rawRevisionId: string
    resolverId: string
    resolverVersion: string
    retryWindowStartedAt: string
  },
): boolean {
  const attempts = database.select().from(normalizationAttempts).where(and(
    eq(normalizationAttempts.rawRevisionId, input.rawRevisionId),
    eq(normalizationAttempts.resolverId, input.resolverId),
    eq(normalizationAttempts.resolverVersion, input.resolverVersion),
    eq(normalizationAttempts.inputHash, input.inputHash),
    eq(normalizationAttempts.status, 'completed'),
  )).orderBy(desc(normalizationAttempts.completedAt), desc(normalizationAttempts.startedAt)).all()
  for (const attempt of attempts) {
    const attemptAt = attempt.completedAt ?? attempt.startedAt
    if (attemptAt <= input.retryWindowStartedAt) continue
    const destination = database.select().from(normalizationFieldOutcomes).where(and(
      eq(normalizationFieldOutcomes.attemptId, attempt.id),
      eq(normalizationFieldOutcomes.field, 'destinationUrl'),
    )).all().find((outcome) => outcome.status === 'resolved' || outcome.status === 'locked')
    if (destination) return true
  }
  return false
}

function persistNormalization(
  transaction: Parameters<Parameters<DrizzleDatabase['transaction']>[0]>[0],
  input: PersistNormalizationWithTriggerInput,
) {
  transaction.insert(normalizationRuns).values({
    id: input.runId, rawRecordId: input.rawRecordId, rawRevisionId: input.rawRevisionId,
    triggerOccurrenceId: input.triggerOccurrence?.id ?? null,
    triggerConnectorInstanceId: input.triggerOccurrence?.capture?.connectorInstanceId ?? null,
    triggerConnectorRunId: input.triggerOccurrence?.capture?.connectorRunId ?? null,
    inputHash: input.inputHash, resolverSetHash: input.resolverSetHash,
    canonicalSchemaVersion: input.canonicalSchemaVersion, gatePolicyVersion: input.gatePolicyVersion,
    triggerKind: 'intake', triggerId: input.triggerId ?? null, status: input.status,
    createdAt: input.now, updatedAt: input.now,
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
    synchronizeNormalizationRetryWork(transaction, input, attempt)
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
}

function synchronizeNormalizationRetryWork(
  transaction: Parameters<Parameters<DrizzleDatabase['transaction']>[0]>[0],
  input: PersistNormalizationWithTriggerInput,
  attempt: NormalizationAttempt,
) {
  const acquiredByIdentity = input.acquiredRetryWork
    ? transaction.select().from(retryWork).where(and(
        eq(retryWork.id, input.acquiredRetryWork.retryWorkId),
        eq(retryWork.kind, 'normalization'),
        eq(retryWork.state, 'acquired'),
        eq(retryWork.acquisitionRunId, input.acquiredRetryWork.acquisitionRunId),
        isNull(retryWork.deletedAt),
      )).get()
    : null
  const executingConnectorRunId = input.triggerOccurrence?.capture?.connectorRunId
  const acquiredByCaptureRun = !acquiredByIdentity && executingConnectorRunId
    ? transaction.select().from(retryWork).where(and(
        eq(retryWork.kind, 'normalization'),
        eq(retryWork.state, 'acquired'),
        eq(retryWork.acquisitionRunId, executingConnectorRunId),
        eq(retryWork.resolverId, attempt.resolver.id),
        eq(retryWork.resolverVersion, attempt.resolver.version),
        isNull(retryWork.deletedAt),
      )).get()
    : null
  const existing = transaction.select().from(retryWork).where(and(
    eq(retryWork.kind, 'normalization'),
    eq(retryWork.rawRevisionId, input.rawRevisionId),
    eq(retryWork.resolverId, attempt.resolver.id),
    eq(retryWork.resolverVersion, attempt.resolver.version),
    eq(retryWork.inputHash, attempt.inputHash),
    isNull(retryWork.deletedAt),
  )).get()
  if (acquiredByIdentity && acquiredByIdentity.id !== existing?.id) {
    throw new Error(
      'Acquired normalization retry identity does not match the persisted attempt identity',
    )
  }
  const retryOutcomes = attempt.outcomes.filter((outcome): outcome is Extract<FieldResolutionOutcome, { status: 'retry' | 'exhausted' | 'cancelled' }> =>
    outcome.status === 'retry' || outcome.status === 'exhausted' || outcome.status === 'cancelled')
  if (acquiredByCaptureRun && acquiredByCaptureRun.id !== existing?.id) {
    transaction.update(retryWork).set({
      state: 'completed',
      nextAttemptAt: null,
      acquiredAt: null,
      acquisitionToken: null,
      acquisitionRunId: null,
      updatedAt: input.now,
    }).where(eq(retryWork.id, acquiredByCaptureRun.id)).run()
  }
  if (retryOutcomes.length === 0) {
    if (existing && existing.state !== 'exhausted' && existing.state !== 'cancelled') {
      if (
        input.deferAcquiredRetryCompletion
        && acquiredByIdentity
        && acquiredByIdentity.id === existing.id
      ) {
        return
      }
      transaction.update(retryWork).set({
        state: 'completed',
        nextAttemptAt: null,
        acquiredAt: null,
        acquisitionToken: null,
        acquisitionRunId: null,
        updatedAt: input.now,
      }).where(eq(retryWork.id, existing.id)).run()
    }
    return
  }
  const firstAdvice = retryOutcomes[0].retry
  const advice = retryAdviceSchema.parse(firstAdvice)
  if (retryOutcomes.some((outcome) =>
    (outcome.status === 'retry' && advice.state !== 'scheduled' && advice.state !== 'not_due')
    || (outcome.status === 'exhausted' && advice.state !== 'exhausted')
    || (outcome.status === 'cancelled' && advice.state !== 'cancelled'))) {
    throw new Error(`Resolver ${attempt.resolver.id}@${attempt.resolver.version} emitted retry advice that does not match its outcome status`)
  }
  if (retryOutcomes.some((outcome) => JSON.stringify(outcome.retry) !== JSON.stringify(firstAdvice))) {
    throw new Error(`Resolver ${attempt.resolver.id}@${attempt.resolver.version} emitted inconsistent retry advice for one invocation`)
  }
  if (existing?.state === 'exhausted' || existing?.state === 'cancelled') return
  const values = {
    reason: advice.reason,
    attempt: advice.attempt,
    maxAttempts: advice.maxAttempts,
    lastAttemptAt: advice.lastAttemptAt,
    computedDelayMs: advice.computedDelayMs,
    serverMinimumDelayMs: advice.serverMinimumDelayMs ?? null,
    nextAttemptAt: advice.nextAttemptAt,
    horizonAt: advice.horizonAt,
    state: advice.state === 'not_due' ? 'scheduled' as const : advice.state,
    ownerVersion: attempt.resolver.version,
    lineageJson: JSON.stringify({
      normalizationRunId: input.runId,
      triggerOccurrenceId: input.triggerOccurrence?.id ?? null,
      connectorInstanceId: input.triggerOccurrence?.capture?.connectorInstanceId ?? null,
      connectorRunId: input.triggerOccurrence?.capture?.connectorRunId ?? null,
      acquiredRetryWorkId: input.acquiredRetryWork?.retryWorkId ?? null,
      acquisitionRunId: input.acquiredRetryWork?.acquisitionRunId ?? null,
    }),
    acquiredAt: null,
    acquisitionToken: null,
    acquisitionRunId: null,
    skippedRunId: null,
    updatedAt: input.now,
  }
  if (existing) {
    transaction.update(retryWork).set(values).where(eq(retryWork.id, existing.id)).run()
    return
  }
  transaction.insert(retryWork).values({
    id: crypto.randomUUID(), kind: 'normalization', connectorInstanceId: null,
    filterSignature: null, checkpointSchemaVersion: null, checkpointGeneration: null,
    rawRevisionId: input.rawRevisionId,
    resolverId: attempt.resolver.id,
    resolverVersion: attempt.resolver.version,
    inputHash: attempt.inputHash,
    ...values,
    createdAt: input.now,
    deletedAt: null,
  }).run()
}

function mapPersistedRun(database: DrizzleDatabase, runId: string) {
  const run = database.select().from(normalizationRuns).where(eq(normalizationRuns.id, runId)).get()
  if (!run) throw new Error('Normalization run was not persisted')
  return mapResult(database, run)
}

function identityEvidence(input: {
  destination: NonNullable<CanonicalSourceCandidate['destination']>
  destinationOutcome: Extract<FieldResolutionOutcome, { status: 'resolved' | 'locked' }>
}) {
  return JSON.stringify({
    destination: input.destination,
    resolverId: input.destinationOutcome.resolverId,
    resolverVersion: input.destinationOutcome.resolverVersion,
    inputHash: input.destinationOutcome.inputHash,
  })
}

function recordIdentityConflict(
  database: Parameters<Parameters<DrizzleDatabase['transaction']>[0]>[0],
  input: Omit<typeof sourceIdentityConflicts.$inferInsert, 'id' | 'provenanceVersion'>,
) {
  database.insert(sourceIdentityConflicts).values({
    id: crypto.randomUUID(),
    ...input,
    provenanceVersion: SOURCE_IDENTITY_RECONCILIATION_VERSION,
  }).onConflictDoNothing().run()
}

function mapResult(
  database: DrizzleDatabase,
  run: typeof normalizationRuns.$inferSelect,
): PersistedRawSourceNormalizationResult {
  const attemptRows = database.select().from(normalizationAttempts).where(eq(normalizationAttempts.runId, run.id)).orderBy(asc(normalizationAttempts.sequence)).all()
  const outcomes = database.select().from(normalizationFieldOutcomes).where(eq(normalizationFieldOutcomes.runId, run.id)).orderBy(asc(normalizationFieldOutcomes.sequence)).all().map((row) => JSON.parse(row.outcomeJson) as FieldResolutionOutcome)
  const attempts = attemptRows.map((row) => ({ id: row.id, rawRevisionId: row.rawRevisionId, resolver: JSON.parse(row.declarationJson), inputHash: row.inputHash, status: row.status, applicability: JSON.parse(row.applicabilityJson), startedAt: row.startedAt, completedAt: row.completedAt, outcomes: outcomes.filter((outcome) => outcome.resolverId === row.resolverId && outcome.resolverVersion === row.resolverVersion) })) as NormalizationAttempt[]
  const gateRow = database.select().from(normalizationGates).where(eq(normalizationGates.runId, run.id)).get()
  const candidateRow = database.select().from(canonicalSourceCandidates).where(eq(canonicalSourceCandidates.runId, run.id)).get()
  const triggerOccurrence = run.triggerOccurrenceId
    ? database.select().from(rawSourceOccurrences)
        .where(eq(rawSourceOccurrences.id, run.triggerOccurrenceId)).get()
    : null
  return {
    rawRecordId: run.rawRecordId,
    rawRevisionId: run.rawRevisionId,
    canonicalSchemaVersion: run.canonicalSchemaVersion,
    status: run.status,
    attempts,
    fieldOutcomes: outcomes,
    updatedAt: run.updatedAt,
    gate: gateRow ? JSON.parse(gateRow.gateJson) : null,
    canonicalCandidate: candidateRow ? JSON.parse(candidateRow.candidateJson) : null,
    triggerOccurrence: triggerOccurrence
      ? {
          id: triggerOccurrence.id,
          rawRecordId: triggerOccurrence.rawRecordId,
          rawRevisionId: triggerOccurrence.rawRevisionId,
          capture: triggerOccurrence.connectorInstanceId && triggerOccurrence.connectorRunId
            ? {
                connectorInstanceId: triggerOccurrence.connectorInstanceId,
                connectorRunId: triggerOccurrence.connectorRunId,
              }
            : null,
          observedAt: triggerOccurrence.observedAt,
          receivedAt: triggerOccurrence.receivedAt,
        }
      : null,
  } as PersistedRawSourceNormalizationResult
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
