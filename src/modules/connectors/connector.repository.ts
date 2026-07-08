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

export type ConnectorRunStatus = 'completed' | 'partial_success'

export type ConnectorAuthMode =
  | 'none'
  | 'api_key'
  | 'bearer_token'
  | 'oauth'
  | 'cookie_jar'
  | 'browser_session'

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
  connectorInstanceId: string
  mode: string
  startedAt: string
  completedAt: string
  config: JsonRecord
  filters: JsonRecord
  filterSignature: string
  result: ConnectorRefreshResultInput
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

export interface ListConnectorObservationsInput {
  connectorInstanceId: string
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
        const runId = randomUUID()
        const observationCount = input.result.observations.length
        const warningCount = input.result.warnings.length

        transaction
          .insert(connectorRuns)
          .values({
            id: runId,
            connectorInstanceId: input.connectorInstanceId,
            mode: input.mode,
            status: input.result.status ?? 'completed',
            startedAt: input.startedAt,
            completedAt: input.completedAt,
            coverageStartedAt: input.result.coverage.start,
            coverageEndedAt: input.result.coverage.end,
            configJson: JSON.stringify(input.config),
            filtersJson: JSON.stringify(input.filters),
            filterSignature: input.filterSignature,
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
            .where(
              and(
                eq(connectorCheckpoints.connectorInstanceId, input.connectorInstanceId),
                eq(connectorCheckpoints.filterSignature, input.filterSignature),
              ),
            )
            .run()
        } else {
          transaction
            .insert(connectorCheckpoints)
            .values({
              connectorInstanceId: input.connectorInstanceId,
              filterSignature: input.filterSignature,
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
    mode === 'cookie_jar'
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
