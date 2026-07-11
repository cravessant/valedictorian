import { and, eq, isNull } from 'drizzle-orm'
import {
  connectorCheckpoints,
  connectorInstances,
  connectorObservations,
  connectorRuns
} from '../../db/schema'
import type { DrizzleDatabase } from '../../db/sqlite'
import {
  readConnectorRunLifecycleCounts,
  reconcileConnectorRunLifecycleCounts
} from './connector.lifecycle-counts'
import type {
  ConnectorAuthMode,
  ConnectorAuthReference,
  ConnectorCheckpointRecord,
  ConnectorInstanceRecord,
  ConnectorObservationEvidence,
  ConnectorObservationLinks,
  ConnectorObservationRecord,
  ConnectorObservationResolution,
  ConnectorRunRecord,
  ConnectorWarning,
  JsonRecord,
  RecordConnectorCheckpointInput
} from './connector.repository.types'

export function selectConnectorInstance(
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

export function upsertConnectorCheckpoint(
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

export function mapConnectorInstance(
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

export function normalizeConnectorAuthReferences(input: unknown): ConnectorAuthReference[] {
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

export function normalizeConnectorAuthMode(value: unknown): ConnectorAuthMode {
  if (typeof value !== 'string' || !connectorAuthModes.has(value as ConnectorAuthMode)) {
    throw new Error(`Invalid connector auth mode: ${String(value)}`)
  }

  return value as ConnectorAuthMode
}

export function isSecretBackedAuthMode(mode: ConnectorAuthMode): boolean {
  return mode === 'api_key' ||
    mode === 'bearer_token' ||
    mode === 'oauth' ||
    mode === 'cookie_jar' ||
    mode === 'username_password'
}

export function requiredNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid ${label}`)
  }

  return value.trim()
}

export function optionalNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined
  }

  return value.trim()
}

export function toJsonRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return value as JsonRecord
}

export function stableJsonStringify(value: unknown): string {
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

export function readConnectorWarnings(value: string): ConnectorWarning[] {
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

export function mapConnectorRun(row: typeof connectorRuns.$inferSelect | undefined): ConnectorRunRecord {
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

export function withConnectorRunLifecycleCounts(
  database: DrizzleDatabase,
  run: ConnectorRunRecord,
): ConnectorRunRecord {
  const stats = toJsonRecord(run.stats)
  const lifecycleCounts = readConnectorRunLifecycleCounts(stats, run.id)
    ?? reconcileConnectorRunLifecycleCounts(database, run)
  return {
    ...run,
    stats: { ...stats, lifecycleCounts },
  }
}

export function mapConnectorCheckpoint(
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

export function mapConnectorObservation(
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
    sourcingFindingId: null,
    evidence: JSON.parse(row.evidenceJson) as ConnectorObservationEvidence[],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
