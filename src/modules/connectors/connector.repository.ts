import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import {
  connectorCheckpoints,
  connectorInstances,
  connectorObservations,
  connectorProjectionKeys,
  connectorRuns,
} from '../../db/schema'
import type { DrizzleDatabase } from '../../db/sqlite'

type JsonRecord = Record<string, unknown>

export interface ConnectorCoverageWindow {
  start: string
  end: string
}

export interface ConnectorWarning {
  code: string
  message: string
}

export interface ConnectorCheckpointPayload {
  checkpoint: unknown
  schemaVersion: string
}

export type ConnectorRunStatus =
  | 'cancelled'
  | 'completed'
  | 'failed'
  | 'partial_success'
  | 'queued'
  | 'running'
  | 'skipped'

export type ConnectorRunTerminalStatus = Exclude<ConnectorRunStatus, 'queued' | 'running'>

export type ConnectorAuthMode =
  | 'none'
  | 'api_key'
  | 'bearer_token'
  | 'oauth'
  | 'cookie_jar'
  | 'browser_session'
  | 'username_password'

export interface ConnectorAuthReference {
  id: string
  mode: ConnectorAuthMode
  label?: string
  secretKey?: string
  sessionKey?: string
}

export interface ConnectorObservationLinks {
  source: string | null
  intermediary: string | null
  official: string | null
}

export interface ConnectorObservationResolution {
  status: string
  method: string | null
  reason: string | null
}

export interface ConnectorObservationEvidence {
  type: string
  capturedAt: string
  sourceUrl: string | null
}

export interface ConnectorObservationInput {
  connectorId: string
  connectorVersion: string
  parserVersion?: string | null
  observationSchemaVersion?: string | null
  sourceRecordKey: string
  observedAt: string
  companyName: string
  roleTitle: string
  locationRaw?: string | null
  descriptionText?: string | null
  pay?: unknown
  links: ConnectorObservationLinks
  resolution: ConnectorObservationResolution
  dedupeKeys: string[]
  sourceMetadata?: JsonRecord
  evidence: ConnectorObservationEvidence[]
}

export interface ConnectorRefreshResultInput {
  observations: ConnectorObservationInput[]
  nextCheckpoint: ConnectorCheckpointPayload
  coverage: ConnectorCoverageWindow
  stats: JsonRecord & { observations: number }
  warnings: ConnectorWarning[]
  status?: ConnectorRunStatus
  retryHints?: unknown
}

export interface UpsertConnectorInstanceInput {
  id: string
  connectorId: string
  connectorVersion: string
  displayName: string
  enabled: boolean
  auth?: ConnectorAuthReference[]
  config?: JsonRecord
  filters?: JsonRecord
  createdAt?: string
}

export interface RecordConnectorRefreshResultInput {
  connectorRunId?: string
  connectorInstanceId: string
  mode: string
  startedAt: string
  completedAt: string
  config: JsonRecord
  filters: JsonRecord
  filterSignature: string
  checkpointPersistence?: 'deferred' | 'immediate'
  result: ConnectorRefreshResultInput
}

export interface RecordConnectorRunRequestInput {
  connectorInstanceId: string
  mode: string
  startedAt: string
  coverageStartedAt?: string | null
  coverageEndedAt?: string | null
  filters?: unknown
  filterSignature?: string | null
  reason?: string | null
  dryRun?: boolean
}

export interface RecordConnectorRunRequestResult {
  acquired: boolean
  run: ConnectorRunRecord
}

export interface RecordConnectorRunFailureInput {
  connectorInstanceId: string
  mode: string
  startedAt: string
  completedAt: string
  coverageStartedAt?: string | null
  coverageEndedAt?: string | null
  filters?: unknown
  filterSignature?: string | null
  retryHints?: unknown
  stats?: JsonRecord
  warning: ConnectorWarning
}

export interface RecordConnectorRunSkippedInput {
  connectorInstanceId: string
  mode: string
  reason?: string | null
  skippedAt: string
}

export interface MarkConnectorRunFailedInput {
  connectorRunId: string
  completedAt: string
  retryHints?: unknown
  warning: ConnectorWarning
}

export interface MarkConnectorRunRunningInput {
  connectorRunId: string
  startedAt: string
}

export interface RecoverInterruptedConnectorRunsInput {
  completedAt: string
}

export interface UpdateConnectorRunProgressInput {
  connectorRunId: string
  stats: JsonRecord
}

export interface CompleteConnectorRunInput {
  completedAt: string
  connectorRunId: string
  status: ConnectorRunTerminalStatus
}

export interface RecordConnectorCheckpointInput {
  connectorInstanceId: string
  filterSignature: string
  checkpoint: ConnectorCheckpointPayload
  coverage: ConnectorCoverageWindow
  savedAt: string
}

export interface GetConnectorCheckpointInput {
  connectorInstanceId: string
  filterSignature: string
}

export interface ConnectorInstanceRecord {
  id: string
  connectorId: string
  connectorVersion: string
  displayName: string
  enabled: boolean
  auth: ConnectorAuthReference[]
  config: unknown
  filters: unknown
  createdAt: string
  updatedAt: string
}

export interface ConnectorRunRecord {
  id: string
  connectorInstanceId: string
  mode: string
  status: string
  startedAt: string
  completedAt: string | null
  coverageStartedAt: string | null
  coverageEndedAt: string | null
  config: unknown
  filters: unknown
  filterSignature: string
  observationCount: number
  warningCount: number
  stats: unknown
  warnings: unknown
  retryHints: unknown
}

export interface ConnectorCheckpointRecord {
  connectorInstanceId: string
  filterSignature: string
  checkpoint: unknown
  schemaVersion: string
  coverageStartedAt: string | null
  coverageEndedAt: string | null
}

export interface ConnectorObservationRecord extends ConnectorObservationInput {
  id: string
  connectorInstanceId: string
  connectorRunId: string
  sourceMetadata: JsonRecord
  sourcingFindingId: string | null
  createdAt: string
  updatedAt: string
}

export interface ConnectorStatusSummaryRecord extends ConnectorInstanceRecord {
  latestRun: ConnectorRunRecord | null
}

export interface ConnectorProjectionKeyRecord {
  dedupeKey: string
  sourcingFindingId: string
  createdAt: string
  updatedAt: string
}

export interface ListConnectorRunsInput {
  connectorInstanceId: string
  status?: string
  mode?: string
  limit?: number
  offset?: number
}

export interface ListConnectorRunsResult {
  items: ConnectorRunRecord[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

export interface ListConnectorCheckpointsInput {
  connectorInstanceId: string
  filterSignature?: string
}

export interface ListConnectorObservationsInput {
  connectorInstanceId: string
  connectorRunId?: string
}

export interface LinkObservationToSourcingFindingInput {
  connectorObservationId: string
  sourcingFindingId: string
}

export interface RecordProjectionKeysInput {
  sourcingFindingId: string
  dedupeKeys: string[]
}

export function createSqliteConnectorRepository(database: DrizzleDatabase) {
  return {
    async upsertInstance(input: UpsertConnectorInstanceInput): Promise<ConnectorInstanceRecord> {
      const now = new Date().toISOString()
      const createdAt = input.createdAt ?? now
      const auth = normalizeConnectorAuthReferences(input.auth ?? [])
      const existing = database
        .select({ id: connectorInstances.id })
        .from(connectorInstances)
        .where(and(eq(connectorInstances.id, input.id), isNull(connectorInstances.deletedAt)))
        .get()

      if (existing) {
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
            updatedAt: now,
          })
          .where(eq(connectorInstances.id, input.id))
          .run()
      } else {
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
          .select({ id: connectorInstances.id })
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
            run: mapConnectorRun(activeRun),
          }
        }

        const instance = mapConnectorInstance(instanceRow)
        const now = input.startedAt
        const filters = input.filters ?? instance.filters
        const filterSignature = input.filterSignature ?? `filters:${stableJsonStringify(filters)}`
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
            retryHintsJson: JSON.stringify(input.reason ? { reason: input.reason } : null),
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          })
          .run()

        return {
          acquired: true,
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

    async markRunRunning(input: MarkConnectorRunRunningInput): Promise<ConnectorRunRecord> {
      const row = database
        .select()
        .from(connectorRuns)
        .where(
          and(
            eq(connectorRuns.id, input.connectorRunId),
            eq(connectorRuns.status, 'queued'),
            isNull(connectorRuns.deletedAt),
          ),
        )
        .get()

      if (!row) {
        throw new Error(`Queued connector run not found: ${input.connectorRunId}`)
      }

      const now = new Date().toISOString()
      const stats = toJsonRecord(JSON.parse(row.statsJson))

      database
        .update(connectorRuns)
        .set({
          status: 'running',
          startedAt: input.startedAt,
          statsJson: JSON.stringify({
            ...stats,
            queued: false,
            running: true,
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

    recoverInterruptedRuns(input: RecoverInterruptedConnectorRunsInput): number {
      const interruptedRuns = database
        .select()
        .from(connectorRuns)
        .where(
          and(
            inArray(connectorRuns.status, ['queued', 'running']),
            isNull(connectorRuns.deletedAt),
          ),
        )
        .all()
      const warning = {
        code: 'connector.interrupted',
        message: 'Connector run was interrupted before completion.',
      }

      for (const run of interruptedRuns) {
        const stats = toJsonRecord(JSON.parse(run.statsJson))
        const warnings = readConnectorWarnings(run.warningsJson)
        warnings.push(warning)

        database
          .update(connectorRuns)
          .set({
            status: 'cancelled',
            completedAt: input.completedAt,
            warningCount: warnings.length,
            statsJson: JSON.stringify({
              ...stats,
              interrupted: true,
              queued: false,
              running: false,
            }),
            warningsJson: JSON.stringify(warnings),
            retryHintsJson: JSON.stringify({
              reason: 'connector_run_interrupted',
            }),
            updatedAt: input.completedAt,
          })
          .where(eq(connectorRuns.id, run.id))
          .run()
      }

      return interruptedRuns.length
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

      database
        .update(connectorRuns)
        .set({
          status: input.status,
          completedAt: input.completedAt,
          statsJson: JSON.stringify({
            ...stats,
            completed: true,
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

      database
        .insert(connectorRuns)
        .values({
          id: runId,
          connectorInstanceId: input.connectorInstanceId,
          mode: input.mode,
          status: 'skipped',
          startedAt: input.skippedAt,
          completedAt: input.skippedAt,
          coverageStartedAt: null,
          coverageEndedAt: null,
          configJson: JSON.stringify(instance.config),
          filtersJson: JSON.stringify(filters),
          filterSignature: `filters:${stableJsonStringify(filters)}`,
          observationCount: 0,
          warningCount: 0,
          statsJson: JSON.stringify({ skipped: true }),
          warningsJson: JSON.stringify([]),
          retryHintsJson: JSON.stringify({
            reason,
            skippedBy: 'user',
          }),
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
      const row = database
        .select()
        .from(connectorRuns)
        .where(and(eq(connectorRuns.id, input.connectorRunId), isNull(connectorRuns.deletedAt)))
        .get()

      if (!row) {
        throw new Error(`Connector run not found: ${input.connectorRunId}`)
      }

      const warnings = readConnectorWarnings(row.warningsJson)
      warnings.push(input.warning)
      const retryHints = input.retryHints ?? (JSON.parse(row.retryHintsJson) as unknown)
      const stats = toJsonRecord(JSON.parse(row.statsJson))
      const recordedFailures = stats.failures

      database
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

      return mapConnectorRun(
        database
          .select()
          .from(connectorRuns)
          .where(eq(connectorRuns.id, input.connectorRunId))
          .get(),
      )
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

    async linkObservationToSourcingFinding(
      input: LinkObservationToSourcingFindingInput,
    ): Promise<ConnectorObservationRecord> {
      const now = new Date().toISOString()
      const existing = database
        .select({ id: connectorObservations.id })
        .from(connectorObservations)
        .where(
          and(
            eq(connectorObservations.id, input.connectorObservationId),
            isNull(connectorObservations.deletedAt),
          ),
        )
        .get()

      if (!existing) {
        throw new Error(`Connector observation not found: ${input.connectorObservationId}`)
      }

      database
        .update(connectorObservations)
        .set({
          sourcingFindingId: input.sourcingFindingId,
          updatedAt: now,
        })
        .where(eq(connectorObservations.id, input.connectorObservationId))
        .run()

      const observation = await this.getObservation(input.connectorObservationId)

      if (!observation) {
        throw new Error(`Connector observation not found: ${input.connectorObservationId}`)
      }

      return observation
    },

    async findProjectionByDedupeKeys(
      dedupeKeys: string[],
    ): Promise<ConnectorProjectionKeyRecord | null> {
      if (dedupeKeys.length === 0) {
        return null
      }

      const rows = database
        .select()
        .from(connectorProjectionKeys)
        .where(
          and(
            inArray(connectorProjectionKeys.dedupeKey, dedupeKeys),
            isNull(connectorProjectionKeys.deletedAt),
          ),
        )
        .all()
      const rowsByKey = new Map(rows.map((row) => [row.dedupeKey, row]))
      const row = dedupeKeys.map((key) => rowsByKey.get(key)).find((row) => row !== undefined)

      return row
        ? {
            dedupeKey: row.dedupeKey,
            sourcingFindingId: row.sourcingFindingId,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          }
        : null
    },

    async recordProjectionKeys(input: RecordProjectionKeysInput): Promise<void> {
      if (input.dedupeKeys.length === 0) {
        return
      }

      const now = new Date().toISOString()

      for (const dedupeKey of input.dedupeKeys) {
        const existing = database
          .select({
            dedupeKey: connectorProjectionKeys.dedupeKey,
            sourcingFindingId: connectorProjectionKeys.sourcingFindingId,
          })
          .from(connectorProjectionKeys)
          .where(eq(connectorProjectionKeys.dedupeKey, dedupeKey))
          .get()

        if (existing) {
          if (existing.sourcingFindingId !== input.sourcingFindingId) {
            continue
          }

          database
            .update(connectorProjectionKeys)
            .set({
              sourcingFindingId: input.sourcingFindingId,
              updatedAt: now,
              deletedAt: null,
            })
            .where(eq(connectorProjectionKeys.dedupeKey, dedupeKey))
            .run()
        } else {
          database
            .insert(connectorProjectionKeys)
            .values({
              dedupeKey,
              sourcingFindingId: input.sourcingFindingId,
              createdAt: now,
              updatedAt: now,
              deletedAt: null,
            })
            .run()
        }
      }
    },
  }
}

function selectConnectorInstance(
  database: DrizzleDatabase,
  connectorInstanceId: string,
): ConnectorInstanceRecord {
  const row = database
    .select()
    .from(connectorInstances)
    .where(and(eq(connectorInstances.id, connectorInstanceId), isNull(connectorInstances.deletedAt)))
    .get()

  if (!row) {
    throw new Error(`Connector instance not found: ${connectorInstanceId}`)
  }

  return mapConnectorInstance(row)
}

function upsertConnectorCheckpoint(
  database: Pick<DrizzleDatabase, 'insert' | 'select' | 'update'>,
  input: RecordConnectorCheckpointInput,
  now: string,
) {
  const existingCheckpoint = database
    .select({
      connectorInstanceId: connectorCheckpoints.connectorInstanceId,
      filterSignature: connectorCheckpoints.filterSignature,
    })
    .from(connectorCheckpoints)
    .where(
      and(
        eq(connectorCheckpoints.connectorInstanceId, input.connectorInstanceId),
        eq(connectorCheckpoints.filterSignature, input.filterSignature),
        isNull(connectorCheckpoints.deletedAt),
      ),
    )
    .get()
  const checkpointValues = {
    checkpointJson: JSON.stringify(input.checkpoint.checkpoint),
    schemaVersion: input.checkpoint.schemaVersion,
    coverageStartedAt: input.coverage.start,
    coverageEndedAt: input.coverage.end,
    savedAt: input.savedAt,
    updatedAt: now,
    deletedAt: null,
  }

  if (existingCheckpoint) {
    database
      .update(connectorCheckpoints)
      .set(checkpointValues)
      .where(
        and(
          eq(connectorCheckpoints.connectorInstanceId, input.connectorInstanceId),
          eq(connectorCheckpoints.filterSignature, input.filterSignature),
        ),
      )
      .run()
    return
  }

  database
    .insert(connectorCheckpoints)
    .values({
      connectorInstanceId: input.connectorInstanceId,
      filterSignature: input.filterSignature,
      ...checkpointValues,
      createdAt: now,
    })
    .run()
}

function mapConnectorInstance(
  row: typeof connectorInstances.$inferSelect,
): ConnectorInstanceRecord {
  return {
    id: row.id,
    connectorId: row.connectorId,
    connectorVersion: row.connectorVersion,
    displayName: row.displayName,
    enabled: row.enabled,
    auth: normalizeConnectorAuthReferences(JSON.parse(row.authJson) as unknown),
    config: JSON.parse(row.configJson) as unknown,
    filters: JSON.parse(row.filtersJson) as unknown,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

const connectorAuthModes = new Set<ConnectorAuthMode>([
  'none',
  'api_key',
  'bearer_token',
  'oauth',
  'cookie_jar',
  'browser_session',
  'username_password',
])

function normalizeConnectorAuthReferences(input: unknown): ConnectorAuthReference[] {
  if (!Array.isArray(input)) {
    return []
  }

  return input.map((item) => {
    const record = toJsonRecord(item)
    const label = optionalNonEmptyString(record.label)
    const secretKey = optionalNonEmptyString(record.secretKey)
    const sessionKey = optionalNonEmptyString(record.sessionKey)
    const mode = normalizeConnectorAuthMode(record.mode)

    return {
      id: requiredNonEmptyString(record.id, 'connector auth id'),
      mode,
      ...(label === undefined ? {} : { label }),
      ...(isSecretBackedAuthMode(mode) && secretKey !== undefined ? { secretKey } : {}),
      ...(mode === 'browser_session' && sessionKey !== undefined ? { sessionKey } : {}),
    }
  })
}

function normalizeConnectorAuthMode(value: unknown): ConnectorAuthMode {
  if (typeof value !== 'string' || !connectorAuthModes.has(value as ConnectorAuthMode)) {
    throw new Error(`Invalid connector auth mode: ${String(value)}`)
  }

  return value as ConnectorAuthMode
}

function isSecretBackedAuthMode(mode: ConnectorAuthMode): boolean {
  return mode === 'api_key' ||
    mode === 'bearer_token' ||
    mode === 'oauth' ||
    mode === 'cookie_jar' ||
    mode === 'username_password'
}

function requiredNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid ${label}`)
  }

  return value.trim()
}

function optionalNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined
  }

  return value.trim()
}

function toJsonRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return value as JsonRecord
}

function stableJsonStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(',')}]`
  }

  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJsonStringify(item)}`)
      .join(',')}}`
  }

  return JSON.stringify(value)
}

function readConnectorWarnings(value: string): ConnectorWarning[] {
  const parsed = JSON.parse(value) as unknown

  if (!Array.isArray(parsed)) {
    return []
  }

  return parsed.flatMap((item) => {
    const record = toJsonRecord(item)

    if (typeof record.code !== 'string' || typeof record.message !== 'string') {
      return []
    }

    return [
      {
        code: record.code,
        message: record.message,
      },
    ]
  })
}

function mapConnectorRun(row: typeof connectorRuns.$inferSelect | undefined): ConnectorRunRecord {
  if (!row) {
    throw new Error('Connector run not found after insert.')
  }

  return {
    id: row.id,
    connectorInstanceId: row.connectorInstanceId,
    mode: row.mode,
    status: row.status,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    coverageStartedAt: row.coverageStartedAt,
    coverageEndedAt: row.coverageEndedAt,
    config: JSON.parse(row.configJson) as unknown,
    filters: JSON.parse(row.filtersJson) as unknown,
    filterSignature: row.filterSignature,
    observationCount: row.observationCount,
    warningCount: row.warningCount,
    stats: JSON.parse(row.statsJson) as unknown,
    warnings: JSON.parse(row.warningsJson) as unknown,
    retryHints: JSON.parse(row.retryHintsJson) as unknown,
  }
}

function mapConnectorCheckpoint(
  row: typeof connectorCheckpoints.$inferSelect,
): ConnectorCheckpointRecord {
  return {
    connectorInstanceId: row.connectorInstanceId,
    filterSignature: row.filterSignature,
    checkpoint: JSON.parse(row.checkpointJson) as unknown,
    schemaVersion: row.schemaVersion,
    coverageStartedAt: row.coverageStartedAt,
    coverageEndedAt: row.coverageEndedAt,
  }
}

function mapConnectorObservation(
  row: typeof connectorObservations.$inferSelect,
): ConnectorObservationRecord {
  return {
    id: row.id,
    connectorInstanceId: row.connectorInstanceId,
    connectorRunId: row.connectorRunId,
    connectorId: row.connectorId,
    connectorVersion: row.connectorVersion,
    parserVersion: row.parserVersion ?? null,
    observationSchemaVersion: row.observationSchemaVersion ?? null,
    sourceRecordKey: row.sourceRecordKey,
    observedAt: row.observedAt,
    companyName: row.companyName,
    roleTitle: row.roleTitle,
    locationRaw: row.locationRaw,
    descriptionText: row.descriptionText,
    pay: JSON.parse(row.payJson) as unknown,
    links: JSON.parse(row.linksJson) as ConnectorObservationLinks,
    resolution: JSON.parse(row.resolutionJson) as ConnectorObservationResolution,
    dedupeKeys: JSON.parse(row.dedupeKeysJson) as string[],
    sourceMetadata: JSON.parse(row.sourceMetadataJson) as JsonRecord,
    evidence: JSON.parse(row.evidenceJson) as ConnectorObservationEvidence[],
    sourcingFindingId: row.sourcingFindingId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
