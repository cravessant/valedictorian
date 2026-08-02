import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import {
  connectorCaptureWork,
  connectorInstances,
  connectorRuns,
} from '../../../../db/schema.js'
import type { PgliteDatabase } from '../../../../db/pglite.js'
import { inclusiveCoverageStartFromEarliestBackfillDate } from '../../public/connector.earliest-backfill.js'
import { connectorDisabledExecutionError } from '../../public/connector.execution-errors.js'
import { mapConnectorInstance } from './connector-instance.persistence.js'
import { mapConnectorRun, persistFrozenConnectorRunLifecycleCounts } from './connector-run.persistence.js'
import { stableJsonStringify } from '../../ports/connector.json-values.js'
import {
  mapAcquiredRetryWork,
  restoreUnclaimedConnectorWork,
  retryAdviceFromWork,
  selectPendingRetryWork,
} from './connector.retry-work.js'
import { admitSourceExecutionScope } from '../../../source-execution/source-execution.persistence.js'
import {
  connectorSynchronizationSnapshot,
  writeConnectorRunSynchronization,
} from './connector-synchronization.persistence.js'
import type { AcquiredRetryWork } from '../../ports/connector-retry-work.records.js'
import type {
  RecordConnectorRunRequestInput,
  RecordConnectorRunRequestResult,
} from '../../ports/connector-run.records.js'

export async function recordConnectorRunRequest(
  database: PgliteDatabase,
  input: RecordConnectorRunRequestInput,
): Promise<RecordConnectorRunRequestResult> {
  return database.transaction(async (transaction) => {
    const [instanceRow] = await transaction
      .select()
      .from(connectorInstances)
      .where(
        and(
          eq(connectorInstances.id, input.connectorInstanceId),
          isNull(connectorInstances.deletedAt),
        ),
      )
      .limit(1)
      .for('update')
    if (!instanceRow) {
      throw new Error(`Connector instance not found: ${input.connectorInstanceId}`)
    }
    if (!instanceRow.enabled) {
      throw connectorDisabledExecutionError(input.connectorInstanceId)
    }
    const instance = mapConnectorInstance(instanceRow)
    const now = input.startedAt
    const filters = input.filters ?? instance.filters
    const filterSignature = input.filterSignature ?? `filters:${stableJsonStringify(filters)}`
    const coverageStartedAt = input.coverageStartedAt
      ?? inclusiveCoverageStartFromEarliestBackfillDate(instance.earliestBackfillDate)
    const [activeRun] = await transaction
      .select()
      .from(connectorRuns)
      .where(
        and(
          eq(connectorRuns.connectorInstanceId, input.connectorInstanceId),
          inArray(connectorRuns.status, ['queued', 'running']),
          isNull(connectorRuns.deletedAt),
        ),
      )
      .orderBy(desc(connectorRuns.startedAt), desc(connectorRuns.createdAt), desc(connectorRuns.id))
      .limit(1)
    if (activeRun) {
      return {
        acquired: false,
        acquiredWork: null,
        run: mapConnectorRun(activeRun),
      }
    }
    const admission = await admitSourceExecutionScope(
      transaction, instance.executionScopeId, now,
    )
    if (!admission.admitted) {
      const runId = randomUUID()
      await transaction.insert(connectorRuns).values({
        id: runId, executionScopeId: instance.executionScopeId,
        connectorInstanceId: input.connectorInstanceId, mode: input.mode, status: 'skipped',
        startedAt: now, completedAt: now, coverageStartedAt: input.coverageStartedAt ?? null,
        coverageEndedAt: input.coverageEndedAt ?? null, configJson: JSON.stringify(instance.config),
        filtersJson: JSON.stringify(filters), filterSignature, observationCount: 0, warningCount: 0,
        statsJson: JSON.stringify({ skipped: true, scopeUnavailable: true }), warningsJson: '[]',
        retryHintsJson: 'null', createdAt: now, updatedAt: now, deletedAt: null,
      })
      const boundary = (coverageStartedAt ?? now).slice(0, 10)
      const outcome = admission.blocker === 'action_required'
        ? { kind: 'action_required' as const, operation: { kind: 'authentication_expired' as const, executionScopeId: instance.executionScopeId, requestRefresh: true as const } }
        : { kind: 'cooling_down' as const, operation: { kind: 'scope_rate_limited' as const, executionScopeId: instance.executionScopeId, retryAt: admission.retryAt, serverMinimumDelayMs: null } }
      await writeConnectorRunSynchronization(
        transaction, runId, connectorSynchronizationSnapshot(boundary, outcome), now,
      )
      return {
        acquired: false,
        acquiredWork: null,
        run: await persistFrozenConnectorRunLifecycleCounts(transaction, runId, now),
      }
    }
    const pendingRetry = await selectPendingRetryWork(transaction, {
      connectorInstanceId: input.connectorInstanceId,
      filterSignature,
    })
    if (pendingRetry?.acquisitionRunId) {
      const [acquiredRun] = await transaction.select().from(connectorRuns)
        .where(eq(connectorRuns.id, pendingRetry.acquisitionRunId)).limit(1)
      if (acquiredRun) {
        return {
          acquired: false,
          acquiredWork: null,
          run: mapConnectorRun(acquiredRun),
        }
      }
    }
    const beforeDue = pendingRetry?.status === 'scheduled'
      && pendingRetry.nextEligibleAt !== null
      && Date.parse(now) < Date.parse(pendingRetry.nextEligibleAt)
    const terminal = pendingRetry?.status === 'exhausted' || pendingRetry?.status === 'cancelled'
    if (pendingRetry && (beforeDue || terminal)) {
      if (pendingRetry.skippedRunId) {
        const [existingSkipped] = await transaction.select().from(connectorRuns)
          .where(eq(connectorRuns.id, pendingRetry.skippedRunId)).limit(1)
        if (existingSkipped) {
          return {
            acquired: false,
            acquiredWork: null,
            run: mapConnectorRun(existingSkipped),
          }
        }
      }
      const skippedRunId = randomUUID()
      const adviceState = beforeDue
        ? 'not_due'
        : pendingRetry.status === 'cancelled' ? 'cancelled' : 'exhausted'
      const advice = retryAdviceFromWork(pendingRetry, adviceState)
      await transaction.insert(connectorRuns).values({
        id: skippedRunId,
        executionScopeId: instance.executionScopeId,
        connectorInstanceId: input.connectorInstanceId,
        mode: input.mode,
        status: 'skipped',
        startedAt: now,
        completedAt: now,
        coverageStartedAt: input.coverageStartedAt ?? null,
        coverageEndedAt: input.coverageEndedAt ?? null,
        configJson: JSON.stringify(instance.config),
        filtersJson: JSON.stringify(filters),
        filterSignature,
        observationCount: 0,
        warningCount: 0,
        statsJson: JSON.stringify({ skipped: true, notDue: beforeDue }),
        warningsJson: JSON.stringify([]),
        retryHintsJson: JSON.stringify(advice),
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      const retryOutcome = advice.reason === 'rate_limit' && advice.nextAttemptAt
        ? {
            kind: 'cooling_down' as const,
            operation: {
              kind: 'scope_rate_limited' as const,
              executionScopeId: instance.executionScopeId,
              retryAt: advice.nextAttemptAt,
              serverMinimumDelayMs: advice.serverMinimumDelayMs ?? null,
            },
          }
        : { kind: 'yielded' as const, reason: 'operation_timeout' as const }
      await writeConnectorRunSynchronization(transaction, skippedRunId,
        connectorSynchronizationSnapshot(coverageStartedAt.slice(0, 10), retryOutcome), now)
      await transaction.update(connectorCaptureWork).set({ skippedRunId, updatedAt: now })
        .where(eq(connectorCaptureWork.id, pendingRetry.id))
      return {
        acquired: false,
        acquiredWork: null,
        run: await persistFrozenConnectorRunLifecycleCounts(transaction, skippedRunId, now),
      }
    }
    const runId = randomUUID()
    await transaction
      .insert(connectorRuns)
      .values({
        id: runId,
        executionScopeId: instance.executionScopeId,
        connectorInstanceId: input.connectorInstanceId,
        mode: input.mode,
        status: 'queued',
        startedAt: input.startedAt,
        completedAt: null,
        coverageStartedAt: input.coverageStartedAt ?? null,
        coverageEndedAt: input.coverageEndedAt ?? null,
        configJson: JSON.stringify(instance.config),
        filtersJson: JSON.stringify(filters),
        filterSignature,
        observationCount: 0,
        warningCount: 0,
        statsJson: JSON.stringify({
          queued: true,
          ...(input.dryRun === undefined ? {} : { dryRun: input.dryRun }),
        }),
        warningsJson: JSON.stringify([]),
        retryHintsJson: JSON.stringify(null),
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
    await writeConnectorRunSynchronization(transaction, runId, connectorSynchronizationSnapshot(
      coverageStartedAt.slice(0, 10), { kind: 'in_progress' },
    ), now)
    let acquiredWork: AcquiredRetryWork | null = null
    if (pendingRetry?.status === 'scheduled') {
      const [acquisition] = await transaction.update(connectorCaptureWork).set({
        status: 'claimed',
        claimedAt: now,
        acquisitionToken: randomUUID(),
        acquisitionRunId: runId,
        skippedRunId: null,
        updatedAt: now,
      }).where(and(
        eq(connectorCaptureWork.id, pendingRetry.id),
        eq(connectorCaptureWork.status, 'scheduled'),
      )).returning({ id: connectorCaptureWork.id })
      if (acquisition) {
        // The claim is tentative. The scope row lock keeps other transactions
        // out, but this transaction's own work runs between admission and here,
        // so the scope is admitted again before the claim is kept.
        const readmission = await admitSourceExecutionScope(
          transaction, instance.executionScopeId, now,
        )
        if (readmission.admitted) {
          acquiredWork = mapAcquiredRetryWork(pendingRetry)
        } else {
          await restoreUnclaimedConnectorWork(transaction, pendingRetry, runId)
        }
      }
    }
    const [persisted] = await transaction
      .select()
      .from(connectorRuns)
      .where(eq(connectorRuns.id, runId))
      .limit(1)
    return {
      acquired: true,
      acquiredWork,
      run: mapConnectorRun(persisted),
    }
  })
}
