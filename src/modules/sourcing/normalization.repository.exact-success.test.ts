import { describe, expect, it } from 'vitest'
import {
  normalizationAttempts,
  normalizationFieldOutcomes,
  normalizationRuns,
  captureLineages,
  captureEvidenceVersions,
} from '../../db/schema'
import { useResettablePgliteTestOwner } from '../../test/pglite-test-owner'
import { createPgliteNormalizationRepository } from './normalization.repository'

const RESOLVER_ID = 'jobright.authenticated-destination'
const RESOLVER_VERSION = 'jobright-authenticated-destination@1'
const INPUT_HASH = 'sha256:exact-auth-destination-input'
const resettableOwner = useResettablePgliteTestOwner()

async function seedExactDestinationAttempt(input: {
  attemptStatus: string
  destinationStatus: string
  destinationValue?: string
  completedAt?: string
  rawRevisionId: string
  database?: ReturnType<typeof resettableOwner>['database']
}) {
  const { database } = input.database
    ? { database: input.database }
    : resettableOwner()
  const normalizationRepository = createPgliteNormalizationRepository(database)
  const now = input.completedAt ?? '2026-07-11T12:00:00.000Z'
  const rawRecordId = `raw-record-${input.rawRevisionId}`
  const rawRevisionId = input.rawRevisionId
  const runId = `normalization-run-${input.rawRevisionId}`
  const attemptId = `attempt-${input.rawRevisionId}`

  await database.insert(captureLineages).values({ id: rawRecordId, createdAt: now })
  await database.insert(captureEvidenceVersions).values({
    id: rawRevisionId, captureLineageId: rawRecordId, revision: 1,
    contentHash: `sha256:content-${input.rawRevisionId}`, adapterId: 'jobright.resolver', adapterKind: 'connector',
    adapterVersion: '0.7.0', providerRecordId: `job-${input.rawRevisionId}`,
    payloadJson: JSON.stringify({ jobTitle: 'Exact Intern', companyName: 'Exact Co' }),
    evidenceJson: '[]', observedAt: now, createdAt: now,
  })
  await database.insert(normalizationRuns).values({
    id: runId, captureLineageId: rawRecordId, captureEvidenceVersionId: rawRevisionId,
    triggerCaptureId: null, triggerConnectorInstanceId: null, triggerConnectorRunId: null,
    inputHash: 'sha256:run-input', resolverSetHash: 'sha256:resolver-set',
    canonicalSchemaVersion: 'canonical-candidate@1', gatePolicyVersion: 'normalization-gate@1',
    triggerKind: 'intake', triggerId: null, status: 'completed', createdAt: now, updatedAt: now,
  })
  await database.insert(normalizationAttempts).values({
    id: attemptId, runId, captureEvidenceVersionId: rawRevisionId, sequence: 0,
    resolverId: RESOLVER_ID, resolverVersion: RESOLVER_VERSION, inputHash: INPUT_HASH,
    declarationJson: JSON.stringify({ id: RESOLVER_ID, version: RESOLVER_VERSION, outputFields: ['destinationUrl'] }),
    applicabilityJson: '[]', status: input.attemptStatus, startedAt: now, completedAt: now,
  })
  const outcome = {
    resolverId: RESOLVER_ID, resolverVersion: RESOLVER_VERSION, field: 'destinationUrl',
    inputHash: INPUT_HASH, status: input.destinationStatus,
    ...(input.destinationValue == null ? { reason: `fixture ${input.destinationStatus}` } : {
      value: input.destinationValue, confidence: 1,
    }),
  }
  await database.insert(normalizationFieldOutcomes).values({
    id: `outcome-${input.rawRevisionId}`, runId, attemptId, sequence: 0, attemptSequence: 0,
    outcomeIndex: 0, field: 'destinationUrl', status: input.destinationStatus,
    resolverId: RESOLVER_ID, resolverVersion: RESOLVER_VERSION, inputHash: INPUT_HASH,
    outcomeJson: JSON.stringify(outcome),
  })

  return { normalizationRepository, rawRevisionId }
}

describe.sequential('normalization repository exact success', () => {
  it('does not treat exact Jobright destinationUrl non-success statuses as successful normalization', async () => {
    const { database } = resettableOwner()
    const normalizationRepository = createPgliteNormalizationRepository(database)
    const statuses = [
      'failed',
      'rejected',
      'abstained',
      'conflict',
      'exhausted',
      'cancelled',
      'retry',
    ] as const

    for (const destinationStatus of statuses) {
      const { rawRevisionId } = await seedExactDestinationAttempt({
        attemptStatus: destinationStatus === 'retry' ? 'retry' : 'completed',
        destinationStatus,
        rawRevisionId: `exact-negative-${destinationStatus}`,
        database,
      })
      await expect(normalizationRepository.hasExactSuccessfulNormalizationAttempt({
        rawRevisionId,
        resolverId: RESOLVER_ID,
        resolverVersion: RESOLVER_VERSION,
        inputHash: INPUT_HASH,
        retryWindowStartedAt: '2026-07-11T12:00:00.000Z',
      })).resolves.toBe(false)
    }
  })

  it('treats exact Jobright destinationUrl resolved and locked after the retry window start as successful normalization', async () => {
    const { database } = resettableOwner()
    const normalizationRepository = createPgliteNormalizationRepository(database)
    const windowStartedAt = '2026-07-11T12:00:00.000Z'
    const successAt = '2026-07-11T12:00:01.000Z'
    const cases = [
      { destinationStatus: 'resolved' as const, destinationValue: 'https://jobs.lever.co/example/exact' },
      { destinationStatus: 'locked' as const, destinationValue: 'https://jobs.lever.co/example/locked' },
    ]

    for (const { destinationStatus, destinationValue } of cases) {
      const { rawRevisionId } = await seedExactDestinationAttempt({
        attemptStatus: 'completed',
        destinationStatus,
        destinationValue,
        completedAt: successAt,
        rawRevisionId: `exact-positive-${destinationStatus}`,
        database,
      })

      await expect(normalizationRepository.hasExactSuccessfulNormalizationAttempt({
        rawRevisionId,
        resolverId: RESOLVER_ID,
        resolverVersion: RESOLVER_VERSION,
        inputHash: INPUT_HASH,
        retryWindowStartedAt: windowStartedAt,
      })).resolves.toBe(true)
    }
  })

  it('does not treat an exact success completed at the retry window start as recovery', async () => {
    const windowStartedAt = '2026-07-11T12:00:00.000Z'
    const { normalizationRepository, rawRevisionId } = await seedExactDestinationAttempt({
      attemptStatus: 'completed',
      destinationStatus: 'resolved',
      destinationValue: 'https://jobs.lever.co/example/same-instant',
      completedAt: windowStartedAt,
      rawRevisionId: 'exact-window-start',
    })

    await expect(normalizationRepository.hasExactSuccessfulNormalizationAttempt({
      rawRevisionId,
      resolverId: RESOLVER_ID,
      resolverVersion: RESOLVER_VERSION,
      inputHash: INPUT_HASH,
      retryWindowStartedAt: windowStartedAt,
    })).resolves.toBe(false)
  })

  it('does not treat a prior exact success as recovery for a later reopened retry window', async () => {
    const successAt = '2026-07-11T12:00:00.000Z'
    const laterWindowStartedAt = '2026-07-11T13:00:00.000Z'
    const { normalizationRepository, rawRevisionId } = await seedExactDestinationAttempt({
      attemptStatus: 'completed',
      destinationStatus: 'resolved',
      destinationValue: 'https://jobs.lever.co/example/stale-success',
      completedAt: successAt,
      rawRevisionId: 'exact-reopened-window',
    })

    await expect(normalizationRepository.hasExactSuccessfulNormalizationAttempt({
      rawRevisionId,
      resolverId: RESOLVER_ID,
      resolverVersion: RESOLVER_VERSION,
      inputHash: INPUT_HASH,
      retryWindowStartedAt: laterWindowStartedAt,
    })).resolves.toBe(false)

    await expect(normalizationRepository.hasExactSuccessfulNormalizationAttempt({
      rawRevisionId,
      resolverId: RESOLVER_ID,
      resolverVersion: RESOLVER_VERSION,
      inputHash: INPUT_HASH,
      retryWindowStartedAt: successAt,
    })).resolves.toBe(false)

    await expect(normalizationRepository.hasExactSuccessfulNormalizationAttempt({
      rawRevisionId,
      resolverId: RESOLVER_ID,
      resolverVersion: RESOLVER_VERSION,
      inputHash: INPUT_HASH,
      retryWindowStartedAt: '2026-07-11T11:59:59.000Z',
    })).resolves.toBe(true)
  })
})
