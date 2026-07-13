import { randomUUID } from 'node:crypto'
import { createDrizzleDatabase, createFileDatabase, migrateDatabase } from '../db/sqlite'
import { createSqliteConnectorRepository } from '../modules/connectors/connector.repository'

export async function createConnectorCaptureFixture(
  sqlitePath: string,
  connectorId: string,
  connectorVersion: string,
) {
  const sqlite = createFileDatabase(sqlitePath)
  try {
    migrateDatabase(sqlite)
    const repository = createSqliteConnectorRepository(createDrizzleDatabase(sqlite))
    const suffix = randomUUID()
    const instance = await repository.upsertInstance({
      id: `fixture-instance-${suffix}`,
      connectorId,
      connectorVersion,
      displayName: 'Fixture connector',
      enabled: true,
    })
    const request = await repository.recordRunRequest({
      connectorInstanceId: instance.id,
      mode: 'manual',
      startedAt: '2026-07-10T11:59:00.000Z',
    })
    return {
      connectorInstanceId: instance.id,
      connectorRunId: request.run.id,
      executionScopeId: instance.executionScopeId,
    }
  } finally {
    sqlite.close()
  }
}
