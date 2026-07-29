import { and, asc, eq, isNull } from 'drizzle-orm'
import { connectorInstances } from '../../../../db/schema'
import type { PgliteDatabase } from '../../../../db/pglite'
import {
  assertPersistedEarliestBackfillDate,
  defaultEarliestBackfillDate,
} from '../../public/connector.earliest-backfill'
import {
  createConnectorInstance,
  mapConnectorInstance,
  normalizeConnectorAuthReferences,
} from './connector-instance.persistence'
import { deriveSourceExecutionScopeId } from '../../../source-execution/source-execution-governor'
import { ensureSourceExecutionScope } from '../../../source-execution/source-execution.persistence'
import { latestSynchronizedConnectorRun } from './connector-synchronization.persistence'
import { listConnectorOverviewStatusPage } from './connector-overview.persistence'
import type {
  ConnectorInstanceRecord,
  UpsertConnectorInstanceInput,
} from '../../ports/connector-instance.records'
import type { ConnectorStatusSummaryRecord } from '../../ports/connector-status.records'
import type {
  ConnectorOverviewStatusPage,
  ConnectorOverviewStatusPageInput,
} from '../../ports/connector.overview-page'

export async function createConnectorInstanceRecord(
  database: PgliteDatabase,
  input: UpsertConnectorInstanceInput,
): Promise<ConnectorInstanceRecord> {
  return createConnectorInstance(database, input)
}

export async function upsertConnectorInstanceRecord(
  database: PgliteDatabase,
  input: UpsertConnectorInstanceInput,
): Promise<ConnectorInstanceRecord> {
  const now = new Date().toISOString()
  const createdAt = input.createdAt ?? now
  const auth = normalizeConnectorAuthReferences(input.auth ?? [])
  const executionScopeId = deriveSourceExecutionScopeId(input.id)
  return database.transaction(async (transaction) => {
  await ensureSourceExecutionScope(transaction, executionScopeId, createdAt)
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
}

export async function getConnectorInstanceRecord(
  database: PgliteDatabase,
  connectorInstanceId: string,
): Promise<ConnectorInstanceRecord | null> {
  const [row] = await database
    .select()
    .from(connectorInstances)
    .where(
      and(eq(connectorInstances.id, connectorInstanceId), isNull(connectorInstances.deletedAt)),
    )
    .limit(1)
  return row ? mapConnectorInstance(row) : null
}

export async function listConnectorInstanceRecords(
  database: PgliteDatabase,
): Promise<ConnectorInstanceRecord[]> {
  return (await database
    .select()
    .from(connectorInstances)
    .where(isNull(connectorInstances.deletedAt))
    .orderBy(asc(connectorInstances.displayName), asc(connectorInstances.createdAt), asc(connectorInstances.id)))
    .map(mapConnectorInstance)
}

export async function getConnectorStatusSummaryRecord(
  database: PgliteDatabase,
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
}

export async function listConnectorStatusSummaryRecords(
  database: PgliteDatabase,
): Promise<ConnectorStatusSummaryRecord[]> {
  const rows = await database
    .select()
    .from(connectorInstances)
    .where(and(eq(connectorInstances.enabled, true), isNull(connectorInstances.deletedAt)))
    .orderBy(asc(connectorInstances.displayName), asc(connectorInstances.createdAt), asc(connectorInstances.id))
  return Promise.all(rows.map(async (row) => ({
    ...mapConnectorInstance(row),
    latestRun: await latestSynchronizedConnectorRun(database, row.id),
  })))
}

export async function listConnectorOverviewStatusSummaryRecords(
  database: PgliteDatabase,
  input: ConnectorOverviewStatusPageInput,
): Promise<ConnectorOverviewStatusPage> {
  return listConnectorOverviewStatusPage(database, input)
}
