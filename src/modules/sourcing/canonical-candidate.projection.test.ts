import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import type { CanonicalSourceCandidate } from 'sparxie'
import { eq, sql } from 'drizzle-orm'
import {
  captureEvidenceVersions,
  captureLineages,
  jobFactVersions,
  jobs,
  normalizationGates,
  normalizationRuns,
  opportunities,
  sources,
  workflowRuns,
} from '../../db/schema'
import {
  createPgliteClient,
  migratePgliteDatabase,
  type PgliteDatabase,
} from '../../db/pglite'
import { createCanonicalCandidateProjectionService } from './canonical-candidate.projection'

const NOW = '2026-07-18T10:00:00.000Z'

describe('canonical candidate projection', () => {
  it('projects a passed canonical candidate and returns its finding identity', async () => {
    const database = await createTestDatabase()
    const persisted = await seedPassedCandidate(database, 'projected')
    const service = createCanonicalCandidateProjectionService(() => new Date(NOW))

    const findingId = await database.transaction((transaction) =>
      service.projectPersisted(transaction, persisted.candidateId, persisted.rawRevisionId))

    expect(findingId).toEqual(expect.any(String))
    await expect(database.select().from(opportunities)).resolves.toEqual([
      expect.objectContaining({
        id: findingId,
        companyName: 'Projected Robotics',
        roleTitle: 'Software Intern',
        mergeStatus: 'new',
      }),
    ])
  })

  it('converges concurrent projection identities on the newest canonical destination', async () => {
    const database = await createTestDatabase()
    const destination = 'https://jobs.example.test/shared-role'
    const first = await seedPassedCandidate(database, 'concurrent-a', {
      roleTitle: 'Software Intern',
      destination: { class: 'employer_or_ats', url: destination },
      canonicalIdentity: { kind: 'destination_url', value: destination },
    })
    const newest = await seedPassedCandidate(database, 'concurrent-z', {
      roleTitle: 'Software Engineering Intern',
      destination: { class: 'employer_or_ats', url: destination },
      canonicalIdentity: { kind: 'destination_url', value: destination },
    })
    const service = createCanonicalCandidateProjectionService(() => new Date(NOW))

    const results = await Promise.allSettled([first, newest].map((persisted) =>
      database.transaction((transaction) =>
        service.projectPersisted(transaction, persisted.candidateId, persisted.rawRevisionId))))
    const findingIds = results.map((result) => {
      expect(result.status).toBe('fulfilled')
      if (result.status !== 'fulfilled') throw result.reason
      return result.value
    })
    const rows = await database.select().from(opportunities)

    expect(new Set(findingIds).size).toBe(1)
    expect(rows).toEqual([
      expect.objectContaining({
        roleTitle: 'Software Engineering Intern',
        destinationUrl: destination,
      }),
    ])
    expect(JSON.parse(rows[0]?.projectionAliasesJson ?? '[]')).toEqual(expect.arrayContaining([
      'source_entity:job-concurrent-a',
      'source_entity:job-concurrent-z',
    ]))
  })

  it('keeps the first projection identity primary while accumulating later aliases', async () => {
    const database = await createTestDatabase()
    const destination = 'https://jobs.example.test/identity-alias'
    const first = await seedPassedCandidate(database, 'identity-first', {
      destination: { class: 'employer_or_ats', url: destination },
      canonicalIdentity: { kind: 'destination_url', value: destination },
    })
    const later = await seedPassedCandidate(database, 'identity-later', {
      destination: { class: 'employer_or_ats', url: destination },
      canonicalIdentity: { kind: 'destination_url', value: destination },
      observedAt: '2026-07-18T11:00:00.000Z',
    })
    const service = createCanonicalCandidateProjectionService(() => new Date(NOW))
    const findingId = await database.transaction((transaction) =>
      service.projectPersisted(transaction, first.candidateId, first.rawRevisionId))
    const [before] = await database.select().from(opportunities)

    await database.transaction((transaction) =>
      service.projectPersisted(transaction, later.candidateId, later.rawRevisionId))
    const [after] = await database.select().from(opportunities)

    // Temporary #283 parity: later strong identities remain aliases of the first projection identity.
    expect(after).toMatchObject({
      id: findingId,
      projectionIdentityKey: before?.projectionIdentityKey,
    })
    expect(JSON.parse(after?.projectionAliasesJson ?? '[]')).toContain(
      'source_entity:job-identity-later',
    )
  })

  it('reports conflicting canonical identity owners in deterministic order', async () => {
    const database = await createTestDatabase()
    const first = await seedPassedCandidate(database, 'owner-a')
    const second = await seedPassedCandidate(database, 'owner-b')
    const service = createCanonicalCandidateProjectionService(() => new Date(NOW))
    const firstFindingId = await database.transaction((transaction) =>
      service.projectPersisted(transaction, first.candidateId, first.rawRevisionId))
    const secondFindingId = await database.transaction((transaction) =>
      service.projectPersisted(transaction, second.candidateId, second.rawRevisionId))
    expect(firstFindingId).toEqual(expect.any(String))
    expect(secondFindingId).toEqual(expect.any(String))
    if (!firstFindingId || !secondFindingId) throw new Error('Expected projected finding identities')
    const conflict = await seedPassedCandidate(database, 'conflict', {
      sourceEntityId: 'job-owner-a',
      canonicalIdentity: {
        kind: 'destination_url',
        value: 'https://jobs.example.test/owner-b',
      },
    })
    const owners = [firstFindingId, secondFindingId]
      .sort((left, right) => left.localeCompare(right))
      .join(', ')

    await expect(database.transaction((transaction) =>
      service.projectPersisted(transaction, conflict.candidateId, conflict.rawRevisionId)))
      .rejects.toThrow(`Conflicting sourcing findings own canonical identities: ${owners}`)
    await expect(database.select().from(opportunities)).resolves.toHaveLength(2)
  })

  it('rolls back the complete projection when an injected write failure aborts the transaction', async () => {
    const database = await createTestDatabase()
    const persisted = await seedPassedCandidate(database, 'rollback')
    const service = createCanonicalCandidateProjectionService(() => new Date(NOW))
    await database.execute(sql.raw(`
      CREATE FUNCTION reject_canonical_projection() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'injected canonical projection failure';
      END;
      $$;
    `))
    await database.execute(sql.raw(`
      CREATE TRIGGER reject_canonical_projection_insert
        BEFORE INSERT ON opportunities
        FOR EACH ROW EXECUTE FUNCTION reject_canonical_projection();
    `))

    await expect(database.transaction((transaction) =>
      service.projectPersisted(transaction, persisted.candidateId, persisted.rawRevisionId)))
      .rejects.toThrow('Failed query: insert into "opportunities"')
    await expect(database.select().from(opportunities)).resolves.toEqual([])
    await expect(database.select().from(sources)).resolves.toEqual([])
    await expect(database.select().from(workflowRuns)).resolves.toEqual([])
  })

  it('keeps a projected finding visible after an on-disk close and reopen', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'canonical-projection-'))
    let findingId: string | null = null

    try {
      const firstClient = await createPgliteClient({ dataDir: directory })
      try {
        const database = await migratePgliteDatabase(firstClient)
        const persisted = await seedPassedCandidate(database, 'reopen')
        const service = createCanonicalCandidateProjectionService(() => new Date(NOW))
        findingId = await database.transaction((transaction) =>
          service.projectPersisted(transaction, persisted.candidateId, persisted.rawRevisionId))
      } finally {
        await firstClient.close()
      }

      const reopenedClient = await createPgliteClient({ dataDir: directory })
      try {
        const database = await migratePgliteDatabase(reopenedClient)
        const [persisted] = await database
          .select()
          .from(opportunities)
          .where(eq(opportunities.id, findingId ?? ''))
          .limit(1)
        expect(persisted).toMatchObject({
          companyName: 'Projected Robotics',
          destinationUrl: 'https://jobs.example.test/reopen',
        })
      } finally {
        await reopenedClient.close()
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

async function createTestDatabase() {
  const client = await createPgliteClient()
  onTestFinished(() => client.close())
  return migratePgliteDatabase(client)
}

async function seedPassedCandidate(
  database: PgliteDatabase,
  suffix: string,
  overrides: Partial<CanonicalSourceCandidate> = {},
) {
  const jobId = `job-${suffix}`
  const rawRecordId = `raw-${suffix}`
  const rawRevisionId = `revision-${suffix}`
  const normalizationId = `normalization-${suffix}`
  const candidateId = `candidate-${suffix}`
  const destinationUrl = `https://jobs.example.test/${suffix}`
  const candidate: CanonicalSourceCandidate = {
    id: candidateId,
    sourceEntityId: jobId,
    rawRecordId,
    rawRevisionId,
    schemaVersion: 'canonical-candidate@1',
    canonicalIdentity: { kind: 'destination_url', value: destinationUrl },
    companyName: 'Projected Robotics',
    roleTitle: 'Software Intern',
    employmentType: 'internship',
    seniority: 'internship',
    workMode: 'remote',
    location: { raw: 'Denver, CO', city: 'Denver', region: 'CO', country: 'US' },
    compensation: null,
    postedAt: { value: '2026-07-18', precision: 'date', raw: 'Jul 18' },
    destination: { class: 'employer_or_ats', url: destinationUrl },
    sourceUrl: null,
    providerJobId: suffix,
    observedAt: NOW,
    ...overrides,
  }

  await database.insert(jobs).values({
    id: jobId,
    identityKind: 'provider_job',
    identityNamespace: 'fixture',
    identityValue: suffix,
    createdAt: NOW,
  })
  await database.insert(captureLineages).values({ id: rawRecordId, jobId, createdAt: NOW })
  await database.insert(captureEvidenceVersions).values({
    id: rawRevisionId,
    captureLineageId: rawRecordId,
    revision: 1,
    contentHash: `sha256:${suffix}`,
    adapterId: 'fixture.cli',
    adapterKind: 'cli',
    adapterVersion: '1.0.0',
    reportedOriginName: 'Fixture Board',
    observedAt: candidate.observedAt,
    evidenceJson: '[]',
    createdAt: NOW,
  })
  await database.insert(normalizationRuns).values({
    id: normalizationId,
    captureLineageId: rawRecordId,
    captureEvidenceVersionId: rawRevisionId,
    inputHash: `sha256:input-${suffix}`,
    resolverSetHash: 'sha256:resolver-set',
    canonicalSchemaVersion: 'canonical-candidate@1',
    gatePolicyVersion: 'gate/v1',
    triggerKind: 'intake',
    status: 'completed',
    createdAt: NOW,
    updatedAt: NOW,
  })
  await database.insert(jobFactVersions).values({
    id: candidateId,
    runId: normalizationId,
    jobId,
    captureLineageId: rawRecordId,
    captureEvidenceVersionId: rawRevisionId,
    schemaVersion: candidate.schemaVersion,
    jobFactVersionJson: JSON.stringify(candidate),
    createdAt: NOW,
  })
  await database.insert(normalizationGates).values({
    id: `gate-${suffix}`,
    runId: normalizationId,
    policyVersion: 'gate/v1',
    status: 'passed',
    jobFactVersionId: candidateId,
    gateJson: '{}',
    evaluatedAt: NOW,
  })

  return { candidateId, rawRevisionId }
}
