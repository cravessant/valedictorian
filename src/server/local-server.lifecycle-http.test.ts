import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHttpValedictorianClient, ValedictorianHttpError } from '@sparxie/sdk'
import { createTestLocalValedictorianClient } from '../runtime/local-valedictorian-client.test-harness'
import { createLocalServerHttpTestFixture } from './local-server.http-test-harness'

const WORKSPACE_ID = 'lifecycle-http-workspace'
const USER = { id: 'http-user', type: 'user' as const }
const CAPTURE_INPUT = {
  evidenceMode: 'reported' as const,
  adapter: { id: 'http-test', kind: 'cli' as const, version: '1.0.0' },
  observedAt: '2026-07-21T12:00:00.000Z',
  providerRecordId: null,
  providerSchema: null,
  payload: null,
  evidence: [{ kind: 'title', label: 'Title', value: 'Engineer' }],
}
const FACTS = {
  companyName: 'Acme',
  roleTitle: 'Engineer',
  sourceName: 'HTTP test',
  roleKind: 'experienced' as const,
  term: null,
  terms: [],
  timingMode: 'unknown' as const,
  startDate: null,
  endDate: null,
  location: null,
  workMode: 'remote' as const,
  employmentType: 'full_time' as const,
  seniority: 'senior' as const,
  compensation: null,
  postedAt: null,
  destination: null,
}

describe.sequential('canonical lifecycle HTTP and typed client', () => {
  const fixture = createLocalServerHttpTestFixture()

  beforeEach(() => fixture.setup())
  afterEach(() => fixture.teardown())

  async function setup() {
    const local = await createTestLocalValedictorianClient({
      seedDataMode: 'none',
      workspaceId: WORKSPACE_ID,
    })
    const server = await fixture.start({ client: local })
    const client = createHttpValedictorianClient({ baseUrl: server.url }).forWorkspace(WORKSPACE_ID)
    return { client, server }
  }

  it('round-trips complete CRUD/history surfaces for all four canonical aggregates', async () => {
    const { client } = await setup()
    const capture = await client.captures.create(CAPTURE_INPUT)
    expect(capture.status).toBe('succeeded')
    if (capture.status !== 'succeeded') throw new Error('capture create failed')

    const corrected = await client.captures.correct({
      captureId: capture.resource.id,
      expectedRevision: 1,
      actor: USER,
      rationale: 'HTTP correction',
      correction: { payload: { corrected: true } },
    })
    expect(corrected.status).toBe('succeeded')
    expect((await client.captures.list({ limit: 1 })).items).toHaveLength(1)
    expect((await client.captures.history({ id: capture.resource.id, limit: 10 })).items.length)
      .toBeGreaterThanOrEqual(2)
    expect(await client.captures.remove({
      id: capture.resource.id,
      choice: 'reject_if_dependents',
      actor: USER,
      rationale: 'HTTP remove',
    })).toMatchObject({ status: 'removed', id: capture.resource.id })
    expect(await client.captures.restore({
      id: capture.resource.id,
      actor: USER,
      rationale: 'HTTP restore',
    })).toMatchObject({ status: 'restored', id: capture.resource.id })

    const job = await client.jobs.create({
      idempotencyKey: 'http-job',
      actor: USER,
      facts: FACTS,
      availability: { state: 'open', observedAt: '2026-07-21T12:00:00.000Z' },
      evidenceReferences: [{
        captureId: capture.resource.id,
        captureRevision: 1,
        evidenceIndexes: [0],
      }],
      externalIdentities: [],
    })
    expect(job.status).toBe('succeeded')
    if (job.status !== 'succeeded') throw new Error('job create failed')
    const jobUpdate = await client.jobs.updateAvailability({
      jobId: job.resource.id,
      expectedAvailabilityRevision: 1,
      actor: USER,
      availability: { state: 'closed', observedAt: '2026-07-22T12:00:00.000Z' },
      evidenceReferences: [{
        captureId: capture.resource.id,
        captureRevision: 1,
        evidenceIndexes: [0],
      }],
    })
    expect(jobUpdate.status).toBe('succeeded')
    expect((await client.jobs.list({ limit: 1 })).items[0]?.id).toBe(job.resource.id)
    expect((await client.jobs.history({ id: job.resource.id, limit: 10 })).items.length)
      .toBeGreaterThanOrEqual(2)
    expect(await client.jobs.remove({
      id: job.resource.id,
      choice: 'reject_if_dependents',
      actor: USER,
      rationale: 'HTTP remove',
    })).toMatchObject({ status: 'removed', id: job.resource.id })
    expect(await client.jobs.restore({
      id: job.resource.id,
      actor: USER,
      rationale: 'HTTP restore',
    })).toMatchObject({ status: 'restored', id: job.resource.id })

    const opportunity = await client.opportunities.create({
      idempotencyKey: 'http-opportunity',
      actor: USER,
      jobId: job.resource.id,
      expectedJobFactsRevision: 1,
      fit: 'fit',
      rank: 1,
      cutoff: 'above',
      disposition: 'reviewing',
    })
    expect(opportunity.status).toBe('succeeded')
    if (opportunity.status !== 'succeeded') throw new Error('opportunity create failed')
    const disposition = await client.opportunities.updateDisposition({
      opportunityId: opportunity.resource.id,
      expectedRevision: 1,
      actor: USER,
      disposition: 'pursue',
      rationale: 'HTTP pursue',
    })
    expect(disposition.status).toBe('succeeded')
    expect((await client.opportunities.list({ limit: 1 })).items[0]?.id)
      .toBe(opportunity.resource.id)
    expect((await client.opportunities.history({ id: opportunity.resource.id, limit: 10 })).items.length)
      .toBeGreaterThanOrEqual(2)
    expect(await client.opportunities.remove({
      id: opportunity.resource.id,
      choice: 'reject_if_dependents',
      actor: USER,
      rationale: 'HTTP remove',
    })).toMatchObject({ status: 'removed', id: opportunity.resource.id })
    expect(await client.opportunities.restore({
      id: opportunity.resource.id,
      actor: USER,
      rationale: 'HTTP restore',
    })).toMatchObject({ status: 'restored', id: opportunity.resource.id })

    const application = await client.applications.create({
      idempotencyKey: 'http-application',
      actor: USER,
      opportunityId: opportunity.resource.id,
      jobId: job.resource.id,
      expectedJobFactsRevision: 1,
      initialLinks: [],
    })
    expect(application.status).toBe('succeeded')
    if (application.status !== 'succeeded') throw new Error('application create failed')
    const status = await client.applications.updateStatus({
      applicationId: application.resource.id,
      expectedRevision: 1,
      actor: USER,
      status: 'submitted',
      rationale: 'HTTP submit',
    })
    expect(status.status).toBe('succeeded')
    expect((await client.applications.list({ limit: 1 })).items[0]?.id)
      .toBe(application.resource.id)
    expect((await client.applications.history({ id: application.resource.id, limit: 10 })).items.length)
      .toBeGreaterThanOrEqual(2)
    expect(await client.applications.remove({
      id: application.resource.id,
      choice: 'cascade_tombstone',
      actor: USER,
      rationale: 'HTTP remove',
    })).toMatchObject({ status: 'removed', id: application.resource.id })
    expect(await client.applications.restore({
      id: application.resource.id,
      actor: USER,
      rationale: 'HTTP restore',
    })).toMatchObject({ status: 'restored', id: application.resource.id })

    expect((await client.captures.get(capture.resource.id))?.id).toBe(capture.resource.id)
    expect((await client.jobs.get(job.resource.id))?.id).toBe(job.resource.id)
    expect((await client.opportunities.get(opportunity.resource.id))?.id)
      .toBe(opportunity.resource.id)
    expect((await client.applications.get(application.resource.id))?.id)
      .toBe(application.resource.id)
  })

  it('round-trips all three promotions with idempotent results through the typed client', async () => {
    const { client } = await setup()
    const capture = await client.captures.create(CAPTURE_INPUT)
    if (capture.status !== 'succeeded') throw new Error('capture create failed')
    const promoteCapture = {
      idempotencyKey: 'promote-capture-http',
      actor: USER,
      captureId: capture.resource.id,
      captureRevision: 1,
      selectedFacts: FACTS,
      evidenceReferences: [{ captureId: capture.resource.id, captureRevision: 1, evidenceIndexes: [0] }],
      externalIdentities: [],
      override: {
        actor: USER,
        rationale: 'Accept provisional provider-less identity',
        warningCodes: ['missing_optional_facts'] as const,
      },
    }
    const job = await client.captures.promoteToJob(promoteCapture)
    expect(job.status).toBe('promoted')
    if (job.status !== 'promoted') throw new Error('capture promotion failed')
    expect(job.warnings.map((warning) => warning.code)).toContain('missing_optional_facts')
    expect(job.override?.warningCodes).toEqual(['missing_optional_facts'])
    expect(job.audit.override).toEqual(job.override)
    const repeatedJob = await client.captures.promoteToJob(promoteCapture)
    expect(repeatedJob).toMatchObject({ status: 'promoted', created: false })
    if (repeatedJob.status !== 'promoted') throw new Error('capture replay failed')
    expect(repeatedJob.resource.id).toBe(job.resource.id)

    const promoteJob = {
      idempotencyKey: 'promote-job-http',
      actor: USER,
      jobId: job.resource.id,
      expectedFactsRevision: 1,
      evaluation: { fit: 'possible' as const, rank: null, cutoff: 'below' as const, disposition: 'pursue' as const },
      override: {
        actor: USER,
        rationale: 'Pursue despite policy warnings',
        warningCodes: ['fit', 'rank', 'cutoff', 'weak_possible_match'] as const,
      },
    }
    const opportunity = await client.jobs.promoteToOpportunity(promoteJob)
    expect(opportunity.status).toBe('promoted')
    if (opportunity.status !== 'promoted') throw new Error('job promotion failed')
    expect(opportunity.warnings.map((warning) => warning.code).sort())
      .toEqual(['cutoff', 'fit', 'rank', 'weak_possible_match'])
    expect(opportunity.audit.override).toEqual(opportunity.override)
    const repeatedOpportunity = await client.jobs.promoteToOpportunity(promoteJob)
    expect(repeatedOpportunity).toMatchObject({ status: 'promoted', created: false })

    const promoteOpportunity = {
      idempotencyKey: 'promote-opportunity-http',
      actor: USER,
      opportunityId: opportunity.resource.id,
      expectedJobId: job.resource.id,
      initialLinks: [],
      override: {
        actor: USER,
        rationale: 'Apply despite possible fit',
        warningCodes: ['fit', 'weak_possible_match'] as const,
      },
    }
    const application = await client.opportunities.promoteToApplication(promoteOpportunity)
    expect(application.status).toBe('promoted')
    if (application.status !== 'promoted') throw new Error('opportunity promotion failed')
    expect(application.warnings.map((warning) => warning.code).sort())
      .toEqual(['cutoff', 'fit', 'rank', 'weak_possible_match'])
    expect(application.audit.override).toEqual(application.override)
    const repeatedApplication = await client.opportunities.promoteToApplication(promoteOpportunity)
    expect(repeatedApplication).toMatchObject({ status: 'promoted', created: false })
  })

  it('rejects an inapplicable override atomically and permits a clean retry', async () => {
    const { client } = await setup()
    const capture = await client.captures.create(CAPTURE_INPUT)
    if (capture.status !== 'succeeded') throw new Error('capture create failed')

    const blocked = await client.captures.promoteToJob({
      idempotencyKey: 'blocked-override',
      actor: USER,
      captureId: capture.resource.id,
      captureRevision: 1,
      selectedFacts: FACTS,
      evidenceReferences: [{ captureId: capture.resource.id, captureRevision: 1, evidenceIndexes: [0] }],
      externalIdentities: [],
      override: { actor: USER, rationale: 'Not an actual warning', warningCodes: ['cutoff'] },
    })
    expect(blocked).toMatchObject({ status: 'blocked', blocker: { code: 'invalid_input' } })
    expect((await client.jobs.list()).items).toHaveLength(0)

    const retried = await client.captures.promoteToJob({
      idempotencyKey: 'clean-retry',
      actor: USER,
      captureId: capture.resource.id,
      captureRevision: 1,
      selectedFacts: FACTS,
      evidenceReferences: [{ captureId: capture.resource.id, captureRevision: 1, evidenceIndexes: [0] }],
      externalIdentities: [],
    })
    expect(retried.status).toBe('promoted')
    expect((await client.jobs.list()).items).toHaveLength(1)
  })

  it('applies duplicate attach and merge decisions through the released client shape', async () => {
    const { client } = await setup()
    const seedCapture = await client.captures.create({ ...CAPTURE_INPUT, providerRecordId: 'seed' })
    if (seedCapture.status !== 'succeeded') throw new Error('seed capture failed')
    const target = await client.jobs.create({
      idempotencyKey: 'duplicate-target',
      actor: USER,
      facts: FACTS,
      availability: { state: 'open', observedAt: CAPTURE_INPUT.observedAt },
      evidenceReferences: [{ captureId: seedCapture.resource.id, captureRevision: 1, evidenceIndexes: [0] }],
      externalIdentities: [],
    })
    if (target.status !== 'succeeded') throw new Error('target job failed')

    const attachCapture = await client.captures.create({ ...CAPTURE_INPUT, providerRecordId: 'attach' })
    if (attachCapture.status !== 'succeeded') throw new Error('attach capture failed')
    const attached = await client.captures.promoteToJob({
      idempotencyKey: 'duplicate-attach',
      actor: USER,
      captureId: attachCapture.resource.id,
      captureRevision: 1,
      selectedFacts: FACTS,
      evidenceReferences: [{ captureId: attachCapture.resource.id, captureRevision: 1, evidenceIndexes: [0] }],
      externalIdentities: [],
      duplicateResolution: { action: 'attach', targetResourceId: target.resource.id },
    })
    expect(attached).toMatchObject({
      status: 'promoted',
      created: false,
      resource: { id: target.resource.id },
      duplicateResolution: { action: 'attach', targetResourceId: target.resource.id },
    })

    const mergeCapture = await client.captures.create({ ...CAPTURE_INPUT, providerRecordId: 'merge' })
    if (mergeCapture.status !== 'succeeded') throw new Error('merge capture failed')
    const merged = await client.captures.promoteToJob({
      idempotencyKey: 'duplicate-merge',
      actor: USER,
      captureId: mergeCapture.resource.id,
      captureRevision: 1,
      selectedFacts: FACTS,
      evidenceReferences: [{ captureId: mergeCapture.resource.id, captureRevision: 1, evidenceIndexes: [0] }],
      externalIdentities: [],
      duplicateResolution: { action: 'merge', targetResourceId: target.resource.id },
    })
    expect(merged).toMatchObject({
      status: 'promoted',
      created: false,
      duplicateResolution: { action: 'merge', targetResourceId: target.resource.id },
    })
    expect((await client.jobs.list()).items).toHaveLength(1)
  })

  it('serializes concurrent corrections and does not echo rejected sensitive input', async () => {
    const { client, server } = await setup()
    const capture = await client.captures.create(CAPTURE_INPUT)
    if (capture.status !== 'succeeded') throw new Error('capture create failed')

    const corrections = await Promise.allSettled([
      client.captures.correct({
        captureId: capture.resource.id,
        expectedRevision: 1,
        actor: USER,
        rationale: 'concurrent A',
        correction: { payload: { winner: 'A' } },
      }),
      client.captures.correct({
        captureId: capture.resource.id,
        expectedRevision: 1,
        actor: USER,
        rationale: 'concurrent B',
        correction: { payload: { winner: 'B' } },
      }),
    ])
    expect(corrections.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(corrections.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect((await client.captures.history({ id: capture.resource.id, limit: 10 })).items).toHaveLength(2)

    const canary = 'lifecycle-http-secret-canary'
    const sensitive = await fetch(`${server.url}/v1/workspaces/${WORKSPACE_ID}/captures`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...CAPTURE_INPUT, providerRecordId: 'sensitive-record', payload: { token: canary } }),
    })
    const responseText = await sensitive.text()
    expect(sensitive.status).toBe(400)
    expect(responseText).not.toContain(canary)
    expect((await client.captures.list()).items).toHaveLength(1)
  })

  it('preserves path authority and maps invalid/stale inputs to deterministic typed errors', async () => {
    const { client, server } = await setup()
    const capture = await client.captures.create(CAPTURE_INPUT)
    if (capture.status !== 'succeeded') throw new Error('capture create failed')

    const spoofed = await fetch(
      `${server.url}/v1/workspaces/${WORKSPACE_ID}/captures/${capture.resource.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          captureId: 'spoofed-id',
          expectedRevision: 1,
          actor: USER,
          rationale: 'path wins',
          correction: { payload: { ok: true } },
        }),
      },
    )
    expect(spoofed.status).toBe(200)
    expect(await client.captures.get('spoofed-id')).toBeNull()

    await expect(client.captures.correct({
      captureId: capture.resource.id,
      expectedRevision: 1,
      actor: USER,
      rationale: 'stale',
      correction: { payload: { stale: true } },
    })).rejects.toBeInstanceOf(ValedictorianHttpError)

    const invalid = await fetch(
      `${server.url}/v1/workspaces/${WORKSPACE_ID}/captures?limit=not-a-number`,
    )
    expect(invalid.status).toBe(400)
  })
})
