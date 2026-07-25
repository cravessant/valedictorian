import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createHttpValedictorianClient,
  ValedictorianHttpError,
} from '@sparxie/sdk'
import { createTestLocalValedictorianClient } from '../runtime/local-valedictorian-client.test-harness'
import { getTestLocalValedictorianDatabase } from '../runtime/local-valedictorian-client.test-harness'
import { createLocalServerHttpTestFixture } from './local-server.http-test-harness'
import { createPgliteCaptureService } from '../modules/capture/capture.service'
import { createCaptureMaterializationService } from '../modules/capture/capture.materialization'
import {
  captureResolutionCommandReceipts,
  captureResolutionGenerations,
  captureResolutionStageResults,
} from '../modules/capture/capture.schema'
import { and, eq } from 'drizzle-orm'
import {
  jobCaptureEvidenceReferences,
  jobExternalIdentities,
  jobs,
} from '../modules/job/job.schema'
import { jobCompanyAssignments, workspaceCompanies } from '../modules/company/company.schema'

const WORKSPACE = 'capture-resolution-http-workspace'

function jobFacts(companyName: string, roleTitle: string) {
  return {
    companyName, roleTitle, sourceName: 'Manual completion', roleKind: 'experienced',
    term: null, terms: [], timingMode: 'unknown', startDate: null, endDate: null,
    location: null, workMode: 'unknown', employmentType: 'unknown', seniority: 'unknown',
    compensation: null, postedAt: null,
    destination: { class: 'employer_or_ats', url: 'https://jobs.completion.acme.com/roles/engineer' },
  } as const
}

function jobFactsV2(companyName: string, roleTitle: string, url: string) {
  const { destination: _destination, ...facts } = jobFacts(companyName, roleTitle)
  return { ...facts, destination: { url } }
}

describe.sequential('Capture resolution HTTP surface', () => {
  const fixture = createLocalServerHttpTestFixture()

  beforeEach(() => fixture.setup())
  afterEach(() => fixture.teardown())

  async function setup() {
    const local = await createTestLocalValedictorianClient({ workspaceId: WORKSPACE })
    const server = await fixture.start({ client: local })
    const client = createHttpValedictorianClient({
      baseUrl: server.url,
    }).forWorkspace(WORKSPACE)
    return { client, local, server }
  }

  it('serves only the canonical typed list and detail routes', async () => {
    const { client, server } = await setup()
    const created = await client.captures.create({
      evidenceMode: 'reported',
      adapter: { id: 'manual.capture', kind: 'manual', version: '1.0.0' },
      observedAt: '2026-07-23T00:00:00.000Z',
      providerRecordId: null,
      providerSchema: null,
      payload: { companyName: 'HTTP Labs', roleTitle: 'HTTP Engineer' },
      evidence: [{
        kind: 'title',
        label: 'Role title',
        value: 'HTTP Engineer',
      }],
    })
    if (created.status !== 'succeeded') throw new Error('expected Capture creation')

    const page = await client.captureResolution.list({
      filter: 'all',
      sort: 'observed_desc',
      limit: 50,
    })
    expect(page).toMatchObject({
      totalCount: 1,
      items: [{
        captureId: created.resource.id,
        readiness: 'ready',
        processingSummary: 'awaiting_information',
        primaryIntent: { kind: 'complete_job_information' },
      }],
    })
    const detail = await client.captureResolution.get(created.resource.id)
    expect(detail).toMatchObject({
      captureId: created.resource.id,
      destination: { status: 'not_required' },
      exactEvidenceReferences: [{
        captureId: created.resource.id,
        evidenceIndexes: [0],
      }],
    })
    if (!detail.expectedGenerationId) throw new Error('expected active generation')
    await expect(client.captureResolution.retry({
      captureId: created.resource.id,
      expectedCaptureRevision: detail.captureRevision,
      expectedGenerationId: detail.expectedGenerationId,
      idempotencyKey: 'manual-destination-retry',
      actor: { id: 'operator', type: 'user' },
    })).resolves.toMatchObject({ status: 'blocked' })
    await expect(client.captureResolution.replay({
      captureId: created.resource.id,
      expectedCaptureRevision: detail.captureRevision,
      expectedGenerationId: detail.expectedGenerationId,
      idempotencyKey: 'manual-destination-replay',
      actor: { id: 'operator', type: 'user' },
      rationale: 'A manual Capture has no provider resolver to replay.',
    })).resolves.toMatchObject({ status: 'blocked' })

    expect((await fetch(
      `${server.url}/v1/workspaces/${WORKSPACE}/captures/resolution`,
    )).status).toBe(404)
    expect((await fetch(
      `${server.url}/v1/capture-resolution/captures`,
    )).status).toBe(404)
    await expect(client.captureResolution.get(
      '018f0000-0000-7000-8000-000000000099',
    )).rejects.toMatchObject({
      status: 404,
    } satisfies Partial<ValedictorianHttpError>)
  })

  it('completes a Capture through the published HTTP command with exact lineage and one selected Company', async () => {
    const { client, local } = await setup()
    const database = getTestLocalValedictorianDatabase(local)
    const created = await client.captures.create({
      evidenceMode: 'reported',
      adapter: { id: 'manual.capture', kind: 'manual', version: '1.0.0' },
      observedAt: '2026-07-23T00:00:00.000Z', providerRecordId: null, providerSchema: null,
      payload: { companyName: 'Completion Labs', roleTitle: 'Completion Engineer' },
      evidence: [{ kind: 'title', label: 'Role title', value: 'Completion Engineer' }],
    })
    if (created.status !== 'succeeded') throw new Error('expected Capture creation')
    const detail = await client.captureResolution.get(created.resource.id)
    const result = await client.captureResolution.complete({
      captureId: created.resource.id,
      expectedCaptureRevision: detail.captureRevision,
      expectedGenerationId: null,
      idempotencyKey: 'complete-http-1', actor: { id: 'operator', type: 'user' },
      jobFacts: jobFacts('Completion Labs', 'Completion Engineer'),
      destination: { class: 'employer_or_ats', url: 'https://jobs.completion.acme.com/roles/engineer' },
      externalIdentities: [], evidenceReferences: detail.exactEvidenceReferences,
      companyResolution: { action: 'create_local', displayName: 'Completion Labs' },
    })
    expect(result).toMatchObject({ status: 'created', createdJob: true })
    if (result.status !== 'created') throw new Error('expected created result')
    await expect(client.captureResolution.complete({
      captureId: created.resource.id, expectedCaptureRevision: detail.captureRevision,
      expectedGenerationId: null, idempotencyKey: 'complete-http-1', actor: { id: 'operator', type: 'user' },
      jobFacts: jobFacts('Completion Labs', 'Completion Engineer'),
      destination: { class: 'employer_or_ats', url: 'https://jobs.completion.acme.com/roles/engineer' },
      externalIdentities: [], evidenceReferences: detail.exactEvidenceReferences,
      companyResolution: { action: 'create_local', displayName: 'Completion Labs' },
    })).resolves.toEqual(result)
    const changedFingerprint = await client.captureResolution.complete({
      captureId: created.resource.id, expectedCaptureRevision: detail.captureRevision,
      expectedGenerationId: null, idempotencyKey: 'complete-http-1', actor: { id: 'different-operator', type: 'user' },
      jobFacts: jobFacts('Completion Labs', 'Completion Engineer'),
      destination: { class: 'employer_or_ats', url: 'https://jobs.completion.acme.com/roles/engineer' },
      externalIdentities: [], evidenceReferences: detail.exactEvidenceReferences,
      companyResolution: { action: 'create_local', displayName: 'Completion Labs' },
    })
    expect(changedFingerprint).toMatchObject({ status: 'blocked', failure: { kind: 'lifecycle_failure', blocker: { code: 'invalid_input' } } })
    expect(await database.select({ id: jobs.id }).from(jobs)).toEqual([{ id: result.jobId }])
    expect(await database.select({ jobId: jobCompanyAssignments.jobId, companyId: jobCompanyAssignments.companyId })
      .from(jobCompanyAssignments)).toEqual([{ jobId: result.jobId, companyId: result.companyId }])
    expect(await database.select({ captureId: jobCaptureEvidenceReferences.captureId, revision: jobCaptureEvidenceReferences.captureRevision })
      .from(jobCaptureEvidenceReferences)).toEqual([{ captureId: created.resource.id, revision: detail.captureRevision }])
    expect(await database.select({ id: workspaceCompanies.id }).from(workspaceCompanies)
      .where(eq(workspaceCompanies.id, result.companyId))).toHaveLength(1)
    const stages = await database.select({ stage: captureResolutionStageResults.stage, status: captureResolutionStageResults.status })
      .from(captureResolutionStageResults).where(eq(captureResolutionStageResults.generationId, detail.expectedGenerationId!))
    expect(stages).toEqual(expect.arrayContaining([
      { stage: 'destination', status: 'not_required' },
      { stage: 'information', status: 'resolved' },
      { stage: 'promotion', status: 'promoted' },
    ]))
  })

  it('uses V2 URL-only completion and keeps server destination validation authoritative', async () => {
    const { client, local } = await setup()
    const database = getTestLocalValedictorianDatabase(local)
    const accepted = await client.captures.create({
      evidenceMode: 'reported',
      adapter: { id: 'manual.capture', kind: 'manual', version: '1.0.0' },
      observedAt: '2026-07-23T00:00:00.000Z', providerRecordId: null, providerSchema: null,
      payload: { companyName: 'V2 Labs', roleTitle: 'V2 Engineer' },
      evidence: [{ kind: 'title', label: 'Role title', value: 'V2 Engineer' }],
    })
    if (accepted.status !== 'succeeded') throw new Error('expected Capture creation')
    const detail = await client.captureResolutionV2.get(accepted.resource.id)
    await database.update(captureResolutionStageResults).set({
      status: 'resolved',
      issueJson: null,
      resultJson: JSON.stringify({
        url: 'https://careers.acme.com/jobs/v2-resolved',
        method: 'jobright_api_detail_apply_link',
        providerStatus: 'closed',
      }),
    }).where(and(
      eq(captureResolutionStageResults.generationId, detail.expectedGenerationId!),
      eq(captureResolutionStageResults.stage, 'destination'),
    ))
    await expect(client.captureResolutionV2.get(accepted.resource.id)).resolves.toMatchObject({
      destination: {
        status: 'resolved',
        url: 'https://careers.acme.com/jobs/v2-resolved',
        providerStatus: 'closed',
      },
    })
    const destinations = [
      'https://www.linkedin.com/jobs/view/1234567890?trk=public_jobs_topcard-title',
      'https://www.indeed.com/viewjob?jk=abc123&from=jobsearch',
      'https://jobs.lever.co/acme/01234567-89ab-cdef-0123-456789abcdef?lever-source=job-board',
    ]
    const completions: Array<{ captureId: string; detail: typeof detail; url: string }> = [{
      captureId: accepted.resource.id,
      detail,
      url: destinations[0]!,
    }]
    for (const [index, url] of destinations.slice(1).entries()) {
      const extra = await client.captures.create({
        evidenceMode: 'reported',
        adapter: { id: 'manual.capture', kind: 'manual', version: '1.0.0' },
        observedAt: `2026-07-23T00:00:0${index + 1}.000Z`,
        providerRecordId: null,
        providerSchema: null,
        payload: { companyName: `V2 ${index + 2} Labs`, roleTitle: 'V2 Engineer' },
        evidence: [{ kind: 'title', label: 'Role title', value: 'V2 Engineer' }],
      })
      if (extra.status !== 'succeeded') throw new Error('expected Capture creation')
      completions.push({
        captureId: extra.resource.id,
        detail: await client.captureResolutionV2.get(extra.resource.id),
        url,
      })
    }
    const createdJobByCapture = new Map<string, string>()
    for (const [index, completion] of completions.entries()) {
      const result = await client.captureResolutionV2.complete({
        captureId: completion.captureId,
        expectedCaptureRevision: completion.detail.captureRevision,
        expectedGenerationId: completion.detail.expectedGenerationId,
        idempotencyKey: `complete-v2-url-only-${index}`,
        actor: { id: 'operator', type: 'user' },
        jobFacts: jobFactsV2(`V2 ${index + 1} Labs`, 'V2 Engineer', completion.url),
        destination: { url: completion.url },
        externalIdentities: [],
        evidenceReferences: completion.detail.exactEvidenceReferences,
        companyResolution: { action: 'create_local', displayName: `V2 ${index + 1} Labs` },
      })
      expect(result).toMatchObject({ status: 'created', createdJob: true })
      if (result.status !== 'created') throw new Error('expected created result')
      const [stored] = await database.select({ factsJson: jobs.factsJson })
        .from(jobs).where(eq(jobs.id, result.jobId))
      expect(JSON.parse(stored!.factsJson).destination).toEqual({ url: completion.url })
      const [receipt] = await database.select({ requestSnapshotJson: captureResolutionCommandReceipts.requestSnapshotJson })
        .from(captureResolutionCommandReceipts)
        .where(eq(captureResolutionCommandReceipts.idempotencyKey, `complete-v2-url-only-${index}`))
      expect(JSON.parse(receipt!.requestSnapshotJson).destination).toEqual({
        url: completion.url.split('?')[0],
      })
      expect(await database.select({ kind: jobExternalIdentities.kind })
        .from(jobExternalIdentities).where(eq(jobExternalIdentities.jobId, result.jobId))).toEqual([])
      createdJobByCapture.set(completion.captureId, result.jobId)
    }
    const completedPage = await client.captureResolutionV2.list({
      filter: 'all',
      sort: 'observed_desc',
      limit: 50,
    })
    for (const [captureId, jobId] of createdJobByCapture) {
      expect(completedPage.items.find((item) => item.captureId === captureId)).toMatchObject({
        linkedJob: { jobId },
      })
    }

    const firstCompletion = completions[0]!
    const firstJobId = createdJobByCapture.get(firstCompletion.captureId)
    if (!firstJobId) throw new Error('expected URL-only V2 Job')

    // The V1 Job client still validates each response against `jobSchema`. Its
    // compatibility projection cannot invent a destination class or identity.
    const v1Get = await client.jobs.get(firstJobId)
    expect(v1Get?.facts.destination).toBeNull()
    expect(v1Get?.externalIdentities).toEqual([])
    const v1List = await client.jobs.list({ limit: 50 })
    expect(v1List.items.find((item) => item.id === firstJobId)).toMatchObject({
      facts: { destination: null },
      externalIdentities: [],
    })
    const v1History = await client.jobs.history({ id: firstJobId, limit: 50 })
    expect(v1History.items).toHaveLength(1)
    expect(v1History.items[0]?.snapshot.facts.destination).toBeNull()
    const v1Availability = await client.jobs.updateAvailability({
      jobId: firstJobId,
      expectedAvailabilityRevision: 1,
      actor: { id: 'operator', type: 'user' },
      availability: { state: 'closed', observedAt: '2026-07-23T01:00:00.000Z' },
      evidenceReferences: firstCompletion.detail.exactEvidenceReferences,
    })
    expect(v1Availability).toMatchObject({
      status: 'succeeded',
      resource: { facts: { destination: null }, externalIdentities: [] },
    })
    const [storedAfterV1Reads] = await database.select({ factsJson: jobs.factsJson })
      .from(jobs).where(eq(jobs.id, firstJobId))
    expect(JSON.parse(storedAfterV1Reads!.factsJson).destination).toEqual({
      url: firstCompletion.url,
    })
    expect(await database.select({ kind: jobExternalIdentities.kind })
      .from(jobExternalIdentities).where(eq(jobExternalIdentities.jobId, firstJobId))).toEqual([])

    const rejectedCapture = await client.captures.create({
      evidenceMode: 'reported',
      adapter: { id: 'manual.capture', kind: 'manual', version: '1.0.0' },
      observedAt: '2026-07-23T00:00:01.000Z', providerRecordId: null, providerSchema: null,
      payload: { companyName: 'V2 Rejected', roleTitle: 'V2 Engineer' },
      evidence: [{ kind: 'title', label: 'Role title', value: 'V2 Engineer' }],
    })
    if (rejectedCapture.status !== 'succeeded') throw new Error('expected Capture creation')
    const rejectedDetail = await client.captureResolutionV2.get(rejectedCapture.resource.id)
    const unsafeUrl = 'https://careers.acme.com/jobs/v2?access_token=destination-secret'
    const rejected = await client.captureResolutionV2.complete({
      captureId: rejectedCapture.resource.id,
      expectedCaptureRevision: rejectedDetail.captureRevision,
      expectedGenerationId: rejectedDetail.expectedGenerationId,
      idempotencyKey: 'complete-v2-sensitive-query',
      actor: { id: 'operator', type: 'user' },
      jobFacts: jobFactsV2('V2 Rejected', 'V2 Engineer', unsafeUrl),
      destination: { url: unsafeUrl },
      externalIdentities: [],
      evidenceReferences: rejectedDetail.exactEvidenceReferences,
      companyResolution: { action: 'create_local', displayName: 'V2 Rejected' },
    })
    expect(rejected).toMatchObject({
      status: 'blocked',
      failure: { kind: 'lifecycle_failure', blocker: { code: 'security_violation' } },
    })
  })

  it('serves exact bounded destination diagnostics without rejected provider data', async () => {
    const { client, local } = await setup()
    const database = getTestLocalValedictorianDatabase(local)
    const created = await client.captures.create({
      evidenceMode: 'reported',
      adapter: { id: 'manual.capture', kind: 'manual', version: '1.0.0' },
      observedAt: '2026-07-23T00:00:00.000Z',
      providerRecordId: null,
      providerSchema: null,
      payload: { companyName: 'Diagnostic Labs', roleTitle: 'Diagnostic Engineer' },
      evidence: [{ kind: 'title', label: 'Role title', value: 'Diagnostic Engineer' }],
    })
    if (created.status !== 'succeeded') throw new Error('expected Capture creation')
    const detail = await client.captureResolutionV2.get(created.resource.id)
    const issue = {
      stage: 'destination',
      code: 'destination_unsupported',
      action: 'complete_job_information',
      causedBy: null,
      message: 'The provider destination points back to Jobright and was suppressed.',
      details: {
        resolverId: 'jobright.provider-url',
        resolverVersion: 'jobright-provider-url@2',
        providerReason: 'provider_internal_destination',
        providerEvidenceKind: 'jobright_destination_provider_internal',
        providerField: 'apply_link',
      },
    } as const
    await database.update(captureResolutionStageResults).set({
      status: 'action_required',
      issueJson: JSON.stringify(issue),
      resultJson: '{}',
    }).where(and(
      eq(captureResolutionStageResults.generationId, detail.expectedGenerationId!),
      eq(captureResolutionStageResults.stage, 'destination'),
    ))
    await database.update(captureResolutionGenerations).set({
      processingSummary: 'needs_action',
    }).where(eq(captureResolutionGenerations.id, detail.expectedGenerationId!))

    const projected = await client.captureResolutionV2.get(created.resource.id)
    expect(projected.lastIssue).toEqual(issue)
    expect(JSON.stringify(projected)).not.toContain('https://jobright.ai/jobs/secret')
  })

  it('starts retry and replay over real HTTP, keeps receipts immutable, and redacts sensitive rationale audit data', async () => {
    const { client, local } = await setup()
    const database = getTestLocalValedictorianDatabase(local)
    const captures = createPgliteCaptureService(database)
    const accepted = await captures.accept({
      workspaceId: WORKSPACE,
      provenance: {
        adapterId: 'jobright.resolver', adapterKind: 'connector', adapterVersion: '0.18.2',
        providerRecordId: 'provider-http-1', providerSchema: 'jobright.v1', observedAt: '2026-07-23T00:00:00.000Z',
      },
      connectorProvenance: {
        connectorInstanceId: 'jobright-http', connectorRunId: 'jobright-http-run', executionScopeId: 'jobright-http-scope',
        reportedOrigin: { kind: 'job_board', name: 'Jobright' },
      },
      evidenceMode: 'reported', evidence: [{ kind: 'title', label: 'Role', value: 'HTTP destination role' }],
      actor: { id: 'connector', type: 'system' },
    })
    if (!accepted.ok) throw new Error(accepted.message)
    const materialization = createCaptureMaterializationService(database)
    await materialization.ensureCapture(WORKSPACE, accepted.capture.id)
    const [firstGeneration] = await database.select().from(captureResolutionGenerations)
      .where(eq(captureResolutionGenerations.captureId, accepted.capture.id))
    if (!firstGeneration) throw new Error('expected first generation')
    await database.update(captureResolutionStageResults).set({
      status: 'action_required', nextAttemptAt: null, resultJson: '{}',
      issueJson: JSON.stringify({ stage: 'destination', code: 'destination_not_found', action: 'complete_job_information', causedBy: null, message: 'Test terminal state.', details: {} }),
    }).where(and(eq(captureResolutionStageResults.generationId, firstGeneration.id), eq(captureResolutionStageResults.stage, 'destination')))

    const actor = { id: 'http-operator', type: 'user', displayName: 'HTTP Operator' } as const
    const retryInput = {
      captureId: accepted.capture.id, expectedCaptureRevision: firstGeneration.captureRevision,
      expectedGenerationId: firstGeneration.id, idempotencyKey: 'http-retry-success', actor,
    }
    const retry = await client.captureResolution.retry(retryInput)
    expect(retry).toMatchObject({ status: 'started' })
    if (retry.status !== 'started') throw new Error('expected HTTP retry to start')

    const mismatch = await client.captureResolution.retry({ ...retryInput, actor: { id: 'different-operator', type: 'user' } })
    expect(mismatch).toMatchObject({ status: 'blocked', blocker: { code: 'invalid_input' } })
    const stale = await client.captureResolution.retry({ ...retryInput, idempotencyKey: 'http-stale-retry' })
    expect(stale).toMatchObject({ status: 'blocked', blocker: { code: 'impossible_state' } })

    await database.update(captureResolutionStageResults).set({
      status: 'resolved', nextAttemptAt: null, resultJson: JSON.stringify({ url: 'https://careers.acme.com/jobs/http', method: 'employer_direct' }), issueJson: null,
    }).where(and(eq(captureResolutionStageResults.generationId, retry.generationId), eq(captureResolutionStageResults.stage, 'destination')))
    const replayInput = {
      captureId: accepted.capture.id, expectedCaptureRevision: retry.captureRevision,
      expectedGenerationId: retry.generationId, idempotencyKey: 'http-replay-success', actor,
      rationale: 'Re-run the verified destination resolution.',
    }
    const replay = await client.captureResolution.replay(replayInput)
    expect(replay).toMatchObject({ status: 'started' })
    if (replay.status !== 'started') throw new Error('expected HTTP replay to start')
    // The old generation is superseded now; a canonical typed-client replay of
    // the same idempotency request must return its immutable original result.
    await expect(client.captureResolution.replay(replayInput)).resolves.toEqual(replay)

    const [generation] = await database.select().from(captureResolutionGenerations)
      .where(eq(captureResolutionGenerations.id, replay.generationId))
    const [receipt] = await database.select().from(captureResolutionCommandReceipts)
      .where(and(eq(captureResolutionCommandReceipts.workspaceId, WORKSPACE), eq(captureResolutionCommandReceipts.idempotencyKey, 'http-replay-success')))
    expect(generation?.createdByActorJson).toBe(JSON.stringify(actor))
    expect(receipt?.requestSnapshotJson).toBe(JSON.stringify({ actor, rationale: 'Re-run the verified destination resolution.' }))

    await database.update(captureResolutionStageResults).set({
      status: 'resolved', nextAttemptAt: null,
      resultJson: JSON.stringify({ url: 'https://careers.acme.com/jobs/redaction', method: 'employer_direct' }), issueJson: null,
    }).where(and(eq(captureResolutionStageResults.generationId, replay.generationId), eq(captureResolutionStageResults.stage, 'destination')))
    const rationaleCanary = 'replay-audit-secret-canary'
    const sensitiveReplay = await client.captureResolution.replay({
      captureId: accepted.capture.id, expectedCaptureRevision: replay.captureRevision,
      expectedGenerationId: replay.generationId, idempotencyKey: 'http-replay-redacted', actor,
      rationale: `Authorization: Bearer ${rationaleCanary}`,
    })
    expect(sensitiveReplay).toMatchObject({ status: 'started' })
    const [sensitiveReceipt] = await database.select().from(captureResolutionCommandReceipts)
      .where(and(eq(captureResolutionCommandReceipts.workspaceId, WORKSPACE), eq(captureResolutionCommandReceipts.idempotencyKey, 'http-replay-redacted')))
    expect(sensitiveReceipt?.requestSnapshotJson).not.toContain(rationaleCanary)
    expect(JSON.parse(sensitiveReceipt!.requestSnapshotJson)).toEqual({
      actor,
      rationale: { redacted: true, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
    })
  })
})
