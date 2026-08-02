import { and, count, eq, ne, or } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  getTestLocalValedictorianDatabase,
  useResettablePgliteTestLocalValedictorianClient,
} from '../../runtime/local-valedictorian-client.test-harness'
import {
  companyDuplicateCandidateReviews,
  companyDuplicateCandidates,
  companyDuplicateIndexState,
  companyDuplicateMaintenanceWork,
  workspaceCompanies,
} from '@sparxie/valedictorian-local-runtime/testing/modules/company/company.schema'
import { COMPANY_DUPLICATE_MATCHER_VERSION } from '@sparxie/valedictorian-local-runtime/testing/modules/company/company.duplicate-scorer'
import { enqueueCompanyDuplicateReconsideration } from '@sparxie/valedictorian-local-runtime/testing/modules/company/company.duplicate-maintenance'

const createClient = useResettablePgliteTestLocalValedictorianClient()
const WORKSPACE = 'company-duplicates-workspace'
const ACTOR = { id: 'duplicate-reviewer', type: 'user' as const }

function context(idempotencyKey: string) {
  return {
    workspaceId: WORKSPACE,
    actor: ACTOR,
    rationale: 'Review possible duplicate Companies.',
    idempotencyKey,
  }
}

describe.sequential('Company duplicate candidates', () => {
  it('scores deterministic pairs and pages the separate review queue', async () => {
    const client = await createClient({ workspaceId: WORKSPACE })
    for (const [index, displayName] of [
      'Acme Incorporated',
      'Acme Inc',
      'Acme Corporation',
    ].entries()) {
      const result = await client.companies.create({
        ...context(`create-acme-${index}`),
        displayName,
        websiteUrl: 'https://acme.example/careers',
        notes: null,
      })
      expect(result.status).toBe('created')
    }

    const first = await client.companies.duplicates.list({
      filter: 'open',
      sort: 'score_desc',
      limit: 1,
    })
    expect(first.totalCount).toBe(3)
    expect(first.items).toHaveLength(1)
    expect(first.items[0]).toMatchObject({
      score: 1,
      reasons: expect.arrayContaining([
        { code: 'same_declared_domain', label: 'The declared website domain matches.' },
      ]),
      status: 'open',
    })
    expect(first.items[0]!.left.companyId < first.items[0]!.right.companyId).toBe(true)
    expect(first.pageInfo).toMatchObject({
      hasPreviousPage: false,
      hasNextPage: true,
    })
    if (!first.pageInfo.endCursor) throw new Error('expected duplicate next cursor')

    const second = await client.companies.duplicates.list({
      filter: 'open',
      sort: 'score_desc',
      limit: 1,
      after: first.pageInfo.endCursor,
    })
    expect(second.items).toHaveLength(1)
    expect(second.items[0]!.candidateId).not.toBe(first.items[0]!.candidateId)
    expect(second.pageInfo.hasPreviousPage).toBe(true)
    if (!second.pageInfo.startCursor) throw new Error('expected duplicate previous cursor')
    const previous = await client.companies.duplicates.list({
      filter: 'open',
      sort: 'score_desc',
      limit: 1,
      before: second.pageInfo.startCursor,
    })
    expect(previous.items[0]!.candidateId).toBe(first.items[0]!.candidateId)

    expect(await client.companies.duplicates.get(first.items[0]!.candidateId))
      .toEqual(first.items[0])
    const stable = await client.companies.duplicates.list({
      filter: 'open',
      sort: 'score_desc',
      limit: 10,
    })
    expect(stable.items.map((candidate) => ({
      id: candidate.candidateId,
      revision: candidate.candidateRevision,
      score: candidate.score,
      reasons: candidate.reasons,
    }))).toEqual((await client.companies.duplicates.list({
      filter: 'open',
      sort: 'score_desc',
      limit: 10,
    })).items.map((candidate) => ({
      id: candidate.candidateId,
      revision: candidate.candidateRevision,
      score: candidate.score,
      reasons: candidate.reasons,
    })))

    const database = getTestLocalValedictorianDatabase(client)
    await database.update(companyDuplicateIndexState).set({
      matcherVersion: 'retired-matcher',
      status: 'ready',
    }).where(eq(companyDuplicateIndexState.workspaceId, WORKSPACE))
    await client.companies.duplicates.list({
      filter: 'open',
      sort: 'score_desc',
      limit: 10,
    })
    const [indexState] = await database
      .select()
      .from(companyDuplicateIndexState)
      .where(eq(companyDuplicateIndexState.workspaceId, WORKSPACE))
    expect(indexState).toMatchObject({
      matcherVersion: COMPANY_DUPLICATE_MATCHER_VERSION,
      status: 'ready',
    })
  })

  it('records a distinct decision, suppresses unchanged inputs, and reopens changed pairs', async () => {
    const client = await createClient({ workspaceId: WORKSPACE })
    for (const [key, displayName] of [
      ['left', 'Northstar Robotics'],
      ['right', 'Northstar Robotix'],
    ] as const) {
      const result = await client.companies.create({
        ...context(`create-${key}`),
        displayName,
        websiteUrl: 'https://northstar.example/jobs',
        notes: null,
      })
      expect(result.status).toBe('created')
    }
    const [candidate] = (await client.companies.duplicates.list({
      filter: 'open',
      sort: 'score_desc',
      limit: 10,
    })).items
    if (!candidate) throw new Error('expected duplicate candidate')
    const input = {
      ...context('mark-distinct'),
      candidateId: candidate.candidateId,
      expectedCandidateRevision: candidate.candidateRevision,
      leftCompanyId: candidate.left.companyId,
      expectedLeftCompanyRevision: candidate.left.revision,
      rightCompanyId: candidate.right.companyId,
      expectedRightCompanyRevision: candidate.right.revision,
    }
    const marked = await client.companies.duplicates.markDistinct(input)
    expect(marked).toMatchObject({
      status: 'marked_distinct',
      candidate: {
        candidateId: candidate.candidateId,
        candidateRevision: candidate.candidateRevision + 1,
        status: 'marked_distinct',
      },
    })
    expect(await client.companies.duplicates.markDistinct(input)).toEqual(marked)
    expect(await client.companies.duplicates.markDistinct({
      ...input,
      idempotencyKey: 'mark-distinct-stale-candidate',
    })).toMatchObject({
      status: 'blocked',
      failure: {
        kind: 'stale_guard',
        recovery: {
          guards: [{
            kind: 'duplicate_candidate_revision',
            candidateId: candidate.candidateId,
            currentRevision: candidate.candidateRevision + 1,
          }],
        },
      },
    })
    expect((await client.companies.duplicates.list({
      filter: 'open',
      sort: 'score_desc',
      limit: 10,
    })).items).toEqual([])
    expect((await client.companies.duplicates.list({
      filter: 'all',
      sort: 'score_desc',
      limit: 10,
    })).items[0]).toMatchObject({
      candidateId: candidate.candidateId,
      status: 'marked_distinct',
    })

    const database = getTestLocalValedictorianDatabase(client)
    const [reviewCount] = await database
      .select({ value: count() })
      .from(companyDuplicateCandidateReviews)
      .where(eq(companyDuplicateCandidateReviews.candidateId, candidate.candidateId))
    expect(Number(reviewCount?.value)).toBe(1)

    const changed = await client.companies.update({
      ...context('change-left-input'),
      companyId: candidate.left.companyId,
      expectedCompanyRevision: candidate.left.revision,
      displayName: 'Northstar Robotics Group',
    })
    expect(changed.status).toBe('updated')
    const reopened = (await client.companies.duplicates.list({
      filter: 'open',
      sort: 'score_desc',
      limit: 10,
    })).items[0]
    expect(reopened).toMatchObject({
      candidateId: candidate.candidateId,
      candidateRevision: candidate.candidateRevision + 2,
      status: 'open',
    })
    expect((await client.companies.get(candidate.left.companyId))
      .openDuplicateCandidateCount).toBe(1)
    expect((await client.companies.directory.list({
      filter: 'active',
      sort: 'display_name_asc',
      limit: 10,
    })).items.map((company) => company.openDuplicateCandidateCount)).toEqual([1, 1])
  })

  it('guards stale reviews and hides archived pairs without deleting them', async () => {
    const client = await createClient({ workspaceId: WORKSPACE })
    const left = await client.companies.create({
      ...context('create-archive-left'),
      displayName: 'Orbit Labs',
      websiteUrl: 'https://orbit.example',
      notes: null,
    })
    const right = await client.companies.create({
      ...context('create-archive-right'),
      displayName: 'Orbit Laboratory',
      websiteUrl: 'https://orbit.example',
      notes: null,
    })
    if (left.status !== 'created' || right.status !== 'created') {
      throw new Error('expected Companies')
    }
    const candidate = (await client.companies.duplicates.list({
      filter: 'open',
      sort: 'score_desc',
      limit: 10,
    })).items[0]!
    const updated = await client.companies.update({
      ...context('stale-left'),
      companyId: candidate.left.companyId,
      expectedCompanyRevision: candidate.left.revision,
      displayName: 'Orbit Labs International',
    })
    if (updated.status !== 'updated') throw new Error('expected Company update')
    expect(await client.companies.duplicates.markDistinct({
      ...context('stale-review'),
      candidateId: candidate.candidateId,
      expectedCandidateRevision: candidate.candidateRevision,
      leftCompanyId: candidate.left.companyId,
      expectedLeftCompanyRevision: candidate.left.revision,
      rightCompanyId: candidate.right.companyId,
      expectedRightCompanyRevision: candidate.right.revision,
    })).toMatchObject({
      status: 'blocked',
      failure: {
        kind: 'stale_guard',
        recovery: {
          action: 'refresh_and_resubmit',
          guards: [{
            kind: 'company_revision',
            companyId: candidate.left.companyId,
            currentRevision: updated.company.revision,
          }],
        },
      },
    })
    const staleSignals = await client.companies.duplicates.get(candidate.candidateId)
    expect(await client.companies.duplicates.markDistinct({
      ...context('stale-signals-review'),
      candidateId: staleSignals.candidateId,
      expectedCandidateRevision: staleSignals.candidateRevision,
      leftCompanyId: staleSignals.left.companyId,
      expectedLeftCompanyRevision: staleSignals.left.revision,
      rightCompanyId: staleSignals.right.companyId,
      expectedRightCompanyRevision: staleSignals.right.revision,
    })).toMatchObject({
      status: 'blocked',
      failure: {
        kind: 'lifecycle_failure',
        blocker: {
          code: 'impossible_state',
          message: 'The duplicate signals changed. Refresh and review the pair again.',
        },
      },
    })

    const current = (await client.companies.duplicates.list({
      filter: 'open',
      sort: 'score_desc',
      limit: 10,
    })).items[0]!
    const archived = await client.companies.archive({
      ...context('archive-left'),
      companyId: current.left.companyId,
      expectedCompanyRevision: current.left.revision,
    })
    expect(archived.status).toBe('archived')
    expect((await client.companies.duplicates.list({
      filter: 'open',
      sort: 'score_desc',
      limit: 10,
    })).items).toEqual([])
    expect((await client.companies.duplicates.list({
      filter: 'all',
      sort: 'score_desc',
      limit: 10,
    })).items[0]).toMatchObject({
      candidateId: current.candidateId,
      left: { status: 'archived' },
    })
    expect((await client.companies.get(current.right.companyId))
      .openDuplicateCandidateCount).toBe(0)
    if (archived.status !== 'archived') throw new Error('expected archive')
    await client.companies.restore({
      ...context('restore-left'),
      companyId: archived.company.id,
      expectedCompanyRevision: archived.company.revision,
    })
    expect((await client.companies.duplicates.list({
      filter: 'open',
      sort: 'score_desc',
      limit: 10,
    })).items).toHaveLength(1)
    expect((await client.companies.get(current.right.companyId))
      .openDuplicateCandidateCount).toBe(1)
  })

  it('processes the maintenance journal in bounded resumable batches', async () => {
    const client = await createClient({ workspaceId: WORKSPACE })
    for (let index = 0; index < 24; index += 1) {
      const result = await client.companies.create({
        ...context(`bounded-${index}`),
        displayName: `Unique Company ${index.toString().padStart(2, '0')}`,
        websiteUrl: null,
        notes: null,
      })
      expect(result.status).toBe('created')
    }
    await client.companies.duplicates.list({
      filter: 'open',
      sort: 'score_desc',
      limit: 10,
    })
    const database = getTestLocalValedictorianDatabase(client)
    const [remainingAfterOneRun] = await database
      .select({ value: count() })
      .from(companyDuplicateMaintenanceWork)
      .where(and(
        eq(companyDuplicateMaintenanceWork.workspaceId, WORKSPACE),
        ne(companyDuplicateMaintenanceWork.status, 'idle'),
      ))
    expect(Number(remainingAfterOneRun?.value)).toBe(4)
    await client.companies.duplicates.list({
      filter: 'open',
      sort: 'score_desc',
      limit: 10,
    })
    const [remainingAfterResume] = await database
      .select({ value: count() })
      .from(companyDuplicateMaintenanceWork)
      .where(and(
        eq(companyDuplicateMaintenanceWork.workspaceId, WORKSPACE),
        ne(companyDuplicateMaintenanceWork.status, 'idle'),
      ))
    expect(Number(remainingAfterResume?.value)).toBe(0)
  })

  it('never lowers a newer queued Company revision', async () => {
    const client = await createClient({ workspaceId: WORKSPACE })
    const created = await client.companies.create({
      ...context('monotonic-create'),
      displayName: 'Monotonic Company',
      websiteUrl: null,
      notes: null,
    })
    if (created.status !== 'created') throw new Error('expected Company')
    const updated = await client.companies.update({
      ...context('monotonic-update'),
      companyId: created.company.id,
      expectedCompanyRevision: created.company.revision,
      displayName: 'Monotonic Company Two',
    })
    if (updated.status !== 'updated') throw new Error('expected Company update')
    const database = getTestLocalValedictorianDatabase(client)
    await database.transaction((tx) => enqueueCompanyDuplicateReconsideration(
      tx,
      {
        workspaceId: WORKSPACE,
        id: created.company.id,
        revision: 1,
      },
      '2026-07-23T18:00:00.000Z',
    ))
    const [work] = await database
      .select()
      .from(companyDuplicateMaintenanceWork)
      .where(and(
        eq(companyDuplicateMaintenanceWork.workspaceId, WORKSPACE),
        eq(companyDuplicateMaintenanceWork.companyId, created.company.id),
      ))
    expect(work).toMatchObject({
      requestedRevision: updated.company.revision,
      status: 'pending',
    })
    const [company] = await database
      .select()
      .from(workspaceCompanies)
      .where(eq(workspaceCompanies.id, created.company.id))
    expect(company?.revision).toBe(updated.company.revision)
  })

  it('enforces the candidate cap across fan-in from other subjects', async () => {
    const client = await createClient({ workspaceId: WORKSPACE })
    const database = getTestLocalValedictorianDatabase(client)
    const timestamp = '2026-07-23T18:00:00.000Z'
    const targetId = testUuid('018f0000', 0)
    const partnerIds = Array.from({ length: 301 }, (_, index) =>
      testUuid('018f0000', index + 1))
    await database.insert(workspaceCompanies).values([
      targetId,
      ...partnerIds,
    ].map((id, index) => ({
      id,
      workspaceId: WORKSPACE,
      displayName: `Shared Signal ${index}`,
      normalizedDisplayName: 'shared signal',
      websiteUrl: 'https://shared-signal.example',
      websiteHost: 'shared-signal.example',
      notes: null,
      revision: 1,
      status: 'active',
      mergedIntoCompanyId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })))
    await database.insert(companyDuplicateCandidates).values(
      partnerIds.slice(0, 300).map((partnerId, index) => ({
        id: testUuid('01900000', index),
        workspaceId: WORKSPACE,
        lowerCompanyId: targetId,
        higherCompanyId: partnerId,
        revision: 1,
        score: 10_000,
        reasonCodesJson: JSON.stringify(['same_declared_domain']),
        matcherVersion: COMPANY_DUPLICATE_MATCHER_VERSION,
        lowerInputFingerprint: 'a'.repeat(64),
        higherInputFingerprint: 'b'.repeat(64),
        status: 'open',
        createdAt: timestamp,
        updatedAt: timestamp,
      })),
    )
    await database.insert(companyDuplicateIndexState).values({
      workspaceId: WORKSPACE,
      matcherVersion: COMPANY_DUPLICATE_MATCHER_VERSION,
      afterCompanyId: partnerIds.at(-1)!,
      status: 'ready',
      updatedAt: timestamp,
    })
    await database.transaction((tx) => enqueueCompanyDuplicateReconsideration(
      tx,
      {
        workspaceId: WORKSPACE,
        id: partnerIds.at(-1)!,
        revision: 1,
      },
      timestamp,
    ))

    await client.companies.duplicates.list({
      filter: 'all',
      sort: 'score_desc',
      limit: 10,
    })
    const [targetCount] = await database
      .select({ value: count() })
      .from(companyDuplicateCandidates)
      .where(and(
        eq(companyDuplicateCandidates.workspaceId, WORKSPACE),
        or(
          eq(companyDuplicateCandidates.lowerCompanyId, targetId),
          eq(companyDuplicateCandidates.higherCompanyId, targetId),
        ),
      ))
    expect(Number(targetCount?.value)).toBe(300)
    const [overflowPair] = await database
      .select()
      .from(companyDuplicateCandidates)
      .where(and(
        eq(companyDuplicateCandidates.workspaceId, WORKSPACE),
        eq(companyDuplicateCandidates.lowerCompanyId, targetId),
        eq(companyDuplicateCandidates.higherCompanyId, partnerIds.at(-1)!),
      ))
    expect(overflowPair).toBeUndefined()
  })
})

function testUuid(prefix: string, value: number) {
  return `${prefix}-0000-7000-8000-${value.toString(16).padStart(12, '0')}`
}
