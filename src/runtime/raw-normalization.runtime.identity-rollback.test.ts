import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { captureLineages, jobs } from '../db/schema'
import type { PgliteDatabase } from '../db/pglite'
import { createNormalizationOrchestrator } from '../modules/sourcing/normalization.orchestrator'
import { createPgliteNormalizationRepository } from '../modules/sourcing/normalization.repository'
import { createPgliteRawSourceRepository } from '../modules/sourcing/raw-source.repository'
import type { NormalizationResolver } from '../modules/sourcing/normalization.registry'
import {
  createDefaultNormalizationResolverRegistry,
  createNormalizationResolverRegistry
} from '../modules/sourcing/normalization.registry'
import {
  createTestConnectorCaptureFixture as createConnectorCaptureFixture,
  closeTestLocalValedictorianClient,
  createTestLocalValedictorianClient as createLocalValedictorianClient,
  createTestPgliteDatabase,
  getTestLocalValedictorianDatabase,
} from './local-valedictorian-client.test-harness'

describe('local deterministic raw normalization', () => {
  it('fails normalization for an emitted required-field failure and suppresses every lower resolver', async () => {
    const networkResolve = vi.fn(() => [])
    const notApplicableResolve = vi.fn(() => [])
    const failed: NormalizationResolver = {
      declaration: { id: 'fixture.failed-company', version: '1.0.0', requiredInputs: ['rawRevision'], outputFields: ['companyName'], capabilities: ['pure'], costClass: 'none', precedence: 1_000 },
      resolve(context) { return [{ resolverId: 'fixture.failed-company', resolverVersion: '1.0.0', field: 'companyName', inputHash: context.hashInput('company'), status: 'failed', reason: 'Synthetic infrastructure failure' }] },
    }
    const blocked = fixtureResolver('fixture.blocked-after-failure', 900, ['network'], networkResolve)
    const notApplicable = fixtureResolver('fixture.not-applicable-after-failure', 800, ['pure'], notApplicableResolve)
    notApplicable.declaration.supportedAdapters = { ids: ['another-adapter'] }
    const client = await createLocalValedictorianClient({ pgliteDataPath: tempDatabasePath(), normalizationRegistry: createNormalizationResolverRegistry([failed, blocked, notApplicable, ...createDefaultNormalizationResolverRegistry().resolvers]) })
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' }, observedAt: '2026-07-10T12:00:00.000Z',
      payload: { company: 'Fallback must not win', title: 'Intern', url: 'https://jobs.lever.co/acme/job-1' },
    }] })
    const result = await client.sourcing.rawRecords.normalization.get(intake.receipts[0].rawRecordId)
    expect(result).toMatchObject({ status: 'failed', gate: { status: 'failed', candidate: null }, canonicalCandidate: null })
    expect(networkResolve).not.toHaveBeenCalled()
    expect(notApplicableResolve).not.toHaveBeenCalled()
    expect(result.fieldOutcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ resolverId: 'fixture.failed-company', status: 'failed', reason: 'Synthetic infrastructure failure' }),
      expect.objectContaining({ resolverId: 'fixture.blocked-after-failure', status: 'suppressed' }),
      expect.objectContaining({ resolverId: 'fixture.not-applicable-after-failure', status: 'suppressed' }),
      expect.objectContaining({ resolverId: 'deterministic.explicit-company', status: 'suppressed' }),
    ]))
    expect(result.attempts).toEqual(expect.arrayContaining([
      expect.objectContaining({ resolver: expect.objectContaining({ id: 'fixture.blocked-after-failure' }), applicability: [expect.objectContaining({ status: 'blocked' })] }),
      expect.objectContaining({ resolver: expect.objectContaining({ id: 'fixture.not-applicable-after-failure' }), applicability: [expect.objectContaining({ status: 'not_applicable' })] }),
    ]))
  })

  it('fails the run when one field in a multi-field resolver emits failed', async () => {
    const partial: NormalizationResolver = {
      declaration: { id: 'fixture.partial-failure', version: '1.0.0', requiredInputs: ['rawRevision'], outputFields: ['companyName', 'roleTitle'], capabilities: ['pure'], costClass: 'none', precedence: 1_000 },
      resolve(context) { return [
        { resolverId: 'fixture.partial-failure', resolverVersion: '1.0.0', field: 'companyName', inputHash: context.hashInput('company'), status: 'failed', reason: 'Company resolver failed' },
        { resolverId: 'fixture.partial-failure', resolverVersion: '1.0.0', field: 'roleTitle', inputHash: context.hashInput('Intern'), status: 'resolved', value: 'Intern', confidence: 1 },
      ] },
    }
    const client = await createLocalValedictorianClient({ pgliteDataPath: tempDatabasePath(), normalizationRegistry: createNormalizationResolverRegistry([partial, ...createDefaultNormalizationResolverRegistry().resolvers]) })
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' }, observedAt: '2026-07-10T12:00:00.000Z',
      payload: { company: 'Fallback must not win', title: 'Intern', url: 'https://jobs.lever.co/acme/job-1' },
    }] })
    const result = await client.sourcing.rawRecords.normalization.get(intake.receipts[0].rawRecordId)
    expect(result).toMatchObject({
      status: 'failed', gate: { status: 'failed', candidate: null }, canonicalCandidate: null,
      attempts: expect.arrayContaining([expect.objectContaining({
        resolver: expect.objectContaining({ id: 'fixture.partial-failure' }), status: 'failed',
        outcomes: expect.arrayContaining([
          expect.objectContaining({ field: 'companyName', status: 'failed' }),
          expect.objectContaining({ field: 'roleTitle', status: 'resolved' }),
        ]),
      })]),
    })
  })

  it.each([
    ['source_alias', 'alias-1'],
    ['destination_url', 'https://jobs.lever.co/other/different-job'],
  ])('does not reinterpret an attached %s raw source entity', async (identityKind, identityValue) => {
    const fixture = await createTestPgliteDatabase()
    const { database } = fixture
    const rawRepository = createPgliteRawSourceRepository(database)
    const intake = await rawRepository.ingestBatch({ records: [{
      adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' }, observedAt: '2026-07-10T12:00:00.000Z',
      payload: { company: 'Acme', title: 'Intern', url: 'https://jobs.lever.co/acme/job-1' },
    }] })
    const sourceEntityId = `fixture-${identityKind}`
    await database.insert(jobs).values({
      id: sourceEntityId, identityKind, identityNamespace: 'fixture/v1', identityValue,
      createdAt: '2026-07-10T12:00:00.000Z',
    })
    await database.update(captureLineages).set({ jobId: sourceEntityId })
      .where(eq(captureLineages.id, intake.receipts[0].rawRecordId))
    const orchestrator = createNormalizationOrchestrator({
      repository: createPgliteNormalizationRepository(database),
      registry: createDefaultNormalizationResolverRegistry(),
    })
    const result = await orchestrator.normalize(intake.receipts[0].rawRecordId, intake.receipts[0].revision.id)
    expect(result).toMatchObject({
      status: 'completed', gate: { status: 'needs_enrichment', conflictingFields: expect.arrayContaining(['canonicalIdentity']), candidate: null },
      canonicalCandidate: null,
    })
    await fixture.close()
  })

  it.each([
    ['equivalent shuffled values', { raw: '$10-$20', interval: 'hour', currency: 'USD', maximum: 20, minimum: 10 }, 'passed', []],
    ['distinct values', { raw: '$10-$21', interval: 'hour', currency: 'USD', maximum: 21, minimum: 10 }, 'needs_enrichment', ['compensation']],
  ] as const)('reconciles equal-strength compensation %s semantically', async (_label, secondValue, expectedStatus, expectedConflicts) => {
    const firstValue = { minimum: 10, maximum: 20, currency: 'USD', interval: 'hour', raw: '$10-$20' }
    const compensationResolver = (id: string, value: typeof firstValue): NormalizationResolver => ({
      declaration: { id, version: '1.0.0', requiredInputs: ['rawRevision'], outputFields: ['compensation'], capabilities: ['pure'], costClass: 'none', precedence: 1_000 },
      resolve(context) { return [{ resolverId: id, resolverVersion: '1.0.0', field: 'compensation', inputHash: context.hashInput(value), status: 'resolved', value, confidence: 1 }] },
    })
    const client = await createLocalValedictorianClient({ pgliteDataPath: tempDatabasePath(), normalizationRegistry: createNormalizationResolverRegistry([
      compensationResolver('fixture.compensation-a', firstValue),
      compensationResolver('fixture.compensation-b', secondValue),
      ...createDefaultNormalizationResolverRegistry().resolvers,
    ]) })
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' }, observedAt: '2026-07-10T12:00:00.000Z',
      payload: { company: 'Acme', title: 'Intern', url: 'https://jobs.lever.co/acme/job-1' },
    }] })
    const result = await client.sourcing.rawRecords.normalization.get(intake.receipts[0].rawRecordId)
    expect(result.gate).toMatchObject({ status: expectedStatus, conflictingFields: expectedConflicts })
    expect(result.canonicalCandidate).toEqual(expectedStatus === 'passed' ? expect.objectContaining({ compensation: firstValue }) : null)
  })

  it('associates provider identities across adapters through one canonical destination without merging raw history', async () => {
    const pgliteDataPath = tempDatabasePath()
    const client = await createLocalValedictorianClient({ pgliteDataPath })
    const destination = 'https://jobs.lever.co/acme/shared-role'
    const alphaCapture = await createConnectorCaptureFixture(client, 'connector.alpha', '1.0.0')
    const betaCapture = await createConnectorCaptureFixture(client, 'connector.beta', '2.0.0')
    const first = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'connector.alpha', kind: 'connector', version: '1.0.0' },
      capture: alphaCapture,
      observedAt: '2026-07-10T12:00:00.000Z', providerRecordId: 'alpha-1', providerSchema: 'jobs/v1',
      payload: { company: 'Acme', title: 'Intern', url: destination },
    }] })
    const second = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'connector.beta', kind: 'connector', version: '2.0.0' },
      capture: betaCapture,
      observedAt: '2026-07-10T12:01:00.000Z', providerRecordId: 'beta-9', providerSchema: 'jobs/v2',
      payload: { company: 'Acme', title: 'Intern', url: destination },
    }] })
    const firstResult = await client.sourcing.rawRecords.normalization.get(first.receipts[0].rawRecordId)
    const secondResult = await client.sourcing.rawRecords.normalization.get(second.receipts[0].rawRecordId)

    expect(first.receipts[0].sourceEntityId).not.toBe(second.receipts[0].sourceEntityId)
    expect(secondResult).toMatchObject({
      gate: { status: 'passed' },
      canonicalCandidate: { sourceEntityId: firstResult.canonicalCandidate?.sourceEntityId },
    })
    const database = getTestLocalValedictorianDatabase(client)
    expect((await database.execute(sql`
      select identity_kind, identity_namespace, identity_value, provenance_kind, provenance_version
      from job_identities order by identity_kind, identity_namespace
    `)).rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ identity_kind: 'provider_job', identity_value: 'alpha-1', provenance_kind: 'capture' }),
      expect.objectContaining({ identity_kind: 'provider_job', identity_value: 'beta-9', provenance_kind: 'capture' }),
      expect.objectContaining({
        identity_kind: 'canonical_destination', identity_namespace: 'deterministic-destination/v1',
        identity_value: destination, provenance_kind: 'normalization', provenance_version: 'source-identity-reconciliation/v1',
      }),
    ]))
    expect((await database.execute(sql`
      select capture_lineage_id, count(*)::integer as revisions from capture_evidence_versions
      group by capture_lineage_id order by capture_lineage_id
    `)).rows).toEqual([
      { capture_lineage_id: first.receipts[0].rawRecordId, revisions: 1 },
      { capture_lineage_id: second.receipts[0].rawRecordId, revisions: 1 },
    ].sort((left, right) => left.capture_lineage_id.localeCompare(right.capture_lineage_id)))
  })

  it('records incompatible strong destination evidence as an idempotent conflict without merging history', async () => {
    const pgliteDataPath = tempDatabasePath()
    const client = await createLocalValedictorianClient({ pgliteDataPath })
    const capture = await createConnectorCaptureFixture(client, 'connector.alpha', '1.0.0')
    const first = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'connector.alpha', kind: 'connector', version: '1.0.0' },
      capture,
      observedAt: '2026-07-10T12:00:00.000Z', providerRecordId: 'alpha-1', providerSchema: 'jobs/v1',
      payload: { company: 'Acme', title: 'Intern', url: 'https://jobs.lever.co/acme/role-one' },
    }] })
    const conflicting = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'connector.alpha', kind: 'connector', version: '1.0.0' },
      capture,
      observedAt: '2026-07-10T12:05:00.000Z', providerRecordId: 'alpha-1', providerSchema: 'jobs/v1',
      payload: { company: 'Acme', title: 'Intern', url: 'https://jobs.lever.co/acme/role-two' },
    }] })
    const result = await client.sourcing.rawRecords.normalization.get(conflicting.receipts[0].rawRecordId)

    expect(conflicting.receipts[0]).toMatchObject({
      rawRecordId: first.receipts[0].rawRecordId,
      sourceEntityId: first.receipts[0].sourceEntityId,
      revision: { revision: 2, reused: false },
    })
    expect(result).toMatchObject({
      gate: { status: 'needs_enrichment', conflictingFields: expect.arrayContaining(['canonicalIdentity']) },
      canonicalCandidate: null,
    })
    await closeTestLocalValedictorianClient(client)
    const restarted = await createLocalValedictorianClient({ pgliteDataPath })
    await expect(restarted.sourcing.rawRecords.normalization.get(conflicting.receipts[0].rawRecordId)).resolves.toMatchObject({
      gate: { status: 'needs_enrichment' }, canonicalCandidate: null,
    })
    const database = getTestLocalValedictorianDatabase(restarted)
    expect((await database.execute(sql`
      select job_id, capture_evidence_version_id, identity_kind, identity_value, reason, provenance_version
      from job_identity_conflicts
    `)).rows).toEqual([expect.objectContaining({
      job_id: first.receipts[0].sourceEntityId,
      capture_evidence_version_id: conflicting.receipts[0].revision.id,
      identity_kind: 'canonical_destination',
      identity_value: 'https://jobs.lever.co/acme/role-two',
      reason: 'Source entity already has a different strong destination association',
      provenance_version: 'source-identity-reconciliation/v1',
    })])
    expect((await database.execute(sql`
      select count(*)::integer as count from capture_evidence_versions
      where capture_lineage_id = ${first.receipts[0].rawRecordId}
    `)).rows[0]).toEqual({ count: 2 })
  })

  it('persists only canonical job destinations and explicit job-specific intermediaries as distinct aliases', async () => {
    const pgliteDataPath = tempDatabasePath()
    const intermediaryResolver: NormalizationResolver = {
      declaration: {
        id: 'fixture.provider-destination', version: '3.2.1', requiredInputs: ['rawRevision'],
        outputFields: ['destinationUrl'], capabilities: ['pure'], costClass: 'none', precedence: 1_000,
      },
      resolve(context) {
        const intermediaryUrl = context.rawRevision.payload?.intermediaryUrl
        const value = {
          class: 'employer_or_ats' as const,
          url: 'https://jobs.lever.co/acme/job-1',
          intermediaryUrl: typeof intermediaryUrl === 'string' ? intermediaryUrl : null,
        }
        return [{
          resolverId: 'fixture.provider-destination', resolverVersion: '3.2.1', field: 'destinationUrl',
          inputHash: context.hashInput(value), status: 'resolved', value, confidence: 1, authoritative: true,
        }]
      },
    }
    const client = await createLocalValedictorianClient({
      pgliteDataPath,
      normalizationRegistry: createNormalizationResolverRegistry([
        intermediaryResolver,
        ...createDefaultNormalizationResolverRegistry().resolvers,
      ]),
    })
    const capture = await createConnectorCaptureFixture(client, 'connector.jobright', '3.2.1')
    const accepted = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'connector.jobright', kind: 'connector', version: '3.2.1' },
      capture,
      observedAt: '2026-07-10T12:00:00.000Z', providerRecordId: 'jobright-1', providerSchema: 'jobs/v1',
      payload: {
        company: 'Acme', title: 'Intern',
        intermediaryUrl: 'https://jobright.ai/jobs/info/jobright-1?utm_source=test',
      },
    }] })
    await expect(client.sourcing.rawRecords.normalization.get(accepted.receipts[0].rawRecordId)).resolves.toMatchObject({
      gate: { status: 'passed' },
    })
    await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'connector.jobright', kind: 'connector', version: '3.2.1' },
      capture,
      observedAt: '2026-07-10T12:05:00.000Z', providerRecordId: 'jobright-1', providerSchema: 'jobs/v1',
      payload: { company: 'Acme', title: 'Intern', intermediaryUrl: 'https://jobright.ai/companies/acme' },
    }] })
    const database = getTestLocalValedictorianDatabase(client)
    expect((await database.execute(sql`
      select identity_kind, identity_value from job_identities
      where identity_kind in ('canonical_destination','destination_alias','intermediary_alias')
      order by identity_kind
    `)).rows).toEqual([
      { identity_kind: 'canonical_destination', identity_value: 'https://jobs.lever.co/acme/job-1' },
      { identity_kind: 'destination_alias', identity_value: 'https://jobs.lever.co/acme/job-1' },
      { identity_kind: 'intermediary_alias', identity_value: 'https://jobright.ai/jobs/info/jobright-1' },
    ])
    expect((await database.execute(sql`
      select count(*)::integer as count from job_identities
      where identity_value = 'https://jobright.ai/companies/acme'
    `)).rows[0]).toEqual({ count: 0 })
  })

  it('never turns weak descriptive fingerprints into identities or hard merges', async () => {
    const pgliteDataPath = tempDatabasePath()
    const client = await createLocalValedictorianClient({ pgliteDataPath })
    const input = {
      adapter: { id: 'manual.fixture', kind: 'manual' as const, version: '1.0.0' },
      observedAt: '2026-07-10T12:00:00.000Z',
      payload: { company: 'Acme', title: 'Intern', location: 'New York', postedAt: { value: '2026-07-10', precision: 'date', raw: 'Jul 10' } },
    }
    const first = await client.sourcing.rawRecords.ingestBatch({ records: [input] })
    const second = await client.sourcing.rawRecords.ingestBatch({ records: [{ ...input, observedAt: '2026-07-10T12:01:00.000Z' }] })
    expect(first.receipts[0]).toMatchObject({ sourceEntityId: null, revision: { revision: 1 } })
    expect(second.receipts[0]).toMatchObject({ sourceEntityId: null, revision: { revision: 1 } })
    expect(second.receipts[0].rawRecordId).not.toBe(first.receipts[0].rawRecordId)
    await expect(client.sourcing.rawRecords.normalization.get(first.receipts[0].rawRecordId)).resolves.toMatchObject({
      gate: { status: 'needs_enrichment' }, canonicalCandidate: null,
    })
    const database = getTestLocalValedictorianDatabase(client)
    expect((await database.execute(sql`
      select count(*)::integer as count from job_identities
    `)).rows[0]).toEqual({ count: 0 })
    expect((await database.execute(sql`
      select count(*)::integer as count from job_identity_conflicts
    `)).rows[0]).toEqual({ count: 0 })
  })

  it('does not partially attach destination identities when an intermediary alias is pre-owned', async () => {
    const pgliteDataPath = tempDatabasePath()
    await seedPreownedIdentity(pgliteDataPath)
    const destinationResolver = fixedDestinationResolver('https://jobright.ai/jobs/info/shared-job')
    const client = await createLocalValedictorianClient({
      pgliteDataPath,
      normalizationRegistry: createNormalizationResolverRegistry([
        destinationResolver,
        ...createDefaultNormalizationResolverRegistry().resolvers,
      ]),
    })
    const capture = await createConnectorCaptureFixture(client, 'connector.alpha', '1.0.0')
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'connector.alpha', kind: 'connector', version: '1.0.0' },
      capture,
      observedAt: '2026-07-10T12:00:00.000Z', providerRecordId: 'alpha-1', providerSchema: 'jobs/v1',
      payload: { company: 'Acme', title: 'Intern' },
    }] })

    await expect(client.sourcing.rawRecords.normalization.get(intake.receipts[0].rawRecordId)).resolves.toMatchObject({
      gate: { status: 'needs_enrichment', conflictingFields: expect.arrayContaining(['canonicalIdentity']) },
      canonicalCandidate: null,
    })
    const database = getTestLocalValedictorianDatabase(client)
    expect((await database.execute(sql`
      select identity_kind from job_identities
      where job_id = ${intake.receipts[0].sourceEntityId}
        and identity_kind in ('canonical_destination','destination_alias')
    `)).rows).toEqual([])
    expect((await database.execute(sql`
      select identity_kind, identity_value, conflicting_job_id
      from job_identity_conflicts where job_id = ${intake.receipts[0].sourceEntityId}
    `)).rows).toEqual([{
      identity_kind: 'intermediary_alias',
      identity_value: 'https://jobright.ai/jobs/info/shared-job',
      conflicting_job_id: 'preowner',
    }])
    await closeTestLocalValedictorianClient(client)
    const restarted = await createLocalValedictorianClient({
      pgliteDataPath,
      normalizationRegistry: createNormalizationResolverRegistry([
        destinationResolver,
        ...createDefaultNormalizationResolverRegistry().resolvers,
      ]),
    })
    await expect(restarted.sourcing.rawRecords.normalization.get(intake.receipts[0].rawRecordId)).resolves.toMatchObject({
      gate: { status: 'needs_enrichment' }, canonicalCandidate: null,
    })
  })

  it('audits a provisional raw identity collision against its resolved destination owner', async () => {
    const pgliteDataPath = tempDatabasePath()
    await seedPreownedIdentity(pgliteDataPath)
    const destinationResolver = fixedDestinationResolver('https://jobright.ai/jobs/info/shared-job')
    const registry = createNormalizationResolverRegistry([
      destinationResolver,
      ...createDefaultNormalizationResolverRegistry().resolvers,
    ])
    const client = await createLocalValedictorianClient({ pgliteDataPath, normalizationRegistry: registry })
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' },
      observedAt: '2026-07-10T12:00:00.000Z',
      payload: { company: 'Acme', title: 'Intern' },
    }] })
    expect(intake.receipts[0].sourceEntityId).toBeNull()
    await expect(client.sourcing.rawRecords.normalization.get(intake.receipts[0].rawRecordId)).resolves.toMatchObject({
      gate: { status: 'needs_enrichment' }, canonicalCandidate: null,
    })
    const database = getTestLocalValedictorianDatabase(client)
    const owner = (await database.execute(sql`
      select id from jobs
      where identity_kind = 'destination_url' and identity_value = 'https://jobs.lever.co/acme/target-role'
    `)).rows[0] as { id: string }
    expect((await database.execute(sql`
      select identity_kind from job_identities
      where job_id = ${owner.id}
        and identity_kind in ('canonical_destination','destination_alias','intermediary_alias')
    `)).rows).toEqual([])
    expect((await database.execute(sql`
      select job_id, conflicting_job_id, capture_evidence_version_id, identity_kind, identity_value
      from job_identity_conflicts
    `)).rows).toEqual([{
      job_id: owner.id,
      conflicting_job_id: 'preowner',
      capture_evidence_version_id: intake.receipts[0].revision.id,
      identity_kind: 'intermediary_alias',
      identity_value: 'https://jobright.ai/jobs/info/shared-job',
    }])
    await closeTestLocalValedictorianClient(client)
    const restarted = await createLocalValedictorianClient({ pgliteDataPath, normalizationRegistry: registry })
    await expect(restarted.sourcing.rawRecords.normalization.get(intake.receipts[0].rawRecordId)).resolves.toMatchObject({
      gate: { status: 'needs_enrichment' }, canonicalCandidate: null,
    })
    await expect(restarted.sourcing.rawRecords.replay({
      selector: { rawRevisionIds: [intake.receipts[0].revision.id] },
      invalidate: { canonicalSchemaVersions: ['canonical-source-candidate/v1'] },
    })).resolves.toMatchObject({ status: 'completed' })
    const replayedDatabase = getTestLocalValedictorianDatabase(restarted)
    expect((await replayedDatabase.execute(sql`
      select count(*)::integer as count from jobs
      where identity_kind = 'destination_url' and identity_value = 'https://jobs.lever.co/acme/target-role'
    `)).rows[0]).toEqual({ count: 1 })
    expect((await replayedDatabase.execute(sql`
      select count(*)::integer as count from job_identity_conflicts
    `)).rows[0]).toEqual({ count: 1 })
  })

  it('does not partially attach a proposal that would cross the identity bound', async () => {
    const pgliteDataPath = tempDatabasePath()
    const client = await createLocalValedictorianClient({ pgliteDataPath })
    const capture = await createConnectorCaptureFixture(client, 'connector.alpha', '1.0.0')
    const initial = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'connector.alpha', kind: 'connector', version: '1.0.0' },
      capture,
      observedAt: '2026-07-10T12:00:00.000Z', providerRecordId: 'alpha-1', providerSchema: 'jobs/v1',
      payload: {},
    }] })
    const sourceEntityId = initial.receipts[0].sourceEntityId
    if (!sourceEntityId) throw new Error('Fixture provider entity is missing')
    const database = getTestLocalValedictorianDatabase(client)
    for (let index = 0; index < 30; index += 1) {
      await database.execute(sql`
        insert into job_identities (
          id, job_id, identity_kind, identity_namespace, identity_value,
          provenance_kind, provenance_version, evidence_json, created_at
        ) values (${`bound-${index}`}, ${sourceEntityId}, 'destination_alias',
          'fixture-bound/v1', ${`https://jobs.lever.co/acme/bound-${index}`}, 'normalization',
          'source-identity-reconciliation/v1', '{}', '2026-07-10T12:01:00.000Z')
      `)
    }
    const completed = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'connector.alpha', kind: 'connector', version: '1.0.0' },
      capture,
      observedAt: '2026-07-10T12:05:00.000Z', providerRecordId: 'alpha-1', providerSchema: 'jobs/v1',
      payload: { company: 'Acme', title: 'Intern', url: 'https://jobs.lever.co/acme/overflow-role' },
    }] })

    await expect(client.sourcing.rawRecords.normalization.get(completed.receipts[0].rawRecordId)).resolves.toMatchObject({
      gate: { status: 'needs_enrichment' }, canonicalCandidate: null,
    })
    expect((await database.execute(sql`
      select identity_kind from job_identities
      where job_id = ${sourceEntityId}
        and identity_value = 'https://jobs.lever.co/acme/overflow-role'
    `)).rows).toEqual([])
    expect((await database.execute(sql`
      select reason from job_identity_conflicts where job_id = ${sourceEntityId}
    `)).rows).toEqual([{ reason: 'Source entity identity bound is exhausted' }])
    expect((await database.execute(sql`
      select count(*)::integer as count from job_identities where job_id = ${sourceEntityId}
    `)).rows[0]).toEqual({ count: 31 })
  })

  it('rolls back reconciliation when normalization run persistence fails', async () => {
    const pgliteDataPath = tempDatabasePath()
    const setup = await createTestPgliteDatabase(pgliteDataPath)
    await installFailureTrigger(
      setup.database,
      'normalization_runs',
      'fail_normalization_run',
      'fixture normalization run failure',
    )
    await setup.close()
    const client = await createLocalValedictorianClient({ pgliteDataPath })

    await expect(client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' },
      observedAt: '2026-07-10T12:00:00.000Z',
      payload: { company: 'Acme', title: 'Intern', url: 'https://jobs.lever.co/acme/atomic-role' },
    }] })).resolves.toMatchObject({ receipts: [expect.objectContaining({ sourceEntityId: null })] })
    const database = getTestLocalValedictorianDatabase(client)
    expect(await normalizationPersistenceState(database)).toEqual({
      jobs: 0,
      identities: 0,
      conflicts: 0,
      runs: 0,
      attempts: 0,
      outcomes: 0,
      candidates: 0,
      gates: 0,
    })
    expect(await rawLedgerState(database)).toEqual({ records: 1, revisions: 1, occurrences: 1 })
  })

  it('rolls back late gate failure while preserving prior normalization history', async () => {
    const fixture = await createTestPgliteDatabase()
    const { database } = fixture
    const rawRepository = createPgliteRawSourceRepository(database)
    const orchestrator = createNormalizationOrchestrator({
      repository: createPgliteNormalizationRepository(database),
      registry: createDefaultNormalizationResolverRegistry(),
    })
    const prior = await rawRepository.ingestBatch({ records: [{
      adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' },
      observedAt: '2026-07-10T11:00:00.000Z',
      payload: { company: 'Prior', title: 'Intern', url: 'https://jobs.lever.co/prior/role-1' },
    }] })
    await orchestrator.normalize(prior.receipts[0].rawRecordId, prior.receipts[0].revision.id)
    const before = await normalizationPersistenceState(database)
    const failing = await rawRepository.ingestBatch({ records: [{
      adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' },
      observedAt: '2026-07-10T12:00:00.000Z',
      payload: { company: 'Later', title: 'Intern', url: 'https://jobs.lever.co/later/role-2' },
    }] })
    await installFailureTrigger(
      database,
      'normalization_gates',
      'fail_normalization_gate',
      'fixture normalization gate failure',
    )

    await expect(orchestrator.normalize(
      failing.receipts[0].rawRecordId,
      failing.receipts[0].revision.id,
    )).rejects.toThrow(/Failed query: insert into "normalization_gates"/)
    expect(await normalizationPersistenceState(database)).toEqual(before)
    expect(await rawLedgerState(database)).toEqual({ records: 2, revisions: 2, occurrences: 2 })
    await fixture.close()
  })

  it('rolls back a conflict audit when its needs-enrichment gate fails', async () => {
    const fixture = await createTestPgliteDatabase()
    const { database } = fixture
    await database.execute(sql`
      insert into jobs (id, identity_kind, identity_namespace, identity_value, created_at)
      values ('preowner', 'provider_job', 'fixture', 'preowner-job', '2026-07-10T11:00:00.000Z')
    `)
    await database.execute(sql`
      insert into job_identities (
        id, job_id, identity_kind, identity_namespace, identity_value,
        provenance_kind, provenance_version, evidence_json, created_at
      ) values (
        'preowned-intermediary', 'preowner', 'intermediary_alias', 'job-intermediary/v1',
        'https://jobright.ai/jobs/info/shared-job', 'normalization',
        'source-identity-reconciliation/v1', '{}', '2026-07-10T11:00:00.000Z'
      )
    `)
    const rawRepository = createPgliteRawSourceRepository(database)
    const intake = await rawRepository.ingestBatch({ records: [{
      adapter: { id: 'manual.alpha', kind: 'manual', version: '1.0.0' },
      observedAt: '2026-07-10T12:00:00.000Z', providerRecordId: 'alpha-1', providerSchema: 'jobs/v1',
      payload: { company: 'Acme', title: 'Intern' },
    }] })
    const before = await normalizationPersistenceState(database)
    await installFailureTrigger(
      database,
      'normalization_gates',
      'fail_conflict_gate',
      'fixture conflict gate failure',
    )
    const orchestrator = createNormalizationOrchestrator({
      repository: createPgliteNormalizationRepository(database),
      registry: createNormalizationResolverRegistry([
        fixedDestinationResolver('https://jobright.ai/jobs/info/shared-job'),
        ...createDefaultNormalizationResolverRegistry().resolvers,
      ]),
    })

    await expect(orchestrator.normalize(
      intake.receipts[0].rawRecordId,
      intake.receipts[0].revision.id,
    )).rejects.toThrow(/Failed query: insert into "normalization_gates"/)
    expect(await normalizationPersistenceState(database)).toEqual(before)
    expect((await database.execute(sql`
      select count(*)::integer as count from job_identity_conflicts
    `)).rows[0]).toEqual({ count: 0 })
    await fixture.close()
  })
})

function fixtureResolver(id: string, precedence: number, capabilities: Array<'pure' | 'network'>, resolve: NormalizationResolver['resolve']): NormalizationResolver {
  return { declaration: { id, version: '1.0.0', requiredInputs: ['rawRevision'], outputFields: ['companyName'], capabilities, costClass: 'none', precedence }, resolve }
}
function fixedDestinationResolver(intermediaryUrl: string): NormalizationResolver {
  return {
    declaration: {
      id: 'fixture.fixed-destination', version: '1.0.0', requiredInputs: ['rawRevision'],
      outputFields: ['destinationUrl'], capabilities: ['pure'], costClass: 'none', precedence: 1_000,
    },
    resolve(context) {
      const value = { class: 'employer_or_ats' as const, url: 'https://jobs.lever.co/acme/target-role', intermediaryUrl }
      return [{
        resolverId: 'fixture.fixed-destination', resolverVersion: '1.0.0', field: 'destinationUrl',
        inputHash: context.hashInput(value), status: 'resolved', value, confidence: 1, authoritative: true,
      }]
    },
  }
}
async function seedPreownedIdentity(pgliteDataPath: string) {
  const fixture = await createTestPgliteDatabase(pgliteDataPath)
  await fixture.database.execute(sql`
    insert into jobs (id, identity_kind, identity_namespace, identity_value, created_at)
    values ('preowner', 'provider_job', 'fixture', 'preowner-job', '2026-07-10T11:00:00.000Z')
  `)
  await fixture.database.execute(sql`
    insert into job_identities (
      id, job_id, identity_kind, identity_namespace, identity_value,
      provenance_kind, provenance_version, evidence_json, created_at
    ) values (
      'preowned-intermediary', 'preowner', 'intermediary_alias', 'job-intermediary/v1',
      'https://jobright.ai/jobs/info/shared-job', 'normalization',
      'source-identity-reconciliation/v1', '{}', '2026-07-10T11:00:00.000Z'
    )
  `)
  await fixture.close()
}
async function installFailureTrigger(
  database: PgliteDatabase,
  table: string,
  trigger: string,
  message: string,
) {
  await database.execute(sql.raw(`
    create function ${trigger}_fn() returns trigger as $$
    begin raise exception '${message}'; end;
    $$ language plpgsql
  `))
  await database.execute(sql.raw(`
    create trigger ${trigger} before insert on ${table}
    for each row execute function ${trigger}_fn()
  `))
}
async function normalizationPersistenceState(database: PgliteDatabase) {
  const count = async (table: string) => Number((await database.execute(
    sql.raw(`select count(*) as count from ${table}`),
  )).rows[0]?.count)
  return {
    jobs: await count('jobs'),
    identities: await count('job_identities'),
    conflicts: await count('job_identity_conflicts'),
    runs: await count('normalization_runs'),
    attempts: await count('normalization_attempts'),
    outcomes: await count('normalization_field_outcomes'),
    candidates: await count('job_fact_versions'),
    gates: await count('normalization_gates'),
  }
}
async function rawLedgerState(database: PgliteDatabase) {
  const count = async (table: string) => Number((await database.execute(
    sql.raw(`select count(*) as count from ${table}`),
  )).rows[0]?.count)
  return {
    records: await count('capture_lineages'),
    revisions: await count('capture_evidence_versions'),
    occurrences: await count('captures'),
  }
}
function tempDatabasePath() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'normalization-runtime-'))
}
