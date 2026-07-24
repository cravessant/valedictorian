import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  getTestLocalValedictorianDatabase,
  useResettablePgliteTestLocalValedictorianClient,
} from '../../runtime/local-valedictorian-client.test-harness'
import { workspaceCompanies } from './company.schema'

const createClient = useResettablePgliteTestLocalValedictorianClient()
const WORKSPACE = 'company-assignment-workspace'
const ACTOR = { id: 'assignment-user', type: 'user' as const }

function context(idempotencyKey: string) {
  return {
    workspaceId: WORKSPACE,
    actor: ACTOR,
    rationale: 'Keep the Job assigned to the intended workspace Company.',
    idempotencyKey,
  }
}

describe.sequential('Job Company assignments', () => {
  it('reads one current assignment and reassigns without changing Job facts', async () => {
    const client = await createClient({ workspaceId: WORKSPACE })
    const job = await createJob(client, 'Assigned posting name', 'Platform Engineer')
    const beforeFacts = (await client.jobs.get(job.id))?.facts
    expect(await client.companyAssignments.get(job.id)).toMatchObject({
      jobId: job.id,
      assignmentRevision: 1,
      workspaceCompany: {
        companyId: job.id,
        displayName: 'Assigned posting name',
        status: 'active',
      },
      jobFactsCompanyName: 'Assigned posting name',
      namesDiffer: false,
    })
    const destination = await client.companies.create({
      ...context('create-destination'),
      displayName: 'Workspace Identity',
      websiteUrl: null,
      notes: null,
    })
    if (destination.status !== 'created') throw new Error('expected destination Company')
    const input = {
      ...context('reassign-job'),
      jobId: job.id,
      expectedAssignmentRevision: 1,
      destinationCompanyId: destination.companyId,
      expectedDestinationCompanyRevision: 1,
    }
    const result = await client.companyAssignments.reassign(input)
    expect(result).toMatchObject({
      status: 'reassigned',
      assignment: {
        assignmentRevision: 2,
        workspaceCompany: {
          companyId: destination.companyId,
          displayName: 'Workspace Identity',
        },
        jobFactsCompanyName: 'Assigned posting name',
        namesDiffer: true,
      },
      jobFactsChanged: false,
    })
    expect(await client.companyAssignments.reassign(input)).toEqual(result)
    expect((await client.jobs.get(job.id))?.facts).toEqual(beforeFacts)
    expect((await client.companies.assignedJobs.list(destination.companyId, {
      filter: 'all',
      sort: 'role_title_asc',
      limit: 50,
    })).items).toEqual([expect.objectContaining({
      jobId: job.id,
      assignmentRevision: 2,
    })])
  })

  it('returns correlated stale guards for assignment and destination revisions', async () => {
    const client = await createClient({ workspaceId: WORKSPACE })
    const job = await createJob(client, 'Stale posting', 'Data Engineer')
    const destination = await client.companies.create({
      ...context('stale-destination'),
      displayName: 'Stale Destination',
      websiteUrl: null,
      notes: null,
    })
    if (destination.status !== 'created') throw new Error('expected destination')
    await client.companies.notes.update({
      ...context('bump-destination'),
      companyId: destination.companyId,
      expectedCompanyRevision: 1,
      notes: 'Revision two.',
    })
    expect(await client.companyAssignments.reassign({
      ...context('stale-company-reassign'),
      jobId: job.id,
      expectedAssignmentRevision: 1,
      destinationCompanyId: destination.companyId,
      expectedDestinationCompanyRevision: 1,
    })).toMatchObject({
      status: 'blocked',
      failure: {
        kind: 'stale_guard',
        recovery: {
          action: 'refresh_and_resubmit',
          guards: [{
            kind: 'company_revision',
            companyId: destination.companyId,
            expectedRevision: 1,
            currentRevision: 2,
          }],
        },
      },
    })
    const reassigned = await client.companyAssignments.reassign({
      ...context('fresh-reassign'),
      jobId: job.id,
      expectedAssignmentRevision: 1,
      destinationCompanyId: destination.companyId,
      expectedDestinationCompanyRevision: 2,
    })
    expect(reassigned.status).toBe('reassigned')
    expect(await client.companyAssignments.reassign({
      ...context('stale-assignment-reassign'),
      jobId: job.id,
      expectedAssignmentRevision: 1,
      destinationCompanyId: job.id,
      expectedDestinationCompanyRevision: 1,
    })).toMatchObject({
      status: 'blocked',
      failure: {
        kind: 'stale_guard',
        recovery: {
          guards: [{
            kind: 'assignment_revision',
            jobId: job.id,
            expectedRevision: 1,
            currentRevision: 2,
          }],
        },
      },
    })
  })

  it('rejects inactive and wrong-workspace targets without canonicalizing', async () => {
    const client = await createClient({ workspaceId: WORKSPACE })
    const job = await createJob(client, 'Guarded posting', 'Security Engineer')
    const merged = await client.companies.create({
      ...context('merged-target'),
      displayName: 'Merged Target',
      websiteUrl: null,
      notes: null,
    })
    if (merged.status !== 'created') throw new Error('expected merged target')
    const database = getTestLocalValedictorianDatabase(client)
    await database.update(workspaceCompanies).set({
      status: 'merged',
      mergedIntoCompanyId: job.id,
    }).where(eq(workspaceCompanies.id, merged.companyId))
    expect(await client.companyAssignments.reassign({
      ...context('choose-merged'),
      jobId: job.id,
      expectedAssignmentRevision: 1,
      destinationCompanyId: merged.companyId,
      expectedDestinationCompanyRevision: 1,
    })).toMatchObject({
      status: 'blocked',
      destinationCompanyId: merged.companyId,
      failure: {
        kind: 'lifecycle_failure',
        blocker: {
          code: 'impossible_state',
          conflictingResourceId: job.id,
        },
      },
    })
    const archived = await client.companies.create({
      ...context('archived-target'),
      displayName: 'Archived Target',
      websiteUrl: null,
      notes: null,
    })
    if (archived.status !== 'created') throw new Error('expected archived target')
    await client.companies.archive({
      ...context('archive-target'),
      companyId: archived.companyId,
      expectedCompanyRevision: 1,
    })
    expect(await client.companyAssignments.reassign({
      ...context('choose-archived'),
      jobId: job.id,
      expectedAssignmentRevision: 1,
      destinationCompanyId: archived.companyId,
      expectedDestinationCompanyRevision: 2,
    })).toMatchObject({
      status: 'blocked',
      destinationCompanyId: archived.companyId,
      failure: {
        kind: 'lifecycle_failure',
        blocker: { code: 'impossible_state' },
      },
    })
    expect(await client.companyAssignments.get(job.id)).toMatchObject({
      assignmentRevision: 1,
      workspaceCompany: { companyId: job.id },
    })
    expect(await client.companyAssignments.reassign({
      ...context('wrong-workspace'),
      workspaceId: 'another-workspace',
      jobId: job.id,
      expectedAssignmentRevision: 1,
      destinationCompanyId: job.id,
      expectedDestinationCompanyRevision: 1,
    })).toMatchObject({
      status: 'blocked',
      failure: {
        kind: 'lifecycle_failure',
        blocker: { code: 'workspace_ownership' },
      },
    })
  })
})

async function createJob(
  client: Awaited<ReturnType<typeof createClient>>,
  companyName: string,
  roleTitle: string,
) {
  const capture = await client.captures.create({
    evidenceMode: 'reported',
    adapter: { id: 'assignment-test', kind: 'cli', version: '1.0.0' },
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
