import { and, eq, isNull } from 'drizzle-orm'
import { connectorInstances } from '../../db/schema'
import type { DrizzleDatabase } from '../../db/sqlite'
import { assertPersistedEarliestBackfillDate } from './connector.earliest-backfill'
import type { ConnectorAuthMode, ConnectorAuthReference, ConnectorInstanceRecord } from './connector-instance.persistence-types'
import { optionalNonEmptyString, requiredNonEmptyString, toJsonRecord } from './connector.persistence-json'

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


export function mapConnectorInstance(
  row: typeof connectorInstances.$inferSelect,
): ConnectorInstanceRecord {
  return {
    id: row.id,
    earliestBackfillDate: assertPersistedEarliestBackfillDate(row.earliestBackfillDate),
    executionScopeId: requiredNonEmptyString(row.executionScopeId, 'connector execution scope id'),
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
    const mode = normalizeConnectorAuthMode(record.mode)

    return {
      id: requiredNonEmptyString(record.id, 'connector auth id'),
      mode,
      ...(label === undefined ? {} : { label }),
      ...(isSecretBackedAuthMode(mode) && secretKey !== undefined ? { secretKey } : {}),
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
