import { describe, expect, it } from 'vitest'
import {
  normalizationAttempts,
  normalizationFieldOutcomes,
  normalizationRuns,
  rawSourceRecords,
  rawSourceRevisions,
} from '../../db/schema'
import { createDrizzleDatabase, createInMemoryDatabase, migrateDatabase } from '../../db/sqlite'
import { createSqliteNormalizationRepository } from './normalization.repository'

const RESOLVER_ID = 'jobright.authenticated-destination'
const RESOLVER_VERSION = 'jobright-authenticated-destination@1'
const INPUT_HASH = 'sha256:exact-auth-destination-input'

function seedExactDestinationAttempt(input: {
  attemptStatus: string
  destinationStatus: string
  destinationValue?: string
  completedAt?: string
}) {
  const sqlite = createInMemoryDatabase()
  migrateDatabase(sqlite)
  const database = createDrizzleDatabase(sqlite)
  const normalizationRepository = createSqliteNormalizationRepository(database)
  const now = input.completedAt ?? '2026-07-11T12:00:00.000Z'
  const rawRecordId = 'raw-record-exact-success'
  const rawRevisionId = 'raw-revision-exact-success'
  const runId = 'normalization-run-exact-success'
  const attemptId = 'attempt-exact-success'

  database.insert(rawSourceRecords).values({
    id: rawRecordId,
    createdAt: now,
  }).run()
  database.insert(rawSourceRevisions).values({
    id: rawRevisionId,
    rawRecordId,
    revision: 1,
    contentHash: 'sha256:content',
    adapterId: 'jobright.resolver',
    adapterKind: 'connector',
    adapterVersion: '0.7.0',
    providerRecordId: 'job-exact-success',
    payloadJson: JSON.stringify({ jobTitle: 'Exact Intern', companyName: 'Exact Co' }),
    evidenceJson: '[]',
    observedAt: now,
    createdAt: now,
  }).run()
  database.insert(normalizationRuns).values({
    id: runId,
    rawRecordId,
    rawRevisionId,
    triggerOccurrenceId: null,
    triggerConnectorInstanceId: null,
    triggerConnectorRunId: null,
    inputHash: 'sha256:run-input',
    resolverSetHash: 'sha256:resolver-set',
    canonicalSchemaVersion: 'canonical-candidate@1',
    gatePolicyVersion: 'normalization-gate@1',
    triggerKind: 'intake',
    triggerId: null,
    status: 'completed',
    createdAt: now,
    updatedAt: now,
  }).run()
  database.insert(normalizationAttempts).values({
    id: attemptId,
    runId,
    rawRevisionId,
    sequence: 0,
    resolverId: RESOLVER_ID,
    resolverVersion: RESOLVER_VERSION,
    inputHash: INPUT_HASH,
    declarationJson: JSON.stringify({
      id: RESOLVER_ID,
      version: RESOLVER_VERSION,
      outputFields: ['destinationUrl'],
    }),
    applicabilityJson: '[]',
    status: input.attemptStatus,
    startedAt: now,
    completedAt: now,
  }).run()
  const outcome = {
    resolverId: RESOLVER_ID,
    resolverVersion: RESOLVER_VERSION,
    field: 'destinationUrl',
    inputHash: INPUT_HASH,
    status: input.destinationStatus,
    ...(input.destinationValue == null ? { reason: `fixture ${input.destinationStatus}` } : {
      value: input.destinationValue,
      confidence: 1,
    }),
  }
  database.insert(normalizationFieldOutcomes).values({
    id: 'outcome-exact-success',
    runId,
    attemptId,
    sequence: 0,
    attemptSequence: 0,
    outcomeIndex: 0,
    field: 'destinationUrl',
    status: input.destinationStatus,
    resolverId: RESOLVER_ID,
    resolverVersion: RESOLVER_VERSION,
    inputHash: INPUT_HASH,
    outcomeJson: JSON.stringify(outcome),
  }).run()

  return {
    database,
    normalizationRepository,
    rawRevisionId,
    sqlite,
  }
}

describe('normalization repository exact success', () => {
  it.each([
    'failed',
    'rejected',
    'abstained',
    'conflict',
    'exhausted',
    'cancelled',
    'retry',
  ] as const)(
    'does not treat exact Jobright destinationUrl %s as successful normalization',
    (destinationStatus) => {
      const { normalizationRepository, rawRevisionId, sqlite } = seedExactDestinationAttempt({
        attemptStatus: destinationStatus === 'retry' ? 'retry' : 'completed',
        destinationStatus,
      })

      expect(normalizationRepository.hasExactSuccessfulNormalizationAttempt({
        rawRevisionId,
        resolverId: RESOLVER_ID,
        resolverVersion: RESOLVER_VERSION,
        inputHash: INPUT_HASH,
        retryWindowStartedAt: '2026-07-11T12:00:00.000Z',
      })).toBe(false)

      sqlite.close()
    },
  )

  it.each([
    { destinationStatus: 'resolved' as const, destinationValue: 'https://jobs.lever.co/example/exact' },
    { destinationStatus: 'locked' as const, destinationValue: 'https://jobs.lever.co/example/locked' },
  ])(
    'treats exact Jobright destinationUrl $destinationStatus after the retry window start as successful normalization',
    ({ destinationStatus, destinationValue }) => {
      const windowStartedAt = '2026-07-11T12:00:00.000Z'
      const successAt = '2026-07-11T12:00:01.000Z'
      const { normalizationRepository, rawRevisionId, sqlite } = seedExactDestinationAttempt({
        attemptStatus: 'completed',
        destinationStatus,
        destinationValue,
        completedAt: successAt,
      })

      expect(normalizationRepository.hasExactSuccessfulNormalizationAttempt({
        rawRevisionId,
        resolverId: RESOLVER_ID,
        resolverVersion: RESOLVER_VERSION,
        inputHash: INPUT_HASH,
        retryWindowStartedAt: windowStartedAt,
      })).toBe(true)

      sqlite.close()
    },
  )

  it('does not treat an exact success completed at the retry window start as recovery', () => {
    const windowStartedAt = '2026-07-11T12:00:00.000Z'
    const { normalizationRepository, rawRevisionId, sqlite } = seedExactDestinationAttempt({
      attemptStatus: 'completed',
      destinationStatus: 'resolved',
      destinationValue: 'https://jobs.lever.co/example/same-instant',
      completedAt: windowStartedAt,
    })

    expect(normalizationRepository.hasExactSuccessfulNormalizationAttempt({
      rawRevisionId,
      resolverId: RESOLVER_ID,
      resolverVersion: RESOLVER_VERSION,
      inputHash: INPUT_HASH,
      retryWindowStartedAt: windowStartedAt,
    })).toBe(false)

    sqlite.close()
  })

  it('does not treat a prior exact success as recovery for a later reopened retry window', () => {
    const successAt = '2026-07-11T12:00:00.000Z'
    const laterWindowStartedAt = '2026-07-11T13:00:00.000Z'
    const { normalizationRepository, rawRevisionId, sqlite } = seedExactDestinationAttempt({
      attemptStatus: 'completed',
      destinationStatus: 'resolved',
      destinationValue: 'https://jobs.lever.co/example/stale-success',
      completedAt: successAt,
    })

    expect(normalizationRepository.hasExactSuccessfulNormalizationAttempt({
      rawRevisionId,
      resolverId: RESOLVER_ID,
      resolverVersion: RESOLVER_VERSION,
      inputHash: INPUT_HASH,
      retryWindowStartedAt: laterWindowStartedAt,
    })).toBe(false)

    expect(normalizationRepository.hasExactSuccessfulNormalizationAttempt({
      rawRevisionId,
      resolverId: RESOLVER_ID,
      resolverVersion: RESOLVER_VERSION,
      inputHash: INPUT_HASH,
      retryWindowStartedAt: successAt,
    })).toBe(false)

    expect(normalizationRepository.hasExactSuccessfulNormalizationAttempt({
      rawRevisionId,
      resolverId: RESOLVER_ID,
      resolverVersion: RESOLVER_VERSION,
      inputHash: INPUT_HASH,
      retryWindowStartedAt: '2026-07-11T11:59:59.000Z',
    })).toBe(true)

    sqlite.close()
  })
})
