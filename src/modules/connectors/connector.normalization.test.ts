import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDrizzleDatabase, createInMemoryDatabase, migrateDatabase } from '../../db/sqlite'
import { createDefaultNormalizationResolverRegistry } from '../sourcing/normalization.registry'
import { createSqliteNormalizationRepository } from '../sourcing/normalization.repository'
import { createSqliteRawSourceRepository } from '../sourcing/raw-source.repository'
import { createSqliteConnectorRepository } from './connector.repository'
import { createConnectorNormalizationHost } from './connector.normalization'

describe('connector normalization host', () => {
  const databases: ReturnType<typeof createInMemoryDatabase>[] = []

  afterEach(() => {
    databases.splice(0).forEach((database) => database.close())
  })

  it('persists a blocked attempt without invoking an undeclared host capability', async () => {
    const sqlite = createInMemoryDatabase()
    databases.push(sqlite)
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const rawRepository = createSqliteRawSourceRepository(database)
    const connectorRepository = createSqliteConnectorRepository(database)
    const normalizationRepository = createSqliteNormalizationRepository(database)
    const registry = createDefaultNormalizationResolverRegistry()
    await connectorRepository.upsertInstance({
      id: 'instance-1', connectorId: 'fixture.connector', connectorVersion: '1.0.0',
      displayName: 'Fixture', enabled: true,
    })
    const connectorRun = (await connectorRepository.recordRunRequest({
      connectorInstanceId: 'instance-1', mode: 'manual',
      startedAt: '2026-07-10T12:00:00.000Z',
    })).run
    const receipt = (await rawRepository.ingestBatch({ records: [{
      adapter: { id: 'fixture.connector', kind: 'connector', version: '1.0.0' },
      capture: { connectorInstanceId: 'instance-1', connectorRunId: connectorRun.id },
      observedAt: '2026-07-10T12:00:00.000Z',
      providerRecordId: 'job-1',
      providerSchema: 'fixture@1',
      payload: { companyName: 'Fixture Robotics', roleTitle: 'Intern' },
    }] })).receipts[0]
    const resolve = vi.fn(async () => [{
      resolverId: 'fixture.model-destination',
      resolverVersion: '1.0.0',
      field: 'destinationUrl' as const,
      inputHash: receipt.revision.contentHash,
      status: 'abstained' as const,
      reason: 'not reached',
    }])
    const host = createConnectorNormalizationHost({
      repository: normalizationRepository,
      registry,
    })

    const outcomes = await host.run({
      rawRevision: receipt.revision,
      resolver: {
        id: 'fixture.model-destination',
        version: '1.0.0',
        requiredInputs: ['rawRevision'],
        outputFields: ['destinationUrl'],
        capabilities: ['model'],
        costClass: 'high',
        precedence: 200,
      },
      resolve,
    }, {
      connectorRunId: connectorRun.id,
      enabledCapabilities: ['pure', 'network'],
      triggerOccurrence: receipt.occurrence,
    })

    expect(resolve).not.toHaveBeenCalled()
    expect(outcomes).toEqual([
      expect.objectContaining({
        resolverId: 'fixture.model-destination',
        status: 'blocked',
        reason: 'Required capability is disabled',
      }),
    ])
    expect(normalizationRepository.getLatest(receipt.rawRecordId)).toMatchObject({
      gate: { status: 'needs_enrichment' },
      attempts: expect.arrayContaining([
        expect.objectContaining({
          resolver: expect.objectContaining({
            id: 'fixture.model-destination',
            capabilities: ['model'],
          }),
          outcomes: [expect.objectContaining({ status: 'blocked' })],
        }),
      ]),
    })
  })
})
