import { describe, expect, it } from 'vitest'
import {
  connectorCheckpoints,
  normalizationAttempts,
  normalizationFieldOutcomes,
  normalizationRuns,
  captureLineages,
  captureEvidenceVersions,
  retryWork,
} from '../../db/schema'
import { createConnectorRepositoryTestContext } from './connector.repository.pglite-test-helpers'
import { mapConnectorRunSummary, publicConnectorRunSummary } from '../../runtime/local-connector-public-run'
import {
  finalizeInProgressConnectorSynchronization,
  updateConnectorSynchronizationOutcome,
} from './connector-synchronization.persistence'

const RESOLVER_ID = 'jobright.authenticated-destination'
const RESOLVER_VERSION = 'jobright-authenticated-destination@1'
const INPUT_HASH = 'sha256:finalize-failed-destination'
const FILTER_SIGNATURE = 'provider-state:jobright.resolver@0.11.0'

describe('exact acquired normalization retry finalization success gate', () => {
  it.each(['failed', 'rejected', 'abstained'] as const)(
    'does not complete retry or remove checkpoint entry for exact destinationUrl %s',
    async (destinationStatus) => {
      const { database, repository } = await createConnectorRepositoryTestContext()
      const now = '2026-07-11T12:00:00.000Z'
      const nextAttemptAt = '2026-07-11T12:00:30.000Z'
      const captureLineageId = 'raw-record-finalize-gate'
      const captureEvidenceVersionId = 'raw-revision-finalize-gate'
      const retryWorkId = 'retry-work-finalize-gate'

      const instance = await repository.upsertInstance({
        id: 'jobright-finalize-gate',
        connectorId: 'jobright.resolver',
        connectorVersion: '0.11.0',
        displayName: 'Finalize gate',
        enabled: true,
      })
      const acquisition = await repository.recordRunRequest({
        connectorInstanceId: 'jobright-finalize-gate',
        mode: 'catch_up',
        startedAt: now,
      })
      await repository.markRunRunning({
        connectorRunId: acquisition.run.id,
        startedAt: now,
      })
      // Use the real acquired run id from the repository.
      const connectorRunId = acquisition.run.id
await database.insert(captureLineages).values({
        id: captureLineageId,
        createdAt: now,
      })
await database.insert(captureEvidenceVersions).values({
        id: captureEvidenceVersionId,
        captureLineageId,
        revision: 1,
        contentHash: 'sha256:content',
        adapterId: 'jobright.resolver',
        adapterKind: 'connector',
        adapterVersion: '0.7.0',
        providerRecordId: 'job-finalize-gate',
        payloadJson: JSON.stringify({ jobTitle: 'Gate Intern', companyName: 'Gate Co' }),
        evidenceJson: '[]',
        observedAt: now,
        createdAt: now,
      })
await database.insert(normalizationRuns).values({
        id: 'normalization-run-finalize-gate',
        captureLineageId,
        captureEvidenceVersionId,
        triggerCaptureId: null,
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
      })
await database.insert(normalizationAttempts).values({
        id: 'attempt-finalize-gate',
        runId: 'normalization-run-finalize-gate',
        captureEvidenceVersionId,
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
        status: 'completed',
        startedAt: now,
        completedAt: now,
      })
await database.insert(normalizationFieldOutcomes).values({
        id: 'outcome-finalize-gate',
        runId: 'normalization-run-finalize-gate',
        attemptId: 'attempt-finalize-gate',
        sequence: 0,
        attemptSequence: 0,
        outcomeIndex: 0,
        field: 'destinationUrl',
        status: destinationStatus,
        resolverId: RESOLVER_ID,
        resolverVersion: RESOLVER_VERSION,
        inputHash: INPUT_HASH,
        outcomeJson: JSON.stringify({
          resolverId: RESOLVER_ID,
          resolverVersion: RESOLVER_VERSION,
          field: 'destinationUrl',
          inputHash: INPUT_HASH,
          status: destinationStatus,
          reason: `fixture ${destinationStatus}`,
        }),
      })

      const checkpointPayload = {
        schemaVersion: 'jobright-resolution-checkpoint@5',
        checkpoint: {
          pendingDetailRetries: [{
            sourceId: 'jobright.public:job-finalize-gate',
            ownership: 'active',
            generationId: 'gen-finalize',
            posting: { inclusion: 'included', kind: 'unknown', raw: null },
            advice: {
              state: 'scheduled',
              reason: 'server_failure',
              attempt: 1,
              maxAttempts: 3,
              lastAttemptAt: now,
              computedDelayMs: 30_000,
              nextAttemptAt,
              horizonAt: '2026-07-11T13:00:00.000Z',
            },
          }],
          retryState: [{
            sourceId: 'jobright.public:job-finalize-gate',
            advice: {
              state: 'scheduled',
              reason: 'server_failure',
              attempt: 1,
              maxAttempts: 3,
              lastAttemptAt: now,
              computedDelayMs: 30_000,
              nextAttemptAt,
              horizonAt: '2026-07-11T13:00:00.000Z',
            },
          }],
        },
      }
      await repository.recordCheckpoint({
        connectorInstanceId: 'jobright-finalize-gate',
        filterSignature: FILTER_SIGNATURE,
        checkpoint: checkpointPayload,
        coverage: { start: now, end: now },
        savedAt: now,
      })
await database.insert(retryWork).values({
        id: retryWorkId,
        executionScopeId: instance.executionScopeId,
        kind: 'normalization',
        connectorInstanceId: null,
        filterSignature: null,
        checkpointSchemaVersion: null,
        checkpointGeneration: null,
        captureEvidenceVersionId,
        resolverId: RESOLVER_ID,
        resolverVersion: RESOLVER_VERSION,
        inputHash: INPUT_HASH,
        reason: 'server_failure',
        attempt: 1,
        maxAttempts: 3,
        lastAttemptAt: now,
        computedDelayMs: 30_000,
        serverMinimumDelayMs: null,
        nextAttemptAt,
        horizonAt: '2026-07-11T13:00:00.000Z',
        state: 'acquired',
        ownerVersion: RESOLVER_VERSION,
        lineageJson: JSON.stringify({ connectorInstanceId: 'jobright-finalize-gate' }),
        acquiredAt: now,
        acquisitionToken: 'token-finalize-gate',
        acquisitionRunId: connectorRunId,
        skippedRunId: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })

      const acquiredRetryWork = {
        retryWorkId,
        acquisitionRunId: connectorRunId,
        rawRevisionId: captureEvidenceVersionId,
        resolverId: RESOLVER_ID,
        resolverVersion: RESOLVER_VERSION,
        inputHash: INPUT_HASH,
      }
      await expect(repository.finalizeExactAcquiredNormalizationRetry({
        acquiredRetryWork,
        checkpoint: {
          schemaVersion: checkpointPayload.schemaVersion,
          checkpoint: { retryState: [] },
        },
        completedAt: '2026-07-11T12:00:01.000Z',
        connectorInstanceId: 'jobright-finalize-gate',
        connectorRunId,
        coverage: { start: now, end: now },
        filterSignature: FILTER_SIGNATURE,
        finalizationMode: 'require-persisted-exact-success',
        savedAt: '2026-07-11T12:00:01.000Z',
        terminalStatus: 'completed',
      })).rejects.toThrow(/exact successful normalization attempt was not found/i)

      await expect(database.select().from(retryWork)).resolves.toEqual([
        expect.objectContaining({
          id: retryWorkId,
          state: 'acquired',
          acquisitionRunId: connectorRunId,
        }),
      ])
      expect((await repository.getCheckpoint({
        connectorInstanceId: 'jobright-finalize-gate',
        filterSignature: FILTER_SIGNATURE,
      }))!.checkpoint).toEqual(checkpointPayload.checkpoint)

      if (destinationStatus === 'failed') {
        await updateConnectorSynchronizationOutcome(
          database,
          connectorRunId,
          { kind: 'failed', reason: 'connector_authored_normalization_failure' },
          '2026-07-11T12:00:01.500Z',
        )
      }

      await repository.finalizeExactAcquiredNormalizationRetry({
        acquiredRetryWork,
        checkpoint: checkpointPayload,
        completedAt: '2026-07-11T12:00:02.000Z',
        connectorInstanceId: 'jobright-finalize-gate',
        connectorRunId,
        coverage: { start: now, end: now },
        filterSignature: FILTER_SIGNATURE,
        finalizationMode: 'complete-only-on-persisted-exact-success',
        savedAt: '2026-07-11T12:00:02.000Z',
        terminalStatus: 'failed',
      })

      const [failedRun] = (await repository.listRuns({
        connectorInstanceId: 'jobright-finalize-gate', limit: 1,
      })).items
      const expectedFailureReason = destinationStatus === 'failed'
        ? 'connector_authored_normalization_failure'
        : 'normalization_retry_failed'
      expect(publicConnectorRunSummary(mapConnectorRunSummary(failedRun!))).toMatchObject({
        status: 'failed',
        outcome: { kind: 'failed', reason: expectedFailureReason },
        lifecycleCounts: { source: 'frozen_terminal' },
      })
      await finalizeInProgressConnectorSynchronization(
        database,
        connectorRunId,
        { kind: 'cancelled', reason: 'repeated_finalize_must_not_replace_terminal' },
        '2026-07-11T12:00:03.000Z',
      )
      await finalizeInProgressConnectorSynchronization(
        database,
        connectorRunId,
        { kind: 'yielded', reason: 'invocation_budget' },
        '2026-07-11T12:00:04.000Z',
      )
      const [afterRepeatedFinalize] = (await repository.listRuns({
        connectorInstanceId: 'jobright-finalize-gate', limit: 1,
      })).items
      expect(publicConnectorRunSummary(mapConnectorRunSummary(afterRepeatedFinalize!))).toMatchObject({
        status: 'failed',
        outcome: { kind: 'failed', reason: expectedFailureReason },
      })

      await expect(database.select().from(retryWork)).resolves.toEqual([
        expect.objectContaining({
          id: retryWorkId,
          state: 'scheduled',
          acquisitionRunId: null,
          acquiredAt: null,
          acquisitionToken: null,
        }),
      ])
      const checkpoint = await repository.getCheckpoint({
        connectorInstanceId: 'jobright-finalize-gate',
        filterSignature: FILTER_SIGNATURE,
      })
      expect((checkpoint!.checkpoint as { retryState: unknown[] }).retryState).toEqual([
        expect.objectContaining({ sourceId: 'jobright.public:job-finalize-gate' }),
      ])
      await expect(database.select().from(connectorCheckpoints)).resolves.toHaveLength(1)
    },
  )
})
