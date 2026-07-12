import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import {
  connectorCheckpoints,
  connectorInstances,
  connectorObservations,
  connectorRuns,
  retryWork,
} from '../../db/schema'
import type { DrizzleDatabase } from '../../db/sqlite'
import {
  assertPersistedEarliestBackfillDate,
  defaultEarliestBackfillDate,
  inclusiveCoverageStartFromEarliestBackfillDate,
} from './connector.earliest-backfill'
import {
  freezeConnectorRunLifecycleCounts
} from './connector.lifecycle-counts'
import {
  selectConnectorInstance,
  upsertConnectorCheckpoint,
  mapConnectorInstance,
  normalizeConnectorAuthReferences,
  toJsonRecord,
  stableJsonStringify,
  readConnectorWarnings,
  mapConnectorRun,
  withConnectorRunLifecycleCounts,
  mapConnectorCheckpoint,
  mapConnectorObservation
} from './connector.repository.helpers'
import {
  mapAcquiredRetryWork,
  parseRetryAdviceJson,
  retryAdviceFromWork,
  selectPendingRetryWork,
  synchronizeConnectorRetryWork,
} from './connector.retry-work'
import {
  finalizeExactAcquiredNormalizationRetry,
  releaseAcquiredNormalizationWorkForRun,
} from './connector.repository.exact-retry-finalize'
import { recoverInterruptedConnectorRuns } from './connector.repository.recovery'
export type {
  AcquiredRetryWork,
  ConnectorCoverageWindow,
  ConnectorWarning,
  ConnectorCheckpointPayload,
  ConnectorRunStatus,
  ConnectorRunTerminalStatus,
  ConnectorAuthMode,
  ConnectorAuthReference,
  ConnectorObservationLinks,
  ConnectorObservationResolution,
  ConnectorObservationEvidence,
  ConnectorObservationInput,
  ConnectorRefreshResultInput,
  UpsertConnectorInstanceInput,
  RecordConnectorRefreshResultInput,
  RecordConnectorRunRequestInput,
  RecordConnectorRunRequestResult,
  RecordConnectorRunFailureInput,
  RecordConnectorRunSkippedInput,
  MarkConnectorRunFailedInput,
  MarkConnectorRunRunningInput,
  RecoverInterruptedConnectorRunsInput,
  UpdateConnectorRunProgressInput,
  CompleteConnectorRunInput,
  RecordConnectorCheckpointInput,
  GetConnectorCheckpointInput,
  ConnectorInstanceRecord,
  ConnectorRunRecord,
  ConnectorCheckpointRecord,
  ConnectorObservationRecord,
  ConnectorStatusSummaryRecord,
  ListConnectorRunsInput,
  ListConnectorRunsResult,
  ListConnectorCheckpointsInput,
  ListConnectorObservationsInput,
} from './connector.repository.types'
import type {
  AcquiredRetryWork,
  UpsertConnectorInstanceInput,
  RecordConnectorRefreshResultInput,
  RecordConnectorRunRequestInput,
  RecordConnectorRunRequestResult,
  RecordConnectorRunFailureInput,
  RecordConnectorRunSkippedInput,
  MarkConnectorRunFailedInput,
  MarkConnectorRunRunningInput,
  RecoverInterruptedConnectorRunsInput,
  UpdateConnectorRunProgressInput,
  CompleteConnectorRunInput,
  RecordConnectorCheckpointInput,
  GetConnectorCheckpointInput,
  ConnectorInstanceRecord,
  ConnectorRunRecord,
  ConnectorCheckpointRecord,
  ConnectorObservationRecord,
  ConnectorStatusSummaryRecord,
  ListConnectorRunsInput,
  ListConnectorRunsResult,
  ListConnectorCheckpointsInput,
  ListConnectorObservationsInput
} from './connector.repository.types'

export function createSqliteConnectorRepository(
  database: DrizzleDatabase,
) {
  return {
    async upsertInstance(input: UpsertConnectorInstanceInput): Promise<ConnectorInstanceRecord> {
      const now = new Date().toISOString()
      const createdAt = input.createdAt ?? now
      const auth = normalizeConnectorAuthReferences(input.auth ?? [])
      const existing = database
        .select({
          id: connectorInstances.id,
          earliestBackfillDate: connectorInstances.earliestBackfillDate,
        })
        .from(connectorInstances)
        .where(and(eq(connectorInstances.id, input.id), isNull(connectorInstances.deletedAt)))
        .get()

      if (existing) {
        const earliestBackfillDate = input.earliestBackfillDate === undefined
          ? assertPersistedEarliestBackfillDate(existing.earliestBackfillDate)
          : assertPersistedEarliestBackfillDate(input.earliestBackfillDate)
        database
          .update(connectorInstances)
          .set({
            connectorId: input.connectorId,
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
          .run()
      } else {
        const earliestBackfillDate = input.earliestBackfillDate === undefined
          ? defaultEarliestBackfillDate(createdAt)
          : assertPersistedEarliestBackfillDate(input.earliestBackfillDate)
        database
          .insert(connectorInstances)
          .values({
            id: input.id,
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
          .run()
      }

      return selectConnectorInstance(database, input.id)
    },

    async recordRefreshResult(
      input: RecordConnectorRefreshResultInput,
    ): Promise<ConnectorRunRecord> {
      return database.transaction((transaction) => {
        const instance = transaction
          .select({ id: connectorInstances.id, connectorVersion: connectorInstances.connectorVersion })
          .from(connectorInstances)
          .where(
            and(
              eq(connectorInstances.id, input.connectorInstanceId),
              isNull(connectorInstances.deletedAt),
            ),
          )
          .get()

        if (!instance) {
          throw new Error(`Connector instance not found: ${input.connectorInstanceId}`)
        }

        const now = new Date().toISOString()
        const runId = input.connectorRunId ?? randomUUID()
        const observationCount = input.result.observations.length
        const warningCount = input.result.warnings.length
        const activeRun = input.connectorRunId
          ? transaction
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
            .get()
          : null

        if (input.connectorRunId && !activeRun) {
          throw new Error(`Active connector run not found: ${input.connectorRunId}`)
        }

        const deferTerminal = Boolean(
          activeRun && (input.checkpointPersistence ?? 'immediate') === 'deferred',
        )
        const terminalValues = {
          mode: input.mode,
          status: deferTerminal ? 'running' : input.result.status ?? 'completed',
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
          transaction
            .update(connectorRuns)
            .set(terminalValues)
            .where(eq(connectorRuns.id, runId))
            .run()
        } else {
          transaction
            .insert(connectorRuns)
            .values({
              id: runId,
              connectorInstanceId: input.connectorInstanceId,
              ...terminalValues,
              createdAt: now,
            })
            .run()
        }

        if ((input.checkpointPersistence ?? 'immediate') === 'immediate') {
          upsertConnectorCheckpoint(
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

        synchronizeConnectorRetryWork(transaction, {
          advice: input.result.retryHints ?? null,
          checkpoint: input.result.nextCheckpoint,
          checkpointSchemaVersion: input.result.nextCheckpoint.schemaVersion,
          connectorInstanceId: input.connectorInstanceId,
          connectorVersion: instance.connectorVersion,
          filterSignature: input.filterSignature,
          now,
          preserveAcquiredNormalizationWork: input.preserveAcquiredNormalizationWork === true,
          runId,
        })

        for (const observation of input.result.observations) {
          transaction
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
            .run()
        }

        return mapConnectorRun(
          transaction
            .select()
            .from(connectorRuns)
            .where(eq(connectorRuns.id, runId))
            .get(),
        )
      })
    },

    async recordCheckpoint(
      input: RecordConnectorCheckpointInput,
    ): Promise<ConnectorCheckpointRecord> {
      const instance = await this.getInstance(input.connectorInstanceId)

      if (!instance) {
        throw new Error(`Connector instance not found: ${input.connectorInstanceId}`)
      }

      upsertConnectorCheckpoint(database, input, new Date().toISOString())

      const checkpoint = await this.getCheckpoint({
        connectorInstanceId: input.connectorInstanceId,
        filterSignature: input.filterSignature,
      })

      if (!checkpoint) {
        throw new Error(`Connector checkpoint not found after insert: ${input.connectorInstanceId}`)
      }

      return checkpoint
    },

    async releaseAcquiredNormalizationWorkForRun(input: {
      connectorRunId: string
      completedAt: string
    }): Promise<void> {
      releaseAcquiredNormalizationWorkForRun(database, input)
    },

    async finalizeExactAcquiredNormalizationRetry(input: Parameters<typeof finalizeExactAcquiredNormalizationRetry>[1]): Promise<ConnectorRunRecord> {
      return finalizeExactAcquiredNormalizationRetry(database, input)
    },

    async recordRunRequest(
      input: RecordConnectorRunRequestInput,
    ): Promise<RecordConnectorRunRequestResult> {
      return database.transaction((transaction) => {
        const instanceRow = transaction
          .select()
          .from(connectorInstances)
          .where(
            and(
              eq(connectorInstances.id, input.connectorInstanceId),
              isNull(connectorInstances.deletedAt),
            ),
          )
          .get()

        if (!instanceRow) {
          throw new Error(`Connector instance not found: ${input.connectorInstanceId}`)
        }

        const instance = mapConnectorInstance(instanceRow)
        const now = input.startedAt
        const filters = input.filters ?? instance.filters
        const filterSignature = input.filterSignature ?? `filters:${stableJsonStringify(filters)}`
        const coverageStartedAt = input.coverageStartedAt
          ?? inclusiveCoverageStartFromEarliestBackfillDate(instance.earliestBackfillDate)
        const activeRun = transaction
          .select()
          .from(connectorRuns)
          .where(
            and(
              eq(connectorRuns.connectorInstanceId, input.connectorInstanceId),
              inArray(connectorRuns.status, ['queued', 'running']),
              isNull(connectorRuns.deletedAt),
            ),
          )
          .orderBy(desc(connectorRuns.startedAt), desc(connectorRuns.createdAt))
          .get()

        if (activeRun) {
          return {
            acquired: false,
            acquiredWork: null,
            run: mapConnectorRun(activeRun),
          }
        }

        const pendingRetry = selectPendingRetryWork(transaction, {
          connectorInstanceId: input.connectorInstanceId,
          connectorId: instance.connectorId,
          coverageStartedAt,
          filterSignature,
          now,
        })

        if (pendingRetry?.acquisitionRunId) {
          const acquiredRun = transaction.select().from(connectorRuns)
            .where(eq(connectorRuns.id, pendingRetry.acquisitionRunId)).get()
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
            const existingSkipped = transaction.select().from(connectorRuns)
              .where(eq(connectorRuns.id, pendingRetry.skippedRunId)).get()
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
          transaction.insert(connectorRuns).values({
            id: skippedRunId,
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
          }).run()
          transaction.update(retryWork).set({ skippedRunId, updatedAt: now })
            .where(eq(retryWork.id, pendingRetry.id)).run()
          return {
            acquired: false,
            acquiredWork: null,
            run: mapConnectorRun(transaction.select().from(connectorRuns)
              .where(eq(connectorRuns.id, skippedRunId)).get()),
          }
        }

        const runId = randomUUID()

        transaction
          .insert(connectorRuns)
          .values({
            id: runId,
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
          .run()

        let acquiredWork: AcquiredRetryWork | null = null
        if (pendingRetry?.state === 'scheduled') {
          transaction.update(retryWork).set({
            state: 'acquired',
            acquiredAt: now,
            acquisitionToken: randomUUID(),
            acquisitionRunId: runId,
            skippedRunId: null,
            updatedAt: now,
          }).where(and(eq(retryWork.id, pendingRetry.id), eq(retryWork.state, 'scheduled'))).run()
          acquiredWork = mapAcquiredRetryWork(pendingRetry)
        }

        return {
          acquired: true,
          acquiredWork,
          run: mapConnectorRun(
            transaction
              .select()
              .from(connectorRuns)
              .where(eq(connectorRuns.id, runId))
              .get(),
          ),
        }
      }, { behavior: 'immediate' })
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

      database
        .insert(connectorRuns)
        .values({
          id: runId,
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
        .run()

      return mapConnectorRun(
        database
          .select()
          .from(connectorRuns)
          .where(eq(connectorRuns.id, runId))
          .get(),
      )
    },

    async claimQueuedRunToRunning(input: MarkConnectorRunRunningInput): Promise<{
      claimed: boolean
      run: ConnectorRunRecord
    }> {
      const existing = database
        .select()
        .from(connectorRuns)
        .where(and(
          eq(connectorRuns.id, input.connectorRunId),
          isNull(connectorRuns.deletedAt),
        ))
        .get()

      if (!existing) {
        throw new Error(`Connector run not found: ${input.connectorRunId}`)
      }

      const stats = toJsonRecord(JSON.parse(existing.statsJson))
      const updatedAt = new Date().toISOString()
      const updated = database
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
        .run()

      const run = mapConnectorRun(
        database
          .select()
          .from(connectorRuns)
          .where(eq(connectorRuns.id, input.connectorRunId))
          .get(),
      )

      return {
        claimed: updated.changes === 1,
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

    recoverInterruptedRuns(input: RecoverInterruptedConnectorRunsInput): number {
      return recoverInterruptedConnectorRuns(database, input)
    },

    async updateRunProgress(
      input: UpdateConnectorRunProgressInput,
    ): Promise<ConnectorRunRecord> {
      const row = database
        .select()
        .from(connectorRuns)
        .where(and(eq(connectorRuns.id, input.connectorRunId), isNull(connectorRuns.deletedAt)))
        .get()

      if (!row) {
        throw new Error(`Connector run not found: ${input.connectorRunId}`)
      }

      const now = new Date().toISOString()
      const currentStats = toJsonRecord(JSON.parse(row.statsJson))

      database
        .update(connectorRuns)
        .set({
          statsJson: JSON.stringify({
            ...currentStats,
            ...input.stats,
          }),
          updatedAt: now,
        })
        .where(eq(connectorRuns.id, input.connectorRunId))
        .run()

      return mapConnectorRun(
        database
          .select()
          .from(connectorRuns)
          .where(eq(connectorRuns.id, input.connectorRunId))
          .get(),
      )
    },

    async completeRun(input: CompleteConnectorRunInput): Promise<ConnectorRunRecord> {
      const row = database
        .select()
        .from(connectorRuns)
        .where(
          and(
            eq(connectorRuns.id, input.connectorRunId),
            eq(connectorRuns.status, 'running'),
            isNull(connectorRuns.deletedAt),
          ),
        )
        .get()

      if (!row) {
        throw new Error(`Running connector run not found: ${input.connectorRunId}`)
      }

      const stats = toJsonRecord(JSON.parse(row.statsJson))
      const lifecycleCounts = freezeConnectorRunLifecycleCounts(database, mapConnectorRun(row))

      database
        .update(connectorRuns)
        .set({
          status: input.status,
          completedAt: input.completedAt,
          statsJson: JSON.stringify({
            ...stats,
            completed: true,
            lifecycleCounts,
            running: false,
          }),
          updatedAt: input.completedAt,
        })
        .where(eq(connectorRuns.id, input.connectorRunId))
        .run()

      return mapConnectorRun(
        database
          .select()
          .from(connectorRuns)
          .where(eq(connectorRuns.id, input.connectorRunId))
          .get(),
      )
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

      database
        .insert(connectorRuns)
        .values({
          id: runId,
          connectorInstanceId: input.connectorInstanceId,
          mode: input.mode,
          status: 'skipped',
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
        .run()

      return mapConnectorRun(
        database
          .select()
          .from(connectorRuns)
          .where(eq(connectorRuns.id, runId))
          .get(),
      )
    },

    async markRunFailed(input: MarkConnectorRunFailedInput): Promise<ConnectorRunRecord> {
      return database.transaction((transaction) => {
        const row = transaction
          .select()
          .from(connectorRuns)
          .where(and(eq(connectorRuns.id, input.connectorRunId), isNull(connectorRuns.deletedAt)))
          .get()

        if (!row) {
          throw new Error(`Connector run not found: ${input.connectorRunId}`)
        }

        const warnings = readConnectorWarnings(row.warningsJson)
        warnings.push(input.warning)
        const retryHints = input.retryHints === undefined
          ? parseRetryAdviceJson(row.retryHintsJson)
          : input.retryHints
        const stats = toJsonRecord(JSON.parse(row.statsJson))
        const recordedFailures = stats.failures

        transaction
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
          .where(eq(connectorRuns.id, input.connectorRunId))
          .run()
        transaction.update(retryWork).set({
          state: 'scheduled', acquiredAt: null, acquisitionToken: null,
          acquisitionRunId: null, updatedAt: input.completedAt,
        }).where(and(
          eq(retryWork.state, 'acquired'),
          eq(retryWork.acquisitionRunId, input.connectorRunId),
          isNull(retryWork.deletedAt),
        )).run()

        return mapConnectorRun(
          transaction
          .select()
          .from(connectorRuns)
          .where(eq(connectorRuns.id, input.connectorRunId))
          .get(),
        )
      }, { behavior: 'immediate' })
    },

    async getRun(connectorRunId: string): Promise<ConnectorRunRecord | null> {
      const row = database
        .select()
        .from(connectorRuns)
        .where(and(eq(connectorRuns.id, connectorRunId), isNull(connectorRuns.deletedAt)))
        .get()

      return row ? mapConnectorRun(row) : null
    },

    async getInstance(connectorInstanceId: string): Promise<ConnectorInstanceRecord | null> {
      const row = database
        .select()
        .from(connectorInstances)
        .where(
          and(eq(connectorInstances.id, connectorInstanceId), isNull(connectorInstances.deletedAt)),
        )
        .get()

      return row ? mapConnectorInstance(row) : null
    },

    async listInstances(): Promise<ConnectorInstanceRecord[]> {
      return database
        .select()
        .from(connectorInstances)
        .where(isNull(connectorInstances.deletedAt))
        .orderBy(asc(connectorInstances.displayName), asc(connectorInstances.createdAt))
        .all()
        .map(mapConnectorInstance)
    },

    async getStatusSummary(
      connectorInstanceId: string,
    ): Promise<ConnectorStatusSummaryRecord | null> {
      const row = database
        .select()
        .from(connectorInstances)
        .where(
          and(eq(connectorInstances.id, connectorInstanceId), isNull(connectorInstances.deletedAt)),
        )
        .get()

      if (!row) {
        return null
      }

      const latestRun = database
        .select()
        .from(connectorRuns)
        .where(and(eq(connectorRuns.connectorInstanceId, row.id), isNull(connectorRuns.deletedAt)))
        .orderBy(desc(connectorRuns.startedAt), desc(connectorRuns.createdAt))
        .limit(1)
        .get()

      return {
        ...mapConnectorInstance(row),
        latestRun: latestRun ? mapConnectorRun(latestRun) : null,
      }
    },

    async listStatusSummaries(): Promise<ConnectorStatusSummaryRecord[]> {
      return database
        .select()
        .from(connectorInstances)
        .where(and(eq(connectorInstances.enabled, true), isNull(connectorInstances.deletedAt)))
        .orderBy(asc(connectorInstances.displayName), asc(connectorInstances.createdAt))
        .all()
        .map((row) => {
          const latestRun = database
            .select()
            .from(connectorRuns)
            .where(
              and(
                eq(connectorRuns.connectorInstanceId, row.id),
                isNull(connectorRuns.deletedAt),
              ),
            )
            .orderBy(desc(connectorRuns.startedAt), desc(connectorRuns.createdAt))
            .limit(1)
            .get()

          return {
            ...mapConnectorInstance(row),
            latestRun: latestRun ? mapConnectorRun(latestRun) : null,
          }
        })
    },

    async getCheckpoint(
      input: GetConnectorCheckpointInput,
    ): Promise<ConnectorCheckpointRecord | null> {
      const row = database
        .select()
        .from(connectorCheckpoints)
        .where(
          and(
            eq(connectorCheckpoints.connectorInstanceId, input.connectorInstanceId),
            eq(connectorCheckpoints.filterSignature, input.filterSignature),
            isNull(connectorCheckpoints.deletedAt),
          ),
        )
        .get()

      return row ? mapConnectorCheckpoint(row) : null
    },

    async listRuns(input: ListConnectorRunsInput): Promise<ListConnectorRunsResult> {
      const limit = input.limit ?? 50
      const offset = input.offset ?? 0
      const items = database
        .select()
        .from(connectorRuns)
        .where(
          and(
            eq(connectorRuns.connectorInstanceId, input.connectorInstanceId),
            isNull(connectorRuns.deletedAt),
          ),
        )
        .orderBy(desc(connectorRuns.startedAt), desc(connectorRuns.createdAt))
        .all()
        .map(mapConnectorRun)
        .map((run) => withConnectorRunLifecycleCounts(database, run))
        .filter((run) => input.status === undefined || run.status === input.status)
        .filter((run) => input.mode === undefined || run.mode === input.mode)
      const pagedItems = items.slice(offset, offset + limit)

      return {
        items: pagedItems,
        total: items.length,
        limit,
        offset,
        hasMore: offset + pagedItems.length < items.length,
      }
    },

    async listCheckpoints(
      input: ListConnectorCheckpointsInput,
    ): Promise<ConnectorCheckpointRecord[]> {
      return database
        .select()
        .from(connectorCheckpoints)
        .where(
          and(
            eq(connectorCheckpoints.connectorInstanceId, input.connectorInstanceId),
            isNull(connectorCheckpoints.deletedAt),
          ),
        )
        .all()
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
      return database
        .select()
        .from(connectorObservations)
        .where(
          and(
            eq(connectorObservations.connectorInstanceId, input.connectorInstanceId),
            isNull(connectorObservations.deletedAt),
          ),
        )
        .all()
        .map(mapConnectorObservation)
        .filter(
          (observation) =>
            input.connectorRunId === undefined ||
            observation.connectorRunId === input.connectorRunId,
        )
    },

    async getObservation(connectorObservationId: string): Promise<ConnectorObservationRecord | null> {
      const row = database
        .select()
        .from(connectorObservations)
        .where(
          and(
            eq(connectorObservations.id, connectorObservationId),
            isNull(connectorObservations.deletedAt),
          ),
        )
        .get()

      return row ? mapConnectorObservation(row) : null
    },

  }
}
