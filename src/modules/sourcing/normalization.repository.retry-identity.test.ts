import { describe, expect, it } from 'vitest'
import { normalizationRuns, retryWork } from '../../db/schema'
import { createDrizzleDatabase, createInMemoryDatabase, migrateDatabase } from '../../db/sqlite'
import { createSqliteConnectorRepository } from '../connectors/connector.repository'
import { createSqliteNormalizationRepository } from './normalization.repository'
import { createSqliteRawSourceRepository } from './raw-source.repository'

describe('normalization repository acquired retry identity', () => {
  it('rejects exact acquired replay when persisted attempt input hash does not match acquired work', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const connectorRepository = createSqliteConnectorRepository(database)
    const rawRepository = createSqliteRawSourceRepository(database)
    const normalizationRepository = createSqliteNormalizationRepository(database)
    await connectorRepository.upsertInstance({
      id: 'fixture-instance',
      connectorId: 'fixture.connector',
      connectorVersion: '1.0.0',
      displayName: 'Fixture',
      enabled: true,
    })
    const acquisition = await connectorRepository.recordRunRequest({
      connectorInstanceId: 'fixture-instance',
      mode: 'catch_up',
      startedAt: '2026-07-11T12:00:30.000Z',
    })
    await connectorRepository.markRunRunning({
      connectorRunId: acquisition.run.id,
      startedAt: '2026-07-11T12:00:30.000Z',
    })
    const receipt = (await rawRepository.ingestBatch({
      records: [{
        adapter: { id: 'fixture.connector', kind: 'connector', version: '1.0.0' },
        observedAt: '2026-07-11T12:00:00.000Z',
        providerRecordId: 'hash-mismatch-job',
        payload: { companyName: 'Hash Co', roleTitle: 'Intern' },
      }],
    })).receipts[0]

    const acquisitionRunId = acquisition.run.id
    const retryWorkId = 'retry-work-hash-mismatch'
    const acquiredInputHash = 'sha256:acquired-input-hash'
    const mismatchedAttemptHash = 'sha256:mismatched-attempt-hash'
    database.insert(retryWork).values({
      id: retryWorkId,
      kind: 'normalization',
      connectorInstanceId: null,
      filterSignature: null,
      checkpointSchemaVersion: null,
      checkpointGeneration: null,
      rawRevisionId: receipt.revision.id,
      resolverId: 'fixture.network-details',
      resolverVersion: '2.0.0',
      inputHash: acquiredInputHash,
      reason: 'server_failure',
      attempt: 1,
      maxAttempts: 3,
      lastAttemptAt: '2026-07-11T12:00:00.000Z',
      computedDelayMs: 30_000,
      serverMinimumDelayMs: null,
      nextAttemptAt: '2026-07-11T12:00:30.000Z',
      horizonAt: '2026-07-11T13:00:00.000Z',
      state: 'acquired',
      ownerVersion: '2.0.0',
      lineageJson: JSON.stringify({ connectorInstanceId: 'fixture-instance' }),
      acquiredAt: '2026-07-11T12:00:30.000Z',
      acquisitionToken: 'token-hash-mismatch',
      acquisitionRunId,
      skippedRunId: null,
      createdAt: '2026-07-11T12:00:00.000Z',
      updatedAt: '2026-07-11T12:00:30.000Z',
      deletedAt: null,
    }).run()

    const runsBefore = database.select().from(normalizationRuns).all().length
    expect(() => normalizationRepository.persist({
      runId: 'normalization-run-hash-mismatch',
      rawRecordId: receipt.rawRecordId,
      rawRevisionId: receipt.revision.id,
      inputHash: 'sha256:run-input',
      resolverSetHash: 'sha256:resolver-set',
      canonicalSchemaVersion: 'canonical-candidate@1',
      gatePolicyVersion: 'normalization-gate@1',
      status: 'completed',
      acquiredRetryWork: {
        retryWorkId,
        acquisitionRunId,
      },
      attempts: [{
        id: 'attempt-hash-mismatch',
        resolver: {
          id: 'fixture.network-details',
          version: '2.0.0',
          requiredInputs: ['rawRevision'],
          outputFields: ['destinationUrl'],
          capabilities: ['network'],
          costClass: 'high',
          precedence: 500,
        },
        applicability: [],
        inputHash: mismatchedAttemptHash,
        status: 'completed',
        startedAt: '2026-07-11T12:00:31.000Z',
        completedAt: '2026-07-11T12:00:31.000Z',
        outcomes: [{
          resolverId: 'fixture.network-details',
          resolverVersion: '2.0.0',
          field: 'destinationUrl',
          inputHash: mismatchedAttemptHash,
          status: 'resolved',
          value: 'https://jobs.lever.co/example/hash-mismatch',
        }],
      }],
      candidate: null,
      gate: {
        status: 'needs_enrichment',
        policyVersion: 'normalization-gate@1',
        evaluatedAt: '2026-07-11T12:00:31.000Z',
        missingFields: ['companyName'],
        reason: 'incomplete',
      },
      now: '2026-07-11T12:00:31.000Z',
    })).toThrow(/acquired normalization retry identity/i)

    expect(database.select().from(normalizationRuns).all()).toHaveLength(runsBefore)
    expect(database.select().from(retryWork).all()).toEqual([
      expect.objectContaining({
        id: retryWorkId,
        state: 'acquired',
        inputHash: acquiredInputHash,
        acquisitionRunId,
        acquisitionToken: 'token-hash-mismatch',
        nextAttemptAt: '2026-07-11T12:00:30.000Z',
      }),
    ])
    sqlite.close()
  })
})
