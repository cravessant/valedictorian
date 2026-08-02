import { randomUUID } from 'node:crypto'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import {
  connectorCaptureWork,
  connectorInstances,
  connectorObservations,
  connectorRuns,
  connectorRunSynchronizations,
} from '../../../../db/schema.js'
import type { PgliteDatabase } from '../../../../db/pglite.js'
import { inclusiveCoverageStartFromEarliestBackfillDate } from '../../public/connector.earliest-backfill.js'
import { freezeConnectorRunLifecycleCounts } from './connector.lifecycle-counts.js'
import { upsertConnectorCheckpoint } from './connector-checkpoint.persistence.js'
import {
  mapConnectorRun,
  persistFrozenConnectorRunLifecycleCounts,
  readConnectorWarnings,
} from './connector-run.persistence.js'
import { stableJsonStringify, toJsonRecord } from '../../ports/connector.json-values.js'
import { parseRetryAdviceJson, synchronizeConnectorRetryWork } from './connector.retry-work.js'
import { recoverInterruptedConnectorRuns } from './connector.repository.recovery.js'
import {
  connectorSynchronizationSnapshot,
  finalizeInProgressConnectorSynchronization,
  updateConnectorSynchronizationOutcome,
  writeConnectorRunSynchronization,
} from './connector-synchronization.persistence.js'
import { listConnectorRunsSnapshot } from './connector-run-list.persistence.js'
import type { ConnectorInstanceRecord } from '../../ports/connector-instance.records.js'
import type {
  CompleteConnectorRunInput,
  ConnectorRunRecord,
  ListConnectorRunsInput,
  ListConnectorRunsResult,
  MarkConnectorRunFailedInput,
  MarkConnectorRunRunningInput,
  RecordConnectorRefreshResultInput,
  RecordConnectorRunFailureInput,
  RecordConnectorRunSkippedInput,
  RecoverInterruptedConnectorRunsInput,
  UpdateConnectorRunProgressInput,
} from '../../ports/connector-run.records.js'

type RequireInstance = (connectorInstanceId: string) => Promise<ConnectorInstanceRecord>

export async function recordConnectorRefreshResult(
  database: PgliteDatabase,
  input: RecordConnectorRefreshResultInput,
): Promise<ConnectorRunRecord> {
  return database.transaction(async (transaction) => {
    const [instance] = await transaction
      .select({ id: connectorInstances.id, connectorVersion: connectorInstances.connectorVersion, executionScopeId: connectorInstances.executionScopeId })
      .from(connectorInstances)
      .where(
        and(
          eq(connectorInstances.id, input.connectorInstanceId),
          isNull(connectorInstances.deletedAt),
        ),
      )
      .limit(1)
    if (!instance) {
      throw new Error(`Connector instance not found: ${input.connectorInstanceId}`)
    }
    const now = new Date().toISOString()
    const runId = input.connectorRunId ?? randomUUID()
    const observationCount = input.result.observations.length
    const warningCount = input.result.warnings.length
    const [activeRun] = input.connectorRunId
      ? await transaction
        .select({ id: connectorRuns.id })
        .from(connectorRuns)
        .where(
          and(
            eq(connectorRuns.id, input.connectorRunId),
            eq(connectorRuns.connectorInstanceId, input.connectorInstanceId),
            inArray(connectorRuns.status, ['queued', 'running']),
            isNull(connectorRuns.deletedAt),
          ),
        )
        .limit(1)
      : []
    if (input.connectorRunId && !activeRun) {
      throw new Error(`Active connector run not found: ${input.connectorRunId}`)
    }
    const deferTerminal = Boolean(
      activeRun && (input.checkpointPersistence ?? 'immediate') === 'deferred',
    )
    const terminalValues = {
      mode: input.mode,
      status: deferTerminal ? 'running' : input.result.status,
      startedAt: input.startedAt,
      completedAt: deferTerminal ? null : input.completedAt,
      coverageStartedAt: input.result.coverage.start,
      coverageEndedAt: input.result.coverage.end,
      configJson: JSON.stringify(input.config),
      filtersJson: JSON.stringify(input.filters),
      filterSignature: input.filterSignature,
      observationCount,
      warningCount,
      statsJson: JSON.stringify({
        ...input.result.stats,
        ...(deferTerminal ? { refreshCompleted: true, running: true } : {}),
      }),
      warningsJson: JSON.stringify(input.result.warnings),
      retryHintsJson: JSON.stringify(input.result.retryHints ?? null),
      updatedAt: now,
      deletedAt: null,
    }
    if (activeRun) {
      await transaction
        .update(connectorRuns)
        .set(terminalValues)
        .where(eq(connectorRuns.id, runId))
    } else {
      await transaction
        .insert(connectorRuns)
        .values({
          id: runId,
          executionScopeId: instance.executionScopeId,
          connectorInstanceId: input.connectorInstanceId,
          ...terminalValues,
          createdAt: now,
        })
    }
    await transaction.insert(connectorRunSynchronizations).values({
      connectorRunId: runId,
      snapshotJson: JSON.stringify(input.result.synchronization),
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: connectorRunSynchronizations.connectorRunId,
      set: { snapshotJson: JSON.stringify(input.result.synchronization), updatedAt: now },
    })
    if ((input.checkpointPersistence ?? 'immediate') === 'immediate') {
      await upsertConnectorCheckpoint(
        transaction,
        {
          connectorInstanceId: input.connectorInstanceId,
          filterSignature: input.filterSignature,
          checkpoint: input.result.nextCheckpoint,
          coverage: input.result.coverage,
          savedAt: input.completedAt,
        },
        now,
      )
    }
    await synchronizeConnectorRetryWork(transaction, {
      advice: input.result.retryHints ?? null,
      checkpoint: input.result.nextCheckpoint,
      checkpointSchemaVersion: input.result.nextCheckpoint.schemaVersion,
      connectorInstanceId: input.connectorInstanceId,
      connectorVersion: instance.connectorVersion,
      executionScopeId: instance.executionScopeId ?? (() => { throw new Error('Connector instance is missing execution scope identity') })(),
      filterSignature: input.filterSignature,
      now,
      runId,
    })
    for (const observation of input.result.observations) {
      await transaction
        .insert(connectorObservations)
        .values({
          id: randomUUID(),
          connectorInstanceId: input.connectorInstanceId,
          connectorRunId: runId,
          connectorId: observation.connectorId,
          connectorVersion: observation.connectorVersion,
          parserVersion: observation.parserVersion ?? null,
          observationSchemaVersion: observation.observationSchemaVersion ?? null,
          sourceRecordKey: observation.sourceRecordKey,
          observedAt: observation.observedAt,
          companyName: observation.companyName,
          roleTitle: observation.roleTitle,
          locationRaw: observation.locationRaw ?? null,
          descriptionText: observation.descriptionText ?? null,
          payJson: JSON.stringify(observation.pay ?? null),
          linksJson: JSON.stringify(observation.links),
          resolutionJson: JSON.stringify(observation.resolution),
          dedupeKeysJson: JSON.stringify(observation.dedupeKeys),
          sourceMetadataJson: JSON.stringify(observation.sourceMetadata ?? {}),
          evidenceJson: JSON.stringify(observation.evidence),
          rawJson: JSON.stringify(observation),
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        })
    }
    if (deferTerminal) {
      const [persisted] = await transaction.select().from(connectorRuns)
        .where(eq(connectorRuns.id, runId)).limit(1)
      return mapConnectorRun(persisted)
    }
    return persistFrozenConnectorRunLifecycleCounts(transaction, runId, now)
  })
}

export async function recordConnectorRunFailure(
  database: PgliteDatabase,
  requireInstance: RequireInstance,
  input: RecordConnectorRunFailureInput,
): Promise<ConnectorRunRecord> {
  const instance = await requireInstance(input.connectorInstanceId)
  const now = new Date().toISOString()
  const filters = input.filters ?? instance.filters
  const filterSignature = input.filterSignature ?? `filters:${stableJsonStringify(filters)}`
  const runId = randomUUID()
  await database
    .insert(connectorRuns)
    .values({
      id: runId,
      executionScopeId: instance.executionScopeId,
      connectorInstanceId: input.connectorInstanceId,
      mode: input.mode,
      status: 'failed',
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      coverageStartedAt: input.coverageStartedAt ?? null,
      coverageEndedAt: input.coverageEndedAt ?? null,
      configJson: JSON.stringify(instance.config),
      filtersJson: JSON.stringify(filters),
      filterSignature,
      observationCount: 0,
      warningCount: 1,
      statsJson: JSON.stringify(input.stats ?? { failed: true }),
      warningsJson: JSON.stringify([input.warning]),
      retryHintsJson: JSON.stringify(input.retryHints ?? null),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
  await writeConnectorRunSynchronization(database, runId, connectorSynchronizationSnapshot(
    (input.coverageStartedAt ?? input.startedAt).slice(0, 10),
    { kind: 'failed', reason: input.warning.code },
  ), now)
  return persistFrozenConnectorRunLifecycleCounts(database, runId, now)
}

export async function claimQueuedConnectorRunToRunning(
  database: PgliteDatabase,
  input: MarkConnectorRunRunningInput,
): Promise<{ claimed: boolean; run: ConnectorRunRecord }> {
  const [existing] = await database
    .select()
    .from(connectorRuns)
    .where(and(
      eq(connectorRuns.id, input.connectorRunId),
      isNull(connectorRuns.deletedAt),
    ))
    .limit(1)
  if (!existing) {
    throw new Error(`Connector run not found: ${input.connectorRunId}`)
  }
  const stats = toJsonRecord(JSON.parse(existing.statsJson))
  const updatedAt = new Date().toISOString()
  const [updated] = await database
    .update(connectorRuns)
    .set({
      status: 'running',
      startedAt: input.startedAt,
      statsJson: JSON.stringify({
        ...stats,
        queued: false,
        running: true,
      }),
      updatedAt,
    })
    .where(and(
      eq(connectorRuns.id, input.connectorRunId),
      eq(connectorRuns.status, 'queued'),
      isNull(connectorRuns.deletedAt),
    ))
    .returning({ id: connectorRuns.id })
  const [persisted] = await database
      .select()
      .from(connectorRuns)
      .where(eq(connectorRuns.id, input.connectorRunId))
      .limit(1)
  const run = mapConnectorRun(persisted)
  return {
    claimed: Boolean(updated),
    run,
  }
}

export async function recoverInterruptedConnectorRunRecords(
  database: PgliteDatabase,
  input: RecoverInterruptedConnectorRunsInput,
): Promise<number> {
  return recoverInterruptedConnectorRuns(database, input)
}

export async function updateConnectorRunProgress(
  database: PgliteDatabase,
  input: UpdateConnectorRunProgressInput,
): Promise<ConnectorRunRecord> {
  const [row] = await database
    .select()
    .from(connectorRuns)
    .where(and(eq(connectorRuns.id, input.connectorRunId), isNull(connectorRuns.deletedAt)))
    .limit(1)
  if (!row) {
    throw new Error(`Connector run not found: ${input.connectorRunId}`)
  }
  const now = new Date().toISOString()
  const currentStats = toJsonRecord(JSON.parse(row.statsJson))
  await database
    .update(connectorRuns)
    .set({
      statsJson: JSON.stringify({
        ...currentStats,
        ...input.stats,
      }),
      updatedAt: now,
    })
    .where(eq(connectorRuns.id, input.connectorRunId))
  const [persisted] = await database
      .select()
      .from(connectorRuns)
      .where(eq(connectorRuns.id, input.connectorRunId))
      .limit(1)
  return mapConnectorRun(persisted)
}

export async function completeConnectorRun(
  database: PgliteDatabase,
  input: CompleteConnectorRunInput,
): Promise<ConnectorRunRecord> {
  return database.transaction(async (transaction) => {
    const [row] = await transaction
      .select()
      .from(connectorRuns)
      .where(and(
        eq(connectorRuns.id, input.connectorRunId),
        eq(connectorRuns.status, 'running'),
        isNull(connectorRuns.deletedAt),
      )).limit(1).for('update')
    if (!row) {
      throw new Error(`Running connector run not found: ${input.connectorRunId}`)
    }
    const stats = toJsonRecord(JSON.parse(row.statsJson))
    const lifecycleCounts = await freezeConnectorRunLifecycleCounts(transaction, mapConnectorRun(row))
    const [persisted] = await transaction.update(connectorRuns).set({
      status: input.status,
      completedAt: input.completedAt,
      statsJson: JSON.stringify({
        ...stats, completed: true, lifecycleCounts, running: false,
      }),
      updatedAt: input.completedAt,
    }).where(and(
      eq(connectorRuns.id, input.connectorRunId),
      eq(connectorRuns.status, 'running'),
      isNull(connectorRuns.deletedAt),
    )).returning()
    if (!persisted) {
      throw new Error(`Running connector run changed during completion: ${input.connectorRunId}`)
    }
    await finalizeInProgressConnectorSynchronization(
      transaction,
      input.connectorRunId,
      genericTerminalSynchronizationOutcome(input.status),
      input.completedAt,
    )
    return mapConnectorRun(persisted)
  })
}

export async function recordConnectorRunSkipped(
  database: PgliteDatabase,
  requireInstance: RequireInstance,
  input: RecordConnectorRunSkippedInput,
): Promise<ConnectorRunRecord> {
  const instance = await requireInstance(input.connectorInstanceId)
  const now = new Date().toISOString()
  const reason = input.reason ?? 'user_skipped_connector_run'
  const filters = instance.filters
  const runId = randomUUID()
  const coverageStartedAt = inclusiveCoverageStartFromEarliestBackfillDate(
    instance.earliestBackfillDate,
  )
  await database
    .insert(connectorRuns)
    .values({
      id: runId,
      executionScopeId: instance.executionScopeId,
      connectorInstanceId: input.connectorInstanceId,
      mode: input.mode,
      status: 'cancelled',
      startedAt: input.skippedAt,
      completedAt: input.skippedAt,
      coverageStartedAt,
      coverageEndedAt: input.skippedAt,
      configJson: JSON.stringify(instance.config),
      filtersJson: JSON.stringify(filters),
      filterSignature: `filters:${stableJsonStringify(filters)}`,
      observationCount: 0,
      warningCount: 0,
      statsJson: JSON.stringify({ skipped: true, reason }),
      warningsJson: JSON.stringify([]),
      retryHintsJson: JSON.stringify(null),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
  await writeConnectorRunSynchronization(database, runId, connectorSynchronizationSnapshot(
    coverageStartedAt.slice(0, 10), { kind: 'cancelled', reason },
  ), now)
  return persistFrozenConnectorRunLifecycleCounts(database, runId, now)
}

export async function markConnectorRunFailed(
  database: PgliteDatabase,
  input: MarkConnectorRunFailedInput,
): Promise<ConnectorRunRecord> {
  return database.transaction(async (transaction) => {
    const [row] = await transaction
      .select()
      .from(connectorRuns)
      .where(and(
        eq(connectorRuns.id, input.connectorRunId),
        inArray(connectorRuns.status, ['queued', 'running']),
        isNull(connectorRuns.deletedAt),
      ))
      .limit(1)
      .for('update')
    if (!row) {
      throw new Error(`Active connector run not found: ${input.connectorRunId}`)
    }
    const warnings = readConnectorWarnings(row.warningsJson)
    warnings.push(input.warning)
    const retryHints = input.retryHints === undefined
      ? parseRetryAdviceJson(row.retryHintsJson)
      : input.retryHints
    const stats = toJsonRecord(JSON.parse(row.statsJson))
    const recordedFailures = stats.failures
    const [failedRun] = await transaction
      .update(connectorRuns)
      .set({
        status: 'failed',
        completedAt: input.completedAt,
        warningCount: warnings.length,
        statsJson: JSON.stringify({
          ...stats,
          failures: typeof recordedFailures === 'number' && recordedFailures >= 1
            ? recordedFailures
            : 1,
          queued: false,
          running: false,
        }),
        warningsJson: JSON.stringify(warnings),
        retryHintsJson: JSON.stringify(retryHints),
        updatedAt: input.completedAt,
      })
      .where(and(
        eq(connectorRuns.id, input.connectorRunId),
        inArray(connectorRuns.status, ['queued', 'running']),
        isNull(connectorRuns.deletedAt),
      ))
      .returning({ id: connectorRuns.id })
    if (!failedRun) {
      throw new Error(`Active connector run changed during failure: ${input.connectorRunId}`)
    }
    await updateConnectorSynchronizationOutcome(transaction, row.id, {
      kind: 'failed', reason: input.warning.code,
    }, input.completedAt)
    await transaction.update(connectorCaptureWork).set({
      status: 'scheduled', claimedAt: null, acquisitionToken: null,
      acquisitionRunId: null, updatedAt: input.completedAt,
    }).where(and(
      eq(connectorCaptureWork.status, 'claimed'),
      eq(connectorCaptureWork.acquisitionRunId, input.connectorRunId),
    ))
    return persistFrozenConnectorRunLifecycleCounts(
      transaction, input.connectorRunId, input.completedAt,
    )
  })
}

export async function getConnectorRunRecord(
  database: PgliteDatabase,
  connectorRunId: string,
): Promise<ConnectorRunRecord | null> {
  const [row] = await database
    .select()
    .from(connectorRuns)
    .where(and(eq(connectorRuns.id, connectorRunId), isNull(connectorRuns.deletedAt)))
    .limit(1)
  return row ? mapConnectorRun(row) : null
}

export async function listConnectorRunRecords(
  database: PgliteDatabase,
  input: ListConnectorRunsInput,
): Promise<ListConnectorRunsResult> {
  return listConnectorRunsSnapshot(database, input)
}

function genericTerminalSynchronizationOutcome(status: CompleteConnectorRunInput['status']) {
  if (status === 'failed') return { kind: 'failed' as const, reason: 'connector_run_failed' }
  if (status === 'cancelled') {
    return { kind: 'cancelled' as const, reason: 'connector_run_cancelled' }
  }
  return { kind: 'yielded' as const, reason: 'invocation_budget' as const }
}
