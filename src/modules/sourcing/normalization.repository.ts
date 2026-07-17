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
  jobFactVersions,
  normalizationAttempts,
  normalizationFieldOutcomes,
  normalizationGates,
  normalizationRuns,
  captures,
  captureLineages,
  captureEvidenceVersions,
  retryWork,
  sourceExecutionScopes,
  jobs,
  jobIdentities,
  jobIdentityConflicts,
} from '../../db/schema'
import type { DrizzleDatabase } from '../../db/sqlite'
import { classifyExplicitIntermediaryAlias, DESTINATION_TAXONOMY_VERSION } from './destination-classifier'
import { deriveSourceExecutionScopeId } from '../source-execution/source-execution-governor'

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
    acquisitionRunId?: string
    acquisitionToken?: string
    executionScopeId: string
    failureFinalization?: {
      evidence: unknown
      terminal?: boolean
    }
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
    stagePassedCandidate?: (
      transaction: Parameters<Parameters<DrizzleDatabase['transaction']>[0]>[0],
      input: { rawRecordId: string; rawRevisionId: string; canonicalCandidateId: string; now: string },
    ) => void
    projectPassedCandidate?: (
      candidateId: string,
      rawRevisionId: string,
    ) => void
  } = {},
) {
  const persist = (
    transaction: Parameters<Parameters<DrizzleDatabase['transaction']>[0]>[0],
    input: PersistNormalizationWithTriggerInput,
  ) => {
    persistNormalization(transaction, input)
    if (input.gate.status === 'passed' && input.candidate) {
      options.stagePassedCandidate?.(transaction, {
        rawRecordId: input.rawRecordId,
        rawRevisionId: input.rawRevisionId,
        canonicalCandidateId: input.candidate.id,
        now: input.now,
      })
    }
  }
  const project = (input: PersistNormalizationWithTriggerInput) => {
    if (input.gate.status === 'passed' && input.candidate) {
      options.projectPassedCandidate?.(input.candidate.id, input.rawRevisionId)
    }
  }
  return {
    getRawContext(rawRevisionId: string): NormalizationRawContext | null {
      const revision = database.select().from(captureEvidenceVersions).where(eq(captureEvidenceVersions.id, rawRevisionId)).get()
      if (!revision) return null
      const record = database.select().from(captureLineages).where(eq(captureLineages.id, revision.captureLineageId)).get()
      if (!record) return null
      const entity = record.jobId ? database.select().from(jobs).where(eq(jobs.id, record.jobId)).get() : null
      return { revision: mapRevision(revision), sourceEntity: entity ?? null }
    },
    findCached(rawRevisionId: string, inputHash: string, resolverSetHash: string, canonicalSchemaVersion: string, gatePolicyVersion: string) {
      const run = database.select().from(normalizationRuns).where(and(
        eq(normalizationRuns.captureEvidenceVersionId, rawRevisionId), eq(normalizationRuns.inputHash, inputHash),
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
      const persistedInput = database.transaction((transaction) => {
        const persistReconciliation = (reconciliation: StrongDestinationReconciliation) => {
          const persistence = input.materialize(reconciliation)
          persist(transaction, persistence)
          return persistence
        }
        const canonical = {
          kind: 'canonical_destination' as const,
          namespace: DESTINATION_TAXONOMY_VERSION,
          value: input.destination.url,
        }
        const targetIdentity = transaction.select().from(jobIdentities).where(and(
          eq(jobIdentities.identityKind, canonical.kind),
          eq(jobIdentities.identityNamespace, canonical.namespace),
          eq(jobIdentities.identityValue, canonical.value),
        )).get()
        const destinationOwner = targetIdentity ? null : transaction.select().from(jobs).where(and(
          eq(jobs.identityKind, 'destination_url'),
          eq(jobs.identityNamespace, canonical.namespace),
          eq(jobs.identityValue, canonical.value),
        )).get()
        const priorOwners = input.sourceEntity
          ? transaction.selectDistinct({ sourceEntityId: jobFactVersions.jobId })
              .from(jobFactVersions)
              .innerJoin(captureLineages, eq(captureLineages.id, jobFactVersions.captureLineageId))
              .where(eq(captureLineages.jobId, input.sourceEntity.id)).all()
              .map(({ sourceEntityId }) => sourceEntityId)
          : []
        const currentCanonical = input.sourceEntity
          ? transaction.select().from(jobIdentities).where(and(
              eq(jobIdentities.jobId, input.sourceEntity.id),
              eq(jobIdentities.identityKind, canonical.kind),
            )).all()
          : []
        const targetOwnerId = targetIdentity?.jobId ?? destinationOwner?.id ?? input.sourceEntity?.id ?? crypto.randomUUID()
        const conflictingOwner = priorOwners.find((ownerId) => ownerId !== targetOwnerId)
        const conflictingIdentity = currentCanonical.find(({ identityNamespace, identityValue }) =>
          identityNamespace !== canonical.namespace || identityValue !== canonical.value)

        if (input.sourceEntity && (conflictingOwner || conflictingIdentity)) {
          recordIdentityConflict(transaction, {
            jobId: input.sourceEntity.id,
            conflictingJobId: targetIdentity?.jobId ?? conflictingOwner ?? null,
            captureEvidenceVersionId: input.rawRevisionId,
            identityKind: canonical.kind,
            identityNamespace: canonical.namespace,
            identityValue: canonical.value,
            reason: 'Source entity already has a different strong destination association',
            evidenceJson: identityEvidence(input),
            createdAt: input.createdAt,
          })
          return persistReconciliation({ sourceEntity: input.sourceEntity, conflict: true })
        }

        let owner = transaction.select().from(jobs).where(eq(jobs.id, targetOwnerId)).get()
        if (!owner) {
          owner = {
            id: targetOwnerId,
            identityKind: 'destination_url',
            identityNamespace: DESTINATION_TAXONOMY_VERSION,
            identityValue: canonical.value,
            createdAt: input.createdAt,
          }
          transaction.insert(jobs).values(owner).run()
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
          existing: transaction.select().from(jobIdentities).where(and(
            eq(jobIdentities.identityKind, identity.kind),
            eq(jobIdentities.identityNamespace, identity.namespace),
            eq(jobIdentities.identityValue, identity.value),
          )).get(),
        }))
        const ownershipCollisions = preflight.filter(({ existing }) =>
          existing && existing.jobId !== targetOwnerId)
        if (ownershipCollisions.length > 0) {
          for (const { identity, existing } of ownershipCollisions) {
            recordIdentityConflict(transaction, {
              jobId: input.sourceEntity?.id ?? owner.id,
              conflictingJobId: existing!.jobId,
              captureEvidenceVersionId: input.rawRevisionId,
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
        const currentCount = transaction.select({ count: sql<number>`count(*)` }).from(jobIdentities)
          .where(eq(jobIdentities.jobId, targetOwnerId)).get()?.count ?? 0
        if (currentCount + newIdentities.length > MAX_IDENTITIES_PER_SOURCE_ENTITY) {
          const overflowIdentity = newIdentities[0]?.identity ?? canonical
          recordIdentityConflict(transaction, {
            jobId: input.sourceEntity?.id ?? owner.id,
            conflictingJobId: targetOwnerId,
            captureEvidenceVersionId: input.rawRevisionId,
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
          transaction.insert(jobIdentities).values({
            id: crypto.randomUUID(), jobId: owner.id,
            identityKind: identity.kind, identityNamespace: identity.namespace, identityValue: identity.value,
            provenanceKind: 'normalization', provenanceVersion: SOURCE_IDENTITY_RECONCILIATION_VERSION,
            evidenceJson: identityEvidence(input),
            captureEvidenceVersionId: input.rawRevisionId, createdAt: input.createdAt,
          }).run()
        }
        return persistReconciliation({ sourceEntity: owner, conflict: false })
      })
      project(persistedInput)
      return mapPersistedRun(database, persistedInput.runId)
    },
    persist(input: PersistNormalizationWithTriggerInput) {
      database.transaction((transaction) => persist(transaction, input))
      project(input)
      return mapPersistedRun(database, input.runId)
    },
    getLatest(rawRecordId: string) {
      const run = database.select({ run: normalizationRuns }).from(normalizationRuns)
        .innerJoin(captureEvidenceVersions, eq(captureEvidenceVersions.id, normalizationRuns.captureEvidenceVersionId))
        .where(eq(normalizationRuns.captureLineageId, rawRecordId))
        .orderBy(
          desc(captureEvidenceVersions.revision),
          desc(normalizationRuns.createdAt),
          sql`${normalizationRuns}.rowid desc`,
        ).get()?.run
      return run ? mapResult(database, run) : null
    },
    getLatestForRevision(rawRevisionId: string) {
      const run = database.select().from(normalizationRuns)
        .where(eq(normalizationRuns.captureEvidenceVersionId, rawRevisionId))
        .orderBy(desc(normalizationRuns.updatedAt), sql`${normalizationRuns}.rowid desc`).get()
      return run ? mapResult(database, run) : null
    },
    listHistory(rawRecordId: string) {
      return database.select({ run: normalizationRuns }).from(normalizationRuns)
        .innerJoin(captureEvidenceVersions, eq(captureEvidenceVersions.id, normalizationRuns.captureEvidenceVersionId))
        .where(eq(normalizationRuns.captureLineageId, rawRecordId))
        .orderBy(
          desc(captureEvidenceVersions.revision),
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
    eq(normalizationAttempts.captureEvidenceVersionId, input.rawRevisionId),
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
    id: input.runId, captureLineageId: input.rawRecordId, captureEvidenceVersionId: input.rawRevisionId,
    triggerCaptureId: input.triggerOccurrence?.id ?? null,
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
      id: attempt.id, runId: input.runId, captureEvidenceVersionId: input.rawRevisionId, sequence: attemptSequence,
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
  if (input.candidate) transaction.insert(jobFactVersions).values({
    id: input.candidate.id, runId: input.runId, jobId: input.candidate.sourceEntityId,
    captureLineageId: input.rawRecordId, captureEvidenceVersionId: input.rawRevisionId, schemaVersion: input.canonicalSchemaVersion,
    jobFactVersionJson: JSON.stringify(input.candidate), createdAt: input.now,
  }).run()
  transaction.insert(normalizationGates).values({
    id: crypto.randomUUID(), runId: input.runId, policyVersion: input.gatePolicyVersion, status: input.gate.status,
    jobFactVersionId: input.candidate?.id ?? null, gateJson: JSON.stringify(input.gate), evaluatedAt: input.gate.evaluatedAt,
  }).run()
}

function synchronizeNormalizationRetryWork(
  transaction: Parameters<Parameters<DrizzleDatabase['transaction']>[0]>[0],
  input: PersistNormalizationWithTriggerInput,
  attempt: NormalizationAttempt,
) {
  if (input.acquiredRetryWork
    && !input.acquiredRetryWork.acquisitionRunId
    && !input.acquiredRetryWork.acquisitionToken) {
    throw new Error('Acquired normalization retry requires a run id or acquisition token')
  }
  const acquiredByIdentity = input.acquiredRetryWork
    ? transaction.select().from(retryWork).where(and(
        eq(retryWork.id, input.acquiredRetryWork.retryWorkId),
        eq(retryWork.kind, 'normalization'),
        eq(retryWork.state, 'acquired'),
        ...(input.acquiredRetryWork.acquisitionRunId
          ? [eq(retryWork.acquisitionRunId, input.acquiredRetryWork.acquisitionRunId)]
          : []),
        ...(input.acquiredRetryWork.acquisitionToken
          ? [eq(retryWork.acquisitionToken, input.acquiredRetryWork.acquisitionToken)]
          : []),
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
    eq(retryWork.captureEvidenceVersionId, input.rawRevisionId),
    eq(retryWork.resolverId, attempt.resolver.id),
    eq(retryWork.resolverVersion, attempt.resolver.version),
    eq(retryWork.inputHash, attempt.inputHash),
    isNull(retryWork.deletedAt),
  )).get()
  const priorLineage = existing ? parseRetryLineage(existing.lineageJson) : {}
  const failureFinalization = input.acquiredRetryWork?.failureFinalization
  if (input.acquiredRetryWork && !acquiredByIdentity) {
    throw new Error(
      'Acquired normalization retry identity does not match the persisted claim',
    )
  }
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
        state: failureFinalization?.terminal ? 'cancelled' : 'completed',
        nextAttemptAt: null,
        acquiredAt: null,
        acquisitionToken: null,
        acquisitionRunId: null,
        lineageJson: JSON.stringify({
          ...priorLineage,
          normalizationRunId: input.runId,
          acquiredRetryWorkId: input.acquiredRetryWork?.retryWorkId ?? priorLineage.acquiredRetryWorkId ?? null,
          acquisitionRunId: input.acquiredRetryWork?.acquisitionRunId ?? priorLineage.acquisitionRunId ?? null,
          acquisitionToken: input.acquiredRetryWork?.acquisitionToken ?? priorLineage.acquisitionToken ?? null,
          ...(failureFinalization
            ? { failureEvidence: failureFinalization.evidence }
            : {}),
        }),
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
  let executionScopeId = attempt.executionScopeId
  if (executionScopeId === null) {
    const revision = transaction.select().from(captureEvidenceVersions)
      .where(eq(captureEvidenceVersions.id, input.rawRevisionId)).get()
    if (!revision) throw new Error('Raw source revision not found for normalization retry scope')
    executionScopeId = deriveSourceExecutionScopeId(revision.captureLineageId)
    transaction.insert(sourceExecutionScopes).values({
      id: executionScopeId, status: 'available', blockedUntil: null,
      backoffAttempt: 0, authGeneration: 0, refreshLeaseToken: null,
      refreshLeaseExpiresAt: null, actionReason: null,
      createdAt: input.now, updatedAt: input.now, deletedAt: null,
    }).onConflictDoNothing().run()
  }
  const values = {
    executionScopeId,
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
      ...priorLineage,
      normalizationRunId: input.runId,
      triggerOccurrenceId: input.triggerOccurrence?.id ?? priorLineage.triggerOccurrenceId ?? null,
      connectorInstanceId: input.triggerOccurrence?.capture?.connectorInstanceId ?? priorLineage.connectorInstanceId ?? null,
      connectorRunId: input.triggerOccurrence?.capture?.connectorRunId ?? priorLineage.connectorRunId ?? null,
      acquiredRetryWorkId: input.acquiredRetryWork?.retryWorkId ?? null,
      acquisitionRunId: input.acquiredRetryWork?.acquisitionRunId ?? null,
      acquisitionToken: input.acquiredRetryWork?.acquisitionToken ?? priorLineage.acquisitionToken ?? null,
      ...(failureFinalization
        ? { failureEvidence: failureFinalization.evidence }
        : {}),
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
    captureEvidenceVersionId: input.rawRevisionId,
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

function parseRetryLineage(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
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
  input: Omit<typeof jobIdentityConflicts.$inferInsert, 'id' | 'provenanceVersion'>,
) {
  database.insert(jobIdentityConflicts).values({
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
  const attempts = attemptRows.map((row) => {
    const resolver = JSON.parse(row.declarationJson) as NormalizationAttempt['resolver']
    return { id: row.id, rawRevisionId: row.captureEvidenceVersionId, resolver, executionScopeId: resolver.scopeRequirement === 'source' ? runScopeId(database, run) : null, operationOutcome: null, inputHash: row.inputHash, status: row.status, applicability: JSON.parse(row.applicabilityJson), startedAt: row.startedAt, completedAt: row.completedAt, outcomes: outcomes.filter((outcome) => outcome.resolverId === row.resolverId && outcome.resolverVersion === row.resolverVersion) }
  }) as NormalizationAttempt[]
  const gateRow = database.select().from(normalizationGates).where(eq(normalizationGates.runId, run.id)).get()
  const candidateRow = database.select().from(jobFactVersions).where(eq(jobFactVersions.runId, run.id)).get()
  const triggerOccurrence = run.triggerCaptureId
    ? database.select().from(captures)
        .where(eq(captures.id, run.triggerCaptureId)).get()
    : null
  return {
    rawRecordId: run.captureLineageId,
    rawRevisionId: run.captureEvidenceVersionId,
    canonicalSchemaVersion: run.canonicalSchemaVersion,
    status: run.status,
    attempts,
    fieldOutcomes: outcomes,
    updatedAt: run.updatedAt,
    gate: gateRow ? JSON.parse(gateRow.gateJson) : null,
    canonicalCandidate: candidateRow ? JSON.parse(candidateRow.jobFactVersionJson) : null,
    triggerOccurrence: triggerOccurrence
      ? {
          id: triggerOccurrence.id,
          rawRecordId: triggerOccurrence.captureLineageId,
          rawRevisionId: triggerOccurrence.captureEvidenceVersionId,
          capture: triggerOccurrence.connectorInstanceId && triggerOccurrence.connectorRunId
            ? {
                connectorInstanceId: triggerOccurrence.connectorInstanceId,
                connectorRunId: triggerOccurrence.connectorRunId,
                executionScopeId: triggerOccurrence.executionScopeId ?? (() => { throw new Error('Trigger occurrence is missing execution scope identity') })(),
              }
            : null,
          observedAt: triggerOccurrence.observedAt,
          receivedAt: triggerOccurrence.receivedAt,
        }
      : null,
  } as PersistedRawSourceNormalizationResult
}

function runScopeId(database: DrizzleDatabase, run: typeof normalizationRuns.$inferSelect) {
  if (!run.triggerCaptureId) return null
  return database.select({ id: captures.executionScopeId }).from(captures)
    .where(eq(captures.id, run.triggerCaptureId)).get()?.id ?? null
}

function mapRevision(row: typeof captureEvidenceVersions.$inferSelect): RawSourceRevision {
  return {
    id: row.id, rawRecordId: row.captureLineageId, revision: row.revision, contentHash: row.contentHash,
    adapter: { id: row.adapterId, kind: row.adapterKind as RawSourceRevision['adapter']['kind'], version: row.adapterVersion },
    reportedOrigin: row.reportedOriginKind && row.reportedOriginName ? { kind: row.reportedOriginKind as NonNullable<RawSourceRevision['reportedOrigin']>['kind'], name: row.reportedOriginName, providerId: row.reportedOriginProviderId, url: row.reportedOriginUrl } : null,
    observedAt: row.observedAt, providerRecordId: row.providerRecordId, providerSchema: row.providerSchema,
    payload: row.payloadJson ? JSON.parse(row.payloadJson) : null, evidence: JSON.parse(row.evidenceJson), createdAt: row.createdAt,
  }
}
