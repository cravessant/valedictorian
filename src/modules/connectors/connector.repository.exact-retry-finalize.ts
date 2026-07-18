import { and, eq, isNull } from 'drizzle-orm'
import {
  connectorRuns,
  retryWork,
} from '../../db/schema'
import type { PgliteDatabase } from '../../db/pglite'
import { hasPersistedExactSuccessfulNormalizationAttempt } from '../sourcing/normalization.repository'
import { freezeConnectorRunLifecycleCounts } from './connector.lifecycle-counts'
import { finalizeInProgressConnectorSynchronization } from './connector-synchronization.persistence'
import {
  mapConnectorRun,
} from './connector-run.persistence'
import { toJsonRecord } from './connector.persistence-json'
import { upsertConnectorCheckpoint } from './connector-checkpoint.persistence'
import type {
  ConnectorCheckpointPayload,
  ConnectorCoverageWindow,
} from './connector-checkpoint.persistence-types'
import type {
  ConnectorRunRecord,
  ConnectorRunTerminalStatus,
} from './connector-run.persistence-types'
import { assertValidJobrightV5CheckpointRetryState } from './connector.retry-work'

export type ExactAcquiredNormalizationFinalizationMode =
  | 'require-persisted-exact-success'
  | 'complete-only-on-persisted-exact-success'

export async function releaseAcquiredNormalizationWorkForRun(
  database: PgliteDatabase,
  input: {
    connectorRunId: string
    completedAt: string
  },
) {
  await database.update(retryWork).set({
    state: 'scheduled',
    acquiredAt: null,
    acquisitionToken: null,
    acquisitionRunId: null,
    updatedAt: input.completedAt,
  }).where(and(
    eq(retryWork.state, 'acquired'),
    eq(retryWork.acquisitionRunId, input.connectorRunId),
    isNull(retryWork.deletedAt),
  ))
}

export async function finalizeExactAcquiredNormalizationRetry(
  database: PgliteDatabase,
  input: {
    acquiredRetryWork: {
      acquisitionRunId: string
      inputHash: string
      rawRevisionId: string
      resolverId: string
      resolverVersion: string
      retryWorkId: string
    }
    checkpoint: ConnectorCheckpointPayload
    completedAt: string
    connectorInstanceId: string
    connectorRunId: string
    coverage: ConnectorCoverageWindow
    filterSignature: string
    finalizationMode: ExactAcquiredNormalizationFinalizationMode
    savedAt: string
    terminalStatus: ConnectorRunTerminalStatus
  },
): Promise<ConnectorRunRecord> {
  return database.transaction(async (transaction) => {
    const [run] = await transaction
      .select()
      .from(connectorRuns)
      .where(and(
        eq(connectorRuns.id, input.connectorRunId),
        eq(connectorRuns.connectorInstanceId, input.connectorInstanceId),
        eq(connectorRuns.status, 'running'),
        isNull(connectorRuns.deletedAt),
      ))
      .limit(1)
    if (!run) {
      throw new Error(`Running connector run not found: ${input.connectorRunId}`)
    }

    const [work] = await transaction.select().from(retryWork).where(and(
      eq(retryWork.id, input.acquiredRetryWork.retryWorkId),
      eq(retryWork.kind, 'normalization'),
      eq(retryWork.captureEvidenceVersionId, input.acquiredRetryWork.rawRevisionId),
      eq(retryWork.resolverId, input.acquiredRetryWork.resolverId),
      eq(retryWork.resolverVersion, input.acquiredRetryWork.resolverVersion),
      eq(retryWork.inputHash, input.acquiredRetryWork.inputHash),
      isNull(retryWork.deletedAt),
    )).limit(1)
    if (!work) {
      throw new Error('Exact acquired normalization retry identity was not found for finalization')
    }

    const exactSuccess = await hasPersistedExactSuccessfulNormalizationAttempt(transaction, {
      rawRevisionId: input.acquiredRetryWork.rawRevisionId,
      resolverId: input.acquiredRetryWork.resolverId,
      resolverVersion: input.acquiredRetryWork.resolverVersion,
      inputHash: input.acquiredRetryWork.inputHash,
      retryWindowStartedAt: work.lastAttemptAt,
    })

    if (input.finalizationMode === 'require-persisted-exact-success') {
      if (!exactSuccess) {
        throw new Error('Exact successful normalization attempt was not found for finalization')
      }
      if (work.state !== 'acquired' || work.acquisitionRunId !== input.acquiredRetryWork.acquisitionRunId) {
        throw new Error('Exact acquired normalization retry is not acquired for finalization')
      }
    } else if (work.state === 'acquired' && work.acquisitionRunId !== input.acquiredRetryWork.acquisitionRunId) {
      throw new Error('Exact normalization retry acquisition does not match the finalizing run')
    }

    assertValidJobrightV5CheckpointRetryState(input.checkpoint)
    await upsertConnectorCheckpoint(
      transaction,
      {
        connectorInstanceId: input.connectorInstanceId,
        filterSignature: input.filterSignature,
        checkpoint: input.checkpoint,
        coverage: input.coverage,
        savedAt: input.savedAt,
      },
      input.completedAt,
    )

    if (exactSuccess) {
      if (work.state !== 'acquired' || work.acquisitionRunId !== input.acquiredRetryWork.acquisitionRunId) {
        throw new Error('Exact acquired normalization retry is not acquired for finalization')
      }
      await transaction.update(retryWork).set({
        state: 'completed',
        nextAttemptAt: null,
        acquiredAt: null,
        acquisitionToken: null,
        acquisitionRunId: null,
        updatedAt: input.completedAt,
      }).where(eq(retryWork.id, work.id))
    } else if (work.state === 'acquired') {
      await transaction.update(retryWork).set({
        state: 'scheduled',
        nextAttemptAt: work.nextAttemptAt,
        acquiredAt: null,
        acquisitionToken: null,
        acquisitionRunId: null,
        updatedAt: input.completedAt,
      }).where(eq(retryWork.id, work.id))
    }

    const terminalStatus = exactSuccess ? 'completed' : input.terminalStatus
    const stats = toJsonRecord(JSON.parse(run.statsJson))
    const lifecycleCounts = await freezeConnectorRunLifecycleCounts(transaction, mapConnectorRun(run))
    await transaction.update(connectorRuns).set({
      status: terminalStatus,
      completedAt: input.completedAt,
      statsJson: JSON.stringify({
        ...stats,
        completed: true,
        lifecycleCounts,
        running: false,
      }),
      updatedAt: input.completedAt,
    }).where(eq(connectorRuns.id, input.connectorRunId))
    await finalizeInProgressConnectorSynchronization(
      transaction,
      input.connectorRunId,
      terminalStatus === 'failed'
        ? { kind: 'failed', reason: 'normalization_retry_failed' }
        : { kind: 'yielded', reason: 'invocation_budget' },
      input.completedAt,
    )

    const [persisted] = await transaction
        .select()
        .from(connectorRuns)
        .where(eq(connectorRuns.id, input.connectorRunId))
        .limit(1)
    return mapConnectorRun(persisted)
  })
}
