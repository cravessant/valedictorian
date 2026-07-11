import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDrizzleDatabase, createFileDatabase } from '../db/sqlite'
import { createSqliteNormalizationRepository } from '../modules/sourcing/normalization.repository'
import type { NormalizationResolver } from '../modules/sourcing/normalization.registry'
import {
  createDefaultNormalizationResolverRegistry,
  createNormalizationResolverRegistry,
} from '../modules/sourcing/normalization.registry'
import { createLocalValedictorianClient } from './local-valedictorian-client'

describe('local raw normalization replay', () => {
  it('replays an exactly selected raw revision when its canonical schema is invalidated', async () => {
    const client = createLocalValedictorianClient({ sqlitePath: tempDatabasePath() })
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' },
      observedAt: '2026-07-10T12:00:00.000Z',
      payload: {
        companyName: 'Fixture Robotics',
        roleTitle: 'Software Intern',
        applicationUrl: 'https://jobs.ashbyhq.com/fixture/job-1',
      },
    }] })
    const first = await client.sourcing.rawRecords.normalization.get(
      intake.receipts[0].rawRecordId,
    )

    const receipt = await client.sourcing.rawRecords.replay({
      selector: { rawRevisionIds: [intake.receipts[0].revision.id] },
      invalidate: { canonicalSchemaVersions: ['canonical-source-candidate/v1'] },
      targetVersions: { canonicalSchemaVersion: 'canonical-source-candidate/v1' },
    })

    expect(receipt).toMatchObject({
      replayId: expect.any(String),
      acceptedAt: expect.any(String),
      matchedRawRevisionIds: [intake.receipts[0].revision.id],
    })
    const replayed = await client.sourcing.rawRecords.normalization.get(
      intake.receipts[0].rawRecordId,
    )
    expect(replayed.attempts.map(({ id }) => id)).not.toEqual(
      first.attempts.map(({ id }) => id),
    )
    expect(replayed.canonicalCandidate).toMatchObject({
      companyName: 'Fixture Robotics',
      roleTitle: 'Software Intern',
    })
  })

  it('materializes a user field lock and suppresses lower-precedence resolver work', async () => {
    const client = createLocalValedictorianClient({ sqlitePath: tempDatabasePath() })
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' },
      observedAt: '2026-07-10T12:00:00.000Z',
      payload: {
        companyName: 'Raw Company', roleTitle: 'Software Intern',
        applicationUrl: 'https://jobs.ashbyhq.com/fixture/job-2',
      },
    }] })
    const directiveInputHash = `sha256:${'a'.repeat(64)}`

    await client.sourcing.rawRecords.replay({
      selector: { rawRecordIds: [intake.receipts[0].rawRecordId] },
      invalidate: {},
      fieldDirectives: [{
        action: 'lock', field: 'companyName', value: 'User Accepted Company',
        reason: 'Confirmed by the user', inputHash: directiveInputHash,
        policyVersion: 'user-lock/v1',
      }],
    })

    const replayed = await client.sourcing.rawRecords.normalization.get(
      intake.receipts[0].rawRecordId,
    )
    expect(replayed.canonicalCandidate?.companyName).toBe('User Accepted Company')
    expect(replayed.fieldOutcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'companyName', status: 'locked', value: 'User Accepted Company',
        inputHash: directiveInputHash, policyVersion: 'user-lock/v1',
      }),
      expect.objectContaining({
        resolverId: 'deterministic.explicit-company', field: 'companyName',
        status: 'suppressed',
      }),
    ]))

    await client.sourcing.rawRecords.replay({
      selector: { rawRevisionIds: [intake.receipts[0].revision.id] },
      invalidate: { gatePolicyVersions: ['sourcing-admission/v1'] },
    })
    const replayedAgain = await client.sourcing.rawRecords.normalization.get(
      intake.receipts[0].rawRecordId,
    )
    expect(replayedAgain.canonicalCandidate?.companyName).toBe('User Accepted Company')
    expect(replayedAgain.fieldOutcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'companyName', status: 'locked', inputHash: directiveInputHash,
      }),
    ]))
  })

  it('persists an equal-strength conflict and prevents required-field admission', async () => {
    const companyResolver = (id: string, value: string): NormalizationResolver => ({
      declaration: {
        id, version: '1.0.0', requiredInputs: ['rawRevision'],
        outputFields: ['companyName'], capabilities: ['pure'], costClass: 'none', precedence: 500,
      },
      resolve(context) {
        return [{
          resolverId: id, resolverVersion: '1.0.0', field: 'companyName',
          inputHash: context.hashInput(value), status: 'resolved', value, confidence: 0.8,
        }]
      },
    })
    const defaultsWithoutCompany = createDefaultNormalizationResolverRegistry().resolvers
      .filter(({ declaration }) => declaration.id !== 'deterministic.explicit-company')
    const client = createLocalValedictorianClient({
      sqlitePath: tempDatabasePath(),
      normalizationRegistry: createNormalizationResolverRegistry([
        companyResolver('fixture.company-a', 'Company A'),
        companyResolver('fixture.company-b', 'Company B'),
        ...defaultsWithoutCompany,
      ]),
    })
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' },
      observedAt: '2026-07-10T12:00:00.000Z',
      payload: { roleTitle: 'Intern', applicationUrl: 'https://jobs.ashbyhq.com/fixture/job-3' },
    }] })

    await client.sourcing.rawRecords.replay({
      selector: { rawRevisionIds: [intake.receipts[0].revision.id] }, invalidate: {},
    })
    const replayed = await client.sourcing.rawRecords.normalization.get(
      intake.receipts[0].rawRecordId,
    )

    expect(replayed).toMatchObject({
      status: 'completed', canonicalCandidate: null,
      gate: { status: 'needs_enrichment', conflictingFields: ['companyName'] },
    })
    expect(replayed.fieldOutcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'companyName', status: 'conflict', values: ['Company A', 'Company B'],
      }),
    ]))
  })

  it('reports a truthful no-op when selected revisions do not match invalidated versions', async () => {
    const client = createLocalValedictorianClient({ sqlitePath: tempDatabasePath() })
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' },
      observedAt: '2026-07-10T12:00:00.000Z',
      payload: {
        companyName: 'Fixture', roleTitle: 'Intern',
        applicationUrl: 'https://jobs.ashbyhq.com/fixture/job-4',
      },
    }] })
    const before = await client.sourcing.rawRecords.normalization.get(
      intake.receipts[0].rawRecordId,
    )

    const receipt = await client.sourcing.rawRecords.replay({
      selector: { rawRecordIds: [intake.receipts[0].rawRecordId] },
      invalidate: { canonicalSchemaVersions: ['canonical-source-candidate/v0'] },
    })

    expect(receipt.matchedRawRevisionIds).toEqual([])
    const after = await client.sourcing.rawRecords.normalization.get(
      intake.receipts[0].rawRecordId,
    )
    expect(after.attempts.map(({ id }) => id)).toEqual(before.attempts.map(({ id }) => id))
  })

  it('rejects invalid directives atomically without appending normalization history', async () => {
    const client = createLocalValedictorianClient({ sqlitePath: tempDatabasePath() })
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' },
      observedAt: '2026-07-10T12:00:00.000Z',
      payload: {
        companyName: 'Fixture', roleTitle: 'Intern',
        applicationUrl: 'https://jobs.ashbyhq.com/fixture/job-5',
      },
    }] })
    const before = await client.sourcing.rawRecords.normalization.get(
      intake.receipts[0].rawRecordId,
    )

    await expect(client.sourcing.rawRecords.replay({
      selector: { rawRevisionIds: [intake.receipts[0].revision.id] },
      invalidate: {},
      fieldDirectives: [{
        action: 'lock', field: 'companyName', value: '', reason: 'Invalid empty company',
        inputHash: `sha256:${'b'.repeat(64)}`, policyVersion: 'user-lock/v1',
      }],
    })).rejects.toMatchObject({ statusCode: 400, code: 'invalid_request' })
    const after = await client.sourcing.rawRecords.normalization.get(
      intake.receipts[0].rawRecordId,
    )
    expect(after.attempts.map(({ id }) => id)).toEqual(before.attempts.map(({ id }) => id))
  })

  it('continues matched revisions after one normalization failure and reports it', async () => {
    const selectivelyInvalid: NormalizationResolver = {
      declaration: {
        id: 'fixture.selectively-invalid', version: '1.0.0', requiredInputs: ['rawRevision'],
        outputFields: ['companyName'], capabilities: ['pure'], costClass: 'none', precedence: 1_000,
      },
      resolve(context) {
        if (context.rawRevision.payload?.failReplay === true) return [{
          resolverId: 'fixture.selectively-invalid', resolverVersion: '1.0.0',
          field: 'companyName', inputHash: `sha256:${'0'.repeat(64)}`,
          status: 'resolved', value: 'Invalid', confidence: 1,
        }]
        return [{
          resolverId: 'fixture.selectively-invalid', resolverVersion: '1.0.0',
          field: 'companyName', inputHash: context.hashInput(null),
          status: 'abstained', reason: 'Fixture permits fallback',
        }]
      },
    }
    const client = createLocalValedictorianClient({
      sqlitePath: tempDatabasePath(),
      normalizationRegistry: createNormalizationResolverRegistry([
        selectivelyInvalid, ...createDefaultNormalizationResolverRegistry().resolvers,
      ]),
    })
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [
      {
        adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' },
        observedAt: '2026-07-10T12:00:00.000Z',
        payload: { failReplay: true, companyName: 'Bad', roleTitle: 'Intern', applicationUrl: 'https://jobs.ashbyhq.com/fixture/bad' },
      },
      {
        adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' },
        observedAt: '2026-07-10T12:00:01.000Z',
        payload: { companyName: 'Good', roleTitle: 'Intern', applicationUrl: 'https://jobs.ashbyhq.com/fixture/good' },
      },
    ] })

    const receipt = await client.sourcing.rawRecords.replay({
      selector: { rawRevisionIds: intake.receipts.map(({ revision }) => revision.id) },
      invalidate: {},
    })

    expect(receipt).toMatchObject({
      status: 'completed_with_failures', completedAt: expect.any(String),
      items: expect.arrayContaining([{
        status: 'failed', rawRecordId: intake.receipts[0].rawRecordId,
        rawRevisionId: intake.receipts[0].revision.id,
        normalizationRunId: expect.any(String),
        failure: { code: 'normalization_failed', retryable: false },
      }]),
    })
    await expect(client.sourcing.rawRecords.normalization.get(
      intake.receipts[1].rawRecordId,
    )).resolves.toMatchObject({ status: 'completed', canonicalCandidate: { companyName: 'Good' } })
  })

  it('runs the exact requested installed resolver version for a targeted resolver id', async () => {
    const versioned = (version: string, companyName: string): NormalizationResolver => ({
      declaration: {
        id: 'fixture.versioned-company', version, requiredInputs: ['rawRevision'],
        outputFields: ['companyName'], capabilities: ['pure'], costClass: 'none', precedence: 1_000,
      },
      resolve(context) { return [{
        resolverId: 'fixture.versioned-company', resolverVersion: version,
        field: 'companyName', inputHash: context.hashInput(companyName),
        status: 'resolved', value: companyName, confidence: 1,
      }] },
    })
    const defaultsWithoutCompany = createDefaultNormalizationResolverRegistry().resolvers
      .filter(({ declaration }) => declaration.id !== 'deterministic.explicit-company')
    const client = createLocalValedictorianClient({
      sqlitePath: tempDatabasePath(),
      normalizationRegistry: createNormalizationResolverRegistry([
        versioned('1.0.0', 'Old Company'), versioned('2.0.0', 'New Company'),
        ...defaultsWithoutCompany,
      ]),
    })
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' },
      observedAt: '2026-07-10T12:00:00.000Z',
      payload: { roleTitle: 'Intern', applicationUrl: 'https://jobs.ashbyhq.com/fixture/versioned' },
    }] })

    await client.sourcing.rawRecords.replay({
      selector: { rawRevisionIds: [intake.receipts[0].revision.id] },
      invalidate: { resolverVersions: [{ resolverId: 'fixture.versioned-company', version: '1.0.0' }] },
      targetVersions: { resolvers: [{ resolverId: 'fixture.versioned-company', version: '2.0.0' }] },
    })
    const replayed = await client.sourcing.rawRecords.normalization.get(intake.receipts[0].rawRecordId)
    expect(replayed.canonicalCandidate?.companyName).toBe('New Company')
    expect(replayed.attempts).toEqual(expect.arrayContaining([
      expect.objectContaining({ resolver: expect.objectContaining({ id: 'fixture.versioned-company', version: '2.0.0' }) }),
    ]))
    expect(replayed.attempts).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ resolver: expect.objectContaining({ id: 'fixture.versioned-company', version: '1.0.0' }) }),
    ]))
  })

  it('persists explicit suppression without canonical null and allows a later lock to supersede it', async () => {
    const client = createLocalValedictorianClient({ sqlitePath: tempDatabasePath() })
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' },
      observedAt: '2026-07-10T12:00:00.000Z',
      payload: {
        companyName: 'Raw Company', roleTitle: 'Intern',
        applicationUrl: 'https://jobs.ashbyhq.com/fixture/suppressed',
      },
    }] })
    const suppressedInputHash = `sha256:${'c'.repeat(64)}`
    await client.sourcing.rawRecords.replay({
      selector: { rawRevisionIds: [intake.receipts[0].revision.id] }, invalidate: {},
      fieldDirectives: [{
        action: 'suppress', field: 'companyName', reason: 'User rejected provider value',
        inputHash: suppressedInputHash, policyVersion: 'user-suppression/v1',
      }],
    })
    const suppressed = await client.sourcing.rawRecords.normalization.get(intake.receipts[0].rawRecordId)
    expect(suppressed).toMatchObject({
      canonicalCandidate: null,
      gate: { status: 'needs_enrichment', missingFields: ['companyName'] },
    })
    expect(suppressed.fieldOutcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'companyName', status: 'suppressed', reason: 'User rejected provider value',
        inputHash: suppressedInputHash, policyVersion: 'user-suppression/v1',
      }),
    ]))
    expect(suppressed.fieldOutcomes).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'companyName', status: 'resolved', value: null }),
    ]))

    await client.sourcing.rawRecords.replay({
      selector: { rawRevisionIds: [intake.receipts[0].revision.id] }, invalidate: {},
      fieldDirectives: [{
        action: 'lock', field: 'companyName', value: 'Replacement Company',
        reason: 'User supplied replacement', inputHash: `sha256:${'d'.repeat(64)}`,
        policyVersion: 'user-lock/v2',
      }],
    })
    const superseded = await client.sourcing.rawRecords.normalization.get(intake.receipts[0].rawRecordId)
    expect(superseded.canonicalCandidate?.companyName).toBe('Replacement Company')
    expect(superseded.fieldOutcomes).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'companyName', status: 'suppressed', inputHash: suppressedInputHash,
      }),
    ]))
  })

  it('keeps prior normalization runs internally queryable while GET returns the latest replay', async () => {
    const sqlitePath = tempDatabasePath()
    const client = createLocalValedictorianClient({ sqlitePath })
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' },
      observedAt: '2026-07-10T12:00:00.000Z',
      payload: { companyName: 'Fixture', roleTitle: 'Intern', applicationUrl: 'https://jobs.ashbyhq.com/fixture/history' },
    }] })
    const first = await client.sourcing.rawRecords.normalization.get(intake.receipts[0].rawRecordId)
    await client.sourcing.rawRecords.replay({
      selector: { rawRevisionIds: [intake.receipts[0].revision.id] }, invalidate: {},
    })
    const latest = await client.sourcing.rawRecords.normalization.get(intake.receipts[0].rawRecordId)

    const sqlite = createFileDatabase(sqlitePath)
    const history = createSqliteNormalizationRepository(createDrizzleDatabase(sqlite))
      .listHistory(intake.receipts[0].rawRecordId)
    sqlite.close()
    expect(history).toHaveLength(2)
    expect(history[0].attempts.map(({ id }) => id)).toEqual(latest.attempts.map(({ id }) => id))
    expect(history[1].attempts.map(({ id }) => id)).toEqual(first.attempts.map(({ id }) => id))
  })

  it('selects only the revision that owns a persisted resolver input hash', async () => {
    const client = createLocalValedictorianClient({ sqlitePath: tempDatabasePath() })
    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [
      {
        adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' },
        observedAt: '2026-07-10T12:00:00.000Z',
        payload: { companyName: 'First', roleTitle: 'Intern', applicationUrl: 'https://jobs.ashbyhq.com/fixture/input-1' },
      },
      {
        adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' },
        observedAt: '2026-07-10T12:00:01.000Z',
        payload: { companyName: 'Second', roleTitle: 'Intern', applicationUrl: 'https://jobs.ashbyhq.com/fixture/input-2' },
      },
    ] })
    const first = await client.sourcing.rawRecords.normalization.get(intake.receipts[0].rawRecordId)
    const companyInputHash = first.fieldOutcomes.find(({ field }) => field === 'companyName')?.inputHash
    expect(companyInputHash).toMatch(/^sha256:/)

    const receipt = await client.sourcing.rawRecords.replay({
      selector: { inputHashes: [companyInputHash!] }, invalidate: {},
    })

    expect(receipt.matchedRawRevisionIds).toEqual([intake.receipts[0].revision.id])
    expect(receipt.items).toEqual([expect.objectContaining({
      rawRecordId: intake.receipts[0].rawRecordId,
      rawRevisionId: intake.receipts[0].revision.id,
    })])
  })
})

function tempDatabasePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'normalization-replay-')), 'db.sqlite')
}
