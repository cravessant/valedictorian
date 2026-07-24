import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createHttpValedictorianClient,
  reassignJobCompanyResultSchema,
  ValedictorianHttpError,
} from '@sparxie/sdk'
import { createTestLocalValedictorianClient } from '../runtime/local-valedictorian-client.test-harness'
import { createLocalServerHttpTestFixture } from './local-server.http-test-harness'

const WORKSPACE = 'company-assignment-http'
const ACTOR = { id: 'assignment-http-user', type: 'user' as const }

describe.sequential('Job Company assignment HTTP surface', () => {
  const fixture = createLocalServerHttpTestFixture()

  beforeEach(() => fixture.setup())
  afterEach(() => fixture.teardown())

  async function setup() {
    const local = await createTestLocalValedictorianClient({ workspaceId: WORKSPACE })
    const server = await fixture.start({ client: local })
    const client = createHttpValedictorianClient({
      baseUrl: server.url,
    }).forWorkspace(WORKSPACE)
    return { client, server }
  }

  it('round-trips current assignment and revision-safe reassignment', async () => {
    const { client } = await setup()
    const job = await createJob(client)
    const destination = await client.companies.create({
      workspaceId: WORKSPACE,
      actor: ACTOR,
      rationale: 'Create a reassignment target.',
      idempotencyKey: 'http-assignment-target',
      displayName: 'HTTP Workspace Company',
      websiteUrl: null,
      notes: null,
    })
    if (destination.status !== 'created') throw new Error('expected destination')
    expect(await client.companyAssignments.get(job.id)).toMatchObject({
      jobId: job.id,
      assignmentRevision: 1,
      workspaceCompany: { companyId: job.id },
    })
    const result = await client.companyAssignments.reassign({
      workspaceId: WORKSPACE,
      actor: ACTOR,
      rationale: 'Use the maintained workspace identity.',
      idempotencyKey: 'http-reassign',
      jobId: job.id,
      expectedAssignmentRevision: 1,
      destinationCompanyId: destination.companyId,
      expectedDestinationCompanyRevision: 1,
    })
    expect(() => reassignJobCompanyResultSchema.parse(result)).not.toThrow()
    expect(result).toMatchObject({
      status: 'reassigned',
      assignment: {
        jobId: job.id,
        assignmentRevision: 2,
        workspaceCompany: { companyId: destination.companyId },
      },
      jobFactsChanged: false,
    })
  })

  it('keeps the path authoritative and maps a missing assignment to 404', async () => {
    const { client, server } = await setup()
    const job = await createJob(client)
    const destination = await client.companies.create({
      workspaceId: WORKSPACE,
      actor: ACTOR,
      rationale: 'Create another target.',
      idempotencyKey: 'http-path-target',
      displayName: 'Path Target',
      websiteUrl: null,
      notes: null,
    })
    if (destination.status !== 'created') throw new Error('expected destination')
    const response = await fetch(
      `${server.url}/v1/workspaces/${WORKSPACE}/jobs/${job.id}/company-assignment/reassign`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'spoofed-workspace',
          jobId: '018f0000-0000-7000-8000-000000000099',
          actor: ACTOR,
          rationale: 'The path remains authoritative.',
          idempotencyKey: 'http-path-authority',
          expectedAssignmentRevision: 1,
          destinationCompanyId: destination.companyId,
          expectedDestinationCompanyRevision: 1,
        }),
      },
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      status: 'reassigned',
      workspaceId: WORKSPACE,
      jobId: job.id,
    })
    await expect(client.companyAssignments.get(
      '018f0000-0000-7000-8000-000000000099' as never,
    )).rejects.toMatchObject({
      status: 404,
    } satisfies Partial<ValedictorianHttpError>)
  })
})

async function createJob(
  client: ReturnType<ReturnType<typeof createHttpValedictorianClient>['forWorkspace']>,
) {
  const capture = await client.captures.create({
    evidenceMode: 'reported',
    adapter: { id: 'assignment-http', kind: 'cli', version: '1.0.0' },
    observedAt: '2026-07-23T00:00:00.000Z',
    providerRecordId: null,
    providerSchema: null,
    payload: null,
    evidence: [{ kind: 'title', label: 'Title', value: 'HTTP Engineer' }],
  })
  if (capture.status !== 'succeeded') throw new Error('expected Capture')
  const job = await client.jobs.create({
    idempotencyKey: 'http-assignment-job',
    actor: ACTOR,
    facts: {
      companyName: 'Posting HTTP Company',
      roleTitle: 'HTTP Engineer',
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
