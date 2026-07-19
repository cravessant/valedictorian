import { describe, expect, it } from 'vitest'
import {
  connectorInstances,
  connectorRuns,
  normalizationRuns,
  sourceExecutionScopes,
} from '../../db/schema'
import { createPgliteTestOwner } from '../../test/pglite-test-owner'
import { createDefaultNormalizationResolverRegistry } from '../sourcing/normalization.registry'
import { createPgliteNormalizationRepository } from '../sourcing/normalization.repository'
import { createPgliteRawSourceRepository } from '../sourcing/raw-source.repository'
import { createConnectorNormalizationHost } from './connector.normalization'

describe('connector normalization host schema failures', () => {
  it('rolls back normalization runs when retry work persistence fails', async () => {
    const timestamp = '2026-07-11T12:00:00.000Z'
    const { client, database } = await createPgliteTestOwner()
    const executionScopeId = 'normalization-scope-retry-rollback'
    const connectorInstanceId = 'normalization-instance-retry-rollback'
    const connectorRunId = 'normalization-run-retry-rollback'
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
    const capture = { connectorInstanceId, connectorRunId, executionScopeId }
    const rawRepository = createPgliteRawSourceRepository(database)
    const normalizationRepository = createPgliteNormalizationRepository(database)
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
    const receipt = (await rawRepository.ingestBatch({ records: [{
      adapter: { id: 'fixture.connector', kind: 'connector', version: '1.0.0' },
      capture,
      observedAt: timestamp,
      providerRecordId: 'retry-job-rollback',
      payload: { companyName: 'Retry Co', roleTitle: 'Intern' },
    }] })).receipts[0]
    const beforeRunCount = (await database.select().from(normalizationRuns)).length
    await client.exec(`
      create function inject_retry_work_failure() returns trigger language plpgsql as $$
      begin raise exception 'injected retry work failure'; end $$;
      create trigger inject_retry_work_failure before insert on retry_work
      for each row execute function inject_retry_work_failure();
    `)
    await expect(host.run({
      rawRevision: receipt.revision,
      resolver: {
        id: 'fixture.network-details', version: '2.0.0', requiredInputs: ['rawRevision'],
        outputFields: ['companyName'], capabilities: ['network'],
        costClass: 'high', precedence: 500,
      },
      resolve: async () => [{
        resolverId: 'fixture.network-details', resolverVersion: '2.0.0',
        field: 'companyName' as const, inputHash: receipt.revision.contentHash,
        status: 'retry' as const, retry,
      }],
    }, {
      connectorRunId: capture.connectorRunId,
      executionScopeId: capture.executionScopeId,
      enabledCapabilities: ['network'],
      triggerOccurrence: receipt.occurrence,
    })).rejects.toThrow()
    await expect(database.select().from(normalizationRuns)).resolves.toHaveLength(beforeRunCount)
  })
})
