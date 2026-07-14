import { describe, expect, it } from 'vitest'
import { createDrizzleDatabase, createInMemoryDatabase, migrateDatabase } from '../../db/sqlite'
import { createSqliteConnectorRepository } from './connector.repository'

describe('connector checkpoint upgrade copy', () => {
  it('is idempotent and never overwrites a newer target checkpoint', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const repository = createSqliteConnectorRepository(createDrizzleDatabase(sqlite))
    await repository.upsertInstance({
      id: 'upgrade-copy', connectorId: 'fixture.provider', connectorVersion: '1.0.0',
      displayName: 'Upgrade copy', enabled: true,
    })
    await repository.recordCheckpoint({
      connectorInstanceId: 'upgrade-copy',
      filterSignature: 'provider-state:fixture.provider@1.0.0',
      checkpoint: { checkpoint: { cursor: 60 }, schemaVersion: 'fixture-checkpoint@1' },
      coverage: { start: '2026-07-01T00:00:00.000Z', end: '2026-07-12T00:00:00.000Z' },
      savedAt: '2026-07-12T00:00:00.000Z',
    })
    await repository.recordCheckpoint({
      connectorInstanceId: 'upgrade-copy',
      filterSignature: 'provider-state:fixture.provider@2.0.0',
      checkpoint: { checkpoint: { cursor: 80 }, schemaVersion: 'fixture-checkpoint@1' },
      coverage: { start: '2026-07-01T00:00:00.000Z', end: '2026-07-13T00:00:00.000Z' },
      savedAt: '2026-07-13T00:00:00.000Z',
    })
    const copy = {
      connectorInstanceId: 'upgrade-copy',
      expectedSchemaVersion: 'fixture-checkpoint@1',
      sourceFilterSignature: 'provider-state:fixture.provider@1.0.0',
      targetFilterSignature: 'provider-state:fixture.provider@2.0.0',
    }

    repository.copyCheckpointIfAbsent(copy)
    repository.copyCheckpointIfAbsent(copy)

    await expect(repository.getCheckpoint({
      connectorInstanceId: 'upgrade-copy',
      filterSignature: 'provider-state:fixture.provider@2.0.0',
    })).resolves.toMatchObject({
      checkpoint: { cursor: 80 },
      coverageEndedAt: '2026-07-13T00:00:00.000Z',
    })
    await expect(repository.listCheckpoints({ connectorInstanceId: 'upgrade-copy' }))
      .resolves.toHaveLength(2)
    sqlite.close()
  })
})
