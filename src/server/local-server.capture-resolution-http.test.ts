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
import { jobCaptureEvidenceReferences, jobs } from '../modules/job/job.schema'
import { jobCompanyAssignments, workspaceCompanies } from '../modules/company/company.schema'

const WORKSPACE = 'capture-resolution-http-workspace'

function jobFacts(companyName: string, roleTitle: string) {
  return {
    companyName, roleTitle, sourceName: 'Manual completion', roleKind: 'experienced',
    term: null, terms: [], timingMode: 'unknown', startDate: null, endDate: null,
    location: null, workMode: 'unknown', employmentType: 'unknown', seniority: 'unknown',
    compensation: null, postedAt: null,
    destination: { class: 'employer_or_ats', url: 'https://jobs.completion.example/roles/engineer' },
  } as const
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
      destination: { class: 'employer_or_ats', url: 'https://jobs.completion.example/roles/engineer' },
      externalIdentities: [], evidenceReferences: detail.exactEvidenceReferences,
      companyResolution: { action: 'create_local', displayName: 'Completion Labs' },
    })
    expect(result).toMatchObject({ status: 'created', createdJob: true })
    if (result.status !== 'created') throw new Error('expected created result')
    await expect(client.captureResolution.complete({
      captureId: created.resource.id, expectedCaptureRevision: detail.captureRevision,
      expectedGenerationId: null, idempotencyKey: 'complete-http-1', actor: { id: 'operator', type: 'user' },
      jobFacts: jobFacts('Completion Labs', 'Completion Engineer'),
      destination: { class: 'employer_or_ats', url: 'https://jobs.completion.example/roles/engineer' },
      externalIdentities: [], evidenceReferences: detail.exactEvidenceReferences,
      companyResolution: { action: 'create_local', displayName: 'Completion Labs' },
    })).resolves.toEqual(result)
    const changedFingerprint = await client.captureResolution.complete({
      captureId: created.resource.id, expectedCaptureRevision: detail.captureRevision,
      expectedGenerationId: null, idempotencyKey: 'complete-http-1', actor: { id: 'different-operator', type: 'user' },
      jobFacts: jobFacts('Completion Labs', 'Completion Engineer'),
      destination: { class: 'employer_or_ats', url: 'https://jobs.completion.example/roles/engineer' },
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

  it('starts retry and replay over real HTTP, keeps receipts immutable, and redacts sensitive rationale audit data', async () => {
    const { client, local } = await setup()
    const database = getTestLocalValedictorianDatabase(local)
    const captures = createPgliteCaptureService(database)
    const accepted = await captures.accept({
      workspaceId: WORKSPACE,
      provenance: {
        adapterId: 'jobright.resolver', adapterKind: 'connector', adapterVersion: '0.18.1',
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
      status: 'resolved', nextAttemptAt: null, resultJson: JSON.stringify({ url: 'https://careers.example.com/jobs/http', method: 'employer_direct' }), issueJson: null,
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
      resultJson: JSON.stringify({ url: 'https://careers.example.com/jobs/redaction', method: 'employer_direct' }), issueJson: null,
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
