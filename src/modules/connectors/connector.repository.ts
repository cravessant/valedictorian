import { randomUUID } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import {
  connectorCheckpoints,
  connectorInstances,
  connectorObservations,
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
  retryHints?: unknown
}

export interface UpsertConnectorInstanceInput {
  id: string
  connectorId: string
  connectorVersion: string
  displayName: string
  enabled: boolean
  config?: JsonRecord
  createdAt?: string
}

export interface RecordConnectorRefreshResultInput {
  connectorInstanceId: string
  mode: string
  startedAt: string
  completedAt: string
  result: ConnectorRefreshResultInput
}

export interface ConnectorInstanceRecord {
  id: string
  connectorId: string
  connectorVersion: string
  displayName: string
  enabled: boolean
  config: unknown
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
  observationCount: number
  warningCount: number
  stats: unknown
  warnings: unknown
  retryHints: unknown
}

export interface ConnectorCheckpointRecord {
  connectorInstanceId: string
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
  createdAt: string
  updatedAt: string
}

export interface ListConnectorObservationsInput {
  connectorInstanceId: string
}

export function createSqliteConnectorRepository(database: DrizzleDatabase) {
  return {
    async upsertInstance(input: UpsertConnectorInstanceInput): Promise<ConnectorInstanceRecord> {
      const now = new Date().toISOString()
      const createdAt = input.createdAt ?? now
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
            configJson: JSON.stringify(input.config ?? {}),
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
            configJson: JSON.stringify(input.config ?? {}),
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
        const runId = randomUUID()
        const observationCount = input.result.observations.length
        const warningCount = input.result.warnings.length

        transaction
          .insert(connectorRuns)
          .values({
            id: runId,
            connectorInstanceId: input.connectorInstanceId,
            mode: input.mode,
            status: 'completed',
            startedAt: input.startedAt,
            completedAt: input.completedAt,
            coverageStartedAt: input.result.coverage.start,
            coverageEndedAt: input.result.coverage.end,
            observationCount,
            warningCount,
            statsJson: JSON.stringify(input.result.stats),
            warningsJson: JSON.stringify(input.result.warnings),
            retryHintsJson: JSON.stringify(input.result.retryHints ?? null),
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          })
          .run()

        const existingCheckpoint = transaction
          .select({ connectorInstanceId: connectorCheckpoints.connectorInstanceId })
          .from(connectorCheckpoints)
          .where(
            and(
              eq(connectorCheckpoints.connectorInstanceId, input.connectorInstanceId),
              isNull(connectorCheckpoints.deletedAt),
            ),
          )
          .get()
        const checkpointValues = {
          checkpointJson: JSON.stringify(input.result.nextCheckpoint.checkpoint),
          schemaVersion: input.result.nextCheckpoint.schemaVersion,
          coverageStartedAt: input.result.coverage.start,
          coverageEndedAt: input.result.coverage.end,
          savedAt: input.completedAt,
          updatedAt: now,
          deletedAt: null,
        }

        if (existingCheckpoint) {
          transaction
            .update(connectorCheckpoints)
            .set(checkpointValues)
            .where(eq(connectorCheckpoints.connectorInstanceId, input.connectorInstanceId))
            .run()
        } else {
          transaction
            .insert(connectorCheckpoints)
            .values({
              connectorInstanceId: input.connectorInstanceId,
              ...checkpointValues,
              createdAt: now,
            })
            .run()
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

    async getCheckpoint(connectorInstanceId: string): Promise<ConnectorCheckpointRecord | null> {
      const row = database
        .select()
        .from(connectorCheckpoints)
        .where(
          and(
            eq(connectorCheckpoints.connectorInstanceId, connectorInstanceId),
            isNull(connectorCheckpoints.deletedAt),
          ),
        )
        .get()

      return row ? mapConnectorCheckpoint(row) : null
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

  return {
    id: row.id,
    connectorId: row.connectorId,
    connectorVersion: row.connectorVersion,
    displayName: row.displayName,
    enabled: row.enabled,
    config: JSON.parse(row.configJson) as unknown,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
