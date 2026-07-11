import { and, eq, isNull, sql } from 'drizzle-orm'
import {
  connectorRuns,
  retryWork,
} from '../../db/schema'
import type { DrizzleDatabase } from '../../db/sqlite'
import { hasPersistedExactSuccessfulNormalizationAttempt } from '../sourcing/normalization.repository'
import { freezeConnectorRunLifecycleCounts } from './connector.lifecycle-counts'
import {
  mapConnectorRun,
  toJsonRecord,
  upsertConnectorCheckpoint,
} from './connector.repository.helpers'
import type {
  ConnectorCheckpointPayload,
  ConnectorCoverageWindow,
  ConnectorRunRecord,
  ConnectorRunTerminalStatus,
} from './connector.repository.types'
import { assertValidJobrightV4CheckpointRetryState } from './connector.retry-work'

export type ExactAcquiredNormalizationFinalizationMode =
  | 'require-persisted-exact-success'
  | 'complete-only-on-persisted-exact-success'

export function releaseAcquiredNormalizationWorkForRun(
  database: DrizzleDatabase,
  input: {
    connectorRunId: string
    completedAt: string
  },
) {
  try {
    // A failed finalization transaction can leave SQLite needing an explicit
    // rollback before later release statements can apply.
    database.run(sql`rollback`)
  } catch {
    // No open transaction to roll back.
  }
  database.update(retryWork).set({
    state: 'scheduled',
    acquiredAt: null,
    acquisitionToken: null,
    acquisitionRunId: null,
    updatedAt: input.completedAt,
  }).where(and(
    eq(retryWork.state, 'acquired'),
    eq(retryWork.acquisitionRunId, input.connectorRunId),
    isNull(retryWork.deletedAt),
  )).run()
}

export function finalizeExactAcquiredNormalizationRetry(
  database: DrizzleDatabase,
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
): ConnectorRunRecord {
  return database.transaction((transaction) => {
    const run = transaction
      .select()
      .from(connectorRuns)
      .where(and(
        eq(connectorRuns.id, input.connectorRunId),
        eq(connectorRuns.connectorInstanceId, input.connectorInstanceId),
        eq(connectorRuns.status, 'running'),
        isNull(connectorRuns.deletedAt),
      ))
      .get()
    if (!run) {
      throw new Error(`Running connector run not found: ${input.connectorRunId}`)
    }

    const work = transaction.select().from(retryWork).where(and(
      eq(retryWork.id, input.acquiredRetryWork.retryWorkId),
      eq(retryWork.kind, 'normalization'),
      eq(retryWork.rawRevisionId, input.acquiredRetryWork.rawRevisionId),
      eq(retryWork.resolverId, input.acquiredRetryWork.resolverId),
      eq(retryWork.resolverVersion, input.acquiredRetryWork.resolverVersion),
      eq(retryWork.inputHash, input.acquiredRetryWork.inputHash),
      isNull(retryWork.deletedAt),
    )).get()
    if (!work) {
      throw new Error('Exact acquired normalization retry identity was not found for finalization')
    }

    const exactSuccess = hasPersistedExactSuccessfulNormalizationAttempt(transaction, {
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

    assertValidJobrightV4CheckpointRetryState(input.checkpoint)
    upsertConnectorCheckpoint(
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
      transaction.update(retryWork).set({
        state: 'completed',
        nextAttemptAt: null,
        acquiredAt: null,
        acquisitionToken: null,
        acquisitionRunId: null,
        updatedAt: input.completedAt,
      }).where(eq(retryWork.id, work.id)).run()
    } else if (work.state === 'acquired') {
      transaction.update(retryWork).set({
        state: 'scheduled',
        nextAttemptAt: work.nextAttemptAt,
        acquiredAt: null,
        acquisitionToken: null,
        acquisitionRunId: null,
        updatedAt: input.completedAt,
      }).where(eq(retryWork.id, work.id)).run()
    }

    const terminalStatus = exactSuccess ? 'completed' : input.terminalStatus
    const stats = toJsonRecord(JSON.parse(run.statsJson))
    const lifecycleCounts = freezeConnectorRunLifecycleCounts(database, mapConnectorRun(run))
    transaction.update(connectorRuns).set({
      status: terminalStatus,
      completedAt: input.completedAt,
      statsJson: JSON.stringify({
        ...stats,
        completed: true,
        lifecycleCounts,
        running: false,
      }),
      updatedAt: input.completedAt,
    }).where(eq(connectorRuns.id, input.connectorRunId)).run()

    return mapConnectorRun(
      transaction
        .select()
        .from(connectorRuns)
        .where(eq(connectorRuns.id, input.connectorRunId))
        .get(),
    )
  }, { behavior: 'immediate' })
}
