import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { captureLineages, jobs } from '../db/schema'
import { createDrizzleDatabase, createFileDatabase, createInMemoryDatabase, migrateDatabase } from '../db/sqlite'
import { createNormalizationOrchestrator } from '../modules/sourcing/normalization.orchestrator'
import { createSqliteNormalizationRepository } from '../modules/sourcing/normalization.repository'
import { createSqliteRawSourceRepository } from '../modules/sourcing/raw-source.repository'
import { createConnectorCaptureFixture } from '../test-fixtures/connector-capture.fixture'
import type { NormalizationResolver } from '../modules/sourcing/normalization.registry'
import {
  createDefaultNormalizationResolverRegistry,
  createNormalizationResolverRegistry
} from '../modules/sourcing/normalization.registry'
import { createLocalValedictorianClient } from './local-valedictorian-client'

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
    const client = createLocalValedictorianClient({ sqlitePath: tempDatabasePath(), normalizationRegistry: createNormalizationResolverRegistry([failed, blocked, notApplicable, ...createDefaultNormalizationResolverRegistry().resolvers]) })
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
    const client = createLocalValedictorianClient({ sqlitePath: tempDatabasePath(), normalizationRegistry: createNormalizationResolverRegistry([partial, ...createDefaultNormalizationResolverRegistry().resolvers]) })
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
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const rawRepository = createSqliteRawSourceRepository(database)
    const intake = await rawRepository.ingestBatch({ records: [{
      adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' }, observedAt: '2026-07-10T12:00:00.000Z',
      payload: { company: 'Acme', title: 'Intern', url: 'https://jobs.lever.co/acme/job-1' },
    }] })
    const sourceEntityId = `fixture-${identityKind}`
    database.insert(jobs).values({
      id: sourceEntityId, identityKind, identityNamespace: 'fixture/v1', identityValue,
      createdAt: '2026-07-10T12:00:00.000Z',
    }).run()
    database.update(captureLineages).set({ jobId: sourceEntityId }).where(eq(captureLineages.id, intake.receipts[0].rawRecordId)).run()
    const orchestrator = createNormalizationOrchestrator({
      repository: createSqliteNormalizationRepository(database),
      registry: createDefaultNormalizationResolverRegistry(),
    })
    const result = await orchestrator.normalize(intake.receipts[0].rawRecordId, intake.receipts[0].revision.id)
    expect(result).toMatchObject({
      status: 'completed', gate: { status: 'needs_enrichment', conflictingFields: expect.arrayContaining(['canonicalIdentity']), candidate: null },
      canonicalCandidate: null,
    })
    sqlite.close()
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
    const client = createLocalValedictorianClient({ sqlitePath: tempDatabasePath(), normalizationRegistry: createNormalizationResolverRegistry([
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
    const sqlitePath = tempDatabasePath()
    const client = createLocalValedictorianClient({ sqlitePath })
    const destination = 'https://jobs.lever.co/acme/shared-role'
    const alphaCapture = await createConnectorCaptureFixture(sqlitePath, 'connector.alpha', '1.0.0')
    const betaCapture = await createConnectorCaptureFixture(sqlitePath, 'connector.beta', '2.0.0')
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
    const sqlite = createFileDatabase(sqlitePath)
    expect(sqlite.prepare(`
      select identity_kind, identity_namespace, identity_value, provenance_kind, provenance_version
      from job_identities order by identity_kind, identity_namespace
    `).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ identity_kind: 'provider_job', identity_value: 'alpha-1', provenance_kind: 'capture' }),
      expect.objectContaining({ identity_kind: 'provider_job', identity_value: 'beta-9', provenance_kind: 'capture' }),
      expect.objectContaining({
        identity_kind: 'canonical_destination', identity_namespace: 'deterministic-destination/v1',
        identity_value: destination, provenance_kind: 'normalization', provenance_version: 'source-identity-reconciliation/v1',
      }),
    ]))
    expect(sqlite.prepare('select capture_lineage_id, count(*) as revisions from capture_evidence_versions group by capture_lineage_id order by capture_lineage_id').all()).toEqual([
      { capture_lineage_id: first.receipts[0].rawRecordId, revisions: 1 },
      { capture_lineage_id: second.receipts[0].rawRecordId, revisions: 1 },
    ].sort((left, right) => left.capture_lineage_id.localeCompare(right.capture_lineage_id)))
    expect(sqlite.prepare('pragma foreign_key_check').all()).toEqual([])
    sqlite.close()
  })

  it('records incompatible strong destination evidence as an idempotent conflict without merging history', async () => {
    const sqlitePath = tempDatabasePath()
    const client = createLocalValedictorianClient({ sqlitePath })
    const capture = await createConnectorCaptureFixture(sqlitePath, 'connector.alpha', '1.0.0')
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
    const restarted = createLocalValedictorianClient({ sqlitePath })
    await expect(restarted.sourcing.rawRecords.normalization.get(conflicting.receipts[0].rawRecordId)).resolves.toMatchObject({
      gate: { status: 'needs_enrichment' }, canonicalCandidate: null,
    })
    const sqlite = createFileDatabase(sqlitePath)
    expect(sqlite.prepare(`
      select job_id, capture_evidence_version_id, identity_kind, identity_value, reason, provenance_version
      from job_identity_conflicts
    `).all()).toEqual([expect.objectContaining({
      job_id: first.receipts[0].sourceEntityId,
      capture_evidence_version_id: conflicting.receipts[0].revision.id,
      identity_kind: 'canonical_destination',
      identity_value: 'https://jobs.lever.co/acme/role-two',
      reason: 'Source entity already has a different strong destination association',
      provenance_version: 'source-identity-reconciliation/v1',
    })])
    expect(sqlite.prepare('select count(*) as count from capture_evidence_versions where capture_lineage_id = ?').get(first.receipts[0].rawRecordId)).toEqual({ count: 2 })
    expect(sqlite.prepare('pragma foreign_key_check').all()).toEqual([])
    sqlite.close()
  })

  it('persists only canonical job destinations and explicit job-specific intermediaries as distinct aliases', async () => {
    const sqlitePath = tempDatabasePath()
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
    const client = createLocalValedictorianClient({
      sqlitePath,
      normalizationRegistry: createNormalizationResolverRegistry([
        intermediaryResolver,
        ...createDefaultNormalizationResolverRegistry().resolvers,
      ]),
    })
    const capture = await createConnectorCaptureFixture(sqlitePath, 'connector.jobright', '3.2.1')
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
    const sqlite = createFileDatabase(sqlitePath)
    expect(sqlite.prepare(`
      select identity_kind, identity_value from job_identities
      where identity_kind in ('canonical_destination','destination_alias','intermediary_alias')
      order by identity_kind
    `).all()).toEqual([
      { identity_kind: 'canonical_destination', identity_value: 'https://jobs.lever.co/acme/job-1' },
      { identity_kind: 'destination_alias', identity_value: 'https://jobs.lever.co/acme/job-1' },
      { identity_kind: 'intermediary_alias', identity_value: 'https://jobright.ai/jobs/info/jobright-1' },
    ])
    expect(sqlite.prepare("select count(*) as count from job_identities where identity_value = 'https://jobright.ai/companies/acme'").get()).toEqual({ count: 0 })
    sqlite.close()
  })

  it('never turns weak descriptive fingerprints into identities or hard merges', async () => {
    const sqlitePath = tempDatabasePath()
    const client = createLocalValedictorianClient({ sqlitePath })
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
    const sqlite = createFileDatabase(sqlitePath)
    expect(sqlite.prepare('select count(*) as count from job_identities').get()).toEqual({ count: 0 })
    expect(sqlite.prepare('select count(*) as count from job_identity_conflicts').get()).toEqual({ count: 0 })
    sqlite.close()
  })

  it('does not partially attach destination identities when an intermediary alias is pre-owned', async () => {
    const sqlitePath = tempDatabasePath()
    const setup = createFileDatabase(sqlitePath)
    migrateDatabase(setup)
    setup.exec(`
      insert into jobs (id, identity_kind, identity_namespace, identity_value, created_at)
      values ('preowner', 'provider_job', 'fixture', 'preowner-job', '2026-07-10T11:00:00.000Z');
      insert into job_identities (
        id, job_id, identity_kind, identity_namespace, identity_value,
        provenance_kind, provenance_version, evidence_json, created_at
      ) values (
        'preowned-intermediary', 'preowner', 'intermediary_alias', 'job-intermediary/v1',
        'https://jobright.ai/jobs/info/shared-job', 'normalization',
        'source-identity-reconciliation/v1', '{}', '2026-07-10T11:00:00.000Z'
      );
    `)
    setup.close()
    const destinationResolver = fixedDestinationResolver('https://jobright.ai/jobs/info/shared-job')
    const client = createLocalValedictorianClient({
      sqlitePath,
      normalizationRegistry: createNormalizationResolverRegistry([
        destinationResolver,
        ...createDefaultNormalizationResolverRegistry().resolvers,
      ]),
    })
    const capture = await createConnectorCaptureFixture(sqlitePath, 'connector.alpha', '1.0.0')
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
    const sqlite = createFileDatabase(sqlitePath)
    expect(sqlite.prepare(`
      select identity_kind from job_identities
      where job_id = ? and identity_kind in ('canonical_destination','destination_alias')
    `).all(intake.receipts[0].sourceEntityId)).toEqual([])
    expect(sqlite.prepare(`
      select identity_kind, identity_value, conflicting_job_id
      from job_identity_conflicts where job_id = ?
    `).all(intake.receipts[0].sourceEntityId)).toEqual([{
      identity_kind: 'intermediary_alias',
      identity_value: 'https://jobright.ai/jobs/info/shared-job',
      conflicting_job_id: 'preowner',
    }])
    expect(sqlite.prepare('pragma foreign_key_check').all()).toEqual([])
    sqlite.close()
    const restarted = createLocalValedictorianClient({
      sqlitePath,
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
    const sqlitePath = tempDatabasePath()
    const setup = createFileDatabase(sqlitePath)
    migrateDatabase(setup)
    setup.exec(`
      insert into jobs (id, identity_kind, identity_namespace, identity_value, created_at)
      values ('preowner', 'provider_job', 'fixture', 'preowner-job', '2026-07-10T11:00:00.000Z');
      insert into job_identities (
        id, job_id, identity_kind, identity_namespace, identity_value,
        provenance_kind, provenance_version, evidence_json, created_at
      ) values (
        'preowned-intermediary', 'preowner', 'intermediary_alias', 'job-intermediary/v1',
        'https://jobright.ai/jobs/info/shared-job', 'normalization',
        'source-identity-reconciliation/v1', '{}', '2026-07-10T11:00:00.000Z'
      );
    `)
    setup.close()
    const destinationResolver = fixedDestinationResolver('https://jobright.ai/jobs/info/shared-job')
    const registry = createNormalizationResolverRegistry([
      destinationResolver,
      ...createDefaultNormalizationResolverRegistry().resolvers,
    ])
    const client = createLocalValedictorianClient({ sqlitePath, normalizationRegistry: registry })
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' },
      observedAt: '2026-07-10T12:00:00.000Z',
      payload: { company: 'Acme', title: 'Intern' },
    }] })
    expect(intake.receipts[0].sourceEntityId).toBeNull()
    await expect(client.sourcing.rawRecords.normalization.get(intake.receipts[0].rawRecordId)).resolves.toMatchObject({
      gate: { status: 'needs_enrichment' }, canonicalCandidate: null,
    })
    const sqlite = createFileDatabase(sqlitePath)
    const owner = sqlite.prepare(`
      select id from jobs
      where identity_kind = 'destination_url' and identity_value = 'https://jobs.lever.co/acme/target-role'
    `).get() as { id: string }
    expect(sqlite.prepare(`
      select identity_kind from job_identities
      where job_id = ? and identity_kind in ('canonical_destination','destination_alias','intermediary_alias')
    `).all(owner.id)).toEqual([])
    expect(sqlite.prepare(`
      select job_id, conflicting_job_id, capture_evidence_version_id, identity_kind, identity_value
      from job_identity_conflicts
    `).all()).toEqual([{
      job_id: owner.id,
      conflicting_job_id: 'preowner',
      capture_evidence_version_id: intake.receipts[0].revision.id,
      identity_kind: 'intermediary_alias',
      identity_value: 'https://jobright.ai/jobs/info/shared-job',
    }])
    expect(sqlite.prepare('pragma foreign_key_check').all()).toEqual([])
    sqlite.close()
    const restarted = createLocalValedictorianClient({ sqlitePath, normalizationRegistry: registry })
    await expect(restarted.sourcing.rawRecords.normalization.get(intake.receipts[0].rawRecordId)).resolves.toMatchObject({
      gate: { status: 'needs_enrichment' }, canonicalCandidate: null,
    })
    await expect(restarted.sourcing.rawRecords.replay({
      selector: { rawRevisionIds: [intake.receipts[0].revision.id] },
      invalidate: { canonicalSchemaVersions: ['canonical-source-candidate/v1'] },
    })).resolves.toMatchObject({ status: 'completed' })
    const replayed = createFileDatabase(sqlitePath)
    expect(replayed.prepare(`
      select count(*) as count from jobs
      where identity_kind = 'destination_url' and identity_value = 'https://jobs.lever.co/acme/target-role'
    `).get()).toEqual({ count: 1 })
    expect(replayed.prepare('select count(*) as count from job_identity_conflicts').get()).toEqual({ count: 1 })
    expect(replayed.prepare('pragma foreign_key_check').all()).toEqual([])
    replayed.close()
  })

  it('does not partially attach a proposal that would cross the identity bound', async () => {
    const sqlitePath = tempDatabasePath()
    const client = createLocalValedictorianClient({ sqlitePath })
    const capture = await createConnectorCaptureFixture(sqlitePath, 'connector.alpha', '1.0.0')
    const initial = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'connector.alpha', kind: 'connector', version: '1.0.0' },
      capture,
      observedAt: '2026-07-10T12:00:00.000Z', providerRecordId: 'alpha-1', providerSchema: 'jobs/v1',
      payload: {},
    }] })
    const sourceEntityId = initial.receipts[0].sourceEntityId
    if (!sourceEntityId) throw new Error('Fixture provider entity is missing')
    const sqlite = createFileDatabase(sqlitePath)
    const insert = sqlite.prepare(`
      insert into job_identities (
        id, job_id, identity_kind, identity_namespace, identity_value,
        provenance_kind, provenance_version, evidence_json, created_at
      ) values (?, ?, 'destination_alias', 'fixture-bound/v1', ?, 'normalization',
        'source-identity-reconciliation/v1', '{}', '2026-07-10T12:01:00.000Z')
    `)
    for (let index = 0; index < 30; index += 1) {
      insert.run(`bound-${index}`, sourceEntityId, `https://jobs.lever.co/acme/bound-${index}`)
    }
    sqlite.close()
    const completed = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'connector.alpha', kind: 'connector', version: '1.0.0' },
      capture,
      observedAt: '2026-07-10T12:05:00.000Z', providerRecordId: 'alpha-1', providerSchema: 'jobs/v1',
      payload: { company: 'Acme', title: 'Intern', url: 'https://jobs.lever.co/acme/overflow-role' },
    }] })

    await expect(client.sourcing.rawRecords.normalization.get(completed.receipts[0].rawRecordId)).resolves.toMatchObject({
      gate: { status: 'needs_enrichment' }, canonicalCandidate: null,
    })
    const inspected = createFileDatabase(sqlitePath)
    expect(inspected.prepare(`
      select identity_kind from job_identities
      where job_id = ? and identity_value = 'https://jobs.lever.co/acme/overflow-role'
    `).all(sourceEntityId)).toEqual([])
    expect(inspected.prepare(`
      select reason from job_identity_conflicts where job_id = ?
    `).all(sourceEntityId)).toEqual([{ reason: 'Source entity identity bound is exhausted' }])
    expect(inspected.prepare('select count(*) as count from job_identities where job_id = ?').get(sourceEntityId)).toEqual({ count: 31 })
    expect(inspected.prepare('pragma foreign_key_check').all()).toEqual([])
    inspected.close()
  })

  it('rolls back reconciliation when normalization run persistence fails', async () => {
    const sqlitePath = tempDatabasePath()
    const setup = createFileDatabase(sqlitePath)
    migrateDatabase(setup)
    setup.exec(`
      create trigger fail_normalization_run
      before insert on normalization_runs
      begin select raise(abort, 'fixture normalization run failure'); end;
    `)
    setup.close()
    const client = createLocalValedictorianClient({ sqlitePath })

    await expect(client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' },
      observedAt: '2026-07-10T12:00:00.000Z',
      payload: { company: 'Acme', title: 'Intern', url: 'https://jobs.lever.co/acme/atomic-role' },
    }] })).resolves.toMatchObject({ receipts: [expect.objectContaining({ sourceEntityId: null })] })
    const sqlite = createFileDatabase(sqlitePath)
    expect(normalizationPersistenceState(sqlite)).toEqual({
      jobs: 0,
      identities: 0,
      conflicts: 0,
      runs: 0,
      attempts: 0,
      outcomes: 0,
      candidates: 0,
      gates: 0,
    })
    expect(rawLedgerState(sqlite)).toEqual({ records: 1, revisions: 1, occurrences: 1 })
    expect(sqlite.prepare('pragma foreign_key_check').all()).toEqual([])
    sqlite.close()
  })

  it('rolls back late gate failure while preserving prior normalization history', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const rawRepository = createSqliteRawSourceRepository(database)
    const orchestrator = createNormalizationOrchestrator({
      repository: createSqliteNormalizationRepository(database),
      registry: createDefaultNormalizationResolverRegistry(),
    })
    const prior = await rawRepository.ingestBatch({ records: [{
      adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' },
      observedAt: '2026-07-10T11:00:00.000Z',
      payload: { company: 'Prior', title: 'Intern', url: 'https://jobs.lever.co/prior/role-1' },
    }] })
    await orchestrator.normalize(prior.receipts[0].rawRecordId, prior.receipts[0].revision.id)
    const before = normalizationPersistenceState(sqlite)
    const failing = await rawRepository.ingestBatch({ records: [{
      adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' },
      observedAt: '2026-07-10T12:00:00.000Z',
      payload: { company: 'Later', title: 'Intern', url: 'https://jobs.lever.co/later/role-2' },
    }] })
    sqlite.exec(`
      create trigger fail_normalization_gate
      before insert on normalization_gates
      begin select raise(abort, 'fixture normalization gate failure'); end;
    `)

    await expect(orchestrator.normalize(
      failing.receipts[0].rawRecordId,
      failing.receipts[0].revision.id,
    )).rejects.toThrow('fixture normalization gate failure')
    expect(normalizationPersistenceState(sqlite)).toEqual(before)
    expect(rawLedgerState(sqlite)).toEqual({ records: 2, revisions: 2, occurrences: 2 })
    expect(sqlite.prepare('pragma foreign_key_check').all()).toEqual([])
    sqlite.close()
  })

  it('rolls back a conflict audit when its needs-enrichment gate fails', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    sqlite.exec(`
      insert into jobs (id, identity_kind, identity_namespace, identity_value, created_at)
      values ('preowner', 'provider_job', 'fixture', 'preowner-job', '2026-07-10T11:00:00.000Z');
      insert into job_identities (
        id, job_id, identity_kind, identity_namespace, identity_value,
        provenance_kind, provenance_version, evidence_json, created_at
      ) values (
        'preowned-intermediary', 'preowner', 'intermediary_alias', 'job-intermediary/v1',
        'https://jobright.ai/jobs/info/shared-job', 'normalization',
        'source-identity-reconciliation/v1', '{}', '2026-07-10T11:00:00.000Z'
      );
    `)
    const database = createDrizzleDatabase(sqlite)
    const rawRepository = createSqliteRawSourceRepository(database)
    const intake = await rawRepository.ingestBatch({ records: [{
      adapter: { id: 'manual.alpha', kind: 'manual', version: '1.0.0' },
      observedAt: '2026-07-10T12:00:00.000Z', providerRecordId: 'alpha-1', providerSchema: 'jobs/v1',
      payload: { company: 'Acme', title: 'Intern' },
    }] })
    const before = normalizationPersistenceState(sqlite)
    sqlite.exec(`
      create trigger fail_conflict_gate
      before insert on normalization_gates
      begin select raise(abort, 'fixture conflict gate failure'); end;
    `)
    const orchestrator = createNormalizationOrchestrator({
      repository: createSqliteNormalizationRepository(database),
      registry: createNormalizationResolverRegistry([
        fixedDestinationResolver('https://jobright.ai/jobs/info/shared-job'),
        ...createDefaultNormalizationResolverRegistry().resolvers,
      ]),
    })

    await expect(orchestrator.normalize(
      intake.receipts[0].rawRecordId,
      intake.receipts[0].revision.id,
    )).rejects.toThrow('fixture conflict gate failure')
    expect(normalizationPersistenceState(sqlite)).toEqual(before)
    expect(sqlite.prepare('select count(*) as count from job_identity_conflicts').get()).toEqual({ count: 0 })
    expect(sqlite.prepare('pragma foreign_key_check').all()).toEqual([])
    sqlite.close()
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
function normalizationPersistenceState(sqlite: ReturnType<typeof createInMemoryDatabase>) {
  const count = (table: string) => (sqlite.prepare(`select count(*) as count from ${table}`).get() as { count: number }).count
  return {
    jobs: count('jobs'),
    identities: count('job_identities'),
    conflicts: count('job_identity_conflicts'),
    runs: count('normalization_runs'),
    attempts: count('normalization_attempts'),
    outcomes: count('normalization_field_outcomes'),
    candidates: count('job_fact_versions'),
    gates: count('normalization_gates'),
  }
}
function rawLedgerState(sqlite: ReturnType<typeof createInMemoryDatabase>) {
  const count = (table: string) => (sqlite.prepare(`select count(*) as count from ${table}`).get() as { count: number }).count
  return {
    records: count('capture_lineages'),
    revisions: count('capture_evidence_versions'),
    occurrences: count('captures'),
  }
}
function tempDatabasePath() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'normalization-runtime-')), 'db.sqlite') }
