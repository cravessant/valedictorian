import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import type { CanonicalSourceCandidate, NormalizationAttempt } from 'sparxie'
import { describe, expect, it } from 'vitest'
import {
  captureEvidenceVersions,
  captureLineages,
  captures,
  connectorInstances,
  connectorRuns,
  jobFactVersions,
  jobIdentities,
  jobIdentityConflicts,
  jobs,
  normalizationAttempts,
  normalizationFieldOutcomes,
  normalizationGates,
  normalizationRuns,
  retryWork,
  sourceExecutionScopes,
} from '../../db/schema'
import {
  createPgliteClient,
  migratePgliteDatabase,
  type PgliteDatabase,
} from '../../db/pglite'
import { createPgliteTestOwner } from '../../test/pglite-test-owner'
import {
  createPgliteNormalizationRepository,
  type PersistNormalizationInput,
} from './normalization.repository'
import { DESTINATION_TAXONOMY_VERSION } from './destination-classifier'

const NOW = '2026-07-11T12:00:00.000Z'
const RAW_RECORD_ID = 'raw-record-retry-identity'
const RAW_REVISION_ID = 'raw-revision-retry-identity'
const EXECUTION_SCOPE_ID = 'source.scope-replay'
const RESOLVER_ID = 'fixture.retry'
const RESOLVER_VERSION = '1.0.0'
const ATTEMPT_INPUT_HASH = 'sha256:retry-attempt-input'

async function seedRawRevision(
  database: PgliteDatabase,
  input: { jobId?: string; withScope?: boolean } = {},
) {
  if (input.jobId) {
    await database.insert(jobs).values({
      id: input.jobId,
      identityKind: 'destination_url',
      identityNamespace: 'fixture',
      identityValue: 'https://jobs.example.test/retry',
      createdAt: NOW,
    })
  }
  await database.insert(captureLineages).values({
    id: RAW_RECORD_ID,
    jobId: input.jobId ?? null,
    createdAt: NOW,
  })
  await database.insert(captureEvidenceVersions).values({
    id: RAW_REVISION_ID,
    captureLineageId: RAW_RECORD_ID,
    revision: 1,
    contentHash: 'sha256:retry-content',
    adapterId: 'fixture.connector',
    adapterKind: 'connector',
    adapterVersion: '1.0.0',
    providerRecordId: 'retry-job',
    payloadJson: JSON.stringify({ roleTitle: 'Intern' }),
    evidenceJson: '[]',
    observedAt: NOW,
    createdAt: NOW,
  })
  if (input.withScope) {
    await database.insert(sourceExecutionScopes).values({
      id: EXECUTION_SCOPE_ID,
      status: 'available',
      blockedUntil: null,
      backoffAttempt: 0,
      authGeneration: 0,
      refreshLeaseToken: null,
      refreshLeaseExpiresAt: null,
      actionReason: null,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    })
    await database.insert(connectorInstances).values({
      id: 'scope-replay',
      executionScopeId: EXECUTION_SCOPE_ID,
      connectorId: 'fixture.connector',
      connectorVersion: '1.0.0',
      displayName: 'Scope replay',
      enabled: true,
      configJson: '{}',
      authJson: '[]',
      filtersJson: '{}',
      earliestBackfillDate: null,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    })
    await database.insert(connectorRuns).values({
      id: 'connector-run-intake',
      executionScopeId: EXECUTION_SCOPE_ID,
      connectorInstanceId: 'scope-replay',
      mode: 'manual',
      status: 'completed',
      startedAt: NOW,
      completedAt: '2026-07-11T12:00:30.000Z',
      coverageStartedAt: null,
      coverageEndedAt: null,
      configJson: '{}',
      filtersJson: '{}',
      filterSignature: 'filters:{}',
      observationCount: 1,
      warningCount: 0,
      statsJson: '{}',
      warningsJson: '[]',
      retryHintsJson: '[]',
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    })
    await database.insert(captures).values({
      id: 'capture-scope-replay',
      captureLineageId: RAW_RECORD_ID,
      captureEvidenceVersionId: RAW_REVISION_ID,
      connectorInstanceId: 'scope-replay',
      connectorRunId: 'connector-run-intake',
      executionScopeId: EXECUTION_SCOPE_ID,
      observedAt: NOW,
      receivedAt: NOW,
    })
  }
}

function retryAttempt(attempt: number): NormalizationAttempt {
  const at = `2026-07-11T12:0${attempt}:00.000Z`
  return {
    id: `attempt-retry-${attempt}`,
    rawRevisionId: RAW_REVISION_ID,
    resolver: {
      id: RESOLVER_ID,
      version: RESOLVER_VERSION,
      requiredInputs: ['rawRevision'],
      outputFields: ['destinationUrl'],
      capabilities: ['network'],
      scopeRequirement: 'source',
      costClass: 'high',
      precedence: 1,
    },
    executionScopeId: EXECUTION_SCOPE_ID,
    operationOutcome: null,
    inputHash: ATTEMPT_INPUT_HASH,
    status: 'retry',
    applicability: [],
    startedAt: at,
    completedAt: at,
    outcomes: [{
      resolverId: RESOLVER_ID,
      resolverVersion: RESOLVER_VERSION,
      field: 'destinationUrl',
      inputHash: ATTEMPT_INPUT_HASH,
      status: 'retry',
      retry: {
        state: 'scheduled',
        reason: 'server_failure',
        attempt,
        maxAttempts: 4,
        lastAttemptAt: at,
        computedDelayMs: 1_000,
        nextAttemptAt: at.replace(':00.000Z', ':01.000Z'),
        horizonAt: '2026-07-11T13:00:00.000Z',
      },
    }],
  }
}

function persistenceInput(
  runId: string,
  attempt: NormalizationAttempt,
  overrides: Partial<PersistNormalizationInput> = {},
): PersistNormalizationInput {
  return {
    runId,
    rawRecordId: RAW_RECORD_ID,
    rawRevisionId: RAW_REVISION_ID,
    inputHash: `sha256:${runId}`,
    resolverSetHash: 'sha256:resolver-set',
    canonicalSchemaVersion: 'canonical-candidate@1',
    gatePolicyVersion: 'normalization-gate@1',
    status: 'completed',
    attempts: [attempt],
    candidate: null,
    gate: {
      status: 'needs_enrichment',
      policyVersion: 'normalization-gate@1',
      evaluatedAt: attempt.completedAt ?? attempt.startedAt,
      requiredFields: ['destinationUrl'],
      missingFields: ['destinationUrl'],
      conflictingFields: [],
      candidate: null,
      reason: 'incomplete',
    },
    now: attempt.completedAt ?? attempt.startedAt,
    ...overrides,
  }
}

describe('normalization repository acquired retry identity', () => {
  it('preserves the original execution scope through consecutive retryable direct replays', async () => {
    const { client, database } = await createPgliteTestOwner()
    try {
      await seedRawRevision(database, { withScope: true })
      const repository = createPgliteNormalizationRepository(database)

      await repository.persist({
        ...persistenceInput('normalization-run-retry-1', retryAttempt(1)),
        triggerOccurrence: {
          id: 'capture-scope-replay',
          rawRecordId: RAW_RECORD_ID,
          rawRevisionId: RAW_REVISION_ID,
          capture: {
            connectorInstanceId: 'scope-replay',
            connectorRunId: 'connector-run-intake',
            executionScopeId: EXECUTION_SCOPE_ID,
          },
          observedAt: NOW,
          receivedAt: NOW,
        },
      })

      for (const attempt of [2, 3]) {
        const [scheduled] = await database.select().from(retryWork)
        expect(scheduled).toMatchObject({
          attempt: attempt - 1,
          executionScopeId: EXECUTION_SCOPE_ID,
          state: 'scheduled',
        })
        expect(JSON.parse(scheduled!.lineageJson)).toMatchObject({
          connectorInstanceId: 'scope-replay',
          connectorRunId: 'connector-run-intake',
        })

        const acquisitionToken = `acquisition-token-${attempt}`
        await database.update(retryWork).set({
          state: 'acquired',
          acquiredAt: `2026-07-11T12:0${attempt}:00.000Z`,
          acquisitionToken,
          acquisitionRunId: null,
        }).where(eq(retryWork.id, scheduled!.id))

        await repository.persist({
          ...persistenceInput(`normalization-run-retry-${attempt}`, retryAttempt(attempt)),
          acquiredRetryWork: {
            retryWorkId: scheduled!.id,
            acquisitionToken,
            executionScopeId: EXECUTION_SCOPE_ID,
          },
        })
      }

      const [work] = await database.select().from(retryWork)
      expect(work).toMatchObject({
        attempt: 3,
        executionScopeId: EXECUTION_SCOPE_ID,
        state: 'scheduled',
      })
      expect(JSON.parse(work!.lineageJson)).toMatchObject({
        acquiredRetryWorkId: work!.id,
        acquisitionToken: 'acquisition-token-3',
        connectorInstanceId: 'scope-replay',
      })
      await expect(database.select({ status: sourceExecutionScopes.status })
        .from(sourceExecutionScopes)
        .where(eq(sourceExecutionScopes.id, EXECUTION_SCOPE_ID)))
        .resolves.toEqual([{ status: 'available' }])
    } finally {
      await client.close()
    }
  })

  it('rejects exact acquired replay when persisted attempt input hash does not match acquired work', async () => {
    const { client, database } = await createPgliteTestOwner()
    try {
      await seedRawRevision(database, { withScope: true })
      const repository = createPgliteNormalizationRepository(database)
      await database.insert(retryWork).values({
        id: 'retry-work-hash-mismatch',
        executionScopeId: EXECUTION_SCOPE_ID,
        kind: 'normalization',
        connectorInstanceId: null,
        filterSignature: null,
        checkpointSchemaVersion: null,
        checkpointGeneration: null,
        captureEvidenceVersionId: RAW_REVISION_ID,
        resolverId: RESOLVER_ID,
        resolverVersion: RESOLVER_VERSION,
        inputHash: 'sha256:acquired-input-hash',
        reason: 'server_failure',
        attempt: 1,
        maxAttempts: 3,
        lastAttemptAt: NOW,
        computedDelayMs: 30_000,
        serverMinimumDelayMs: null,
        nextAttemptAt: '2026-07-11T12:00:30.000Z',
        horizonAt: '2026-07-11T13:00:00.000Z',
        state: 'acquired',
        ownerVersion: RESOLVER_VERSION,
        lineageJson: JSON.stringify({ connectorInstanceId: 'scope-replay' }),
        acquiredAt: '2026-07-11T12:00:30.000Z',
        acquisitionToken: 'token-hash-mismatch',
        acquisitionRunId: null,
        skippedRunId: null,
        createdAt: NOW,
        updatedAt: '2026-07-11T12:00:30.000Z',
        deletedAt: null,
      })

      const mismatchedAttempt = {
        ...retryAttempt(2),
        id: 'attempt-hash-mismatch',
        inputHash: 'sha256:mismatched-attempt-hash',
        outcomes: retryAttempt(2).outcomes.map((outcome) => ({
          ...outcome,
          inputHash: 'sha256:mismatched-attempt-hash',
        })),
      }
      await expect(repository.persist({
        ...persistenceInput('normalization-run-hash-mismatch', mismatchedAttempt),
        acquiredRetryWork: {
          retryWorkId: 'retry-work-hash-mismatch',
          acquisitionToken: 'token-hash-mismatch',
          executionScopeId: EXECUTION_SCOPE_ID,
        },
      })).rejects.toThrow(/acquired normalization retry identity/i)

      await expect(database.select().from(normalizationRuns)).resolves.toEqual([])
      await expect(database.select().from(retryWork)).resolves.toEqual([
        expect.objectContaining({
          id: 'retry-work-hash-mismatch',
          state: 'acquired',
          inputHash: 'sha256:acquired-input-hash',
          acquisitionToken: 'token-hash-mismatch',
          nextAttemptAt: '2026-07-11T12:00:30.000Z',
        }),
      ])
    } finally {
      await client.close()
    }
  })

  it('converges strong destination identity ownership and records a conflicting owner without reassignment', async () => {
    const { client, database } = await createPgliteTestOwner()
    try {
      const sourceJobId = 'job-source-identity'
      await seedRawRevision(database, { jobId: sourceJobId })
      const repository = createPgliteNormalizationRepository(database)
      const sourceEntity = {
        id: sourceJobId,
        identityKind: 'destination_url',
        identityNamespace: 'fixture',
        identityValue: 'https://jobs.example.test/retry',
        createdAt: NOW,
      }
      const destination = {
        class: 'direct_employer' as const,
        url: 'https://jobs.example.test/strong-owner',
      }
      const destinationOutcome = {
        resolverId: RESOLVER_ID,
        resolverVersion: RESOLVER_VERSION,
        field: 'destinationUrl' as const,
        inputHash: ATTEMPT_INPUT_HASH,
        status: 'resolved' as const,
        value: destination.url,
      }
      const strongInput = (runId: string) => ({
        sourceEntity,
        rawRevisionId: RAW_REVISION_ID,
        destination,
        destinationOutcome,
        createdAt: NOW,
        materialize: () => ({
          ...persistenceInput(runId, retryAttempt(1), { attempts: [] }),
          inputHash: 'sha256:strong-owner-cache',
        }),
      })

      const converged = await Promise.all([
        repository.persistWithStrongDestination(strongInput('normalization-strong-owner-a')),
        repository.persistWithStrongDestination(strongInput('normalization-strong-owner-b')),
      ])
      expect(converged[1]).toEqual(converged[0])
      const reconciledIdentities = await database.select().from(jobIdentities)
      expect(reconciledIdentities).toHaveLength(2)
      expect(reconciledIdentities).toEqual(expect.arrayContaining([
        expect.objectContaining({ jobId: sourceJobId, identityKind: 'canonical_destination' }),
        expect.objectContaining({ jobId: sourceJobId, identityKind: 'destination_alias' }),
      ]))

      const conflictingJobId = 'job-conflicting-owner'
      const conflictingUrl = 'https://jobs.example.test/conflicting-owner'
      await database.insert(jobs).values({
        id: conflictingJobId,
        identityKind: 'destination_url',
        identityNamespace: DESTINATION_TAXONOMY_VERSION,
        identityValue: conflictingUrl,
        createdAt: NOW,
      })
      await database.insert(jobIdentities).values({
        id: 'identity-conflicting-owner',
        jobId: conflictingJobId,
        identityKind: 'canonical_destination',
        identityNamespace: DESTINATION_TAXONOMY_VERSION,
        identityValue: conflictingUrl,
        provenanceKind: 'normalization',
        provenanceVersion: 'fixture',
        evidenceJson: '{}',
        captureEvidenceVersionId: RAW_REVISION_ID,
        createdAt: NOW,
      })
      let conflictObserved = false
      await repository.persistWithStrongDestination({
        sourceEntity,
        rawRevisionId: RAW_REVISION_ID,
        destination: { class: 'direct_employer', url: conflictingUrl },
        destinationOutcome: { ...destinationOutcome, value: conflictingUrl },
        createdAt: NOW,
        materialize(reconciliation) {
          conflictObserved = reconciliation.conflict
          return persistenceInput('normalization-strong-conflict', retryAttempt(1), { attempts: [] })
        },
      })

      expect(conflictObserved).toBe(true)
      await expect(database.select().from(jobIdentityConflicts)).resolves.toEqual([
        expect.objectContaining({
          jobId: sourceJobId,
          conflictingJobId,
          identityKind: 'canonical_destination',
          identityValue: conflictingUrl,
        }),
      ])
      await expect(database.select().from(jobIdentities)
        .where(eq(jobIdentities.id, 'identity-conflicting-owner'))).resolves.toEqual([
        expect.objectContaining({ jobId: conflictingJobId }),
      ])
    } finally {
      await client.close()
    }
  })

  it('rolls back the complete passed multi-write when staging fails', async () => {
    const { client, database } = await createPgliteTestOwner()
    try {
      const jobId = 'job-atomic-normalization'
      await seedRawRevision(database, { jobId })
      const candidate: CanonicalSourceCandidate = {
        id: 'candidate-atomic-normalization',
        sourceEntityId: jobId,
        rawRecordId: RAW_RECORD_ID,
        rawRevisionId: RAW_REVISION_ID,
        schemaVersion: 'canonical-candidate@1',
        canonicalIdentity: { kind: 'destination_url', value: 'https://jobs.example.test/retry' },
        companyName: 'Atomic Co',
        roleTitle: 'Intern',
        employmentType: 'internship',
        seniority: 'internship',
        workMode: 'remote',
        location: null,
        compensation: null,
        postedAt: { value: null, precision: 'unknown', raw: null },
        destination: { class: 'direct_employer', url: 'https://jobs.example.test/retry' },
        sourceUrl: null,
        providerJobId: null,
        observedAt: NOW,
      }
      const attempt = retryAttempt(1)
      attempt.executionScopeId = null
      attempt.outcomes.unshift({
        resolverId: RESOLVER_ID,
        resolverVersion: RESOLVER_VERSION,
        field: 'destinationUrl',
        inputHash: ATTEMPT_INPUT_HASH,
        status: 'resolved',
        value: candidate.destination!.url,
      })
      const repository = createPgliteNormalizationRepository(database, {
        async stagePassedCandidate(transaction) {
          await expect(transaction.select().from(normalizationRuns)).resolves.toHaveLength(1)
          await expect(transaction.select().from(normalizationAttempts)).resolves.toHaveLength(1)
          await expect(transaction.select().from(normalizationFieldOutcomes)).resolves.toHaveLength(2)
          await expect(transaction.select().from(normalizationGates)).resolves.toHaveLength(1)
          await expect(transaction.select().from(jobFactVersions)).resolves.toHaveLength(1)
          await expect(transaction.select().from(retryWork)).resolves.toHaveLength(1)
          throw new Error('injected staging failure')
        },
      })

      await expect(repository.persist({
        ...persistenceInput('normalization-run-atomic', attempt),
        candidate,
        gate: {
          status: 'passed',
          policyVersion: 'normalization-gate@1',
          evaluatedAt: NOW,
          requiredFields: ['destinationUrl'],
          missingFields: [],
          conflictingFields: [],
          candidate,
        },
      })).rejects.toThrow('injected staging failure')

      await expect(database.select().from(normalizationRuns)).resolves.toEqual([])
      await expect(database.select().from(normalizationAttempts)).resolves.toEqual([])
      await expect(database.select().from(normalizationFieldOutcomes)).resolves.toEqual([])
      await expect(database.select().from(normalizationGates)).resolves.toEqual([])
      await expect(database.select().from(jobFactVersions)).resolves.toEqual([])
      await expect(database.select().from(retryWork)).resolves.toEqual([])
      await expect(database.select().from(sourceExecutionScopes)).resolves.toEqual([])

      let projectedCandidateId: string | null = null
      const successfulRepository = createPgliteNormalizationRepository(database, {
        async stagePassedCandidate(transaction) {
          await expect(transaction.select().from(jobFactVersions)).resolves.toHaveLength(1)
        },
        async projectPassedCandidate(candidateId) {
          await Promise.resolve()
          projectedCandidateId = candidateId
        },
      })
      await expect(successfulRepository.persist({
        ...persistenceInput('normalization-run-atomic-committed', attempt),
        candidate,
        gate: {
          status: 'passed',
          policyVersion: 'normalization-gate@1',
          evaluatedAt: NOW,
          requiredFields: ['destinationUrl'],
          missingFields: [],
          conflictingFields: [],
          candidate,
        },
      })).resolves.toMatchObject({ canonicalCandidate: candidate })
      expect(projectedCandidateId).toBe(candidate.id)
    } finally {
      await client.close()
    }
  })

  it('converges identical writes, orders timestamp ties by id, and survives close and reopen', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'normalization-pglite-'))
    let client = await createPgliteClient({ dataDir })
    try {
      let database = await migratePgliteDatabase(client)
      await seedRawRevision(database, { withScope: true })
      let repository = createPgliteNormalizationRepository(database)
      const noAttempt = persistenceInput('normalization-run-concurrent', retryAttempt(1), {
        attempts: [],
      })
      const converged = await Promise.all([
        repository.persist(noAttempt),
        repository.persist({
          ...noAttempt,
          runId: 'normalization-run-concurrent-loser',
        }),
      ])
      expect(converged[1]).toEqual(converged[0])
      for (const runId of ['normalization-run-a', 'normalization-run-z']) {
        await repository.persist({
          ...noAttempt,
          runId,
          inputHash: `sha256:${runId}`,
          status: runId.endsWith('-z') ? 'failed' : 'blocked',
          triggerId: `trigger-${runId}`,
        })
      }
      await expect(database.select().from(normalizationRuns)).resolves.toHaveLength(3)
      await expect(repository.getLatest(RAW_RECORD_ID)).resolves.toMatchObject({
        rawRevisionId: RAW_REVISION_ID,
        status: 'failed',
      })
      const beforeClose = await repository.listHistory(RAW_RECORD_ID)
      expect(beforeClose).toHaveLength(3)
      expect(beforeClose.map(({ status }) => status)).toEqual(['failed', 'completed', 'blocked'])

      await client.close()
      client = await createPgliteClient({ dataDir })
      database = await migratePgliteDatabase(client)
      repository = createPgliteNormalizationRepository(database)
      await expect(repository.getLatest(RAW_RECORD_ID)).resolves.toEqual(beforeClose[0])
      await expect(repository.findCached(
        RAW_REVISION_ID,
        noAttempt.inputHash,
        noAttempt.resolverSetHash,
        noAttempt.canonicalSchemaVersion,
        noAttempt.gatePolicyVersion,
      )).resolves.toMatchObject({ rawRevisionId: RAW_REVISION_ID })
    } finally {
      await client.close()
      await rm(dataDir, { recursive: true, force: true })
    }
  })
})
