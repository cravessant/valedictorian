import { and, eq, isNull } from 'drizzle-orm'
import { connectorInstances, sourceExecutionScopes } from '../../db/schema'
import type { DrizzleDatabase } from '../../db/sqlite'
import { assertPersistedEarliestBackfillDate, defaultEarliestBackfillDate } from './connector.earliest-backfill'
import type { ConnectorAuthMode, ConnectorAuthReference, ConnectorInstanceRecord, UpsertConnectorInstanceInput } from './connector-instance.persistence-types'
import { optionalNonEmptyString, requiredNonEmptyString, toJsonRecord } from './connector.persistence-json'
import { deriveSourceExecutionScopeId } from '../source-execution/source-execution-governor'
import { JOBRIGHT_CONNECTOR_ID } from './jobright.constants'

export function createConnectorInstance(
  database: DrizzleDatabase,
  input: UpsertConnectorInstanceInput,
): ConnectorInstanceRecord {
  const now = new Date().toISOString()
  const createdAt = input.createdAt ?? now
  const executionScopeId = deriveSourceExecutionScopeId(input.id)
  return database.transaction((transaction) => {
    if (input.connectorId === JOBRIGHT_CONNECTOR_ID) {
      const activeJobright = transaction
        .select({ id: connectorInstances.id })
        .from(connectorInstances)
        .where(and(
          eq(connectorInstances.connectorId, JOBRIGHT_CONNECTOR_ID),
          isNull(connectorInstances.deletedAt),
        ))
        .get()
      if (activeJobright) {
        throw alreadyConfiguredError()
      }
    }
    transaction.insert(sourceExecutionScopes).values({
      id: executionScopeId, createdAt, updatedAt: createdAt, deletedAt: null,
    }).onConflictDoNothing().run()
    const persisted = transaction.insert(connectorInstances).values({
      id: input.id, executionScopeId, connectorId: input.connectorId,
      connectorVersion: input.connectorVersion, displayName: input.displayName,
      enabled: input.enabled,
      authJson: JSON.stringify(normalizeConnectorAuthReferences(input.auth ?? [])),
      configJson: JSON.stringify(input.config ?? {}),
      filtersJson: JSON.stringify(input.filters ?? {}),
      earliestBackfillDate: input.earliestBackfillDate === undefined
        ? defaultEarliestBackfillDate(createdAt)
        : assertPersistedEarliestBackfillDate(input.earliestBackfillDate),
      createdAt, updatedAt: now, deletedAt: null,
    }).onConflictDoNothing().returning().get()
    if (!persisted) {
      throw alreadyConfiguredError()
    }
    return mapConnectorInstance(persisted)
  }, { behavior: 'immediate' })
}

function alreadyConfiguredError() {
  return Object.assign(
    new Error('This connector is already configured. Manage the existing instance.'),
    { code: 'already_configured', statusCode: 409 },
  )
}

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
