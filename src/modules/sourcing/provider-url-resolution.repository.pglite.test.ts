import { describe, expect, it } from 'vitest'
import {
  captureEvidenceVersions,
  captureLineages,
  connectorInstances,
  retryWork,
  sourceExecutionScopes,
} from '../../db/schema'
import { createPgliteTestOwner } from '../../test/pglite-test-owner'
import { createProviderUrlResolutionRepository } from './provider-url-resolution.repository'

describe('provider URL resolution PGlite repository', () => {
  it('awaits enqueue and converges duplicate work through PostgreSQL conflict handling', async () => {
    const { database } = await createPgliteTestOwner()
    const timestamp = '2026-07-16T12:00:00.000Z'
    await database.insert(sourceExecutionScopes).values({
      id: 'scope-one', createdAt: timestamp, updatedAt: timestamp,
    })
    await database.insert(connectorInstances).values({
      id: 'connector-one', executionScopeId: 'scope-one', connectorId: 'jobright.resolver',
      connectorVersion: '1.0.0', displayName: 'Jobright', enabled: true,
      configJson: '{}', createdAt: timestamp, updatedAt: timestamp,
    })
    await database.insert(captureLineages).values({
      id: 'raw-one', createdAt: timestamp,
    })
    await database.insert(captureEvidenceVersions).values({
      id: 'revision-one', captureLineageId: 'raw-one', revision: 1,
      payloadJson: '{}', contentHash: 'sha256:payload', providerRecordId: 'provider-one',
      adapterId: 'jobright.resolver', adapterKind: 'connector', adapterVersion: '1.0.0',
      evidenceJson: '[]', observedAt: timestamp,
      createdAt: timestamp,
    })
    const repository = createProviderUrlResolutionRepository(database, () => new Date(timestamp))
    const input = {
      captureEvidenceVersionId: 'revision-one', connectorInstanceId: 'connector-one',
      executionScopeId: 'scope-one', inputHash: 'sha256:input',
      intermediaryUrl: 'https://jobright.ai/jobs/info/provider-one',
      providerRecordId: 'provider-one', resolverId: 'jobright.provider-url',
      resolverVersion: 'jobright-provider-url@1',
    }

    await expect(repository.enqueue(input)).resolves.toBe(true)
    await expect(repository.enqueue(input)).resolves.toBe(false)
    await expect(database.select().from(retryWork)).resolves.toHaveLength(1)
  })

  it('rolls back an acquisition when PostgreSQL rejects the claimed transition', async () => {
    const { client, database } = await createPgliteTestOwner()
    const timestamp = '2026-07-16T12:00:00.000Z'
    await database.insert(sourceExecutionScopes).values({
      id: 'scope-rollback', createdAt: timestamp, updatedAt: timestamp,
    })
    await database.insert(connectorInstances).values({
      id: 'connector-rollback', executionScopeId: 'scope-rollback',
      connectorId: 'jobright.resolver', connectorVersion: '1.0.0',
      displayName: 'Jobright', enabled: true, configJson: '{}',
      createdAt: timestamp, updatedAt: timestamp,
    })
    await database.insert(captureLineages).values({
      id: 'raw-rollback', createdAt: timestamp,
    })
    await database.insert(captureEvidenceVersions).values({
      id: 'revision-rollback', captureLineageId: 'raw-rollback', revision: 1,
      contentHash: 'sha256:rollback', adapterId: 'jobright.resolver',
      adapterKind: 'connector', adapterVersion: '1.0.0', evidenceJson: '[]',
      observedAt: timestamp, providerRecordId: 'provider-rollback',
      payloadJson: '{}', createdAt: timestamp,
    })
    const repository = createProviderUrlResolutionRepository(database, () => new Date(timestamp))
    await repository.enqueue({
      captureEvidenceVersionId: 'revision-rollback', connectorInstanceId: 'connector-rollback',
      executionScopeId: 'scope-rollback', inputHash: 'sha256:rollback',
      intermediaryUrl: 'https://jobright.ai/jobs/info/provider-rollback',
      providerRecordId: 'provider-rollback', resolverId: 'jobright.provider-url',
      resolverVersion: 'jobright-provider-url@1',
    })
    await client.exec(`
      create function reject_provider_claim() returns trigger language plpgsql as $$
      begin
        if new.state = 'acquired' then raise exception 'injected claim failure'; end if;
        return new;
      end $$;
      create trigger reject_provider_claim before update on retry_work
      for each row execute function reject_provider_claim();
    `)

    await expect(repository.claimDue(timestamp)).rejects.toThrow()
    await expect(database.select({
      state: retryWork.state,
      acquisitionToken: retryWork.acquisitionToken,
    }).from(retryWork)).resolves.toEqual([{
      state: 'scheduled', acquisitionToken: null,
    }])
  })
})
