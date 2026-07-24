import { describe, expect, it } from 'vitest'
import { mergeCompaniesResultSchema } from '@sparxie/sdk'
import {
  useResettablePgliteTestLocalValedictorianClient,
} from '../../runtime/local-valedictorian-client.test-harness'

const createClient = useResettablePgliteTestLocalValedictorianClient()
const WORKSPACE = 'company-merge-workspace'
const ACTOR = { id: 'company-merger', type: 'user' as const }

function context(idempotencyKey: string) {
  return {
    workspaceId: WORKSPACE,
    actor: ACTOR,
    rationale: 'Consolidate duplicate workspace identities.',
    idempotencyKey,
  }
}

describe.sequential('manual Company merge', () => {
  it('moves assignments, preserves records, flattens redirects, and resolves candidates', async () => {
    const client = await createClient({ workspaceId: WORKSPACE })
    const winner = await createCompany(client, 'winner', 'Northstar Robotics', 'Winner notes.')
    const loser = await createCompany(client, 'loser', 'Northstar Robotix', 'Loser notes.')
    const predecessor = await createCompany(
      client,
      'predecessor',
      'Northstar Robotics LLC',
      'Predecessor notes.',
    )
    const aliasResult = await client.companies.aliases.add({
      ...context('loser-alias'),
      companyId: loser.companyId,
      expectedCompanyRevision: 1,
      value: 'Northstar RBTX',
    })
    if (aliasResult.status !== 'updated') throw new Error('expected alias update')
    await client.companies.duplicates.list({
      filter: 'open',
      sort: 'score_desc',
      limit: 50,
    })
    const job = await createJob(client, 'Asserted Northstar name', 'Platform Engineer')
    const assignment = await client.companyAssignments.reassign({
      ...context('assign-to-loser'),
      jobId: job.id,
      expectedAssignmentRevision: 1,
      destinationCompanyId: loser.companyId,
      expectedDestinationCompanyRevision: 2,
    })
    expect(assignment.status).toBe('reassigned')

    const firstInput = {
      ...context('merge-predecessor'),
      winnerCompanyId: loser.companyId,
      expectedWinnerCompanyRevision: 2,
      loserCompanyId: predecessor.companyId,
      expectedLoserCompanyRevision: 1,
      loserDisplayNameConfirmation: predecessor.company.displayName,
      acknowledgeNoUndo: true as const,
    }
    const first = await client.companies.duplicates.merge(firstInput)
    expect(first.status).toBe('merged')
    expect(await client.companies.duplicates.merge(firstInput)).toEqual(first)
    if (first.status !== 'merged') throw new Error('expected first merge')

    const second = await client.companies.duplicates.merge({
      ...context('merge-loser'),
      winnerCompanyId: winner.companyId,
      expectedWinnerCompanyRevision: 1,
      loserCompanyId: loser.companyId,
      expectedLoserCompanyRevision: first.canonical.revision,
      loserDisplayNameConfirmation: loser.company.displayName,
      acknowledgeNoUndo: true,
    })
    expect(() => mergeCompaniesResultSchema.parse(second)).not.toThrow()
    expect(second).toMatchObject({
      status: 'merged',
      canonical: {
        id: winner.companyId,
        status: 'active',
        notes: 'Winner notes.',
      },
      merged: {
        id: loser.companyId,
        status: 'merged',
        mergedIntoCompanyId: winner.companyId,
        notes: 'Loser notes.',
      },
      redirectPath: [winner.companyId],
      reassignedJobCount: 1,
      flattenedRedirectCount: 1,
      historyPreserved: true,
      notesPreserved: { winner: true, loser: true },
    })
    if (second.status !== 'merged') throw new Error('expected second merge')
    expect(second.canonical.aliases.map((alias) => alias.value)).toEqual(
      expect.arrayContaining([
        'Northstar Robotix',
        'Northstar RBTX',
        'Northstar Robotics LLC',
      ]),
    )
    expect(await client.companies.lookup(loser.companyId)).toMatchObject({
      requested: { id: loser.companyId, status: 'merged', notes: 'Loser notes.' },
      canonical: { id: winner.companyId },
      redirectPath: [winner.companyId],
    })
    expect(await client.companies.lookup(predecessor.companyId)).toMatchObject({
      requested: {
        id: predecessor.companyId,
        status: 'merged',
        notes: 'Predecessor notes.',
      },
      canonical: { id: winner.companyId },
      redirectPath: [winner.companyId],
    })
    expect(await client.companyAssignments.get(job.id)).toMatchObject({
      assignmentRevision: 3,
      workspaceCompany: { companyId: winner.companyId },
      jobFactsCompanyName: 'Asserted Northstar name',
    })
    expect((await client.jobs.get(job.id))?.facts).toMatchObject({
      companyName: 'Asserted Northstar name',
    })

    const loserHistory = await client.companies.history.list(loser.companyId, {
      filter: 'all',
      sort: 'occurred_desc',
      limit: 50,
    })
    expect(loserHistory.items.map((event) => event.kind)).toEqual(
      expect.arrayContaining(['created', 'alias_added', 'merged']),
    )
    const allCandidates = await client.companies.duplicates.list({
      filter: 'all',
      sort: 'score_desc',
      limit: 50,
    })
    const resolved = allCandidates.items.filter((candidate) =>
      candidate.status === 'resolved_by_merge')
    expect(resolved.length).toBeGreaterThan(0)
    expect(await client.companies.duplicates.get(resolved[0]!.candidateId))
      .toEqual(resolved[0])
  })

  it('requires exact confirmation and serializes reassignment against merge', async () => {
    const client = await createClient({ workspaceId: WORKSPACE })
    const winner = await createCompany(client, 'serial-winner', 'Serial Winner', null)
    const loser = await createCompany(client, 'serial-loser', 'Serial Loser', null)
    expect(await client.companies.duplicates.merge({
      ...context('wrong-confirmation'),
      winnerCompanyId: winner.companyId,
      expectedWinnerCompanyRevision: 1,
      loserCompanyId: loser.companyId,
      expectedLoserCompanyRevision: 1,
      loserDisplayNameConfirmation: 'serial loser',
      acknowledgeNoUndo: true,
    })).toMatchObject({
      status: 'blocked',
      failure: {
        kind: 'lifecycle_failure',
        blocker: {
          code: 'invalid_input',
          field: 'loserDisplayNameConfirmation',
        },
      },
    })
    const bumpedWinner = await client.companies.notes.update({
      ...context('bump-serial-winner'),
      companyId: winner.companyId,
      expectedCompanyRevision: 1,
      notes: 'Revision changed before merge.',
    })
    expect(bumpedWinner.status).toBe('updated')
    expect(await client.companies.duplicates.merge({
      ...context('stale-merge'),
      winnerCompanyId: winner.companyId,
      expectedWinnerCompanyRevision: 1,
      loserCompanyId: loser.companyId,
      expectedLoserCompanyRevision: 1,
      loserDisplayNameConfirmation: loser.company.displayName,
      acknowledgeNoUndo: true,
    })).toMatchObject({
      status: 'blocked',
      failure: {
        kind: 'stale_guard',
        recovery: {
          action: 'refresh_and_resubmit',
          guards: [{
            kind: 'company_revision',
            companyId: winner.companyId,
            expectedRevision: 1,
            currentRevision: 2,
          }],
        },
      },
    })
    const job = await createJob(client, 'Serial posting fact', 'Serial Engineer')
    const [merged, reassigned] = await Promise.all([
      client.companies.duplicates.merge({
        ...context('serial-merge'),
        winnerCompanyId: winner.companyId,
        expectedWinnerCompanyRevision: 2,
        loserCompanyId: loser.companyId,
        expectedLoserCompanyRevision: 1,
        loserDisplayNameConfirmation: loser.company.displayName,
        acknowledgeNoUndo: true,
      }),
      client.companyAssignments.reassign({
        ...context('serial-reassign'),
        jobId: job.id,
        expectedAssignmentRevision: 1,
        destinationCompanyId: loser.companyId,
        expectedDestinationCompanyRevision: 1,
      }),
    ])
    expect(merged.status).toBe('merged')
    const current = await client.companyAssignments.get(job.id)
    expect(current.workspaceCompany.companyId).not.toBe(loser.companyId)
    if (reassigned.status === 'reassigned') {
      expect(current.workspaceCompany.companyId).toBe(winner.companyId)
    }
  })

  it('serializes duplicate maintenance so no candidate can appear after merge scanning', async () => {
    const client = await createClient({ workspaceId: WORKSPACE })
    for (let index = 0; index < 3; index += 1) {
      const websiteUrl = `https://merge-race-${index}.example`
      const winner = await createCompany(
        client,
        `race-winner-${index}`,
        `Orchid ${index} Holdings`,
        null,
        websiteUrl,
      )
      const loser = await createCompany(
        client,
        `race-loser-${index}`,
        `Quartz ${index} Group`,
        null,
        websiteUrl,
      )
      const [merged] = await Promise.all([
        client.companies.duplicates.merge({
          ...context(`race-merge-${index}`),
          winnerCompanyId: winner.companyId,
          expectedWinnerCompanyRevision: 1,
          loserCompanyId: loser.companyId,
          expectedLoserCompanyRevision: 1,
          loserDisplayNameConfirmation: loser.company.displayName,
          acknowledgeNoUndo: true,
        }),
        client.companies.duplicates.list({
          filter: 'open',
          sort: 'score_desc',
          limit: 50,
        }),
      ])
      expect(merged.status).toBe('merged')
      const all = await client.companies.duplicates.list({
        filter: 'all',
        sort: 'score_desc',
        limit: 50,
      })
      expect(all.items.filter((candidate) =>
        candidate.left.companyId === loser.companyId
        || candidate.right.companyId === loser.companyId,
      ).every((candidate) => candidate.status === 'resolved_by_merge')).toBe(true)
    }
  })
})

async function createCompany(
  client: Awaited<ReturnType<typeof createClient>>,
  key: string,
  displayName: string,
  notes: string | null,
  websiteUrl = 'https://northstar.example',
) {
  const result = await client.companies.create({
    ...context(`create-${key}`),
    displayName,
    websiteUrl,
    notes,
  })
  if (result.status !== 'created') throw new Error('expected Company')
  return result
}

async function createJob(
  client: Awaited<ReturnType<typeof createClient>>,
  companyName: string,
  roleTitle: string,
) {
  const capture = await client.captures.create({
    evidenceMode: 'reported',
    adapter: { id: 'merge-test', kind: 'cli', version: '1.0.0' },
    observedAt: '2026-07-23T00:00:00.000Z',
    providerRecordId: null,
    providerSchema: null,
    payload: null,
    evidence: [{ kind: 'title', label: 'Title', value: roleTitle }],
  })
  if (capture.status !== 'succeeded') throw new Error('expected Capture')
  const job = await client.jobs.create({
    idempotencyKey: `job-${roleTitle}`,
    actor: ACTOR,
    facts: {
      companyName,
      roleTitle,
      sourceName: 'manual',
      roleKind: 'experienced',
      term: null,
      terms: [],
      timingMode: 'unknown',
      startDate: null,
      endDate: null,
      location: null,
      workMode: 'remote',
      employmentType: 'full_time',
      seniority: 'senior',
      compensation: null,
      postedAt: null,
      destination: null,
    },
    availability: {
      state: 'open',
      observedAt: '2026-07-23T00:00:00.000Z',
    },
    evidenceReferences: [{
      captureId: capture.resource.id,
      captureRevision: capture.resource.revision,
      evidenceIndexes: [0],
    }],
    externalIdentities: [],
  })
  if (job.status !== 'succeeded') throw new Error('expected Job')
  return job.resource
}
