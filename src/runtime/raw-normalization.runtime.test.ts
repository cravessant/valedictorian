import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { JsonValue } from 'sparxie'
import { eq } from 'drizzle-orm'
import { rawSourceRecords, sourceEntities } from '../db/schema'
import { createDrizzleDatabase, createFileDatabase, createInMemoryDatabase, migrateDatabase } from '../db/sqlite'
import { createNormalizationOrchestrator } from '../modules/sourcing/normalization.orchestrator'
import { createSqliteNormalizationRepository } from '../modules/sourcing/normalization.repository'
import { createSqliteRawSourceRepository } from '../modules/sourcing/raw-source.repository'
import type { NormalizationResolver } from '../modules/sourcing/normalization.registry'
import {
  createDefaultNormalizationResolverRegistry,
  createNormalizationResolverRegistry,
} from '../modules/sourcing/normalization.registry'
import { createLocalValedictorianClient } from './local-valedictorian-client'

describe('local deterministic raw normalization', () => {
  it('blocks ineligible capabilities, permits fallback, and suppresses lower precedence after authority', async () => {
    const networkResolve = vi.fn(() => [])
    const resolvers: NormalizationResolver[] = [
      fixtureResolver('fixture.network', 500, ['network'], networkResolve),
      { ...fixtureResolver('fixture.not-applicable', 450, ['pure'], () => []), declaration: {
        ...fixtureResolver('fixture.not-applicable', 450, ['pure'], () => []).declaration,
        supportedAdapters: { ids: ['another-adapter'] },
      } },
      fixtureResolver('fixture.company-authority', 400, ['pure'], (context) => [{
        resolverId: 'fixture.company-authority', resolverVersion: '1.0.0', field: 'companyName',
        inputHash: context.hashInput('authority'), status: 'resolved', value: 'Authoritative Co', confidence: 1, authoritative: true,
      }]),
      fixtureResolver('fixture.company-fallback', 300, ['pure'], (context) => [{
        resolverId: 'fixture.company-fallback', resolverVersion: '1.0.0', field: 'companyName',
        inputHash: context.hashInput('fallback'), status: 'resolved', value: 'Must not run', confidence: 0.5,
      }]),
      ...createDefaultNormalizationResolverRegistry().resolvers,
    ]
    const client = createLocalValedictorianClient({
      sqlitePath: tempDatabasePath(), normalizationRegistry: createNormalizationResolverRegistry(resolvers),
    })
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' },
      observedAt: '2026-07-10T12:00:00.000Z',
      payload: { companyName: 'Raw Co', roleTitle: 'Intern', applicationUrl: 'https://jobs.ashbyhq.com/acme/job-1' },
    }] })
    const result = await client.sourcing.rawRecords.normalization.get(intake.receipts[0].rawRecordId)

    expect(networkResolve).not.toHaveBeenCalled()
    expect(result.canonicalCandidate?.companyName).toBe('Authoritative Co')
    expect(result.fieldOutcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ resolverId: 'fixture.network', status: 'blocked' }),
      expect.objectContaining({ resolverId: 'fixture.not-applicable', status: 'not_applicable' }),
      expect.objectContaining({ resolverId: 'fixture.company-fallback', status: 'suppressed', policyVersion: 'resolver-precedence/v1' }),
      expect.objectContaining({ resolverId: 'deterministic.explicit-company', status: 'suppressed' }),
    ]))
  })

  it('falls back after an explicit abstention and preserves unknown/structured facts', async () => {
    const fallback = fixtureResolver('fixture.abstaining-company', 400, ['pure'], (context) => [{
      resolverId: 'fixture.abstaining-company', resolverVersion: '1.0.0', field: 'companyName',
      inputHash: context.hashInput(null), status: 'abstained', reason: 'Fixture abstention',
    }])
    const client = createLocalValedictorianClient({
      sqlitePath: tempDatabasePath(),
      normalizationRegistry: createNormalizationResolverRegistry([fallback, ...createDefaultNormalizationResolverRegistry().resolvers]),
    })
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' }, observedAt: '2026-07-10T12:00:00.000Z',
      payload: {
        company: 'Fallback Co', title: 'Intern', employmentType: 'Full_Time', workMode: 'spaceship', seniority: 'mystery',
        location: 'New York, NY', compensation: { minimum: 25, maximum: 35, currency: 'USD', interval: 'hour', raw: '$25-$35/hr' },
        postedAt: { value: '2026-07-10', precision: 'date', raw: 'Jul 10' },
        applicationUrl: 'https://jobs.smartrecruiters.com/Acme/123-intern',
      },
    }] })
    const result = await client.sourcing.rawRecords.normalization.get(intake.receipts[0].rawRecordId)
    expect(result.canonicalCandidate).toMatchObject({
      companyName: 'Fallback Co', employmentType: 'full_time', workMode: 'unclear', seniority: 'unknown',
      location: { raw: 'New York, NY', city: null, region: null, country: null },
      compensation: { minimum: 25, maximum: 35, currency: 'USD', interval: 'hour' },
      postedAt: { value: '2026-07-10', precision: 'date', raw: 'Jul 10' },
    })
    expect(result.fieldOutcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'workMode', value: 'unclear',
        evidence: [expect.objectContaining({ value: 'spaceship' })],
      }),
      expect.objectContaining({
        field: 'seniority', value: 'unknown',
        evidence: [expect.objectContaining({ value: 'mystery' })],
      }),
    ]))
  })

  it('needs enrichment after an invoked required-field block and suppresses lower resolvers', async () => {
    const networkResolve = vi.fn(() => [])
    const notApplicableResolve = vi.fn(() => [])
    const blocked: NormalizationResolver = {
      declaration: { id: 'fixture.emitted-blocked-company', version: '1.0.0', requiredInputs: ['rawRevision'], outputFields: ['companyName'], capabilities: ['pure'], costClass: 'none', precedence: 1_000 },
      resolve(context) { return [{ resolverId: 'fixture.emitted-blocked-company', resolverVersion: '1.0.0', field: 'companyName', inputHash: context.hashInput('company'), status: 'blocked', reason: 'Provider authentication is temporarily blocked' }] },
    }
    const lowerBlocked = fixtureResolver('fixture.blocked-after-emitted-block', 900, ['network'], networkResolve)
    const lowerNotApplicable = fixtureResolver('fixture.not-applicable-after-emitted-block', 800, ['pure'], notApplicableResolve)
    lowerNotApplicable.declaration.supportedAdapters = { ids: ['another-adapter'] }
    const client = createLocalValedictorianClient({ sqlitePath: tempDatabasePath(), normalizationRegistry: createNormalizationResolverRegistry([blocked, lowerBlocked, lowerNotApplicable, ...createDefaultNormalizationResolverRegistry().resolvers]) })
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' }, observedAt: '2026-07-10T12:00:00.000Z',
      payload: { company: 'Fallback must not win', title: 'Intern', url: 'https://jobs.lever.co/acme/job-1' },
    }] })
    const result = await client.sourcing.rawRecords.normalization.get(intake.receipts[0].rawRecordId)
    expect(result).toMatchObject({
      status: 'completed', canonicalCandidate: null,
      gate: { status: 'needs_enrichment', candidate: null, missingFields: expect.arrayContaining(['companyName']), reason: expect.stringContaining('Provider authentication is temporarily blocked') },
    })
    expect(networkResolve).not.toHaveBeenCalled()
    expect(notApplicableResolve).not.toHaveBeenCalled()
    expect(result.fieldOutcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ resolverId: 'fixture.emitted-blocked-company', status: 'blocked', reason: 'Provider authentication is temporarily blocked' }),
      expect.objectContaining({ resolverId: 'fixture.blocked-after-emitted-block', status: 'suppressed' }),
      expect.objectContaining({ resolverId: 'fixture.not-applicable-after-emitted-block', status: 'suppressed' }),
      expect.objectContaining({ resolverId: 'deterministic.explicit-company', status: 'suppressed' }),
    ]))
    expect(result.attempts).toEqual(expect.arrayContaining([
      expect.objectContaining({ resolver: expect.objectContaining({ id: 'fixture.blocked-after-emitted-block' }), applicability: [expect.objectContaining({ status: 'blocked' })] }),
      expect.objectContaining({ resolver: expect.objectContaining({ id: 'fixture.not-applicable-after-emitted-block' }), applicability: [expect.objectContaining({ status: 'not_applicable' })] }),
    ]))
  })

  it('preserves retry metadata from a partial multi-field resolver and suppresses only the pending field', async () => {
    const partial: NormalizationResolver = {
      declaration: { id: 'fixture.partial-retry', version: '1.0.0', requiredInputs: ['rawRevision'], outputFields: ['companyName', 'roleTitle'], capabilities: ['pure'], costClass: 'none', precedence: 1_000 },
      resolve(context) { return [
        { resolverId: 'fixture.partial-retry', resolverVersion: '1.0.0', field: 'companyName', inputHash: context.hashInput('company'), status: 'retry', reason: 'Provider rate limit', retryAfter: '2026-07-10T12:05:00.000Z' },
        { resolverId: 'fixture.partial-retry', resolverVersion: '1.0.0', field: 'roleTitle', inputHash: context.hashInput('Intern'), status: 'resolved', value: 'Intern', confidence: 1 },
      ] },
    }
    const client = createLocalValedictorianClient({ sqlitePath: tempDatabasePath(), normalizationRegistry: createNormalizationResolverRegistry([partial, ...createDefaultNormalizationResolverRegistry().resolvers]) })
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' }, observedAt: '2026-07-10T12:00:00.000Z',
      payload: { company: 'Fallback must not win', title: 'Intern', url: 'https://jobs.lever.co/acme/job-1' },
    }] })
    const result = await client.sourcing.rawRecords.normalization.get(intake.receipts[0].rawRecordId)
    expect(result).toMatchObject({
      status: 'completed', canonicalCandidate: null,
      gate: { status: 'needs_enrichment', candidate: null, missingFields: expect.arrayContaining(['companyName']), reason: expect.stringContaining('Provider rate limit') },
      attempts: expect.arrayContaining([expect.objectContaining({
        resolver: expect.objectContaining({ id: 'fixture.partial-retry' }), status: 'completed',
        outcomes: expect.arrayContaining([
          expect.objectContaining({ field: 'companyName', status: 'retry', reason: 'Provider rate limit', retryAfter: '2026-07-10T12:05:00.000Z' }),
          expect.objectContaining({ field: 'roleTitle', status: 'resolved', value: 'Intern' }),
        ]),
      })]),
    })
    expect(result.fieldOutcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ resolverId: 'deterministic.explicit-company', field: 'companyName', status: 'suppressed' }),
      expect.objectContaining({ resolverId: 'deterministic.explicit-title', field: 'roleTitle', status: 'resolved', value: 'Intern' }),
    ]))
  })

  it('keeps a higher-precedence winner when a lower invoked resolver requests retry', async () => {
    const winner = fixtureResolver('fixture.company-winner', 1_000, ['pure'], (context) => [{
      resolverId: 'fixture.company-winner', resolverVersion: '1.0.0', field: 'companyName',
      inputHash: context.hashInput('Higher Winner'), status: 'resolved', value: 'Higher Winner', confidence: 0.8,
    }])
    const retry = fixtureResolver('fixture.lower-company-retry', 900, ['pure'], (context) => [{
      resolverId: 'fixture.lower-company-retry', resolverVersion: '1.0.0', field: 'companyName',
      inputHash: context.hashInput('company'), status: 'retry', reason: 'Lower resolver is transiently unavailable', retryAfter: null,
    }])
    const defaultsWithoutCompany = createDefaultNormalizationResolverRegistry().resolvers.filter(({ declaration }) => declaration.id !== 'deterministic.explicit-company')
    const client = createLocalValedictorianClient({ sqlitePath: tempDatabasePath(), normalizationRegistry: createNormalizationResolverRegistry([winner, retry, ...defaultsWithoutCompany]) })
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' }, observedAt: '2026-07-10T12:00:00.000Z',
      payload: { title: 'Intern', url: 'https://jobs.lever.co/acme/job-1' },
    }] })
    const result = await client.sourcing.rawRecords.normalization.get(intake.receipts[0].rawRecordId)
    expect(result).toMatchObject({
      status: 'completed', gate: { status: 'passed' }, canonicalCandidate: { companyName: 'Higher Winner' },
    })
    expect(result.fieldOutcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ resolverId: 'fixture.company-winner', status: 'resolved', value: 'Higher Winner' }),
      expect.objectContaining({ resolverId: 'fixture.lower-company-retry', status: 'retry', retryAfter: null }),
    ]))
  })

  it.each(['FT', 'Full_Time', 'full-time', 'full time'])('maps the explicit employment alias %s', async (employmentType) => {
    const client = createLocalValedictorianClient({ sqlitePath: tempDatabasePath() })
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' }, observedAt: '2026-07-10T12:00:00.000Z',
      payload: { company: 'Acme', title: 'Intern', employmentType, url: 'https://jobs.lever.co/acme/job-1' },
    }] })
    const result = await client.sourcing.rawRecords.normalization.get(intake.receipts[0].rawRecordId)
    expect(result.canonicalCandidate?.employmentType).toBe('full_time')
    expect(result.fieldOutcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'employmentType', evidence: [expect.objectContaining({ value: employmentType })] }),
    ]))
  })

  it('persists an emitted outcome/declaration/context mismatch as a failed attempt', async () => {
    const invalid = fixtureResolver('fixture.invalid-output', 1_000, ['pure'], () => [{
      resolverId: 'fixture.invalid-output', resolverVersion: '1.0.0', field: 'companyName',
      inputHash: `sha256:${'0'.repeat(64)}`, status: 'resolved', value: 'Invalid', confidence: 1,
    }])
    const client = createLocalValedictorianClient({
      sqlitePath: tempDatabasePath(),
      normalizationRegistry: createNormalizationResolverRegistry([invalid, ...createDefaultNormalizationResolverRegistry().resolvers]),
    })
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' }, observedAt: '2026-07-10T12:00:00.000Z',
      payload: { company: 'Acme', title: 'Intern', url: 'https://jobs.lever.co/acme/job-1' },
    }] })
    const result = await client.sourcing.rawRecords.normalization.get(intake.receipts[0].rawRecordId)
    expect(result).toMatchObject({
      status: 'failed', gate: { status: 'failed', candidate: null },
      attempts: expect.arrayContaining([expect.objectContaining({
        resolver: expect.objectContaining({ id: 'fixture.invalid-output' }), status: 'failed',
        outcomes: [expect.objectContaining({ resolverId: 'fixture.invalid-output', status: 'failed' })],
      })]),
    })
  })

  it('persists an invoked resolver that omits a declared field as failed', async () => {
    const incomplete: NormalizationResolver = {
      declaration: { id: 'fixture.incomplete', version: '1.0.0', requiredInputs: ['rawRevision'], outputFields: ['companyName', 'roleTitle'], capabilities: ['pure'], costClass: 'none', precedence: 1_000 },
      resolve(context) { return [{ resolverId: 'fixture.incomplete', resolverVersion: '1.0.0', field: 'companyName', inputHash: context.hashInput('company'), status: 'abstained', reason: 'No company' }] },
    }
    const client = createLocalValedictorianClient({ sqlitePath: tempDatabasePath(), normalizationRegistry: createNormalizationResolverRegistry([incomplete, ...createDefaultNormalizationResolverRegistry().resolvers]) })
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{ adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' }, observedAt: '2026-07-10T12:00:00.000Z', payload: { company: 'Acme', title: 'Intern', url: 'https://jobs.lever.co/acme/job-1' } }] })
    await expect(client.sourcing.rawRecords.normalization.get(intake.receipts[0].rawRecordId)).resolves.toMatchObject({
      status: 'failed',
      attempts: expect.arrayContaining([expect.objectContaining({ resolver: expect.objectContaining({ id: 'fixture.incomplete' }), status: 'failed' })]),
    })
  })

  it('fails a trusted resolver that emits an out-of-contract canonical value', async () => {
    const malformed: NormalizationResolver = {
      declaration: { id: 'fixture.malformed-value', version: '1.0.0', requiredInputs: ['rawRevision'], outputFields: ['employmentType'], capabilities: ['pure'], costClass: 'none', precedence: 1_000 },
      resolve(context) { return [{ resolverId: 'fixture.malformed-value', resolverVersion: '1.0.0', field: 'employmentType', inputHash: context.hashInput('banana'), status: 'resolved', value: 'banana', confidence: 1, evidence: [{ kind: 'fixture', value: 'banana' }] }] },
    }
    const client = createLocalValedictorianClient({ sqlitePath: tempDatabasePath(), normalizationRegistry: createNormalizationResolverRegistry([malformed, ...createDefaultNormalizationResolverRegistry().resolvers]) })
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{ adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' }, observedAt: '2026-07-10T12:00:00.000Z', payload: { company: 'Acme', title: 'Intern', url: 'https://jobs.lever.co/acme/job-1' } }] })
    await expect(client.sourcing.rawRecords.normalization.get(intake.receipts[0].rawRecordId)).resolves.toMatchObject({
      status: 'failed', gate: { status: 'failed', candidate: null },
      attempts: expect.arrayContaining([expect.objectContaining({ resolver: expect.objectContaining({ id: 'fixture.malformed-value' }), status: 'failed' })]),
    })
  })

  it('fails a trusted locked outcome with an out-of-contract canonical value', async () => {
    const malformed: NormalizationResolver = {
      declaration: { id: 'fixture.malformed-lock', version: '1.0.0', requiredInputs: ['rawRevision'], outputFields: ['employmentType'], capabilities: ['pure'], costClass: 'none', precedence: 1_000 },
      resolve(context) { return [{ resolverId: 'fixture.malformed-lock', resolverVersion: '1.0.0', field: 'employmentType', inputHash: context.hashInput('banana'), status: 'locked', value: 'banana', reason: 'Fixture lock', policyVersion: 'fixture-lock/v1' }] },
    }
    const client = createLocalValedictorianClient({ sqlitePath: tempDatabasePath(), normalizationRegistry: createNormalizationResolverRegistry([malformed, ...createDefaultNormalizationResolverRegistry().resolvers]) })
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{ adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' }, observedAt: '2026-07-10T12:00:00.000Z', payload: { company: 'Acme', title: 'Intern', url: 'https://jobs.lever.co/acme/job-1' } }] })
    await expect(client.sourcing.rawRecords.normalization.get(intake.receipts[0].rawRecordId)).resolves.toMatchObject({
      status: 'failed', gate: { status: 'failed', candidate: null },
      attempts: expect.arrayContaining([expect.objectContaining({ resolver: expect.objectContaining({ id: 'fixture.malformed-lock' }), status: 'failed' })]),
    })
  })

  it('admits a trusted locked outcome with a bounded canonical value', async () => {
    const valid: NormalizationResolver = {
      declaration: { id: 'fixture.valid-lock', version: '1.0.0', requiredInputs: ['rawRevision'], outputFields: ['employmentType'], capabilities: ['pure'], costClass: 'none', precedence: 1_000 },
      resolve(context) { return [{ resolverId: 'fixture.valid-lock', resolverVersion: '1.0.0', field: 'employmentType', inputHash: context.hashInput('internship'), status: 'locked', value: 'internship', reason: 'Fixture lock', policyVersion: 'fixture-lock/v1' }] },
    }
    const client = createLocalValedictorianClient({ sqlitePath: tempDatabasePath(), normalizationRegistry: createNormalizationResolverRegistry([valid, ...createDefaultNormalizationResolverRegistry().resolvers]) })
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{ adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' }, observedAt: '2026-07-10T12:00:00.000Z', payload: { company: 'Acme', title: 'Intern', url: 'https://jobs.lever.co/acme/job-1' } }] })
    await expect(client.sourcing.rawRecords.normalization.get(intake.receipts[0].rawRecordId)).resolves.toMatchObject({
      status: 'completed', gate: { status: 'passed' }, canonicalCandidate: { employmentType: 'internship' },
    })
  })

  it.each([
    [{ value: '2026-02-29', precision: 'date', raw: 'Feb 29' }, { value: null, precision: 'unknown', raw: 'Feb 29' }],
    [{ value: 'not-a-date', precision: 'date', raw: 'not-a-date' }, { value: null, precision: 'unknown', raw: 'not-a-date' }],
    [{ value: '2026-07-10T12:00:00', precision: 'instant', raw: 'no timezone' }, { value: null, precision: 'unknown', raw: 'no timezone' }],
    [{ value: '2026-02-29T12:00:00Z', precision: 'instant', raw: 'bad leap day' }, { value: null, precision: 'unknown', raw: 'bad leap day' }],
    [{ value: '2026-07-10T12:00:00+99:00', precision: 'instant', raw: 'bad offset' }, { value: null, precision: 'unknown', raw: 'bad offset' }],
    [{ value: '2 days ago', precision: 'relative', raw: '2 days ago' }, { value: null, precision: 'relative', raw: '2 days ago' }],
    [{ value: 'stale', precision: 'unknown', raw: 'unknown' }, { value: null, precision: 'unknown', raw: 'unknown' }],
    [{ value: '2024-02-29', precision: 'date', raw: 'Feb 29' }, { value: '2024-02-29', precision: 'date', raw: 'Feb 29' }],
    [{ value: '2026-07-10T12:00:00-04:00', precision: 'instant', raw: 'Jul 10' }, { value: '2026-07-10T12:00:00-04:00', precision: 'instant', raw: 'Jul 10' }],
  ])('normalizes postedAt deterministically for %j', async (postedAt, expected) => {
    const result = await normalizePayload({ postedAt })
    expect(result.canonicalCandidate?.postedAt).toEqual(expected)
    expect(result.fieldOutcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'postedAt', evidence: [expect.objectContaining({ value: postedAt })] }),
    ]))
  })

  it.each([
    [{ minimum: 100, maximum: 10, currency: '', interval: 'year', raw: '$100-$10' }, null],
    [{ minimum: 10, maximum: 100, currency: '', interval: 'year', raw: '$10-$100' }, null],
    [{ minimum: -1, maximum: null, currency: 'usd', interval: 'year', raw: '-$1' }, null],
    [{ minimum: null, maximum: null, currency: null, interval: 'year', raw: null }, null],
    [{ minimum: 10, maximum: 100, currency: ' usd ', interval: 'year', raw: ' $10-$100 ' }, { minimum: 10, maximum: 100, currency: 'USD', interval: 'year', raw: '$10-$100' }],
    [{ minimum: null, maximum: null, currency: null, interval: 'year', raw: ' Competitive ' }, { minimum: null, maximum: null, currency: null, interval: 'year', raw: 'Competitive' }],
    [{ minimum: 10, maximum: null, currency: 'USD', interval: 'fortnight', raw: '$10' }, null],
  ])('normalizes compensation deterministically for %j', async (compensation, expected) => {
    const result = await normalizePayload({ compensation })
    expect(result.canonicalCandidate?.compensation).toEqual(expected)
    expect(result.fieldOutcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'compensation', evidence: [expect.objectContaining({ value: compensation })] }),
    ]))
  })

  it.each([
    ['compensation', { minimum: 100, maximum: 10, currency: 'USD', interval: 'year', raw: '$100-$10' }],
    ['postedAt', { value: 'not-a-date', precision: 'date', raw: 'not-a-date' }],
  ] as const)('fails a trusted resolver with semantic-invalid %s', async (field, value) => {
    const malformed: NormalizationResolver = {
      declaration: { id: `fixture.invalid-${field}`, version: '1.0.0', requiredInputs: ['rawRevision'], outputFields: [field], capabilities: ['pure'], costClass: 'none', precedence: 1_000 },
      resolve(context) { return [{ resolverId: `fixture.invalid-${field}`, resolverVersion: '1.0.0', field, inputHash: context.hashInput(value), status: 'resolved', value, confidence: 1 }] },
    }
    const client = createLocalValedictorianClient({ sqlitePath: tempDatabasePath(), normalizationRegistry: createNormalizationResolverRegistry([malformed, ...createDefaultNormalizationResolverRegistry().resolvers]) })
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{ adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' }, observedAt: '2026-07-10T12:00:00.000Z', payload: { company: 'Acme', title: 'Intern', url: 'https://jobs.lever.co/acme/job-1' } }] })
    await expect(client.sourcing.rawRecords.normalization.get(intake.receipts[0].rawRecordId)).resolves.toMatchObject({
      status: 'failed', gate: { status: 'failed', candidate: null },
      attempts: expect.arrayContaining([expect.objectContaining({ resolver: expect.objectContaining({ id: `fixture.invalid-${field}` }), status: 'failed' })]),
    })
  })

  it('admits a valid custom compensation object independent of key insertion order', async () => {
    const value = { raw: '$10-$20', interval: 'hour', currency: 'USD', maximum: 20, minimum: 10 }
    const resolver: NormalizationResolver = {
      declaration: { id: 'fixture.valid-compensation', version: '1.0.0', requiredInputs: ['rawRevision'], outputFields: ['compensation'], capabilities: ['pure'], costClass: 'none', precedence: 1_000 },
      resolve(context) { return [{ resolverId: 'fixture.valid-compensation', resolverVersion: '1.0.0', field: 'compensation', inputHash: context.hashInput(value), status: 'resolved', value, confidence: 1 }] },
    }
    const client = createLocalValedictorianClient({ sqlitePath: tempDatabasePath(), normalizationRegistry: createNormalizationResolverRegistry([resolver, ...createDefaultNormalizationResolverRegistry().resolvers]) })
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{ adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' }, observedAt: '2026-07-10T12:00:00.000Z', payload: { company: 'Acme', title: 'Intern', url: 'https://jobs.lever.co/acme/job-1' } }] })
    await expect(client.sourcing.rawRecords.normalization.get(intake.receipts[0].rawRecordId)).resolves.toMatchObject({
      status: 'completed', gate: { status: 'passed' }, canonicalCandidate: { compensation: value },
    })
  })

  it.each([
    ['companyName', ' Acme '],
    ['roleTitle', ' Intern '],
    ['providerJobId', ' provider-1 '],
    ['canonicalIdentity', { kind: 'provider_job', value: ' identity-1 ' }],
    ['sourceUrl', ' HTTPS://Example.COM:443/jobs/1#fragment '],
    ['compensation', { minimum: 10, maximum: 20, currency: 'usd', interval: 'hour', raw: '$10-$20' }],
  ] as const)('fails a trusted resolver with non-canonical %s', async (field, value) => {
    const resolver: NormalizationResolver = {
      declaration: { id: `fixture.noncanonical-${field}`, version: '1.0.0', requiredInputs: ['rawRevision'], outputFields: [field], capabilities: ['pure'], costClass: 'none', precedence: 1_000 },
      resolve(context) { return [{ resolverId: `fixture.noncanonical-${field}`, resolverVersion: '1.0.0', field, inputHash: context.hashInput(value), status: 'resolved', value, confidence: 1, evidence: [{ kind: 'fixture_raw', value }] }] },
    }
    const client = createLocalValedictorianClient({ sqlitePath: tempDatabasePath(), normalizationRegistry: createNormalizationResolverRegistry([resolver, ...createDefaultNormalizationResolverRegistry().resolvers]) })
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{ adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' }, observedAt: '2026-07-10T12:00:00.000Z', payload: { company: 'Acme', title: 'Intern', url: 'https://jobs.lever.co/acme/job-1' } }] })
    const result = await client.sourcing.rawRecords.normalization.get(intake.receipts[0].rawRecordId)
    expect(result).toMatchObject({
      status: 'failed', gate: { status: 'failed', candidate: null },
      attempts: expect.arrayContaining([expect.objectContaining({ resolver: expect.objectContaining({ id: `fixture.noncanonical-${field}` }), status: 'failed' })]),
    })
  })

  it.each([
    ['canonicalIdentity', { kind: 'destination_url', value: 'https://jobs.lever.co/acme/job-1', extra: 'undeclared' }],
    ['destinationUrl', { class: 'employer_or_ats', url: 'https://jobs.lever.co/acme/job-1', intermediaryUrl: null, extra: 'undeclared' }],
    ['location', { raw: 'New York, NY', city: null, region: null, country: null, extra: 'undeclared' }],
  ] as const)('fails a trusted resolver whose %s contains undeclared properties', async (field, value) => {
    const resolver: NormalizationResolver = {
      declaration: { id: `fixture.extra-${field}`, version: '1.0.0', requiredInputs: ['rawRevision'], outputFields: [field], capabilities: ['pure'], costClass: 'none', precedence: 1_000 },
      resolve(context) { return [{ resolverId: `fixture.extra-${field}`, resolverVersion: '1.0.0', field, inputHash: context.hashInput(value), status: 'resolved', value, confidence: 1 }] },
    }
    const client = createLocalValedictorianClient({ sqlitePath: tempDatabasePath(), normalizationRegistry: createNormalizationResolverRegistry([resolver, ...createDefaultNormalizationResolverRegistry().resolvers]) })
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{ adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' }, observedAt: '2026-07-10T12:00:00.000Z', payload: { company: 'Acme', title: 'Intern', url: 'https://jobs.lever.co/acme/job-1' } }] })
    await expect(client.sourcing.rawRecords.normalization.get(intake.receipts[0].rawRecordId)).resolves.toMatchObject({
      status: 'failed', gate: { status: 'failed', candidate: null },
      attempts: expect.arrayContaining([expect.objectContaining({ resolver: expect.objectContaining({ id: `fixture.extra-${field}` }), status: 'failed' })]),
    })
  })

  it.each([
    ['bogus status', (context: Parameters<NormalizationResolver['resolve']>[0]) => ({ resolverId: 'fixture.invalid-outcome', resolverVersion: '1.0.0', field: 'companyName', inputHash: context.hashInput('Acme'), status: 'bogus', value: 'Acme' })],
    ['NaN confidence', (context: Parameters<NormalizationResolver['resolve']>[0]) => ({ resolverId: 'fixture.invalid-outcome', resolverVersion: '1.0.0', field: 'companyName', inputHash: context.hashInput('Acme'), status: 'resolved', value: 'Acme', confidence: Number.NaN })],
  ])('fails a trusted resolver with %s without exposing mutated outcomes', async (_label, makeOutcome) => {
    const resolver: NormalizationResolver = {
      declaration: { id: 'fixture.invalid-outcome', version: '1.0.0', requiredInputs: ['rawRevision'], outputFields: ['companyName'], capabilities: ['pure'], costClass: 'none', precedence: 1_000 },
      resolve(context) { return [makeOutcome(context)] as never },
    }
    const client = createLocalValedictorianClient({ sqlitePath: tempDatabasePath(), normalizationRegistry: createNormalizationResolverRegistry([resolver, ...createDefaultNormalizationResolverRegistry().resolvers]) })
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{ adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' }, observedAt: '2026-07-10T12:00:00.000Z', payload: { company: 'Acme', title: 'Intern', url: 'https://jobs.lever.co/acme/job-1' } }] })
    const result = await client.sourcing.rawRecords.normalization.get(intake.receipts[0].rawRecordId)
    expect(result).toMatchObject({
      status: 'failed', gate: { status: 'failed', candidate: null },
      attempts: expect.arrayContaining([expect.objectContaining({
        resolver: expect.objectContaining({ id: 'fixture.invalid-outcome' }), status: 'failed',
        outcomes: [expect.objectContaining({ status: 'failed' })],
      })]),
    })
    expect(result.fieldOutcomes.some((outcome) => !['resolved','not_applicable','abstained','blocked','retry','rejected','conflict','failed','suppressed','locked'].includes(outcome.status))).toBe(false)
    expect(JSON.stringify(result)).not.toContain('"confidence":null')
  })

  it('keeps invalid structured optional inputs as raw field evidence', async () => {
    const client = createLocalValedictorianClient({ sqlitePath: tempDatabasePath() })
    const invalidCompensation = { minimum: 'many', interval: 'year' }
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{ adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' }, observedAt: '2026-07-10T12:00:00.000Z', payload: { company: 'Acme', title: 'Intern', compensation: invalidCompensation, url: 'https://jobs.lever.co/acme/job-1' } }] })
    const result = await client.sourcing.rawRecords.normalization.get(intake.receipts[0].rawRecordId)
    expect(result.canonicalCandidate?.compensation).toBeNull()
    expect(result.fieldOutcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'compensation', value: null, evidence: [expect.objectContaining({ value: invalidCompensation })] }),
    ]))
  })

  it('rejects invalid registry declarations and duplicate trusted identities', () => {
    const valid = fixtureResolver('fixture.duplicate', 1, ['pure'], () => [])
    expect(() => createNormalizationResolverRegistry([valid, valid])).toThrow('Duplicate normalization resolver')
    expect(() => createNormalizationResolverRegistry([{ ...valid, declaration: { ...valid.declaration, outputFields: ['notAField' as never] } }])).toThrow('Invalid resolver output fields')
  })

  it('orders equal-precedence resolver identities by locale-independent code points', () => {
    const upper = fixtureResolver('fixture.Z', 10, ['pure'], () => [])
    const lower = fixtureResolver('fixture.a', 10, ['pure'], () => [])
    expect(createNormalizationResolverRegistry([lower, upper]).resolvers.map(({ declaration }) => declaration.id)).toEqual([
      'fixture.Z', 'fixture.a',
    ])
  })

  it('reuses provisional destination identity and preserves collision-safe provider identity', async () => {
    const client = createLocalValedictorianClient({ sqlitePath: tempDatabasePath() })
    const manual = {
      adapter: { id: 'manual.fixture', kind: 'manual' as const, version: '1.0.0' },
      observedAt: '2026-07-10T12:00:00.000Z',
      payload: { company: 'Acme', title: 'Intern', url: 'https://jobs.lever.co/acme/job-1' },
    }
    const manualReceipts = await client.sourcing.rawRecords.ingestBatch({ records: [manual, manual] })
    const manualResults = await Promise.all(manualReceipts.receipts.map((receipt) =>
      client.sourcing.rawRecords.normalization.get(receipt.rawRecordId)))
    expect(manualReceipts.receipts.every(({ sourceEntityId }) => sourceEntityId === null)).toBe(true)
    expect(manualResults[0].canonicalCandidate?.sourceEntityId).toBe(manualResults[1].canonicalCandidate?.sourceEntityId)
    expect(manualResults[0].canonicalCandidate?.canonicalIdentity).toEqual({
      kind: 'destination_url', value: 'https://jobs.lever.co/acme/job-1',
    })

    const connector = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'fixture:connector', kind: 'connector', version: '1.0.0' },
      providerRecordId: 'job:value:1', providerSchema: 'jobs:v1', observedAt: '2026-07-10T12:00:00.000Z',
      payload: { company: 'Acme', title: 'Intern', url: 'https://jobs.lever.co/acme/job-2' },
    }] })
    const connectorResult = await client.sourcing.rawRecords.normalization.get(connector.receipts[0].rawRecordId)
    expect(connectorResult.canonicalCandidate?.sourceEntityId).toBe(connector.receipts[0].sourceEntityId)
    const encoded = connectorResult.canonicalCandidate?.canonicalIdentity.value
    expect(JSON.parse(encoded ?? '')).toEqual([
      'adapter:17:fixture:connector|schema:value:7:jobs:v1', 'job:value:1',
    ])
  })

  it('uses the trimmed persisted provider identity while preserving padded raw evidence', async () => {
    const client = createLocalValedictorianClient({ sqlitePath: tempDatabasePath() })
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'fixture.connector', kind: 'connector', version: '1.0.0' },
      providerRecordId: ' job-1 ', providerSchema: 'jobs/v1', observedAt: '2026-07-10T12:00:00.000Z',
      payload: { company: 'Acme', title: 'Intern', url: 'https://jobs.lever.co/acme/job-1' },
    }] })
    const result = await client.sourcing.rawRecords.normalization.get(intake.receipts[0].rawRecordId)
    expect(result).toMatchObject({
      status: 'completed', gate: { status: 'passed' }, canonicalCandidate: { providerJobId: 'job-1' },
    })
    expect(result.fieldOutcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'providerJobId', status: 'resolved', value: 'job-1',
        evidence: [expect.objectContaining({ value: ' job-1 ' })],
      }),
    ]))
  })

  it.each([
    ['destination mismatch', { kind: 'destination_url', value: 'https://jobs.lever.co/other/different-job' }, false],
    ['source alias bypass', { kind: 'source_alias', value: 'alias-1' }, false],
    ['provider mismatch', { kind: 'provider_job', value: '["wrong-namespace","wrong-id"]' }, true],
  ] as const)('blocks canonical identity %s from producing a candidate', async (_label, identity, connector) => {
    const resolver: NormalizationResolver = {
      declaration: { id: 'fixture.identity-mismatch', version: '1.0.0', requiredInputs: ['rawRevision'], outputFields: ['canonicalIdentity'], capabilities: ['pure'], costClass: 'none', precedence: 1_000 },
      resolve(context) { return [{ resolverId: 'fixture.identity-mismatch', resolverVersion: '1.0.0', field: 'canonicalIdentity', inputHash: context.hashInput(identity), status: 'resolved', value: identity, confidence: 1, authoritative: true }] },
    }
    const client = createLocalValedictorianClient({ sqlitePath: tempDatabasePath(), normalizationRegistry: createNormalizationResolverRegistry([resolver, ...createDefaultNormalizationResolverRegistry().resolvers]) })
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'fixture.identity', kind: connector ? 'connector' : 'manual', version: '1.0.0' },
      providerRecordId: connector ? 'job-1' : null,
      observedAt: '2026-07-10T12:00:00.000Z',
      payload: { company: 'Acme', title: 'Intern', url: 'https://jobs.lever.co/acme/job-1' },
    }] })
    await expect(client.sourcing.rawRecords.normalization.get(intake.receipts[0].rawRecordId)).resolves.toMatchObject({
      status: 'completed',
      gate: { status: 'needs_enrichment', conflictingFields: expect.arrayContaining(['canonicalIdentity']), candidate: null },
      canonicalCandidate: null,
    })
  })

  it('rejects a required field and suppresses every lower resolver regardless of applicability', async () => {
    const networkResolve = vi.fn(() => [])
    const notApplicableResolve = vi.fn(() => [])
    const rejected: NormalizationResolver = {
      declaration: { id: 'fixture.rejected-company', version: '1.0.0', requiredInputs: ['rawRevision'], outputFields: ['companyName'], capabilities: ['pure'], costClass: 'none', precedence: 1_000 },
      resolve(context) { return [{ resolverId: 'fixture.rejected-company', resolverVersion: '1.0.0', field: 'companyName', inputHash: context.hashInput('company'), status: 'rejected', reason: 'Deterministically not admissible' }] },
    }
    const blocked = fixtureResolver('fixture.blocked-company', 900, ['network'], networkResolve)
    const notApplicable = fixtureResolver('fixture.not-applicable-company', 800, ['pure'], notApplicableResolve)
    notApplicable.declaration.supportedAdapters = { ids: ['another-adapter'] }
    const client = createLocalValedictorianClient({ sqlitePath: tempDatabasePath(), normalizationRegistry: createNormalizationResolverRegistry([rejected, blocked, notApplicable, ...createDefaultNormalizationResolverRegistry().resolvers]) })
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' }, observedAt: '2026-07-10T12:00:00.000Z',
      payload: { company: 'Fallback must not win', title: 'Intern', url: 'https://jobs.lever.co/acme/job-1' },
    }] })
    const result = await client.sourcing.rawRecords.normalization.get(intake.receipts[0].rawRecordId)
    expect(result).toMatchObject({ status: 'completed', gate: { status: 'rejected', candidate: null }, canonicalCandidate: null })
    expect(networkResolve).not.toHaveBeenCalled()
    expect(notApplicableResolve).not.toHaveBeenCalled()
    expect(result.fieldOutcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ resolverId: 'fixture.rejected-company', status: 'rejected' }),
      expect.objectContaining({ resolverId: 'fixture.blocked-company', status: 'suppressed' }),
      expect.objectContaining({ resolverId: 'fixture.not-applicable-company', status: 'suppressed' }),
      expect.objectContaining({ resolverId: 'deterministic.explicit-company', status: 'suppressed' }),
    ]))
    expect(result.attempts).toEqual(expect.arrayContaining([
      expect.objectContaining({ resolver: expect.objectContaining({ id: 'fixture.blocked-company' }), applicability: [expect.objectContaining({ status: 'blocked' })] }),
      expect.objectContaining({ resolver: expect.objectContaining({ id: 'fixture.not-applicable-company' }), applicability: [expect.objectContaining({ status: 'not_applicable' })] }),
    ]))
  })

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
    database.insert(sourceEntities).values({
      id: sourceEntityId, identityKind, identityNamespace: 'fixture/v1', identityValue,
      createdAt: '2026-07-10T12:00:00.000Z',
    }).run()
    database.update(rawSourceRecords).set({ sourceEntityId }).where(eq(rawSourceRecords.id, intake.receipts[0].rawRecordId)).run()
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
    const first = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'connector.alpha', kind: 'connector', version: '1.0.0' },
      observedAt: '2026-07-10T12:00:00.000Z', providerRecordId: 'alpha-1', providerSchema: 'jobs/v1',
      payload: { company: 'Acme', title: 'Intern', url: destination },
    }] })
    const second = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'connector.beta', kind: 'connector', version: '2.0.0' },
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
      from source_entity_identities order by identity_kind, identity_namespace
    `).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ identity_kind: 'provider_job', identity_value: 'alpha-1', provenance_kind: 'capture' }),
      expect.objectContaining({ identity_kind: 'provider_job', identity_value: 'beta-9', provenance_kind: 'capture' }),
      expect.objectContaining({
        identity_kind: 'canonical_destination', identity_namespace: 'deterministic-destination/v1',
        identity_value: destination, provenance_kind: 'normalization', provenance_version: 'source-identity-reconciliation/v1',
      }),
    ]))
    expect(sqlite.prepare('select raw_record_id, count(*) as revisions from raw_source_revisions group by raw_record_id order by raw_record_id').all()).toEqual([
      { raw_record_id: first.receipts[0].rawRecordId, revisions: 1 },
      { raw_record_id: second.receipts[0].rawRecordId, revisions: 1 },
    ].sort((left, right) => left.raw_record_id.localeCompare(right.raw_record_id)))
    expect(sqlite.prepare('pragma foreign_key_check').all()).toEqual([])
    sqlite.close()
  })

  it('records incompatible strong destination evidence as an idempotent conflict without merging history', async () => {
    const sqlitePath = tempDatabasePath()
    const client = createLocalValedictorianClient({ sqlitePath })
    const first = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'connector.alpha', kind: 'connector', version: '1.0.0' },
      observedAt: '2026-07-10T12:00:00.000Z', providerRecordId: 'alpha-1', providerSchema: 'jobs/v1',
      payload: { company: 'Acme', title: 'Intern', url: 'https://jobs.lever.co/acme/role-one' },
    }] })
    const conflicting = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'connector.alpha', kind: 'connector', version: '1.0.0' },
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
      select source_entity_id, raw_revision_id, identity_kind, identity_value, reason, provenance_version
      from source_identity_conflicts
    `).all()).toEqual([expect.objectContaining({
      source_entity_id: first.receipts[0].sourceEntityId,
      raw_revision_id: conflicting.receipts[0].revision.id,
      identity_kind: 'canonical_destination',
      identity_value: 'https://jobs.lever.co/acme/role-two',
      reason: 'Source entity already has a different strong destination association',
      provenance_version: 'source-identity-reconciliation/v1',
    })])
    expect(sqlite.prepare('select count(*) as count from raw_source_revisions where raw_record_id = ?').get(first.receipts[0].rawRecordId)).toEqual({ count: 2 })
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
    const accepted = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'connector.jobright', kind: 'connector', version: '3.2.1' },
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
      observedAt: '2026-07-10T12:05:00.000Z', providerRecordId: 'jobright-1', providerSchema: 'jobs/v1',
      payload: { company: 'Acme', title: 'Intern', intermediaryUrl: 'https://jobright.ai/companies/acme' },
    }] })
    const sqlite = createFileDatabase(sqlitePath)
    expect(sqlite.prepare(`
      select identity_kind, identity_value from source_entity_identities
      where identity_kind in ('canonical_destination','destination_alias','intermediary_alias')
      order by identity_kind
    `).all()).toEqual([
      { identity_kind: 'canonical_destination', identity_value: 'https://jobs.lever.co/acme/job-1' },
      { identity_kind: 'destination_alias', identity_value: 'https://jobs.lever.co/acme/job-1' },
      { identity_kind: 'intermediary_alias', identity_value: 'https://jobright.ai/jobs/info/jobright-1' },
    ])
    expect(sqlite.prepare("select count(*) as count from source_entity_identities where identity_value = 'https://jobright.ai/companies/acme'").get()).toEqual({ count: 0 })
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
    expect(sqlite.prepare('select count(*) as count from source_entity_identities').get()).toEqual({ count: 0 })
    expect(sqlite.prepare('select count(*) as count from source_identity_conflicts').get()).toEqual({ count: 0 })
    sqlite.close()
  })

  it('does not partially attach destination identities when an intermediary alias is pre-owned', async () => {
    const sqlitePath = tempDatabasePath()
    const setup = createFileDatabase(sqlitePath)
    migrateDatabase(setup)
    setup.exec(`
      insert into source_entities (id, identity_kind, identity_namespace, identity_value, created_at)
      values ('preowner', 'provider_job', 'fixture', 'preowner-job', '2026-07-10T11:00:00.000Z');
      insert into source_entity_identities (
        id, source_entity_id, identity_kind, identity_namespace, identity_value,
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
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'connector.alpha', kind: 'connector', version: '1.0.0' },
      observedAt: '2026-07-10T12:00:00.000Z', providerRecordId: 'alpha-1', providerSchema: 'jobs/v1',
      payload: { company: 'Acme', title: 'Intern' },
    }] })

    await expect(client.sourcing.rawRecords.normalization.get(intake.receipts[0].rawRecordId)).resolves.toMatchObject({
      gate: { status: 'needs_enrichment', conflictingFields: expect.arrayContaining(['canonicalIdentity']) },
      canonicalCandidate: null,
    })
    const sqlite = createFileDatabase(sqlitePath)
    expect(sqlite.prepare(`
      select identity_kind from source_entity_identities
      where source_entity_id = ? and identity_kind in ('canonical_destination','destination_alias')
    `).all(intake.receipts[0].sourceEntityId)).toEqual([])
    expect(sqlite.prepare(`
      select identity_kind, identity_value, conflicting_source_entity_id
      from source_identity_conflicts where source_entity_id = ?
    `).all(intake.receipts[0].sourceEntityId)).toEqual([{
      identity_kind: 'intermediary_alias',
      identity_value: 'https://jobright.ai/jobs/info/shared-job',
      conflicting_source_entity_id: 'preowner',
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
      insert into source_entities (id, identity_kind, identity_namespace, identity_value, created_at)
      values ('preowner', 'provider_job', 'fixture', 'preowner-job', '2026-07-10T11:00:00.000Z');
      insert into source_entity_identities (
        id, source_entity_id, identity_kind, identity_namespace, identity_value,
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
      select id from source_entities
      where identity_kind = 'destination_url' and identity_value = 'https://jobs.lever.co/acme/target-role'
    `).get() as { id: string }
    expect(sqlite.prepare(`
      select identity_kind from source_entity_identities
      where source_entity_id = ? and identity_kind in ('canonical_destination','destination_alias','intermediary_alias')
    `).all(owner.id)).toEqual([])
    expect(sqlite.prepare(`
      select source_entity_id, conflicting_source_entity_id, raw_revision_id, identity_kind, identity_value
      from source_identity_conflicts
    `).all()).toEqual([{
      source_entity_id: owner.id,
      conflicting_source_entity_id: 'preowner',
      raw_revision_id: intake.receipts[0].revision.id,
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
      select count(*) as count from source_entities
      where identity_kind = 'destination_url' and identity_value = 'https://jobs.lever.co/acme/target-role'
    `).get()).toEqual({ count: 1 })
    expect(replayed.prepare('select count(*) as count from source_identity_conflicts').get()).toEqual({ count: 1 })
    expect(replayed.prepare('pragma foreign_key_check').all()).toEqual([])
    replayed.close()
  })

  it('does not partially attach a proposal that would cross the identity bound', async () => {
    const sqlitePath = tempDatabasePath()
    const client = createLocalValedictorianClient({ sqlitePath })
    const initial = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'connector.alpha', kind: 'connector', version: '1.0.0' },
      observedAt: '2026-07-10T12:00:00.000Z', providerRecordId: 'alpha-1', providerSchema: 'jobs/v1',
      payload: {},
    }] })
    const sourceEntityId = initial.receipts[0].sourceEntityId
    if (!sourceEntityId) throw new Error('Fixture provider entity is missing')
    const sqlite = createFileDatabase(sqlitePath)
    const insert = sqlite.prepare(`
      insert into source_entity_identities (
        id, source_entity_id, identity_kind, identity_namespace, identity_value,
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
      observedAt: '2026-07-10T12:05:00.000Z', providerRecordId: 'alpha-1', providerSchema: 'jobs/v1',
      payload: { company: 'Acme', title: 'Intern', url: 'https://jobs.lever.co/acme/overflow-role' },
    }] })

    await expect(client.sourcing.rawRecords.normalization.get(completed.receipts[0].rawRecordId)).resolves.toMatchObject({
      gate: { status: 'needs_enrichment' }, canonicalCandidate: null,
    })
    const inspected = createFileDatabase(sqlitePath)
    expect(inspected.prepare(`
      select identity_kind from source_entity_identities
      where source_entity_id = ? and identity_value = 'https://jobs.lever.co/acme/overflow-role'
    `).all(sourceEntityId)).toEqual([])
    expect(inspected.prepare(`
      select reason from source_identity_conflicts where source_entity_id = ?
    `).all(sourceEntityId)).toEqual([{ reason: 'Source entity identity bound is exhausted' }])
    expect(inspected.prepare('select count(*) as count from source_entity_identities where source_entity_id = ?').get(sourceEntityId)).toEqual({ count: 31 })
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
      sourceEntities: 0,
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
      insert into source_entities (id, identity_kind, identity_namespace, identity_value, created_at)
      values ('preowner', 'provider_job', 'fixture', 'preowner-job', '2026-07-10T11:00:00.000Z');
      insert into source_entity_identities (
        id, source_entity_id, identity_kind, identity_namespace, identity_value,
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
      adapter: { id: 'connector.alpha', kind: 'connector', version: '1.0.0' },
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
    expect(sqlite.prepare('select count(*) as count from source_identity_conflicts').get()).toEqual({ count: 0 })
    expect(sqlite.prepare('pragma foreign_key_check').all()).toEqual([])
    sqlite.close()
  })
})

async function normalizePayload(payload: Record<string, JsonValue>) {
  const client = createLocalValedictorianClient({ sqlitePath: tempDatabasePath() })
  const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{
    adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' },
    observedAt: '2026-07-10T12:00:00.000Z',
    payload: { company: 'Acme', title: 'Intern', url: 'https://jobs.lever.co/acme/job-1', ...payload },
  }] })
  return client.sourcing.rawRecords.normalization.get(intake.receipts[0].rawRecordId)
}

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
    sourceEntities: count('source_entities'),
    identities: count('source_entity_identities'),
    conflicts: count('source_identity_conflicts'),
    runs: count('normalization_runs'),
    attempts: count('normalization_attempts'),
    outcomes: count('normalization_field_outcomes'),
    candidates: count('canonical_source_candidates'),
    gates: count('normalization_gates'),
  }
}
function rawLedgerState(sqlite: ReturnType<typeof createInMemoryDatabase>) {
  const count = (table: string) => (sqlite.prepare(`select count(*) as count from ${table}`).get() as { count: number }).count
  return {
    records: count('raw_source_records'),
    revisions: count('raw_source_revisions'),
    occurrences: count('raw_source_occurrences'),
  }
}
function tempDatabasePath() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'normalization-runtime-')), 'db.sqlite') }
