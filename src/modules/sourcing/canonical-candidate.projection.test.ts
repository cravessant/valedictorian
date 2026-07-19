import { describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { opportunities } from '../../db/schema'
import { useResettablePgliteTestDatabase } from '../../test/pglite-test-owner'
import {
  CANONICAL_PROJECTION_TEST_NOW as NOW,
  seedPassedCanonicalCandidate,
} from './canonical-candidate.projection.pglite-test-helpers'
import { createCanonicalCandidateProjectionService } from './canonical-candidate.projection'

const resettableDatabase = useResettablePgliteTestDatabase()

describe.sequential('canonical candidate projection', () => {
  it('projects a passed canonical candidate and returns its finding identity', async () => {
    const database = await createTestDatabase()
    const persisted = await seedPassedCanonicalCandidate(database, 'projected')
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
    const first = await seedPassedCanonicalCandidate(database, 'concurrent-a', {
      roleTitle: 'Software Intern',
      destination: { class: 'employer_or_ats', url: destination },
      canonicalIdentity: { kind: 'destination_url', value: destination },
    })
    const newest = await seedPassedCanonicalCandidate(database, 'concurrent-z', {
      roleTitle: 'Software Engineering Intern',
      destination: { class: 'employer_or_ats', url: destination },
      canonicalIdentity: { kind: 'destination_url', value: destination },
    })
    const service = createCanonicalCandidateProjectionService(() => new Date(NOW))

    // PGlite 0.5 has one backend connection; these lock addresses are what
    // independent PostgreSQL transactions contend on in a server deployment.
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

  it('serializes otherwise unrelated projections that share only a destination', async () => {
    const database = await createTestDatabase()
    const destination = 'https://jobs.example.test/identity-lock'
    const first = await seedPassedCanonicalCandidate(database, 'identity-lock-a', {
      canonicalIdentity: { kind: 'provider_job', value: 'provider-a' },
      destination: { class: 'employer_or_ats', url: destination },
    })
    const second = await seedPassedCanonicalCandidate(database, 'identity-lock-b', {
      canonicalIdentity: { kind: 'provider_job', value: 'provider-b' },
      destination: { class: 'employer_or_ats', url: destination },
    })
    const service = createCanonicalCandidateProjectionService(() => new Date(NOW))
    const projectAndReadLocks = (persisted: typeof first) => database.transaction(async (transaction) => {
      await service.projectPersisted(transaction, persisted.candidateId, persisted.rawRevisionId)
      const locks = await transaction
        .select({
          classId: sql<string>`classid::text`,
          objectId: sql<string>`objid::text`,
        })
        .from(sql`pg_locks`)
        .where(sql`locktype = 'advisory' and mode = 'ExclusiveLock' and granted`)
      return locks.map(({ classId, objectId }) => `${classId}:${objectId}`)
    })

    const firstLocks = await projectAndReadLocks(first)
    const secondLocks = await projectAndReadLocks(second)
    const sharedLocks = firstLocks.filter((lock) => secondLocks.includes(lock))
    const [released] = await database
      .select({ count: sql<number>`count(*)::integer` })
      .from(sql`pg_locks`)
      .where(sql`locktype = 'advisory'`)

    expect(firstLocks).toHaveLength(4)
    expect(secondLocks).toHaveLength(4)
    expect(sharedLocks).toHaveLength(1)
    expect(released?.count).toBe(0)
  })

  it('re-reads one matched opportunity after disjoint aliases converge on it', async () => {
    const database = await createTestDatabase()
    const owner = await seedPassedCanonicalCandidate(database, 'alias-owner')
    const older = await seedPassedCanonicalCandidate(database, 'alias-older', {
      roleTitle: 'Older Software Intern',
      observedAt: '2026-07-18T11:00:00.000Z',
    })
    const newest = await seedPassedCanonicalCandidate(database, 'alias-newest', {
      roleTitle: 'Newest Software Intern',
      observedAt: '2026-07-18T12:00:00.000Z',
    })
    const plainService = createCanonicalCandidateProjectionService(() => new Date(NOW))
    const opportunityId = await database.transaction((transaction) =>
      plainService.projectPersisted(transaction, owner.candidateId, owner.rawRevisionId))
    const [seeded] = await database.select().from(opportunities)
    await database.update(opportunities).set({
      projectionAliasesJson: JSON.stringify([
        ...(JSON.parse(seeded?.projectionAliasesJson ?? '[]') as string[]),
        'source_entity:job-alias-newest',
        'source_entity:job-alias-older',
      ].sort()),
    }).where(eq(opportunities.id, opportunityId ?? ''))
    let interleaved = false

    await database.transaction(async (transaction) => {
      const service = createCanonicalCandidateProjectionService(() => new Date(NOW), {
        beforeOpportunityLock: async () => {
          interleaved = true
          await plainService.projectPersisted(
            transaction,
            newest.candidateId,
            newest.rawRevisionId,
          )
        },
      })
      await service.projectPersisted(transaction, older.candidateId, older.rawRevisionId)
    })
    const [projected] = await database.select().from(opportunities)
    const aliases = JSON.parse(projected?.projectionAliasesJson ?? '[]') as string[]

    expect(interleaved).toBe(true)
    expect(projected).toMatchObject({
      id: opportunityId,
      captureEvidenceVersionId: newest.rawRevisionId,
      roleTitle: 'Newest Software Intern',
    })
    expect(aliases).toEqual(expect.arrayContaining([
      'destination:employer_or_ats:https://jobs.example.test/alias-newest',
      'destination:employer_or_ats:https://jobs.example.test/alias-older',
    ]))
  })

  it('keeps the first projection identity primary while accumulating later aliases', async () => {
    const database = await createTestDatabase()
    const destination = 'https://jobs.example.test/identity-alias'
    const first = await seedPassedCanonicalCandidate(database, 'identity-first', {
      destination: { class: 'employer_or_ats', url: destination },
      canonicalIdentity: { kind: 'destination_url', value: destination },
    })
    const later = await seedPassedCanonicalCandidate(database, 'identity-later', {
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
    const first = await seedPassedCanonicalCandidate(database, 'owner-a')
    const second = await seedPassedCanonicalCandidate(database, 'owner-b')
    const service = createCanonicalCandidateProjectionService(() => new Date(NOW))
    const firstFindingId = await database.transaction((transaction) =>
      service.projectPersisted(transaction, first.candidateId, first.rawRevisionId))
    const secondFindingId = await database.transaction((transaction) =>
      service.projectPersisted(transaction, second.candidateId, second.rawRevisionId))
    expect(firstFindingId).toEqual(expect.any(String))
    expect(secondFindingId).toEqual(expect.any(String))
    if (!firstFindingId || !secondFindingId) throw new Error('Expected projected finding identities')
    const conflict = await seedPassedCanonicalCandidate(database, 'conflict', {
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

})

async function createTestDatabase() {
  return resettableDatabase()
}
