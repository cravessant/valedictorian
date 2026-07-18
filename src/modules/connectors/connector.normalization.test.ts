import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  connectorInstances,
  connectorRuns,
  normalizationRuns,
  retryWork,
  sourceExecutionScopes,
} from '../../db/schema'
import {
  createPgliteClient,
  migratePgliteDatabase,
  type PgliteClient,
} from '../../db/pglite'
import { createDefaultNormalizationResolverRegistry } from '../sourcing/normalization.registry'
import { createPgliteNormalizationRepository } from '../sourcing/normalization.repository'
import { createPgliteRawSourceRepository } from '../sourcing/raw-source.repository'
import { createConnectorNormalizationHost } from './connector.normalization'

describe('connector normalization host', () => {
  const clients = new Set<PgliteClient>()

  afterEach(async () => {
    await Promise.all([...clients].map((client) => client.close()))
    clients.clear()
  })

  it('persists a blocked attempt without invoking an undeclared host capability', async () => {
    const { database, capture } = await createFixture(clients, 'blocked', '2026-07-10T12:00:00.000Z')
    const rawRepository = createPgliteRawSourceRepository(database)
    const normalizationRepository = createPgliteNormalizationRepository(database)
    const receipt = (await rawRepository.ingestBatch({ records: [{
      adapter: { id: 'fixture.connector', kind: 'connector', version: '1.0.0' },
      capture,
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
      registry: createDefaultNormalizationResolverRegistry(),
    })

    const outcomes = await host.run({
      rawRevision: receipt.revision,
      resolver: {
        id: 'fixture.model-destination', version: '1.0.0',
        requiredInputs: ['rawRevision'], outputFields: ['destinationUrl'],
        capabilities: ['model'], costClass: 'high', precedence: 200,
      },
      resolve,
    }, {
      connectorRunId: capture.connectorRunId,
      executionScopeId: capture.executionScopeId,
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
    await expect(normalizationRepository.getLatest(receipt.rawRecordId)).resolves.toMatchObject({
      gate: { status: 'needs_enrichment' },
      attempts: expect.arrayContaining([
        expect.objectContaining({
          resolver: expect.objectContaining({
            id: 'fixture.model-destination', capabilities: ['model'],
          }),
          outcomes: [expect.objectContaining({ status: 'blocked' })],
        }),
      ]),
    })
  })

  it('persists one typed retry unit for a multi-field connector resolver invocation', async () => {
    const timestamp = '2026-07-11T12:00:00.000Z'
    const { client, database, capture } = await createFixture(clients, 'retry', timestamp)
    const rawRepository = createPgliteRawSourceRepository(database)
    const normalizationRepository = createPgliteNormalizationRepository(database)
    const receipt = (await rawRepository.ingestBatch({ records: [{
      adapter: { id: 'fixture.connector', kind: 'connector', version: '1.0.0' },
      capture,
      observedAt: timestamp,
      providerRecordId: 'retry-job',
      payload: { companyName: 'Retry Co', roleTitle: 'Intern' },
    }] })).receipts[0]
    const host = createConnectorNormalizationHost({
      repository: normalizationRepository,
      registry: createDefaultNormalizationResolverRegistry(),
      now: () => new Date(timestamp),
    })
    const retry = {
      state: 'scheduled' as const, reason: 'operation_timeout' as const,
      attempt: 1, maxAttempts: 3, lastAttemptAt: timestamp,
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
      connectorRunId: capture.connectorRunId,
      executionScopeId: capture.executionScopeId,
      enabledCapabilities: ['network'],
      triggerOccurrence: receipt.occurrence,
    })

    await expect(database.select().from(retryWork)).resolves.toEqual([
      expect.objectContaining({
        kind: 'normalization', captureEvidenceVersionId: receipt.revision.id,
        resolverId: 'fixture.network-details', resolverVersion: '2.0.0',
        reason: 'operation_timeout', attempt: 1, maxAttempts: 3,
        nextAttemptAt: '2026-07-11T12:00:30.000Z', state: 'scheduled',
      }),
    ])

    const beforeRunCount = (await database.select().from(normalizationRuns)).length
    await client.exec(`
      create function inject_retry_work_failure() returns trigger language plpgsql as $$
      begin raise exception 'injected retry work failure'; end $$;
      create trigger inject_retry_work_failure before insert on retry_work
      for each row execute function inject_retry_work_failure();
    `)
    const secondReceipt = (await rawRepository.ingestBatch({ records: [{
      adapter: { id: 'fixture.connector', kind: 'connector', version: '1.0.0' },
      capture,
      observedAt: '2026-07-11T12:01:00.000Z',
      providerRecordId: 'retry-job-2',
      payload: { companyName: 'Retry Co Two', roleTitle: 'Intern' },
    }] })).receipts[0]
    await expect(host.run({
      rawRevision: secondReceipt.revision,
      resolver: {
        id: 'fixture.network-details', version: '2.0.0', requiredInputs: ['rawRevision'],
        outputFields: ['companyName'], capabilities: ['network'],
        costClass: 'high', precedence: 500,
      },
      resolve: async () => [{
        resolverId: 'fixture.network-details', resolverVersion: '2.0.0',
        field: 'companyName' as const, inputHash: secondReceipt.revision.contentHash,
        status: 'retry' as const, retry,
      }],
    }, {
      connectorRunId: capture.connectorRunId,
      executionScopeId: capture.executionScopeId,
      enabledCapabilities: ['network'],
      triggerOccurrence: secondReceipt.occurrence,
    })).rejects.toThrow()
    await expect(database.select().from(normalizationRuns)).resolves.toHaveLength(beforeRunCount)
  })
})

async function createFixture(
  clients: Set<PgliteClient>,
  suffix: string,
  timestamp: string,
) {
  const client = await createPgliteClient()
  clients.add(client)
  const database = await migratePgliteDatabase(client)
  const executionScopeId = `normalization-scope-${suffix}`
  const connectorInstanceId = `normalization-instance-${suffix}`
  const connectorRunId = `normalization-run-${suffix}`
  await database.insert(sourceExecutionScopes).values({
    id: executionScopeId, createdAt: timestamp, updatedAt: timestamp,
  })
  await database.insert(connectorInstances).values({
    id: connectorInstanceId, executionScopeId, connectorId: 'fixture.connector',
    connectorVersion: '1.0.0', displayName: 'Fixture', enabled: true,
    configJson: '{}', createdAt: timestamp, updatedAt: timestamp,
  })
  await database.insert(connectorRuns).values({
    id: connectorRunId, executionScopeId, connectorInstanceId, mode: 'manual',
    status: 'running', startedAt: timestamp, observationCount: 0, warningCount: 0,
    statsJson: '{}', warningsJson: '[]', retryHintsJson: 'null',
    createdAt: timestamp, updatedAt: timestamp,
  })
  return {
    client,
    database,
    capture: { connectorInstanceId, connectorRunId, executionScopeId },
  }
}
