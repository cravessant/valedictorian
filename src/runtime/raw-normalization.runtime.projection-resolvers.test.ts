import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { JsonValue } from 'sparxie'
import { opportunities } from '../db/schema'
import { createDrizzleDatabase, createFileDatabase } from '../db/sqlite'
import type { NormalizationResolver } from '../modules/sourcing/normalization.registry'
import {
  createDefaultNormalizationResolverRegistry,
  createNormalizationResolverRegistry
} from '../modules/sourcing/normalization.registry'
import { createLocalValedictorianClient } from './local-valedictorian-client'
import { createConnectorCaptureFixture } from '../test-fixtures/connector-capture.fixture'
import { resolveDatabaseFilePath } from '../workspace/workspace.paths'

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
      pgliteDataPath: tempDatabasePath(), normalizationRegistry: createNormalizationResolverRegistry(resolvers),
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
      pgliteDataPath: tempDatabasePath(),
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

  it('projects only a passed canonical candidate into sourcing with exact lineage and facts', async () => {
    const client = createLocalValedictorianClient({ pgliteDataPath: tempDatabasePath() })
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [
      {
        adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' },
        observedAt: '2026-07-10T12:00:00.000Z',
        reportedOrigin: { kind: 'job_board', name: 'Fixture Board' },
        payload: {
          company: 'Fixture Robotics',
          title: 'Software Intern',
          employmentType: 'Full_Time',
          seniority: 'internship',
          location: { raw: 'New York, NY', city: 'New York', region: 'NY', country: null },
          compensation: { minimum: 25, maximum: 35, currency: 'USD', interval: 'hour', raw: '$25-$35/hr' },
          postedAt: { value: '2026-07-10', precision: 'date', raw: 'Jul 10' },
          applicationUrl: 'https://jobs.ashbyhq.com/fixture/job-1',
          sourceUrl: 'https://fixture.example/jobs/1',
        },
      },
      {
        adapter: { id: 'import.fixture', kind: 'import', version: '1.0.0' },
        observedAt: '2026-07-10T12:01:00.000Z',
        payload: { company: 'Incomplete Co', title: 'Software Intern' },
      },
    ] })

    const normalization = await client.sourcing.rawRecords.normalization.get(
      intake.receipts[0].rawRecordId,
    )
    const findings = await client.sourcing.findings.list()

    expect(normalization.gate).toMatchObject({ status: 'passed' })
    expect(findings).toMatchObject({ total: 1 })
    expect(findings.items[0]).toMatchObject({
      rawRevisionId: intake.receipts[0].revision.id,
      canonicalCandidateId: normalization.canonicalCandidate?.id,
      companyName: 'Fixture Robotics',
      roleTitle: 'Software Intern',
      roleKind: 'internship',
      country: null,
      workMode: 'unclear',
      employmentType: 'full_time',
      seniority: 'internship',
      location: { raw: 'New York, NY', city: 'New York', region: 'NY', country: null },
      compensation: { minimum: 25, maximum: 35, currency: 'USD', interval: 'hour', raw: '$25-$35/hr' },
      postedAt: { value: '2026-07-10', precision: 'date', raw: 'Jul 10' },
      destination: {
        class: 'employer_or_ats',
        url: 'https://jobs.ashbyhq.com/fixture/job-1',
      },
      destinationClass: 'employer_or_ats',
      destinationUrl: 'https://jobs.ashbyhq.com/fixture/job-1',
      officialUrl: 'https://jobs.ashbyhq.com/fixture/job-1',
      sourceUrl: 'https://fixture.example/jobs/1',
      usability: 'usable',
      mergeStatus: 'blocked',
      policyBlocker: 'missing_country',
      mergeNotes: expect.stringContaining('What country'),
    })
    expect(JSON.stringify(findings.items[0])).not.toContain('"country":"US"')
  })

  it('updates one finding for strong identity while keeping weak similarity reviewable', async () => {
    const pgliteDataPath = tempDatabasePath()
    const client = createLocalValedictorianClient({ pgliteDataPath })
    const capture = await createConnectorCaptureFixture(pgliteDataPath, 'fixture.connector', '1.0.0')
    const first = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'fixture.connector', kind: 'connector', version: '1.0.0' },
      capture,
      providerRecordId: 'provider-job-1',
      providerSchema: 'fixture/jobs/v1',
      observedAt: '2026-07-10T12:00:00.000Z',
      payload: {
        company: 'Acme Robotics', title: 'Software Intern', location: 'New York, NY',
        postedAt: { value: '2026-07-10', precision: 'date', raw: 'Jul 10' },
        url: 'https://jobs.lever.co/acme/provider-job-1',
      },
    }] })
    const updated = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'fixture.connector', kind: 'connector', version: '1.0.0' },
      capture,
      providerRecordId: 'provider-job-1',
      providerSchema: 'fixture/jobs/v1',
      observedAt: '2026-07-10T13:00:00.000Z',
      payload: {
        company: 'Acme Robotics', title: 'Software Engineering Intern', location: 'New York, NY',
        postedAt: { value: '2026-07-10', precision: 'date', raw: 'Jul 10' },
        url: 'https://jobs.lever.co/acme/provider-job-1',
      },
    }] })

    let findings = await client.sourcing.findings.list()
    expect(findings).toMatchObject({
      total: 1,
      items: [{
        rawRevisionId: updated.receipts[0].revision.id,
        roleTitle: 'Software Engineering Intern',
      }],
    })
    expect(findings.items[0].rawRevisionId).not.toBe(first.receipts[0].revision.id)

    await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'fixture.import', kind: 'import', version: '2.0.0' },
      observedAt: '2026-07-10T14:00:00.000Z',
      payload: {
        company: 'Acme Robotics', title: 'Software Engineering Intern', location: 'New York, NY',
        postedAt: { value: '2026-07-10', precision: 'date', raw: 'Jul 10' },
        url: 'https://jobs.ashbyhq.com/acme/a-different-job',
      },
    }] })

    findings = await client.sourcing.findings.list()
    expect(findings.total).toBe(2)
    expect(findings.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        destinationUrl: 'https://jobs.ashbyhq.com/acme/a-different-job',
        mergeStatus: 'blocked',
        policyBlocker: 'possible_match',
        mergeNotes: expect.stringContaining('same job'),
      }),
    ]))
  })

  it('converges different provider identities on one canonical employer destination', async () => {
    const pgliteDataPath = tempDatabasePath()
    const client = createLocalValedictorianClient({ pgliteDataPath })
    const records = [
      {
        adapter: { id: 'board.alpha', kind: 'connector' as const, version: '1.0.0' },
        providerRecordId: 'alpha-123',
        providerSchema: 'alpha/jobs/v1',
        observedAt: '2026-07-10T12:00:00.000Z',
        payload: {
          company: 'Shared Robotics', title: 'Software Intern',
          location: { raw: 'New York, NY', country: 'US' },
          applicationUrl: 'https://jobs.ashbyhq.com/shared/job-123',
        },
      },
      {
        adapter: { id: 'board.beta', kind: 'connector' as const, version: '2.0.0' },
        providerRecordId: 'beta-987',
        providerSchema: 'beta/jobs/v2',
        observedAt: '2026-07-10T13:00:00.000Z',
        payload: {
          company: 'Shared Robotics', title: 'Software Engineering Intern',
          location: { raw: 'New York, NY', country: 'US' },
          applicationUrl: 'https://jobs.ashbyhq.com/shared/job-123',
        },
      },
    ]

    for (const orderedRecords of [records, [...records].reverse()]) {
      const orderedPath = orderedRecords === records ? pgliteDataPath : tempDatabasePath()
      const orderedClient = orderedRecords === records
        ? client
        : createLocalValedictorianClient({ pgliteDataPath: orderedPath })
      for (const record of orderedRecords) {
        const capture = await createConnectorCaptureFixture(
          orderedPath,
          record.adapter.id,
          record.adapter.version,
        )
        await orderedClient.sourcing.rawRecords.ingestBatch({ records: [{ ...record, capture }] })
      }

      const findings = await orderedClient.sourcing.findings.list()
      expect(findings).toMatchObject({
        total: 1,
        items: [{
          roleTitle: 'Software Engineering Intern',
          destinationUrl: 'https://jobs.ashbyhq.com/shared/job-123',
        }],
      })
    }
    const persistedDatabase = createFileDatabase(resolveDatabaseFilePath(pgliteDataPath))
    const persisted = persistedDatabase.prepare(
      'select projection_aliases_json as aliases from opportunities',
    ).get() as { aliases: string }
    persistedDatabase.close()
    expect(persisted.aliases).toContain('alpha-123')
    expect(persisted.aliases).toContain('beta-987')

    const concurrentPath = tempDatabasePath()
    const concurrentClient = createLocalValedictorianClient({ pgliteDataPath: concurrentPath })
    const concurrentRecords = await Promise.all(records.map(async (record) => ({
      ...record,
      capture: await createConnectorCaptureFixture(
        concurrentPath,
        record.adapter.id,
        record.adapter.version,
      ),
    })))
    await Promise.all(concurrentRecords.map((record) =>
      concurrentClient.sourcing.rawRecords.ingestBatch({ records: [record] })))
    await expect(concurrentClient.sourcing.findings.list()).resolves.toMatchObject({
      total: 1,
      items: [{ roleTitle: 'Software Engineering Intern' }],
    })
  })

  it('preserves a passed candidate and records failure when its finding cannot be projected', async () => {
    const pgliteDataPath = tempDatabasePath()
    const client = createLocalValedictorianClient({ pgliteDataPath })
    const sqlite = createFileDatabase(resolveDatabaseFilePath(pgliteDataPath))
    sqlite.exec(`
      create trigger reject_sourcing_projection
      before insert on opportunities
      begin
        select raise(abort, 'injected projection policy failure');
      end
    `)
    sqlite.close()

    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' },
      observedAt: '2026-07-10T12:00:00.000Z',
      payload: {
        company: 'Atomic Robotics', title: 'Software Intern',
        location: { raw: 'New York, NY', country: 'US' },
        applicationUrl: 'https://jobs.ashbyhq.com/atomic/job-1',
      },
    }] })

    await expect(client.sourcing.rawRecords.normalization.get(
      intake.receipts[0].rawRecordId,
    )).resolves.toMatchObject({ status: 'completed', gate: { status: 'passed' } })
    await expect(client.sourcing.rawRevisions.projection.get(
      intake.receipts[0].revision.id,
    )).resolves.toMatchObject({
      status: 'failed',
      failure: { code: 'projection_failed', retryable: false },
    })
    await expect(client.sourcing.findings.list()).resolves.toMatchObject({ total: 0 })
  })

  it('requires explicit approval before promoting a typed third-party destination', async () => {
    const client = createLocalValedictorianClient({ pgliteDataPath: tempDatabasePath() })
    await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'linkedin.import', kind: 'import', version: '1.0.0' },
      observedAt: '2026-07-10T12:00:00.000Z',
      payload: {
        company: 'Linked Robotics', title: 'Software Intern',
        location: { raw: 'New York, NY', country: 'US' },
        applicationUrl: 'https://www.linkedin.com/jobs/view/123456',
      },
    }] })

    const finding = (await client.sourcing.findings.list()).items[0]
    expect(finding).toMatchObject({
      destinationClass: 'third_party_job_posting',
      destinationUrl: 'https://www.linkedin.com/jobs/view/123456',
      officialUrl: null,
      sourceUrl: 'https://www.linkedin.com/jobs/view/123456',
      usability: 'review_only',
      mergeStatus: 'blocked',
      policyBlocker: 'third_party_destination',
      blocker: expect.stringContaining('Approve'),
    })
    await expect(client.applications.list()).resolves.toMatchObject({ total: 0 })

    const promoted = await client.sourcing.findings.promote({ findingId: finding.id })
    expect(promoted).toMatchObject({ mergeStatus: 'merged', mergedApplicationId: expect.any(String) })
    await expect(client.applications.get(promoted.mergedApplicationId!)).resolves.toMatchObject({
      primaryLink: {
        label: 'source',
        url: 'https://www.linkedin.com/jobs/view/123456',
      },
    })
  })

  it('classifies a production-shaped Internist as sourcing not-fit with provenance', async () => {
    const pgliteDataPath = tempDatabasePath()
    const client = createLocalValedictorianClient({ pgliteDataPath })
    const capture = await createConnectorCaptureFixture(pgliteDataPath, 'jobright.resolver', '0.6.0')
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'jobright.resolver', kind: 'connector', version: '0.6.0' },
      capture,
      providerRecordId: 'jobright-internist-1',
      providerSchema: 'jobright.jobs/v1',
      observedAt: '2026-07-10T15:00:00.000Z',
      reportedOrigin: {
        kind: 'aggregator',
        name: 'Jobright',
        providerId: 'jobright-internist-1',
        url: 'https://jobright.ai/jobs/info/jobright-internist-1',
      },
      payload: {
        company: 'Regional Medical Center',
        title: 'Internist',
        employmentType: 'FT',
        location: { raw: 'Boston, MA', city: 'Boston', region: 'MA', country: 'US' },
        sourceUrl: 'https://jobright.ai/jobs/info/jobright-internist-1',
        applicationUrl: 'https://jobs.lever.co/regionalmedical/internist-1',
      },
    }] })
    const normalization = await client.sourcing.rawRecords.normalization.get(
      intake.receipts[0].rawRecordId,
    )
    const findings = await client.sourcing.findings.list()

    expect(normalization).toMatchObject({
      gate: { status: 'passed' },
      canonicalCandidate: { roleTitle: 'Internist', employmentType: 'full_time' },
    })
    expect(findings).toMatchObject({
      total: 1,
      items: [{
        rawRevisionId: intake.receipts[0].revision.id,
        canonicalCandidateId: normalization.canonicalCandidate?.id,
        sourceName: 'Jobright',
        roleTitle: 'Internist',
        employmentType: 'full_time',
        roleKind: 'full_time',
        usability: 'usable',
        mergeStatus: 'not_fit',
        dispositionReason: expect.stringContaining('internship'),
        mergedApplicationId: null,
      }],
    })
    expect(findings.items[0].usability).not.toBe('review_only')
  })

  it('classifies an exact employer destination as a strong application duplicate', async () => {
    const client = createLocalValedictorianClient({ pgliteDataPath: tempDatabasePath() })
    const application = await client.applications.create({
      companyName: 'Strong Identity Co',
      roleTitle: 'Software Intern',
      sourceName: 'Manual',
      roleKind: 'internship',
      country: 'US',
      workMode: 'remote',
      status: 'queued',
      primaryLink: {
        kind: 'official',
        label: 'official',
        url: 'https://jobs.lever.co/strong/job-1',
      },
    })
    await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'cli.fixture', kind: 'cli', version: '1.0.0' },
      observedAt: '2026-07-10T16:00:00.000Z',
      payload: {
        company: 'Strong Identity Co',
        title: 'Software Intern',
        applicationUrl: 'https://jobs.lever.co/strong/job-1?utm_source=fixture',
      },
    }] })

    await expect(client.sourcing.findings.list()).resolves.toMatchObject({
      total: 1,
      items: [expect.objectContaining({
        destinationUrl: 'https://jobs.lever.co/strong/job-1',
        mergeStatus: 'duplicate',
        mergedApplicationId: application.id,
        duplicateNotes: expect.stringContaining('official'),
      })],
    })
  })

  it('uses the same current projection for CLI, manual, and import provenance', async () => {
    const pgliteDataPath = tempDatabasePath()
    const client = createLocalValedictorianClient({ pgliteDataPath })
    const adapterKinds = ['cli', 'manual', 'import'] as const

    await client.sourcing.rawRecords.ingestBatch({
      records: adapterKinds.map((kind, index) => ({
        adapter: { id: `fixture.${kind}`, kind, version: '1.0.0' },
        observedAt: `2026-07-10T17:0${index}:00.000Z`,
        payload: {
          company: `${kind} Co`,
          title: 'Software Intern',
          applicationUrl: `https://jobs.lever.co/${kind}/job-${index}`,
        },
      })),
    })

    await expect(client.sourcing.findings.list()).resolves.toMatchObject({ total: 3 })
    const sqlite = createFileDatabase(resolveDatabaseFilePath(pgliteDataPath))
    const database = createDrizzleDatabase(sqlite)
    expect(database.select({
      adapterId: opportunities.adapterId,
      adapterKind: opportunities.adapterKind,
    }).from(opportunities).all()).toEqual(expect.arrayContaining(
      adapterKinds.map((kind) => ({ adapterId: `fixture.${kind}`, adapterKind: kind })),
    ))
    sqlite.close()
  })

  it('deduplicates a canonical employer destination across source adapters', async () => {
    const client = createLocalValedictorianClient({ pgliteDataPath: tempDatabasePath() })
    const destination = 'https://jobs.lever.co/cross-adapter/job-1'
    await client.sourcing.rawRecords.ingestBatch({ records: [
      {
        adapter: { id: 'fixture.manual', kind: 'manual', version: '1.0.0' },
        observedAt: '2026-07-10T17:10:00.000Z',
        payload: { company: 'Cross Adapter Co', title: 'Software Intern', applicationUrl: destination },
      },
      {
        adapter: { id: 'fixture.import', kind: 'import', version: '2.0.0' },
        observedAt: '2026-07-10T17:11:00.000Z',
        payload: { company: 'Cross Adapter Co', title: 'Software Engineering Intern', applicationUrl: destination },
      },
    ] })

    await expect(client.sourcing.findings.list()).resolves.toMatchObject({
      total: 1,
      items: [expect.objectContaining({
        destinationUrl: destination,
        roleTitle: 'Software Engineering Intern',
      })],
    })
  })

  it('preserves sourcing-owned cutoff and human rejection across candidate revisions', async () => {
    const pgliteDataPath = tempDatabasePath()
    const client = createLocalValedictorianClient({ pgliteDataPath })
    const capture = await createConnectorCaptureFixture(pgliteDataPath, 'fixture.connector', '1.0.0')
    const record = (title: string, observedAt: string) => ({
      adapter: { id: 'fixture.connector', kind: 'connector' as const, version: '1.0.0' },
      capture,
      providerRecordId: 'policy-owned-job-1',
      providerSchema: 'fixture/jobs/v1',
      observedAt,
      payload: {
        company: 'Policy Co', title,
        location: { raw: 'New York, NY', city: 'New York', region: 'NY', country: 'US' },
        applicationUrl: 'https://jobs.lever.co/policy/job-1',
      },
    })
    await client.sourcing.rawRecords.ingestBatch({
      records: [record('Software Intern', '2026-07-10T18:00:00.000Z')],
    })
    const finding = (await client.sourcing.findings.list()).items[0]
    await client.sourcing.findings.update({
      findingId: finding.id,
      priorityScore: 4,
      priorityBand: 'low',
    })

    await client.sourcing.rawRecords.ingestBatch({
      records: [record('Software Engineering Intern', '2026-07-10T18:01:00.000Z')],
    })
    await expect(client.sourcing.findings.list()).resolves.toMatchObject({
      total: 1,
      items: [expect.objectContaining({
        roleTitle: 'Software Engineering Intern',
        priorityScore: 4,
        mergeStatus: 'below_cutoff',
      })],
    })

    await client.sourcing.findings.decide({
      findingId: finding.id,
      mergeStatus: 'not_pursued',
      dispositionReason: 'User rejected this role.',
    })
    await client.sourcing.rawRecords.ingestBatch({
      records: [record('Software Platform Intern', '2026-07-10T18:02:00.000Z')],
    })
    await expect(client.sourcing.findings.list()).resolves.toMatchObject({
      total: 1,
      items: [expect.objectContaining({
        roleTitle: 'Software Platform Intern',
        mergeStatus: 'not_pursued',
        dispositionReason: 'User rejected this role.',
      })],
    })
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
    const client = createLocalValedictorianClient({ pgliteDataPath: tempDatabasePath(), normalizationRegistry: createNormalizationResolverRegistry([blocked, lowerBlocked, lowerNotApplicable, ...createDefaultNormalizationResolverRegistry().resolvers]) })
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
        { resolverId: 'fixture.partial-retry', resolverVersion: '1.0.0', field: 'companyName', inputHash: context.hashInput('company'), status: 'retry', retry: {
          state: 'scheduled', reason: 'rate_limit', attempt: 1, maxAttempts: 3,
          lastAttemptAt: '2026-07-10T12:00:00.000Z', computedDelayMs: 300_000,
          nextAttemptAt: '2026-07-10T12:05:00.000Z', horizonAt: '2026-07-10T13:00:00.000Z',
        } },
        { resolverId: 'fixture.partial-retry', resolverVersion: '1.0.0', field: 'roleTitle', inputHash: context.hashInput('Intern'), status: 'resolved', value: 'Intern', confidence: 1 },
      ] },
    }
    const client = createLocalValedictorianClient({ pgliteDataPath: tempDatabasePath(), normalizationRegistry: createNormalizationResolverRegistry([partial, ...createDefaultNormalizationResolverRegistry().resolvers]) })
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' }, observedAt: '2026-07-10T12:00:00.000Z',
      payload: { company: 'Fallback must not win', title: 'Intern', url: 'https://jobs.lever.co/acme/job-1' },
    }] })
    const result = await client.sourcing.rawRecords.normalization.get(intake.receipts[0].rawRecordId)
    expect(result).toMatchObject({
      status: 'completed', canonicalCandidate: null,
      gate: { status: 'needs_enrichment', candidate: null, missingFields: expect.arrayContaining(['companyName']), reason: expect.stringContaining('rate_limit') },
      attempts: expect.arrayContaining([expect.objectContaining({
        resolver: expect.objectContaining({ id: 'fixture.partial-retry' }), status: 'completed',
        outcomes: expect.arrayContaining([
          expect.objectContaining({ field: 'companyName', status: 'retry', retry: expect.objectContaining({ reason: 'rate_limit', nextAttemptAt: '2026-07-10T12:05:00.000Z' }) }),
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
      inputHash: context.hashInput('company'), status: 'retry', retry: {
        state: 'scheduled', reason: 'network_interruption', attempt: 1, maxAttempts: 3,
        lastAttemptAt: '2026-07-10T12:00:00.000Z', computedDelayMs: 60_000,
        nextAttemptAt: '2026-07-10T12:01:00.000Z', horizonAt: '2026-07-10T13:00:00.000Z',
      },
    }])
    const defaultsWithoutCompany = createDefaultNormalizationResolverRegistry().resolvers.filter(({ declaration }) => declaration.id !== 'deterministic.explicit-company')
    const client = createLocalValedictorianClient({ pgliteDataPath: tempDatabasePath(), normalizationRegistry: createNormalizationResolverRegistry([winner, retry, ...defaultsWithoutCompany]) })
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
      expect.objectContaining({ resolverId: 'fixture.lower-company-retry', status: 'retry', retry: expect.objectContaining({ reason: 'network_interruption' }) }),
    ]))
  })

  it.each(['FT', 'Full_Time', 'full-time', 'full time'])('maps the explicit employment alias %s', async (employmentType) => {
    const client = createLocalValedictorianClient({ pgliteDataPath: tempDatabasePath() })
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
      pgliteDataPath: tempDatabasePath(),
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
    const client = createLocalValedictorianClient({ pgliteDataPath: tempDatabasePath(), normalizationRegistry: createNormalizationResolverRegistry([incomplete, ...createDefaultNormalizationResolverRegistry().resolvers]) })
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
    const client = createLocalValedictorianClient({ pgliteDataPath: tempDatabasePath(), normalizationRegistry: createNormalizationResolverRegistry([malformed, ...createDefaultNormalizationResolverRegistry().resolvers]) })
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
    const client = createLocalValedictorianClient({ pgliteDataPath: tempDatabasePath(), normalizationRegistry: createNormalizationResolverRegistry([malformed, ...createDefaultNormalizationResolverRegistry().resolvers]) })
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
    const client = createLocalValedictorianClient({ pgliteDataPath: tempDatabasePath(), normalizationRegistry: createNormalizationResolverRegistry([valid, ...createDefaultNormalizationResolverRegistry().resolvers]) })
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
    const client = createLocalValedictorianClient({ pgliteDataPath: tempDatabasePath(), normalizationRegistry: createNormalizationResolverRegistry([malformed, ...createDefaultNormalizationResolverRegistry().resolvers]) })
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
    const client = createLocalValedictorianClient({ pgliteDataPath: tempDatabasePath(), normalizationRegistry: createNormalizationResolverRegistry([resolver, ...createDefaultNormalizationResolverRegistry().resolvers]) })
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
    const client = createLocalValedictorianClient({ pgliteDataPath: tempDatabasePath(), normalizationRegistry: createNormalizationResolverRegistry([resolver, ...createDefaultNormalizationResolverRegistry().resolvers]) })
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
    const client = createLocalValedictorianClient({ pgliteDataPath: tempDatabasePath(), normalizationRegistry: createNormalizationResolverRegistry([resolver, ...createDefaultNormalizationResolverRegistry().resolvers]) })
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
    const client = createLocalValedictorianClient({ pgliteDataPath: tempDatabasePath(), normalizationRegistry: createNormalizationResolverRegistry([resolver, ...createDefaultNormalizationResolverRegistry().resolvers]) })
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
    const client = createLocalValedictorianClient({ pgliteDataPath: tempDatabasePath() })
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
    const pgliteDataPath = tempDatabasePath()
    const client = createLocalValedictorianClient({ pgliteDataPath })
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
      capture: await createConnectorCaptureFixture(pgliteDataPath, 'fixture:connector', '1.0.0'),
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
    const pgliteDataPath = tempDatabasePath()
    const client = createLocalValedictorianClient({ pgliteDataPath })
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'fixture.connector', kind: 'connector', version: '1.0.0' },
      capture: await createConnectorCaptureFixture(pgliteDataPath, 'fixture.connector', '1.0.0'),
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
    const pgliteDataPath = tempDatabasePath()
    const client = createLocalValedictorianClient({ pgliteDataPath, normalizationRegistry: createNormalizationResolverRegistry([resolver, ...createDefaultNormalizationResolverRegistry().resolvers]) })
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'fixture.identity', kind: connector ? 'connector' : 'manual', version: '1.0.0' },
      capture: connector
        ? await createConnectorCaptureFixture(pgliteDataPath, 'fixture.identity', '1.0.0')
        : undefined,
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
    const client = createLocalValedictorianClient({ pgliteDataPath: tempDatabasePath(), normalizationRegistry: createNormalizationResolverRegistry([rejected, blocked, notApplicable, ...createDefaultNormalizationResolverRegistry().resolvers]) })
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
    await expect(client.sourcing.findings.list()).resolves.toMatchObject({ total: 0, items: [] })
  })


})

async function normalizePayload(payload: Record<string, JsonValue>) {
  const client = createLocalValedictorianClient({ pgliteDataPath: tempDatabasePath() })
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
function tempDatabasePath() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'normalization-runtime-'))
}
