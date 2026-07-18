import { randomUUID } from 'node:crypto'
import { createPgliteClient, migratePgliteDatabase } from '../db/pglite'
import { createPgliteConnectorRepository } from '../modules/connectors/connector.repository'

export async function createConnectorCaptureFixture(
  pgliteDataPath: string,
  connectorId: string,
  connectorVersion: string,
) {
  const client = await createPgliteClient({ dataDir: pgliteDataPath })
  try {
    const database = await migratePgliteDatabase(client)
    const repository = createPgliteConnectorRepository(database)
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
    await client.close()
  }
}
