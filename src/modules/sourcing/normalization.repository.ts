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
import { insertJobFactVersions, insertJobIdentities, insertJobIdentityConflicts, insertJobs } from '../job/job.repository'
import type { PgliteDatabase } from '../../db/pglite'
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
type PgliteTransaction = Parameters<Parameters<PgliteDatabase['transaction']>[0]>[0]

export function createPgliteNormalizationRepository(
  database: PgliteDatabase,
  options: {
    stagePassedCandidate?: (
      transaction: PgliteTransaction,
      input: { rawRecordId: string; rawRevisionId: string; canonicalCandidateId: string; now: string },
    ) => Promise<void> | void
    projectPassedCandidate?: (
      candidateId: string,
      rawRevisionId: string,
    ) => Promise<void> | void
  } = {},
) {
  const persist = async (
    transaction: PgliteTransaction,
    input: PersistNormalizationWithTriggerInput,
  ) => {
    const result = await persistNormalization(transaction, input)
    if (result.inserted && input.gate.status === 'passed' && input.candidate) {
      await options.stagePassedCandidate?.(transaction, {
        rawRecordId: input.rawRecordId,
        rawRevisionId: input.rawRevisionId,
        canonicalCandidateId: input.candidate.id,
        now: input.now,
      })
    }
    return result
  }
  const project = async (input: PersistNormalizationWithTriggerInput) => {
    if (input.gate.status === 'passed' && input.candidate) {
      await options.projectPassedCandidate?.(input.candidate.id, input.rawRevisionId)
    }
  }
  return {
    async getRawContext(rawRevisionId: string): Promise<NormalizationRawContext | null> {
      const [revision] = await database.select().from(captureEvidenceVersions)
        .where(eq(captureEvidenceVersions.id, rawRevisionId)).limit(1)
      if (!revision) return null
      const [record] = await database.select().from(captureLineages)
        .where(eq(captureLineages.id, revision.captureLineageId)).limit(1)
      if (!record) return null
      const [entity] = record.jobId
        ? await database.select().from(jobs).where(eq(jobs.id, record.jobId)).limit(1)
        : []
      return { revision: mapRevision(revision), sourceEntity: entity ?? null }
    },
    async findCached(rawRevisionId: string, inputHash: string, resolverSetHash: string, canonicalSchemaVersion: string, gatePolicyVersion: string) {
      const [run] = await database.select().from(normalizationRuns).where(and(
        eq(normalizationRuns.captureEvidenceVersionId, rawRevisionId), eq(normalizationRuns.inputHash, inputHash),
        eq(normalizationRuns.resolverSetHash, resolverSetHash), eq(normalizationRuns.canonicalSchemaVersion, canonicalSchemaVersion),
        eq(normalizationRuns.gatePolicyVersion, gatePolicyVersion),
        eq(normalizationRuns.triggerKind, 'intake'),
        isNull(normalizationRuns.triggerId),
      )).limit(1)
      return run && ['completed','failed','blocked'].includes(run.status)
        ? await mapResult(database, run)
        : null
    },
    async persistWithStrongDestination(input: {
      sourceEntity: NormalizationRawContext['sourceEntity']
      rawRevisionId: string
      destination: NonNullable<CanonicalSourceCandidate['destination']>
      destinationOutcome: Extract<FieldResolutionOutcome, { status: 'resolved' | 'locked' }>
      createdAt: string
      materialize: (reconciliation: StrongDestinationReconciliation) => PersistNormalizationWithTriggerInput
    }) {
      const persistedInput = await database.transaction(async (transaction) => {
        const persistReconciliation = async (reconciliation: StrongDestinationReconciliation) => {
          const persistence = input.materialize(reconciliation)
          const result = await persist(transaction, persistence)
          return { persistence, ...result }
        }
        const canonical = {
          kind: 'canonical_destination' as const,
          namespace: DESTINATION_TAXONOMY_VERSION,
          value: input.destination.url,
        }
        const [targetIdentity] = await transaction.select().from(jobIdentities).where(and(
          eq(jobIdentities.identityKind, canonical.kind),
          eq(jobIdentities.identityNamespace, canonical.namespace),
          eq(jobIdentities.identityValue, canonical.value),
        )).limit(1)
        const [destinationOwner] = targetIdentity ? [] : await transaction.select().from(jobs).where(and(
          eq(jobs.identityKind, 'destination_url'),
          eq(jobs.identityNamespace, canonical.namespace),
          eq(jobs.identityValue, canonical.value),
        )).limit(1)
        const priorOwners = input.sourceEntity
          ? (await transaction.selectDistinct({ sourceEntityId: jobFactVersions.jobId })
              .from(jobFactVersions)
              .innerJoin(captureLineages, eq(captureLineages.id, jobFactVersions.captureLineageId))
              .where(eq(captureLineages.jobId, input.sourceEntity.id)))
              .map(({ sourceEntityId }) => sourceEntityId)
          : []
        const currentCanonical = input.sourceEntity
          ? await transaction.select().from(jobIdentities).where(and(
              eq(jobIdentities.jobId, input.sourceEntity.id),
              eq(jobIdentities.identityKind, canonical.kind),
            ))
          : []
        let targetOwnerId = targetIdentity?.jobId ?? destinationOwner?.id ?? input.sourceEntity?.id ?? crypto.randomUUID()
        const conflictingOwner = priorOwners.find((ownerId) => ownerId !== targetOwnerId)
        const conflictingIdentity = currentCanonical.find(({ identityNamespace, identityValue }) =>
          identityNamespace !== canonical.namespace || identityValue !== canonical.value)

        if (input.sourceEntity && (conflictingOwner || conflictingIdentity)) {
          await recordIdentityConflict(transaction, {
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
          return await persistReconciliation({ sourceEntity: input.sourceEntity, conflict: true })
        }

        let [owner] = await transaction.select().from(jobs).where(eq(jobs.id, targetOwnerId)).limit(1)
        if (!owner) {
          owner = {
            id: targetOwnerId,
            identityKind: 'destination_url',
            identityNamespace: DESTINATION_TAXONOMY_VERSION,
            identityValue: canonical.value,
            createdAt: input.createdAt,
          }
          const [insertedOwner] = await insertJobs(transaction).values(owner)
            .onConflictDoNothing().returning()
          if (!insertedOwner) {
            [owner] = await transaction.select().from(jobs).where(eq(jobs.id, targetOwnerId)).limit(1)
            if (!owner) {
              [owner] = await transaction.select().from(jobs).where(and(
                eq(jobs.identityKind, 'destination_url'),
                eq(jobs.identityNamespace, DESTINATION_TAXONOMY_VERSION),
                eq(jobs.identityValue, canonical.value),
              )).limit(1)
              if (owner) targetOwnerId = owner.id
            }
            if (!owner) throw new Error('Strong destination owner was not persisted')
          }
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
        const preflight: Array<{
          identity: (typeof identities)[number]
          existing: typeof jobIdentities.$inferSelect | undefined
        }> = []
        for (const identity of identities) {
          const [existing] = await transaction.select().from(jobIdentities).where(and(
            eq(jobIdentities.identityKind, identity.kind),
            eq(jobIdentities.identityNamespace, identity.namespace),
            eq(jobIdentities.identityValue, identity.value),
          )).limit(1)
          preflight.push({ identity, existing })
        }
        const ownershipCollisions = preflight.filter(({ existing }) =>
          existing && existing.jobId !== targetOwnerId)
        if (ownershipCollisions.length > 0) {
          for (const { identity, existing } of ownershipCollisions) {
            await recordIdentityConflict(transaction, {
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
          return await persistReconciliation({ sourceEntity: input.sourceEntity ?? owner, conflict: true })
        }
        const newIdentities = preflight.filter(({ existing }) => !existing)
        const [countRow] = await transaction.select({ count: sql<number>`count(*)` }).from(jobIdentities)
          .where(eq(jobIdentities.jobId, targetOwnerId))
        const currentCount = Number(countRow?.count ?? 0)
        if (currentCount + newIdentities.length > MAX_IDENTITIES_PER_SOURCE_ENTITY) {
          const overflowIdentity = newIdentities[0]?.identity ?? canonical
          await recordIdentityConflict(transaction, {
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
          return await persistReconciliation({ sourceEntity: input.sourceEntity ?? owner, conflict: true })
        }

        for (const { identity } of newIdentities) {
          const [insertedIdentity] = await insertJobIdentities(transaction).values({
            id: crypto.randomUUID(), jobId: owner.id,
            identityKind: identity.kind, identityNamespace: identity.namespace, identityValue: identity.value,
            provenanceKind: 'normalization', provenanceVersion: SOURCE_IDENTITY_RECONCILIATION_VERSION,
            evidenceJson: identityEvidence(input),
            captureEvidenceVersionId: input.rawRevisionId, createdAt: input.createdAt,
          }).onConflictDoNothing().returning()
          if (!insertedIdentity) {
            const [winner] = await transaction.select().from(jobIdentities).where(and(
              eq(jobIdentities.identityKind, identity.kind),
              eq(jobIdentities.identityNamespace, identity.namespace),
              eq(jobIdentities.identityValue, identity.value),
            )).limit(1)
            if (!winner || winner.jobId !== owner.id) {
              await recordIdentityConflict(transaction, {
                jobId: input.sourceEntity?.id ?? owner.id,
                conflictingJobId: winner?.jobId ?? null,
                captureEvidenceVersionId: input.rawRevisionId,
                identityKind: identity.kind,
                identityNamespace: identity.namespace,
                identityValue: identity.value,
                reason: 'Strong identity is already owned by another source entity',
                evidenceJson: identityEvidence(input),
                createdAt: input.createdAt,
              })
              return await persistReconciliation({
                sourceEntity: input.sourceEntity ?? owner,
                conflict: true,
              })
            }
          }
        }
        return await persistReconciliation({ sourceEntity: owner, conflict: false })
      })
      if (persistedInput.inserted) await project(persistedInput.persistence)
      return await mapPersistedRun(database, persistedInput.runId)
    },
    async persist(input: PersistNormalizationWithTriggerInput) {
      const result = await database.transaction(async (transaction) => await persist(transaction, input))
      if (result.inserted) await project(input)
      return await mapPersistedRun(database, result.runId)
    },
    async getLatest(rawRecordId: string) {
      const [selected] = await database.select({ run: normalizationRuns }).from(normalizationRuns)
        .innerJoin(captureEvidenceVersions, eq(captureEvidenceVersions.id, normalizationRuns.captureEvidenceVersionId))
        .where(eq(normalizationRuns.captureLineageId, rawRecordId))
        .orderBy(
          desc(captureEvidenceVersions.revision),
          desc(normalizationRuns.createdAt),
          desc(normalizationRuns.updatedAt),
          desc(normalizationRuns.id),
        ).limit(1)
      return selected?.run ? await mapResult(database, selected.run) : null
    },
    async getLatestForRevision(rawRevisionId: string) {
      const [run] = await database.select().from(normalizationRuns)
        .where(eq(normalizationRuns.captureEvidenceVersionId, rawRevisionId))
        .orderBy(desc(normalizationRuns.updatedAt), desc(normalizationRuns.createdAt), desc(normalizationRuns.id))
        .limit(1)
      return run ? await mapResult(database, run) : null
    },
    async listHistory(rawRecordId: string) {
      const rows = await database.select({ run: normalizationRuns }).from(normalizationRuns)
        .innerJoin(captureEvidenceVersions, eq(captureEvidenceVersions.id, normalizationRuns.captureEvidenceVersionId))
        .where(eq(normalizationRuns.captureLineageId, rawRecordId))
        .orderBy(
          desc(captureEvidenceVersions.revision),
          desc(normalizationRuns.createdAt),
          desc(normalizationRuns.updatedAt),
          desc(normalizationRuns.id),
        )
      const history: PersistedRawSourceNormalizationResult[] = []
      for (const { run } of rows) history.push(await mapResult(database, run))
      return history
    },
    async hasExactSuccessfulNormalizationAttempt(input: {
      inputHash: string
      rawRevisionId: string
      resolverId: string
      resolverVersion: string
      retryWindowStartedAt: string
    }): Promise<boolean> {
      return await hasPersistedExactSuccessfulNormalizationAttempt(database, input)
    },
  }
}

export async function hasPersistedExactSuccessfulNormalizationAttempt(
  database: Pick<PgliteDatabase, 'select'>,
  input: {
    inputHash: string
    rawRevisionId: string
    resolverId: string
    resolverVersion: string
    retryWindowStartedAt: string
  },
): Promise<boolean> {
  const attempts = await database.select().from(normalizationAttempts).where(and(
    eq(normalizationAttempts.captureEvidenceVersionId, input.rawRevisionId),
    eq(normalizationAttempts.resolverId, input.resolverId),
    eq(normalizationAttempts.resolverVersion, input.resolverVersion),
    eq(normalizationAttempts.inputHash, input.inputHash),
    eq(normalizationAttempts.status, 'completed'),
  )).orderBy(
    desc(normalizationAttempts.completedAt),
    desc(normalizationAttempts.startedAt),
    desc(normalizationAttempts.sequence),
    desc(normalizationAttempts.id),
  )
  for (const attempt of attempts) {
    const attemptAt = attempt.completedAt ?? attempt.startedAt
    if (attemptAt <= input.retryWindowStartedAt) continue
    const destination = (await database.select().from(normalizationFieldOutcomes).where(and(
      eq(normalizationFieldOutcomes.attemptId, attempt.id),
      eq(normalizationFieldOutcomes.field, 'destinationUrl'),
    )).orderBy(
      asc(normalizationFieldOutcomes.outcomeIndex),
      asc(normalizationFieldOutcomes.sequence),
      asc(normalizationFieldOutcomes.id),
    )).find((outcome) => outcome.status === 'resolved' || outcome.status === 'locked')
    if (destination) return true
  }
  return false
}

async function persistNormalization(
  transaction: PgliteTransaction,
  input: PersistNormalizationWithTriggerInput,
) {
  const [insertedRun] = await transaction.insert(normalizationRuns).values({
    id: input.runId, captureLineageId: input.rawRecordId, captureEvidenceVersionId: input.rawRevisionId,
    triggerCaptureId: input.triggerOccurrence?.id ?? null,
    triggerConnectorInstanceId: input.triggerOccurrence?.capture?.connectorInstanceId ?? null,
    triggerConnectorRunId: input.triggerOccurrence?.capture?.connectorRunId ?? null,
    inputHash: input.inputHash, resolverSetHash: input.resolverSetHash,
    canonicalSchemaVersion: input.canonicalSchemaVersion, gatePolicyVersion: input.gatePolicyVersion,
    triggerKind: 'intake', triggerId: input.triggerId ?? null, status: input.status,
    createdAt: input.now, updatedAt: input.now,
  }).onConflictDoNothing().returning()
  if (!insertedRun) {
    const [existingRun] = await transaction.select().from(normalizationRuns)
      .where(eq(normalizationRuns.id, input.runId)).limit(1)
    if (existingRun && isSameNormalizationRun(existingRun, input)) {
      return { inserted: false, runId: existingRun.id }
    }
    const [cachedRun] = input.triggerId === undefined
      ? await transaction.select().from(normalizationRuns).where(and(
          eq(normalizationRuns.captureEvidenceVersionId, input.rawRevisionId),
          eq(normalizationRuns.inputHash, input.inputHash),
          eq(normalizationRuns.resolverSetHash, input.resolverSetHash),
          eq(normalizationRuns.canonicalSchemaVersion, input.canonicalSchemaVersion),
          eq(normalizationRuns.gatePolicyVersion, input.gatePolicyVersion),
          isNull(normalizationRuns.triggerId),
        )).limit(1)
      : []
    if (cachedRun && isSameNormalizationRun(cachedRun, input)) {
      return { inserted: false, runId: cachedRun.id }
    }
    throw new Error('Normalization persistence conflicts with an existing cache or run identity')
  }
  let outcomeSequence = 0
  for (const [attemptSequence, attempt] of input.attempts.entries()) {
    await transaction.insert(normalizationAttempts).values({
      id: attempt.id, runId: input.runId, captureEvidenceVersionId: input.rawRevisionId, sequence: attemptSequence,
      resolverId: attempt.resolver.id, resolverVersion: attempt.resolver.version, inputHash: attempt.inputHash,
      declarationJson: JSON.stringify(attempt.resolver), applicabilityJson: JSON.stringify(attempt.applicability ?? []),
      status: attempt.status, startedAt: attempt.startedAt, completedAt: attempt.completedAt,
    })
    for (const [outcomeIndex, outcome] of attempt.outcomes.entries()) {
      await transaction.insert(normalizationFieldOutcomes).values({
        id: crypto.randomUUID(), runId: input.runId, attemptId: attempt.id, sequence: outcomeSequence++,
        attemptSequence, outcomeIndex, field: outcome.field, status: outcome.status,
        resolverId: outcome.resolverId, resolverVersion: outcome.resolverVersion, inputHash: outcome.inputHash,
        outcomeJson: JSON.stringify(outcome),
      })
    }
    await synchronizeNormalizationRetryWork(transaction, input, attempt)
  }
  if (input.candidate) await insertJobFactVersions(transaction).values({
    id: input.candidate.id, runId: input.runId, jobId: input.candidate.sourceEntityId,
    captureLineageId: input.rawRecordId, captureEvidenceVersionId: input.rawRevisionId, schemaVersion: input.canonicalSchemaVersion,
    jobFactVersionJson: JSON.stringify(input.candidate), createdAt: input.now,
  })
  await transaction.insert(normalizationGates).values({
    id: crypto.randomUUID(), runId: input.runId, policyVersion: input.gatePolicyVersion, status: input.gate.status,
    jobFactVersionId: input.candidate?.id ?? null, gateJson: JSON.stringify(input.gate), evaluatedAt: input.gate.evaluatedAt,
  })
  return { inserted: true, runId: insertedRun.id }
}

async function synchronizeNormalizationRetryWork(
  transaction: PgliteTransaction,
  input: PersistNormalizationWithTriggerInput,
  attempt: NormalizationAttempt,
) {
  if (input.acquiredRetryWork
    && !input.acquiredRetryWork.acquisitionRunId
    && !input.acquiredRetryWork.acquisitionToken) {
    throw new Error('Acquired normalization retry requires a run id or acquisition token')
  }
  const [acquiredByIdentity] = input.acquiredRetryWork
    ? await transaction.select().from(retryWork).where(and(
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
      )).limit(1)
    : []
  const executingConnectorRunId = input.triggerOccurrence?.capture?.connectorRunId
  const [acquiredByCaptureRun] = !acquiredByIdentity && executingConnectorRunId
    ? await transaction.select().from(retryWork).where(and(
        eq(retryWork.kind, 'normalization'),
        eq(retryWork.state, 'acquired'),
        eq(retryWork.acquisitionRunId, executingConnectorRunId),
        eq(retryWork.resolverId, attempt.resolver.id),
        eq(retryWork.resolverVersion, attempt.resolver.version),
        isNull(retryWork.deletedAt),
      )).limit(1)
    : []
  const [existing] = await transaction.select().from(retryWork).where(and(
    eq(retryWork.kind, 'normalization'),
    eq(retryWork.captureEvidenceVersionId, input.rawRevisionId),
    eq(retryWork.resolverId, attempt.resolver.id),
    eq(retryWork.resolverVersion, attempt.resolver.version),
    eq(retryWork.inputHash, attempt.inputHash),
    isNull(retryWork.deletedAt),
  )).limit(1)
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
    await transaction.update(retryWork).set({
      state: 'completed',
      nextAttemptAt: null,
      acquiredAt: null,
      acquisitionToken: null,
      acquisitionRunId: null,
      updatedAt: input.now,
    }).where(eq(retryWork.id, acquiredByCaptureRun.id))
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
      await transaction.update(retryWork).set({
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
      }).where(eq(retryWork.id, existing.id))
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
    const [revision] = await transaction.select().from(captureEvidenceVersions)
      .where(eq(captureEvidenceVersions.id, input.rawRevisionId)).limit(1)
    if (!revision) throw new Error('Raw source revision not found for normalization retry scope')
    executionScopeId = deriveSourceExecutionScopeId(revision.captureLineageId)
    await transaction.insert(sourceExecutionScopes).values({
      id: executionScopeId, status: 'available', blockedUntil: null,
      backoffAttempt: 0, authGeneration: 0, refreshLeaseToken: null,
      refreshLeaseExpiresAt: null, actionReason: null,
      createdAt: input.now, updatedAt: input.now, deletedAt: null,
    }).onConflictDoNothing()
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
    await transaction.update(retryWork).set(values).where(eq(retryWork.id, existing.id))
    return
  }
  const [insertedRetry] = await transaction.insert(retryWork).values({
    id: crypto.randomUUID(), kind: 'normalization', connectorInstanceId: null,
    filterSignature: null, checkpointSchemaVersion: null, checkpointGeneration: null,
    captureEvidenceVersionId: input.rawRevisionId,
    resolverId: attempt.resolver.id,
    resolverVersion: attempt.resolver.version,
    inputHash: attempt.inputHash,
    ...values,
    createdAt: input.now,
    deletedAt: null,
  }).onConflictDoNothing().returning()
  if (!insertedRetry) {
    const [winner] = await transaction.select().from(retryWork).where(and(
      eq(retryWork.kind, 'normalization'),
      eq(retryWork.captureEvidenceVersionId, input.rawRevisionId),
      eq(retryWork.resolverId, attempt.resolver.id),
      eq(retryWork.resolverVersion, attempt.resolver.version),
      eq(retryWork.inputHash, attempt.inputHash),
      isNull(retryWork.deletedAt),
    )).limit(1)
    if (!winner || winner.executionScopeId !== executionScopeId) {
      throw new Error('Normalization retry conflicts with an existing execution scope owner')
    }
  }
}

async function mapPersistedRun(database: PgliteDatabase, runId: string) {
  const [run] = await database.select().from(normalizationRuns).where(eq(normalizationRuns.id, runId)).limit(1)
  if (!run) throw new Error('Normalization run was not persisted')
  return await mapResult(database, run)
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

function isSameNormalizationRun(
  run: typeof normalizationRuns.$inferSelect,
  input: PersistNormalizationWithTriggerInput,
) {
  return run.captureLineageId === input.rawRecordId
    && run.captureEvidenceVersionId === input.rawRevisionId
    && run.inputHash === input.inputHash
    && run.resolverSetHash === input.resolverSetHash
    && run.canonicalSchemaVersion === input.canonicalSchemaVersion
    && run.gatePolicyVersion === input.gatePolicyVersion
    && run.triggerId === (input.triggerId ?? null)
    && run.status === input.status
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

async function recordIdentityConflict(
  database: PgliteTransaction,
  input: Omit<typeof jobIdentityConflicts.$inferInsert, 'id' | 'provenanceVersion'>,
) {
  await insertJobIdentityConflicts(database).values({
    id: crypto.randomUUID(),
    ...input,
    provenanceVersion: SOURCE_IDENTITY_RECONCILIATION_VERSION,
  }).onConflictDoNothing()
}

async function mapResult(
  database: PgliteDatabase,
  run: typeof normalizationRuns.$inferSelect,
): Promise<PersistedRawSourceNormalizationResult> {
  const attemptRows = await database.select().from(normalizationAttempts)
    .where(eq(normalizationAttempts.runId, run.id))
    .orderBy(asc(normalizationAttempts.sequence), asc(normalizationAttempts.id))
  const outcomeRows = await database.select().from(normalizationFieldOutcomes)
    .where(eq(normalizationFieldOutcomes.runId, run.id))
    .orderBy(asc(normalizationFieldOutcomes.sequence), asc(normalizationFieldOutcomes.id))
  const outcomes = outcomeRows.map((row) => JSON.parse(row.outcomeJson) as FieldResolutionOutcome)
  const runScope = await runScopeId(database, run)
  const attempts = attemptRows.map((row) => {
    const resolver = JSON.parse(row.declarationJson) as NormalizationAttempt['resolver']
    return { id: row.id, rawRevisionId: row.captureEvidenceVersionId, resolver, executionScopeId: resolver.scopeRequirement === 'source' ? runScope : null, operationOutcome: null, inputHash: row.inputHash, status: row.status, applicability: JSON.parse(row.applicabilityJson), startedAt: row.startedAt, completedAt: row.completedAt, outcomes: outcomes.filter((outcome) => outcome.resolverId === row.resolverId && outcome.resolverVersion === row.resolverVersion) }
  }) as NormalizationAttempt[]
  const [gateRow] = await database.select().from(normalizationGates)
    .where(eq(normalizationGates.runId, run.id)).limit(1)
  const [candidateRow] = await database.select().from(jobFactVersions)
    .where(eq(jobFactVersions.runId, run.id)).limit(1)
  const [triggerOccurrence] = run.triggerCaptureId
    ? await database.select().from(captures)
        .where(eq(captures.id, run.triggerCaptureId)).limit(1)
    : []
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

async function runScopeId(database: PgliteDatabase, run: typeof normalizationRuns.$inferSelect) {
  if (!run.triggerCaptureId) return null
  const [capture] = await database.select({ id: captures.executionScopeId }).from(captures)
    .where(eq(captures.id, run.triggerCaptureId)).limit(1)
  return capture?.id ?? null
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
