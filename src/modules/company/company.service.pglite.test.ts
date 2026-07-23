import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  getTestLocalValedictorianDatabase,
  useResettablePgliteTestLocalValedictorianClient,
} from '../../runtime/local-valedictorian-client.test-harness'
import { jobs } from '../job/job.schema'
import { workspaceCompanies } from './company.schema'

const createClient = useResettablePgliteTestLocalValedictorianClient()
const WORKSPACE = 'company-service-workspace'
const ACTOR = { id: 'company-user', type: 'user' as const }

function context(idempotencyKey: string) {
  return {
    workspaceId: WORKSPACE,
    actor: ACTOR,
    rationale: 'Maintain the workspace Company directory.',
    idempotencyKey,
  }
}

describe.sequential('Workspace Company service', () => {
  it('creates idempotently and owns direct, search, preview, and directory reads', async () => {
    const client = await createClient({ workspaceId: WORKSPACE })
    const input = {
      ...context('create-northstar'),
      displayName: 'Northstar Robotics',
      websiteUrl: 'https://northstar.example/careers',
      notes: 'Robotics hiring team.',
    }
    const created = await client.companies.create(input)
    const replay = await client.companies.create(input)
    expect(created).toEqual(replay)
    await expect(client.companies.create({
      ...input,
      displayName: 'Different Company',
    })).rejects.toMatchObject({ statusCode: 409 })
    expect(created.status).toBe('created')
    if (created.status !== 'created') throw new Error('expected created Company')

    expect(await client.companies.get(created.company.id)).toMatchObject({
      lookup: {
        requested: {
          id: created.company.id,
          displayName: 'Northstar Robotics',
          websiteUrl: 'https://northstar.example/careers',
        },
        canonical: { id: created.company.id },
        redirectPath: [],
      },
      assignedJobCount: 0,
      openDuplicateCandidateCount: 0,
    })
    expect(await client.companies.lookup(created.company.id)).toMatchObject({
      requested: { id: created.company.id },
      canonical: { id: created.company.id },
      redirectPath: [],
    })
    expect(await client.companies.search({
      query: 'northstar',
      scope: 'active',
      limit: 20,
    })).toMatchObject({
      items: [{ companyId: created.company.id, assignedJobCount: 0 }],
      truncated: false,
    })
    expect(await client.companies.previewMatches({
      displayName: 'Northstar Robotics',
      websiteUrl: 'https://northstar.example',
      limit: 20,
    })).toMatchObject({
      items: [{
        companyId: created.company.id,
        score: 1,
        reasons: expect.arrayContaining([
          expect.objectContaining({ code: 'normalized_name_similarity' }),
          expect.objectContaining({ code: 'same_declared_domain' }),
        ]),
      }],
      truncated: false,
    })
    expect(await client.companies.directory.list({
      filter: 'all',
      sort: 'display_name_asc',
      limit: 50,
    })).toMatchObject({
      items: [{
        companyId: created.company.id,
        websiteHost: 'northstar.example',
        canonicalCompanyId: created.company.id,
      }],
      totalCount: 1,
    })

    const second = await client.companies.create({
      ...context('create-zeta'),
      displayName: 'Zeta Systems',
      websiteUrl: null,
      notes: null,
    })
    if (second.status !== 'created') throw new Error('expected second Company')
    const firstPage = await client.companies.directory.list({
      filter: 'all',
      sort: 'display_name_asc',
      limit: 1,
    })
    expect(firstPage.items.map((item) => item.displayName)).toEqual(['Northstar Robotics'])
    expect(firstPage.pageInfo).toMatchObject({
      hasPreviousPage: false,
      hasNextPage: true,
    })
    if (!firstPage.pageInfo.endCursor) throw new Error('expected next cursor')
    const secondPage = await client.companies.directory.list({
      filter: 'all',
      sort: 'display_name_asc',
      limit: 1,
      after: firstPage.pageInfo.endCursor,
    })
    expect(secondPage.items.map((item) => item.displayName)).toEqual(['Zeta Systems'])
    expect(secondPage.pageInfo.hasPreviousPage).toBe(true)
    if (!secondPage.pageInfo.startCursor) throw new Error('expected previous cursor')
    expect((await client.companies.directory.list({
      filter: 'all',
      sort: 'display_name_asc',
      limit: 1,
      before: secondPage.pageInfo.startCursor,
    })).items.map((item) => item.displayName)).toEqual(['Northstar Robotics'])
  })

  it('guards revisions across identity, notes, aliases, archive, and restore', async () => {
    const client = await createClient({ workspaceId: WORKSPACE })
    const created = await client.companies.create({
      ...context('create-guarded'),
      displayName: 'Guarded Company',
      websiteUrl: null,
      notes: null,
    })
    if (created.status !== 'created') throw new Error('expected created Company')
    const companyId = created.company.id

    const updated = await client.companies.update({
      ...context('update-guarded'),
      companyId,
      expectedCompanyRevision: 1,
      displayName: 'Guarded Company Labs',
      websiteUrl: 'https://guarded.example',
    })
    expect(updated).toMatchObject({ status: 'updated', company: { revision: 2 } })
    const stale = await client.companies.update({
      ...context('stale-guarded'),
      companyId,
      expectedCompanyRevision: 1,
      displayName: 'Stale name',
    })
    expect(stale).toMatchObject({
      status: 'blocked',
      failure: {
        kind: 'stale_guard',
        recovery: {
          action: 'refresh_and_resubmit',
          guards: [{ kind: 'company_revision', currentRevision: 2 }],
        },
      },
    })

    const aliasAdded = await client.companies.aliases.add({
      ...context('alias-add'),
      companyId,
      expectedCompanyRevision: 2,
      value: 'Guarded Co.',
    })
    if (aliasAdded.status !== 'updated') throw new Error('expected alias update')
    const alias = aliasAdded.company.aliases[0]
    if (!alias) throw new Error('expected alias')
    const aliasUpdated = await client.companies.aliases.update({
      ...context('alias-update'),
      companyId,
      expectedCompanyRevision: 3,
      aliasId: alias.id,
      value: 'Guarded Incorporated',
    })
    expect(aliasUpdated).toMatchObject({
      status: 'updated',
      company: { revision: 4, aliases: [{ value: 'Guarded Incorporated' }] },
    })
    const notes = await client.companies.notes.update({
      ...context('notes-update'),
      companyId,
      expectedCompanyRevision: 4,
      notes: 'Updated operator notes.',
    })
    expect(notes).toMatchObject({
      status: 'updated',
      company: { revision: 5, notes: 'Updated operator notes.' },
    })
    const removed = await client.companies.aliases.remove({
      ...context('alias-remove'),
      companyId,
      expectedCompanyRevision: 5,
      aliasId: alias.id,
    })
    expect(removed).toMatchObject({
      status: 'updated',
      company: { revision: 6, aliases: [] },
    })
    const archived = await client.companies.archive({
      ...context('archive-company'),
      companyId,
      expectedCompanyRevision: 6,
    })
    expect(archived).toMatchObject({
      status: 'archived',
      company: { revision: 7, status: 'archived' },
    })
    expect((await client.companies.search({
      query: 'guarded',
      scope: 'active',
      limit: 20,
    })).items).toEqual([])
    const restored = await client.companies.restore({
      ...context('restore-company'),
      companyId,
      expectedCompanyRevision: 7,
    })
    expect(restored).toMatchObject({
      status: 'restored',
      company: { revision: 8, status: 'active' },
    })
    expect((await client.companies.history.list(companyId, {
      filter: 'all',
      sort: 'occurred_desc',
      limit: 50,
    })).items.map((event) => event.kind)).toEqual([
      'restored',
      'archived',
      'alias_removed',
      'updated',
      'alias_updated',
      'alias_added',
      'updated',
      'created',
    ])
  })

  it('blocks wrong-workspace writes without creating a Company', async () => {
    const client = await createClient({ workspaceId: WORKSPACE })
    expect(await client.companies.create({
      ...context('foreign-create'),
      workspaceId: 'another-workspace',
      displayName: 'Foreign Company',
      websiteUrl: null,
      notes: null,
    })).toMatchObject({
      status: 'blocked',
      failure: {
        kind: 'lifecycle_failure',
        blocker: { code: 'workspace_ownership' },
      },
    })
    expect((await client.companies.directory.list({
      filter: 'all',
      sort: 'display_name_asc',
      limit: 50,
    })).totalCount).toBe(0)
  })

  it('projects assigned Job links from assignment state without rewriting Job facts', async () => {
    const client = await createClient({ workspaceId: WORKSPACE })
    const capture = await client.captures.create({
      evidenceMode: 'reported',
      adapter: { id: 'company-test', kind: 'cli', version: '1.0.0' },
      observedAt: '2026-07-23T00:00:00.000Z',
      providerRecordId: null,
      providerSchema: null,
      payload: null,
      evidence: [{ kind: 'title', label: 'Title', value: 'Platform Engineer' }],
    })
    if (capture.status !== 'succeeded') throw new Error('expected Capture')
    const job = await client.jobs.create({
      idempotencyKey: 'company-assigned-job',
      actor: ACTOR,
      facts: {
        companyName: 'Asserted Posting Name',
        roleTitle: 'Platform Engineer',
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
    const database = getTestLocalValedictorianDatabase(client)
    await database.update(jobs).set({
      factsJson: JSON.stringify({
        companyName: 'Legacy asserted name',
        roleTitle: 'Legacy platform role',
      }),
    }).where(eq(jobs.id, job.resource.id))
    const page = await client.companies.assignedJobs.list(job.resource.id, {
      filter: 'all',
      sort: 'role_title_asc',
      limit: 50,
    })
    expect(page).toMatchObject({
      items: [{
        jobId: job.resource.id,
        roleTitle: 'Legacy platform role',
        jobFactsCompanyName: 'Legacy asserted name',
        namesDiffer: true,
      }],
      totalCount: 1,
    })
    expect((await client.companies.get(job.resource.id)).assignedJobCount).toBe(1)
    expect((await client.companies.search({
      query: 'asserted posting',
      scope: 'active',
      limit: 20,
    })).items[0]).toMatchObject({ companyId: job.resource.id, assignedJobCount: 1 })
    expect((await client.companies.directory.list({
      filter: 'all',
      sort: 'display_name_asc',
      limit: 50,
    })).items[0]).toMatchObject({ assignedJobCount: 1 })
  })

  it('keeps merged identity fields read-only while preserving notes and canonical lookup', async () => {
    const client = await createClient({ workspaceId: WORKSPACE })
    const canonical = await client.companies.create({
      ...context('create-canonical'),
      displayName: 'Canonical Company',
      websiteUrl: null,
      notes: null,
    })
    const merged = await client.companies.create({
      ...context('create-merged'),
      displayName: 'Merged Company',
      websiteUrl: null,
      notes: 'Loser notes',
    })
    if (canonical.status !== 'created' || merged.status !== 'created') {
      throw new Error('expected Companies')
    }
    const database = getTestLocalValedictorianDatabase(client)
    await database.update(workspaceCompanies).set({
      status: 'merged',
      mergedIntoCompanyId: canonical.companyId,
    }).where(eq(workspaceCompanies.id, merged.companyId))

    expect(await client.companies.lookup(merged.companyId)).toMatchObject({
      requested: { id: merged.companyId, status: 'merged' },
      canonical: { id: canonical.companyId, status: 'active' },
      redirectPath: [canonical.companyId],
    })
    expect(await client.companies.update({
      ...context('merged-identity-update'),
      companyId: merged.companyId,
      expectedCompanyRevision: 1,
      displayName: 'Forbidden identity change',
    })).toMatchObject({
      status: 'blocked',
      failure: {
        kind: 'lifecycle_failure',
        blocker: { code: 'impossible_state' },
      },
    })
    expect(await client.companies.notes.update({
      ...context('merged-notes-update'),
      companyId: merged.companyId,
      expectedCompanyRevision: 1,
      notes: 'Preserved and updated loser notes.',
    })).toMatchObject({
      status: 'updated',
      company: {
        status: 'merged',
        revision: 2,
        notes: 'Preserved and updated loser notes.',
      },
    })
  })
})
