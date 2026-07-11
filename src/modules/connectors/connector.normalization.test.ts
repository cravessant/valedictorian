import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizationRuns, retryWork } from '../../db/schema'
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

  it('persists one typed retry unit for a multi-field connector resolver invocation', async () => {
    const sqlite = createInMemoryDatabase()
    databases.push(sqlite)
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const rawRepository = createSqliteRawSourceRepository(database)
    const connectorRepository = createSqliteConnectorRepository(database)
    const normalizationRepository = createSqliteNormalizationRepository(database)
    await connectorRepository.upsertInstance({
      id: 'retry-instance', connectorId: 'fixture.connector', connectorVersion: '1.0.0',
      displayName: 'Retry fixture', enabled: true,
    })
    const connectorRun = (await connectorRepository.recordRunRequest({
      connectorInstanceId: 'retry-instance', mode: 'manual', startedAt: '2026-07-11T12:00:00.000Z',
    })).run
    const receipt = (await rawRepository.ingestBatch({ records: [{
      adapter: { id: 'fixture.connector', kind: 'connector', version: '1.0.0' },
      capture: { connectorInstanceId: 'retry-instance', connectorRunId: connectorRun.id },
      observedAt: '2026-07-11T12:00:00.000Z', providerRecordId: 'retry-job',
      payload: { companyName: 'Retry Co', roleTitle: 'Intern' },
    }] })).receipts[0]
    const host = createConnectorNormalizationHost({
      repository: normalizationRepository,
      registry: createDefaultNormalizationResolverRegistry(),
      now: () => new Date('2026-07-11T12:00:00.000Z'),
    })
    const retry = {
      state: 'scheduled' as const, reason: 'operation_timeout' as const,
      attempt: 1, maxAttempts: 3, lastAttemptAt: '2026-07-11T12:00:00.000Z',
      computedDelayMs: 30_000, nextAttemptAt: '2026-07-11T12:00:30.000Z',
      horizonAt: '2026-07-11T13:00:00.000Z',
    }

    await host.run({
      rawRevision: receipt.revision,
      resolver: {
        id: 'fixture.network-details', version: '2.0.0', requiredInputs: ['rawRevision'],
        outputFields: ['companyName', 'roleTitle'], capabilities: ['network'],
        costClass: 'high', precedence: 500,
      },
      resolve: async () => [
        { resolverId: 'fixture.network-details', resolverVersion: '2.0.0', field: 'companyName' as const, inputHash: receipt.revision.contentHash, status: 'retry' as const, retry },
        { resolverId: 'fixture.network-details', resolverVersion: '2.0.0', field: 'roleTitle' as const, inputHash: receipt.revision.contentHash, status: 'retry' as const, retry },
      ],
    }, {
      connectorRunId: connectorRun.id, enabledCapabilities: ['network'],
      triggerOccurrence: receipt.occurrence,
    })

    expect(database.select().from(retryWork).all()).toEqual([
      expect.objectContaining({
        kind: 'normalization', rawRevisionId: receipt.revision.id,
        resolverId: 'fixture.network-details', resolverVersion: '2.0.0',
        reason: 'operation_timeout', attempt: 1, maxAttempts: 3,
        nextAttemptAt: '2026-07-11T12:00:30.000Z', state: 'scheduled',
      }),
    ])

    const beforeRunCount = database.select().from(normalizationRuns).all().length
    sqlite.exec(`
      create trigger inject_retry_work_failure
      before insert on retry_work
      begin select raise(abort, 'injected retry work failure'); end;
    `)
    const secondReceipt = (await rawRepository.ingestBatch({ records: [{
      adapter: { id: 'fixture.connector', kind: 'connector', version: '1.0.0' },
      capture: { connectorInstanceId: 'retry-instance', connectorRunId: connectorRun.id },
      observedAt: '2026-07-11T12:01:00.000Z', providerRecordId: 'retry-job-2',
      payload: { companyName: 'Retry Co Two', roleTitle: 'Intern' },
    }] })).receipts[0]
    await expect(host.run({
      rawRevision: secondReceipt.revision,
      resolver: {
        id: 'fixture.network-details', version: '2.0.0', requiredInputs: ['rawRevision'],
        outputFields: ['companyName'], capabilities: ['network'], costClass: 'high', precedence: 500,
      },
      resolve: async () => [{
        resolverId: 'fixture.network-details', resolverVersion: '2.0.0', field: 'companyName' as const,
        inputHash: secondReceipt.revision.contentHash, status: 'retry' as const, retry,
      }],
    }, {
      connectorRunId: connectorRun.id, enabledCapabilities: ['network'],
      triggerOccurrence: secondReceipt.occurrence,
    })).rejects.toThrow(/injected retry work failure/)
    expect(database.select().from(normalizationRuns).all()).toHaveLength(beforeRunCount)
  })
})
