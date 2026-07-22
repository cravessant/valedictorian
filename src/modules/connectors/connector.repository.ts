import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm'
import {
  connectorCheckpoints,
  connectorInstances,
  connectorObservations,
  connectorRuns,
  connectorRunSynchronizations,
  retryWork,
  sourceExecutionScopes,
} from '../../db/schema'
import type { PgliteDatabase } from '../../db/pglite'
import {
  assertPersistedEarliestBackfillDate,
  defaultEarliestBackfillDate,
  inclusiveCoverageStartFromEarliestBackfillDate,
} from './connector.earliest-backfill'
import { freezeConnectorRunLifecycleCounts } from './connector.lifecycle-counts'
import { createConnectorInstance, mapConnectorInstance, normalizeConnectorAuthReferences } from './connector-instance.persistence'
import { copyConnectorCheckpointIfAbsent, upsertConnectorCheckpoint, mapConnectorCheckpoint } from './connector-checkpoint.persistence'
import {
  mapConnectorRun,
  persistFrozenConnectorRunLifecycleCounts,
  readConnectorWarnings,
} from './connector-run.persistence'
import { mapConnectorObservation } from './connector-observation.persistence'
import { stableJsonStringify, toJsonRecord } from './connector.persistence-json'
import {
  mapAcquiredRetryWork,
  parseRetryAdviceJson,
  retryAdviceFromWork,
  selectPendingRetryWork,
  synchronizeConnectorRetryWork,
} from './connector.retry-work'
import { recoverInterruptedConnectorRuns } from './connector.repository.recovery'
import { connectorDisabledExecutionError } from './connector-execution.errors'
export type * from './connector-instance.persistence-types'
export type * from './connector-checkpoint.persistence-types'
export type * from './connector-observation.persistence-types'
export type * from './connector-run.persistence-types'
export type * from './connector-retry-work.identity-types'
export type * from './connector-status.persistence-types'
import type { UpsertConnectorInstanceInput, ConnectorInstanceRecord } from './connector-instance.persistence-types'
import type { RecordConnectorCheckpointInput, GetConnectorCheckpointInput, ConnectorCheckpointRecord, ListConnectorCheckpointsInput } from './connector-checkpoint.persistence-types'
import type { ConnectorObservationRecord, ListConnectorObservationsInput } from './connector-observation.persistence-types'
import type { RecordConnectorRefreshResultInput, RecordConnectorRunRequestInput, RecordConnectorRunRequestResult, RecordConnectorRunFailureInput, RecordConnectorRunSkippedInput, MarkConnectorRunFailedInput, MarkConnectorRunRunningInput, RecoverInterruptedConnectorRunsInput, UpdateConnectorRunProgressInput, CompleteConnectorRunInput, ConnectorRunRecord, ListConnectorRunsInput, ListConnectorRunsResult } from './connector-run.persistence-types'
import type { AcquiredRetryWork } from './connector-retry-work.identity-types'
import type { ConnectorStatusSummaryRecord } from './connector-status.persistence-types'
import { deriveSourceExecutionScopeId } from '../source-execution/source-execution-governor'
import {
  connectorSynchronizationSnapshot,
  finalizeInProgressConnectorSynchronization,
  latestSynchronizedConnectorRun,
  readConnectorRunSynchronization,
  updateConnectorSynchronizationOutcome,
  writeConnectorRunSynchronization,
} from './connector-synchronization.persistence'
import { listConnectorOverviewStatusPage } from './connector-overview.persistence'
import { listConnectorRunsSnapshot } from './connector-run-list.persistence'
export function createPgliteConnectorRepository(
  database: PgliteDatabase,
) {
  return {
    async getRunSynchronization(connectorRunId: string) {
      return readConnectorRunSynchronization(database, connectorRunId)
    },
    async createInstance(input: UpsertConnectorInstanceInput): Promise<ConnectorInstanceRecord> {
      return createConnectorInstance(database, input)
    },
    async upsertInstance(input: UpsertConnectorInstanceInput): Promise<ConnectorInstanceRecord> {
      const now = new Date().toISOString()
      const createdAt = input.createdAt ?? now
      const auth = normalizeConnectorAuthReferences(input.auth ?? [])
      const executionScopeId = deriveSourceExecutionScopeId(input.id)
      return database.transaction(async (transaction) => {
      await transaction.insert(sourceExecutionScopes).values({
        id: executionScopeId, createdAt, updatedAt: createdAt, deletedAt: null,
      }).onConflictDoNothing()
      const [existing] = await transaction
        .select({
          id: connectorInstances.id,
          earliestBackfillDate: connectorInstances.earliestBackfillDate,
        })
        .from(connectorInstances)
        .where(and(eq(connectorInstances.id, input.id), isNull(connectorInstances.deletedAt)))
        .limit(1)
      if (existing) {
        const earliestBackfillDate = input.earliestBackfillDate === undefined
          ? assertPersistedEarliestBackfillDate(existing.earliestBackfillDate)
          : assertPersistedEarliestBackfillDate(input.earliestBackfillDate)
        await transaction
          .update(connectorInstances)
          .set({
            connectorId: input.connectorId,
            executionScopeId,
            connectorVersion: input.connectorVersion,
            displayName: input.displayName,
            enabled: input.enabled,
            authJson: JSON.stringify(auth),
            configJson: JSON.stringify(input.config ?? {}),
            filtersJson: JSON.stringify(input.filters ?? {}),
            earliestBackfillDate,
            updatedAt: now,
          })
          .where(eq(connectorInstances.id, input.id))
      } else {
        const earliestBackfillDate = input.earliestBackfillDate === undefined
          ? defaultEarliestBackfillDate(createdAt)
          : assertPersistedEarliestBackfillDate(input.earliestBackfillDate)
        await transaction
          .insert(connectorInstances)
          .values({
            id: input.id,
            executionScopeId,
            connectorId: input.connectorId,
            connectorVersion: input.connectorVersion,
            displayName: input.displayName,
            enabled: input.enabled,
            authJson: JSON.stringify(auth),
            configJson: JSON.stringify(input.config ?? {}),
            filtersJson: JSON.stringify(input.filters ?? {}),
            earliestBackfillDate,
            createdAt,
            updatedAt: now,
            deletedAt: null,
          })
      }
      const [persisted] = await transaction.select().from(connectorInstances)
        .where(and(eq(connectorInstances.id, input.id), isNull(connectorInstances.deletedAt))).limit(1)
      if (!persisted) throw new Error(`Connector instance not found: ${input.id}`)
      return mapConnectorInstance(persisted)
      })
    },
    async recordRefreshResult(
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
          preserveAcquiredNormalizationWork: input.preserveAcquiredNormalizationWork === true,
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
    },
    async recordCheckpoint(
      input: RecordConnectorCheckpointInput,
    ): Promise<ConnectorCheckpointRecord> {
      const instance = await this.getInstance(input.connectorInstanceId)
      if (!instance) {
        throw new Error(`Connector instance not found: ${input.connectorInstanceId}`)
      }
      await upsertConnectorCheckpoint(database, input, new Date().toISOString())
      const checkpoint = await this.getCheckpoint({
        connectorInstanceId: input.connectorInstanceId,
        filterSignature: input.filterSignature,
      })
      if (!checkpoint) {
        throw new Error(`Connector checkpoint not found after insert: ${input.connectorInstanceId}`)
      }
      return checkpoint
    },
    async copyCheckpointIfAbsent(input: Parameters<typeof copyConnectorCheckpointIfAbsent>[1]) {
      await copyConnectorCheckpointIfAbsent(database, input, new Date().toISOString())
    },
    async recordRunRequest(
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
        await transaction.update(sourceExecutionScopes).set({
          status: 'available', blockedUntil: null, backoffAttempt: 0, updatedAt: now,
        }).where(and(
          eq(sourceExecutionScopes.id, instance.executionScopeId),
          eq(sourceExecutionScopes.status, 'cooldown'),
          lte(sourceExecutionScopes.blockedUntil, now),
        ))
        const [executionScope] = await transaction.select().from(sourceExecutionScopes)
          .where(eq(sourceExecutionScopes.id, instance.executionScopeId)).limit(1)
        const scopeAvailable = executionScope !== undefined
          && executionScope.status !== 'action_required'
          && executionScope.status !== 'refreshing'
          && (executionScope.blockedUntil === null || executionScope.blockedUntil <= now)
        if (!scopeAvailable) {
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
          const actionRequired = executionScope?.status === 'action_required' || executionScope?.status === 'refreshing'
          const outcome = actionRequired
            ? { kind: 'action_required' as const, operation: { kind: 'authentication_expired' as const, executionScopeId: instance.executionScopeId, requestRefresh: true as const } }
            : { kind: 'cooling_down' as const, operation: { kind: 'scope_rate_limited' as const, executionScopeId: instance.executionScopeId, retryAt: executionScope?.blockedUntil ?? now, serverMinimumDelayMs: null } }
          await writeConnectorRunSynchronization(
            transaction, runId, connectorSynchronizationSnapshot(boundary, outcome), now,
          )
          return {
            acquired: false,
            acquiredWork: null,
            run: await persistFrozenConnectorRunLifecycleCounts(transaction, runId, now),
          }
        }
        const retrySelection = {
          connectorInstanceId: input.connectorInstanceId,
          connectorId: instance.connectorId,
          executionScopeId: instance.executionScopeId,
          coverageStartedAt,
          filterSignature,
          now, ...(input.retryKind === undefined ? {} : { retryKind: input.retryKind }),
        }
        const pendingRetry = await selectPendingRetryWork(transaction, retrySelection)
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
        const beforeDue = pendingRetry?.state === 'scheduled'
          && pendingRetry.nextAttemptAt !== null
          && Date.parse(now) < Date.parse(pendingRetry.nextAttemptAt)
        const terminal = pendingRetry?.state === 'exhausted' || pendingRetry?.state === 'cancelled'
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
            : pendingRetry.state === 'cancelled' ? 'cancelled' : 'exhausted'
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
          await transaction.update(retryWork).set({ skippedRunId, updatedAt: now })
            .where(eq(retryWork.id, pendingRetry.id))
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
        if (pendingRetry?.state === 'scheduled') {
          const [acquisition] = await transaction.update(retryWork).set({
            state: 'acquired',
            acquiredAt: now,
            acquisitionToken: randomUUID(),
            acquisitionRunId: runId,
            skippedRunId: null,
            updatedAt: now,
          }).where(and(
            eq(retryWork.id, pendingRetry.id),
            eq(retryWork.state, 'scheduled'),
            sql`exists (
              select 1 from source_execution_scopes scope
              where scope.id = ${retryWork.executionScopeId}
                and scope.status in ('available', 'cooldown')
                and (scope.blocked_until is null or scope.blocked_until <= ${now})
            )`,
          )).returning({ id: retryWork.id })
          if (acquisition) {
            await transaction.update(sourceExecutionScopes).set({
              status: 'available', blockedUntil: null, backoffAttempt: 0, updatedAt: now,
            }).where(and(
              eq(sourceExecutionScopes.id, pendingRetry.executionScopeId),
              eq(sourceExecutionScopes.status, 'cooldown'),
              lte(sourceExecutionScopes.blockedUntil, now),
            ))
            acquiredWork = mapAcquiredRetryWork(pendingRetry)
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
    },
    async recordRunFailure(input: RecordConnectorRunFailureInput): Promise<ConnectorRunRecord> {
      const instance = await this.getInstance(input.connectorInstanceId)
      if (!instance) {
        throw new Error(`Connector instance not found: ${input.connectorInstanceId}`)
      }
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
    },
    async claimQueuedRunToRunning(input: MarkConnectorRunRunningInput): Promise<{
      claimed: boolean
      run: ConnectorRunRecord
    }> {
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
    },
    async markRunRunning(input: MarkConnectorRunRunningInput): Promise<ConnectorRunRecord> {
      const claim = await this.claimQueuedRunToRunning(input)
      if (!claim.claimed) {
        throw new Error(`Queued connector run not found: ${input.connectorRunId}`)
      }
      return claim.run
    },
    async recoverInterruptedRuns(input: RecoverInterruptedConnectorRunsInput): Promise<number> {
      return recoverInterruptedConnectorRuns(database, input)
    },
    async updateRunProgress(
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
    },
    async completeRun(input: CompleteConnectorRunInput): Promise<ConnectorRunRecord> {
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
    },
    async recordRunSkipped(input: RecordConnectorRunSkippedInput): Promise<ConnectorRunRecord> {
      const instance = await this.getInstance(input.connectorInstanceId)
      if (!instance) {
        throw new Error(`Connector instance not found: ${input.connectorInstanceId}`)
      }
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
    },
    async markRunFailed(input: MarkConnectorRunFailedInput): Promise<ConnectorRunRecord> {
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
        await transaction.update(retryWork).set({
          state: 'scheduled', acquiredAt: null, acquisitionToken: null,
          acquisitionRunId: null, updatedAt: input.completedAt,
        }).where(and(
          eq(retryWork.state, 'acquired'),
          eq(retryWork.acquisitionRunId, input.connectorRunId),
          isNull(retryWork.deletedAt),
        ))
        return persistFrozenConnectorRunLifecycleCounts(
          transaction, input.connectorRunId, input.completedAt,
        )
      })
    },
    async getRun(connectorRunId: string): Promise<ConnectorRunRecord | null> {
      const [row] = await database
        .select()
        .from(connectorRuns)
        .where(and(eq(connectorRuns.id, connectorRunId), isNull(connectorRuns.deletedAt)))
        .limit(1)
      return row ? mapConnectorRun(row) : null
    },
    async getInstance(connectorInstanceId: string): Promise<ConnectorInstanceRecord | null> {
      const [row] = await database
        .select()
        .from(connectorInstances)
        .where(
          and(eq(connectorInstances.id, connectorInstanceId), isNull(connectorInstances.deletedAt)),
        )
        .limit(1)
      return row ? mapConnectorInstance(row) : null
    },
    async listInstances(): Promise<ConnectorInstanceRecord[]> {
      return (await database
        .select()
        .from(connectorInstances)
        .where(isNull(connectorInstances.deletedAt))
        .orderBy(asc(connectorInstances.displayName), asc(connectorInstances.createdAt), asc(connectorInstances.id)))
        .map(mapConnectorInstance)
    },
    async getStatusSummary(
      connectorInstanceId: string,
    ): Promise<ConnectorStatusSummaryRecord | null> {
      const [row] = await database
        .select()
        .from(connectorInstances)
        .where(
          and(eq(connectorInstances.id, connectorInstanceId), isNull(connectorInstances.deletedAt)),
        )
        .limit(1)
      if (!row) {
        return null
      }
      return {
        ...mapConnectorInstance(row),
        latestRun: await latestSynchronizedConnectorRun(database, row.id),
      }
    },
    async listStatusSummaries(): Promise<ConnectorStatusSummaryRecord[]> {
      const rows = await database
        .select()
        .from(connectorInstances)
        .where(and(eq(connectorInstances.enabled, true), isNull(connectorInstances.deletedAt)))
        .orderBy(asc(connectorInstances.displayName), asc(connectorInstances.createdAt), asc(connectorInstances.id))
      return Promise.all(rows.map(async (row) => ({
        ...mapConnectorInstance(row),
        latestRun: await latestSynchronizedConnectorRun(database, row.id),
      })))
    },
    async listOverviewStatusSummaries(
      input: Parameters<typeof listConnectorOverviewStatusPage>[1],
    ) {
      return listConnectorOverviewStatusPage(database, input)
    },
    async getCheckpoint(
      input: GetConnectorCheckpointInput,
    ): Promise<ConnectorCheckpointRecord | null> {
      const [row] = await database
        .select()
        .from(connectorCheckpoints)
        .where(
          and(
            eq(connectorCheckpoints.connectorInstanceId, input.connectorInstanceId),
            eq(connectorCheckpoints.filterSignature, input.filterSignature),
            isNull(connectorCheckpoints.deletedAt),
          ),
        )
        .limit(1)
      return row ? mapConnectorCheckpoint(row) : null
    },
    async listRuns(input: ListConnectorRunsInput): Promise<ListConnectorRunsResult> {
      return listConnectorRunsSnapshot(database, input)
    },
    async listCheckpoints(
      input: ListConnectorCheckpointsInput,
    ): Promise<ConnectorCheckpointRecord[]> {
      return (await database
        .select()
        .from(connectorCheckpoints)
        .where(
          and(
            eq(connectorCheckpoints.connectorInstanceId, input.connectorInstanceId),
            isNull(connectorCheckpoints.deletedAt),
          ),
        ))
        .map(mapConnectorCheckpoint)
        .filter(
          (checkpoint) =>
            input.filterSignature === undefined ||
            checkpoint.filterSignature === input.filterSignature,
        )
    },
    async listObservations(
      input: ListConnectorObservationsInput,
    ): Promise<ConnectorObservationRecord[]> {
      return (await database
        .select()
        .from(connectorObservations)
        .where(
          and(
            eq(connectorObservations.connectorInstanceId, input.connectorInstanceId),
            isNull(connectorObservations.deletedAt),
          ),
        ))
        .map(mapConnectorObservation)
        .filter(
          (observation) =>
            input.connectorRunId === undefined ||
            observation.connectorRunId === input.connectorRunId,
        )
    },
    async getObservation(connectorObservationId: string): Promise<ConnectorObservationRecord | null> {
      const [row] = await database
        .select()
        .from(connectorObservations)
        .where(
          and(
            eq(connectorObservations.id, connectorObservationId),
            isNull(connectorObservations.deletedAt),
          ),
        )
        .limit(1)
      return row ? mapConnectorObservation(row) : null
    },
  }
}
function genericTerminalSynchronizationOutcome(status: CompleteConnectorRunInput['status']) {
  if (status === 'failed') return { kind: 'failed' as const, reason: 'connector_run_failed' }
  if (status === 'cancelled') {
    return { kind: 'cancelled' as const, reason: 'connector_run_cancelled' }
  }
  return { kind: 'yielded' as const, reason: 'invocation_budget' as const }
}
