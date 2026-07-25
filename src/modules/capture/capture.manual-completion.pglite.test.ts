import { and, count, eq, isNull } from 'drizzle-orm'
import {
  completeCaptureManuallyResultSchema,
  type CompleteCaptureManuallyInput,
} from '@sparxie/sdk'
import { describe, expect, it, vi } from 'vitest'
import { workspaces } from '../../db/workspaces.schema'
import { createCoveredPgliteJobService } from '../../test/covered-job-service'
import { useResettablePgliteTestOwner } from '../../test/pglite-test-owner'
import { assignInitialCompanyOn } from '../company/company.assignment.service'
import {
  companyCapabilityState,
  companyHistory,
  jobCompanyAssignmentHistory,
  jobCompanyAssignments,
  workspaceCompanies,
} from '../company/company.schema'
import {
  createPgliteJobIdentityService,
  type JobIdentityService,
} from '../job/job.identity'
import {
  jobCaptureEvidenceReferences,
  jobExternalIdentities,
  jobHistory,
  jobs,
} from '../job/job.schema'
import type { JobFailure } from '../job/job.service'
import {
  createPgliteJobPromotion,
  type JobPromotionService,
} from '../lifecycle/capture-to-job.promotion'
import {
  captureResolutionCommandReceipts,
  captureResolutionGenerations,
  captureResolutionStageResults,
} from './capture.schema'
import { createManualCaptureCompletionService } from './capture.manual-completion'
import { createPgliteCaptureService } from './capture.service'

const resettableOwner = useResettablePgliteTestOwner()
const WORKSPACE = 'manual-completion-workspace'
const ACTOR: { readonly id: string; readonly type: 'user' } = {
  id: 'manual-completion-user',
  type: 'user',
}

function monotonicClock() {
  let tick = 0
  return () => new Date(Date.UTC(2026, 6, 23, 0, 0, tick++))
}

function jobFacts(companyName: string, roleTitle: string, destination: string | null) {
  return {
    companyName,
    roleTitle,
    sourceName: 'Manual Capture',
    roleKind: 'experienced',
    term: null,
    terms: [],
    timingMode: 'unknown',
    startDate: null,
    endDate: null,
    location: null,
    workMode: 'unknown',
    employmentType: 'unknown',
    seniority: 'unknown',
    compensation: null,
    postedAt: null,
    destination: destination
      ? { class: 'employer_or_ats', url: destination }
      : null,
  }
}

async function setup() {
  const { database } = resettableOwner()
  await database.insert(workspaces).values({
    id: WORKSPACE,
    name: WORKSPACE,
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
  })
  await database.insert(companyCapabilityState).values({
    workspaceId: WORKSPACE,
    status: 'ready',
    completed: 0,
    total: 0,
    issueCount: 0,
    blockedReason: null,
    message: null,
    updatedAt: '2026-07-23T00:00:00.000Z',
  })
  const now = monotonicClock()
  const captures = createPgliteCaptureService(database, { now })
  const jobService = createCoveredPgliteJobService(database, { now })
  const jobIdentityService = createPgliteJobIdentityService(database, { now })
  const promotion = createPgliteJobPromotion(database, captures, jobService, {
    now,
    jobIdentityService,
  })
  const completion = createManualCaptureCompletionService(database, {
    workspaceId: WORKSPACE,
    jobService,
    jobIdentityService,
    promotion,
    now,
  })
  return {
    captures,
    completion,
    database,
    jobIdentityService,
    jobService,
    now,
    promotion,
  }
}

async function acceptCapture(
  captures: ReturnType<typeof createPgliteCaptureService>,
  suffix: string,
) {
  const accepted = await captures.accept({
    workspaceId: WORKSPACE,
    provenance: {
      adapterId: 'manual.capture',
      adapterKind: 'manual',
      adapterVersion: '1.0.0',
      providerRecordId: null,
      providerSchema: null,
      observedAt: '2026-07-23T00:00:00.000Z',
    },
    evidenceMode: 'reported',
    evidence: [{ kind: 'title', label: 'Role title', value: `Engineer ${suffix}` }],
    actor: ACTOR,
  })
  if (!accepted.ok) throw new Error(accepted.message)
  return accepted.capture
}

function completionInput(
  capture: { id: string; revision: number },
  key: string,
  destination = 'https://jobs.manual-completion.acme.com/roles/engineer',
  overrides: Partial<CompleteCaptureManuallyInput> = {},
): CompleteCaptureManuallyInput {
  const base = {
    captureId: capture.id,
    expectedCaptureRevision: capture.revision,
    expectedGenerationId: null,
    idempotencyKey: key,
    actor: ACTOR,
    jobFacts: jobFacts('Manual Completion Labs', 'Completion Engineer', destination),
    destination: { class: 'employer_or_ats', url: destination },
    externalIdentities: [],
    evidenceReferences: [{
      captureId: capture.id,
      captureRevision: capture.revision,
      evidenceIndexes: [0],
    }],
    companyResolution: { action: 'create_local', displayName: 'Manual Completion Labs' },
  } satisfies CompleteCaptureManuallyInput
  return { ...base, ...overrides }
}

async function createExistingJob(
  jobService: Awaited<ReturnType<typeof setup>>['jobService'],
  name: string,
) {
  const created = await jobService.create({
    workspaceId: WORKSPACE,
    facts: jobFacts(name, `${name} Engineer`, null),
    actor: ACTOR,
  })
  if (!created.ok) throw new Error(created.message)
  return created.job
}

async function establishStrongIdentity(
  identities: Awaited<ReturnType<typeof setup>>['jobIdentityService'],
  jobId: string,
  value: string,
) {
  const established = await identities.establish({
    workspaceId: WORKSPACE,
    jobId,
    actor: ACTOR,
    identity: {
      kind: 'canonical_destination',
      provider: 'jobs.manual-completion.acme.com',
      account: 'jobs.manual-completion.acme.com',
      value,
      strength: 'strong',
      provenanceKind: 'test',
      provenanceVersion: '1',
      evidence: { value },
    },
  })
  if (!established.ok || established.attached) {
    throw new Error('Expected a distinct strong Job identity.')
  }
}

async function createExactOwners(
  jobService: Awaited<ReturnType<typeof setup>>['jobService'],
  identityService: Awaited<ReturnType<typeof setup>>['jobIdentityService'],
  ownerCount: number,
) {
  const owners: Array<{
    readonly jobId: string
    readonly identity: CompleteCaptureManuallyInput['externalIdentities'][number]
  }> = []
  for (let index = 0; index < ownerCount; index += 1) {
    const job = await createExistingJob(jobService, `Bounded Owner ${index + 1}`)
    const value = `https://jobs.manual-completion.acme.com/roles/bounded-owner-${index + 1}`
    await establishStrongIdentity(identityService, job.id, value)
    owners.push({
      jobId: job.id,
      identity: {
        kind: 'canonical_destination',
        provider: 'jobs.manual-completion.acme.com',
        account: 'jobs.manual-completion.acme.com',
        value,
        strength: 'strong',
      },
    })
  }
  return owners
}

async function countRows(database: Awaited<ReturnType<typeof setup>>['database']) {
  const [companies] = await database.select({ value: count() }).from(workspaceCompanies)
  const [jobRows] = await database.select({ value: count() }).from(jobs)
  const [assignments] = await database.select({ value: count() }).from(jobCompanyAssignments)
  const [lineage] = await database.select({ value: count() }).from(jobCaptureEvidenceReferences)
  const [generations] = await database.select({ value: count() }).from(captureResolutionGenerations)
  return {
    assignments: assignments!.value,
    companies: companies!.value,
    generations: generations!.value,
    jobs: jobRows!.value,
    lineage: lineage!.value,
  }
}

async function countCompletionWrites(
  database: Awaited<ReturnType<typeof setup>>['database'],
) {
  const rows = await countRows(database)
  const [companyHistoryRows] = await database.select({ value: count() }).from(companyHistory)
  const [assignmentHistoryRows] = await database.select({ value: count() })
    .from(jobCompanyAssignmentHistory)
  const [jobHistoryRows] = await database.select({ value: count() }).from(jobHistory)
  return {
    ...rows,
    assignmentHistory: assignmentHistoryRows!.value,
    companyHistory: companyHistoryRows!.value,
    jobHistory: jobHistoryRows!.value,
  }
}

describe.sequential('manual Capture completion', () => {
  it('replays immutable success and blocked receipts and rejects a changed fingerprint', async () => {
    const { captures, completion, database } = await setup()
    const successCapture = await acceptCapture(captures, 'receipt-success')
    const successRequest = completionInput(successCapture, 'manual-receipt-success')
    const created = await completion.complete(successRequest)
    expect(created).toMatchObject({ status: 'created', createdJob: true })
    expect(await completion.complete(successRequest)).toEqual(created)

    const mismatch = await completion.complete({
      ...successRequest,
      actor: { id: 'different-user', type: 'user' },
    })
    expect(mismatch).toMatchObject({
      status: 'blocked',
      failure: { kind: 'lifecycle_failure', blocker: { code: 'invalid_input' } },
    })

    const unsafeCapture = await acceptCapture(captures, 'receipt-blocked')
    const unsafeRequest = completionInput(
      unsafeCapture,
      'manual-receipt-blocked',
      'https://jobs.manual-completion.acme.com/roles/engineer?token=forbidden',
    )
    const blocked = await completion.complete(unsafeRequest)
    expect(blocked).toMatchObject({
      status: 'blocked',
      failure: { kind: 'lifecycle_failure', blocker: { code: 'security_violation' } },
    })
    expect(await completion.complete(unsafeRequest)).toEqual(blocked)
    expect(await database.select({ value: count() }).from(captureResolutionCommandReceipts))
      .toEqual([{ value: 2 }])
  })

  it('enforces destination safety on both manual destination fields', async () => {
    const { captures, completion } = await setup()
    const capture = await acceptCapture(captures, 'manual-job-facts-destination')
    const request = completionInput(capture, 'manual-job-facts-destination', undefined, {
      jobFacts: jobFacts(
        'Manual Completion Labs',
        'Completion Engineer',
        'https://careers.acme.com/jobs/123?access_token=destination-secret',
      ),
    })

    await expect(completion.complete(request)).resolves.toMatchObject({
      status: 'blocked',
      failure: { kind: 'lifecycle_failure', blocker: { code: 'security_violation' } },
    })
  })

  it.each([
    'https://careers.acme.com/jobs/123#',
    'https://@careers.acme.com/jobs/123',
    'https:\\\\@careers.acme.com/path',
    'https://careers.acme.com\\\\jobs/email@acme.com',
  ])('rejects manual destination delimiters that URL parsing normalizes away: %s', async (destination) => {
    const { captures, completion } = await setup()
    const capture = await acceptCapture(captures, `manual-delimiter-${destination.length}`)

    await expect(completion.complete(completionInput(
      capture,
      `manual-delimiter-${destination.length}`,
      destination,
    ))).resolves.toMatchObject({
      status: 'blocked',
      failure: { kind: 'lifecycle_failure', blocker: { code: 'security_violation' } },
    })
  })

  it('accepts ordinary at signs in manual destination paths and queries', async () => {
    const { captures, completion, database } = await setup()
    const capture = await acceptCapture(captures, 'manual-ordinary-at-sign')
    const destination = 'https://careers.acme.com/jobs/email@acme.com?ref=jobs@board%23weekly'

    const result = await completion.complete(completionInput(
      capture,
      'manual-ordinary-at-sign',
      destination,
    ))

    expect(result).toMatchObject({ status: 'created', createdJob: true })
    if (result.status !== 'created') throw new Error('expected created result')
    const [job] = await database.select({ factsJson: jobs.factsJson }).from(jobs)
      .where(eq(jobs.id, result.jobId))
    expect(JSON.parse(job!.factsJson).destination).toEqual({
      class: 'employer_or_ats',
      url: destination,
    })
  })

  it('scopes the same idempotency key independently for retry and completion commands', async () => {
    const { captures, completion, database } = await setup()
    const capture = await acceptCapture(captures, 'cross-command-receipt')
    const idempotencyKey = 'shared-cross-command-key'
    await database.insert(captureResolutionCommandReceipts).values({
      workspaceId: WORKSPACE,
      operation: 'retry',
      idempotencyKey,
      requestFingerprint: 'a'.repeat(64),
      requestSnapshotJson: '{}',
      resultJson: '{}',
      createdAt: '2026-07-23T00:00:00.000Z',
    })

    const result = await completion.complete(
      completionInput(capture, idempotencyKey),
    )

    expect(result).toMatchObject({ status: 'created', createdJob: true })
    expect(await database.select({
      operation: captureResolutionCommandReceipts.operation,
    }).from(captureResolutionCommandReceipts)
      .where(eq(captureResolutionCommandReceipts.idempotencyKey, idempotencyKey))
      .orderBy(captureResolutionCommandReceipts.operation))
      .toEqual([{ operation: 'complete' }, { operation: 'retry' }])
  })

  it.each([
    {
      status: 'migrating' as const,
      blockedReason: null,
      message: null,
      expectedMessage: 'Workspace Companies are still being prepared.',
    },
    {
      status: 'blocked' as const,
      blockedReason: 'migration_failed' as const,
      message: 'Workspace Company migration failed.',
      expectedMessage: 'Workspace Company migration failed.',
    },
  ])('blocks completion while Company capability is $status without lifecycle writes', async ({
    status,
    blockedReason,
    message,
    expectedMessage,
  }) => {
    const { captures, completion, database } = await setup()
    await database.update(companyCapabilityState).set({
      status,
      blockedReason,
      message,
      issueCount: status === 'blocked' ? 1 : 0,
    }).where(eq(companyCapabilityState.workspaceId, WORKSPACE))
    const capture = await acceptCapture(captures, `company-capability-${status}`)
    const before = await countCompletionWrites(database)
    const request = completionInput(
      capture,
      `manual-company-capability-${status}`,
    )

    const result = await completion.complete(request)

    expect(result).toMatchObject({
      status: 'blocked',
      failure: {
        kind: 'lifecycle_failure',
        blocker: {
          code: 'impossible_state',
          message: expectedMessage,
        },
      },
    })
    expect(await completion.complete(request)).toEqual(result)
    expect(await countCompletionWrites(database)).toEqual(before)
    expect(await database.select({ value: count() })
      .from(captureResolutionCommandReceipts))
      .toEqual([{ value: 1 }])
  })

  it('creates a null-generation completion with destination-only identity and terminal stages', async () => {
    const { captures, completion, database } = await setup()
    const capture = await acceptCapture(captures, 'null-generation')
    const request = completionInput(capture, 'manual-null-generation')
    const result = await completion.complete(request)
    completeCaptureManuallyResultSchema.parse(result)
    expect(result).toMatchObject({ status: 'created', createdJob: true })
    if (result.status !== 'created') return

    const [job] = await database.select({ factsJson: jobs.factsJson })
      .from(jobs).where(eq(jobs.id, result.jobId))
    expect(JSON.parse(job!.factsJson).destination).toEqual({
      class: 'employer_or_ats',
      url: 'https://jobs.manual-completion.acme.com/roles/engineer',
    })
    const identities = await database.select({ value: jobExternalIdentities.value })
      .from(jobExternalIdentities)
      .where(eq(jobExternalIdentities.jobId, result.jobId))
    expect(identities).toEqual([{
      value: 'https://jobs.manual-completion.acme.com/roles/engineer',
    }])
    const stages = await database.select({
      stage: captureResolutionStageResults.stage,
      status: captureResolutionStageResults.status,
    }).from(captureResolutionStageResults)
    expect(stages).toEqual(expect.arrayContaining([
      { stage: 'destination', status: 'resolved' },
      { stage: 'information', status: 'resolved' },
      { stage: 'promotion', status: 'promoted' },
    ]))
  })

  it('serializes concurrent identical completion keys onto one immutable result', async () => {
    const { captures, completion, database } = await setup()
    const capture = await acceptCapture(captures, 'same-key-race')
    const request = completionInput(capture, 'manual-same-key-race')
    const [first, second] = await Promise.all([
      completion.complete(request),
      completion.complete(request),
    ])
    expect(second).toEqual(first)
    expect(await database.select({ value: count() }).from(jobs)).toEqual([{ value: 1 }])
    expect(await database.select({ value: count() }).from(captureResolutionCommandReceipts))
      .toEqual([{ value: 1 }])
  })

  it('returns stale generation and unknown evidence failures without lifecycle writes', async () => {
    const { captures, completion, database } = await setup()
    const staleCapture = await acceptCapture(captures, 'stale-generation')
    await database.insert(captureResolutionGenerations).values({
      id: 'generation-current',
      workspaceId: WORKSPACE,
      captureId: staleCapture.id,
      captureRevision: staleCapture.revision,
      ordinal: 1,
      trigger: 'intake',
      status: 'active',
      processingSummary: 'awaiting_information',
      inputFingerprint: 'a'.repeat(64),
      retryPolicyId: 'test',
      retryPolicySnapshotJson: '{}',
      resolverSelectionSnapshotJson: '{}',
      createdByActorJson: JSON.stringify(ACTOR),
      linkedJobId: null,
      createdAt: '2026-07-23T00:00:00.000Z',
      updatedAt: '2026-07-23T00:00:00.000Z',
    })
    const stale = await completion.complete({
      ...completionInput(staleCapture, 'manual-stale-generation'),
      expectedGenerationId: 'generation-stale',
    })
    expect(stale).toMatchObject({
      status: 'blocked',
      failure: { kind: 'stale_guard', recovery: { guards: [{ kind: 'generation' }] } },
    })
    expect(await countRows(database)).toMatchObject({
      companies: 0,
      jobs: 0,
      assignments: 0,
      lineage: 0,
      generations: 1,
    })

    const indexCapture = await acceptCapture(captures, 'unknown-index')
    const missingEvidence = await completion.complete({
      ...completionInput(indexCapture, 'manual-unknown-index'),
      evidenceReferences: [{
        captureId: indexCapture.id,
        captureRevision: indexCapture.revision,
        evidenceIndexes: [9],
      }],
    })
    expect(missingEvidence).toMatchObject({
      status: 'blocked',
      failure: { kind: 'lifecycle_failure', blocker: { code: 'missing_lineage' } },
    })
    expect(await countRows(database)).toMatchObject({ jobs: 0, assignments: 0, lineage: 0 })
  })

  it('rolls back inline Company, Job, assignment, lineage, and generation on finalization failure', async () => {
    const { captures, database, jobIdentityService, jobService, now, promotion } = await setup()
    const failure: JobFailure = {
      ok: false,
      code: 'invalid_input',
      message: 'Injected finalization failure.',
    }
    const failingPromotion: JobPromotionService = {
      ...promotion,
      promoteCaptureOn: vi.fn(async () => failure),
    }
    const completion = createManualCaptureCompletionService(database, {
      workspaceId: WORKSPACE,
      jobService,
      jobIdentityService,
      promotion: failingPromotion,
      now,
    })
    const capture = await acceptCapture(captures, 'finalization-rollback')
    const request = completionInput(capture, 'manual-finalization-rollback')
    const result = await completion.complete(request)
    expect(result).toMatchObject({
      status: 'blocked',
      failure: { kind: 'lifecycle_failure', blocker: { code: 'strong_identity_conflict' } },
    })
    expect(await countRows(database)).toEqual({
      assignments: 0,
      companies: 0,
      generations: 0,
      jobs: 0,
      lineage: 0,
    })
    expect(await completion.complete(request)).toEqual(result)
  })

  it('rolls back an existing-assignment callback mismatch in the shared Job creation seam', async () => {
    const { database, jobService, now } = await setup()
    const created = await jobService.create({
      workspaceId: WORKSPACE,
      facts: jobFacts('Existing Assignment', 'Existing Assignment Engineer', null),
      actor: ACTOR,
      idempotencyKey: 'existing-assignment-callback',
    })
    if (!created.ok) throw new Error(created.message)
    const existing = created.job
    const [existingAssignment] = await database.select().from(jobCompanyAssignments)
      .where(eq(jobCompanyAssignments.jobId, existing.id))
    if (!existingAssignment) throw new Error('Expected baseline Company assignment.')
    await database.insert(workspaceCompanies).values({
      id: '01980c4f-1111-7000-8000-000000000001',
      workspaceId: WORKSPACE,
      displayName: 'Other Company',
      normalizedDisplayName: 'other company',
      websiteUrl: null,
      websiteHost: null,
      notes: null,
      revision: 1,
      status: 'active',
      mergedIntoCompanyId: null,
      createdAt: '2026-07-23T00:00:00.000Z',
      updatedAt: '2026-07-23T00:00:00.000Z',
    })
    await expect(database.transaction((tx) => jobService.createForCompanyAssignmentOn(tx, {
      workspaceId: WORKSPACE,
      facts: jobFacts('Existing Assignment', 'Existing Assignment Engineer', null),
      actor: ACTOR,
      idempotencyKey: 'existing-assignment-callback',
      selectedCompanyId: '01980c4f-1111-7000-8000-000000000001',
      establishInitialAssignment: ({ jobId, workspaceId, companyId }) => assignInitialCompanyOn(tx, {
        workspaceId,
        jobId,
        companyId,
        actor: ACTOR,
        rationale: 'Test existing assignment mismatch.',
        now: now().toISOString(),
        newId: () => '01980c4f-1111-7000-8000-000000000002',
      }),
    }))).rejects.toThrow('Initial Company assignment conflicts with the selected Company.')
    const [assignment] = await database.select().from(jobCompanyAssignments)
      .where(eq(jobCompanyAssignments.jobId, existing.id))
    expect(assignment?.companyId).toBe(existingAssignment.companyId)
    expect(await database.select({ value: count() }).from(jobHistory))
      .toEqual([{ value: 1 }])
  })

  it('automatically attaches one exact owner and blocks an incompatible Company choice without an orphan', async () => {
    const { captures, completion, database, jobIdentityService, jobService } = await setup()
    const destination = 'https://jobs.manual-completion.acme.com/roles/exact-owner'
    const existing = await createExistingJob(jobService, 'Existing Owner')
    await establishStrongIdentity(jobIdentityService, existing.id, destination)

    const matchingCapture = await acceptCapture(captures, 'single-owner')
    const attached = await completion.complete(completionInput(
      matchingCapture,
      'manual-single-owner',
      destination,
      {
        companyResolution: {
          action: 'use_local',
          companyId: existing.id,
          expectedCompanyRevision: 1,
          restoreIfArchived: false,
        },
      },
    ))
    expect(attached).toMatchObject({
      status: 'created',
      jobId: existing.id,
      companyId: existing.id,
      createdJob: false,
    })
    expect(await database.select({ value: count() }).from(jobCaptureEvidenceReferences)
      .where(eq(jobCaptureEvidenceReferences.captureId, matchingCapture.id)))
      .toEqual([{ value: 1 }])

    const conflictCapture = await acceptCapture(captures, 'assignment-conflict')
    const before = await countRows(database)
    const conflict = await completion.complete(completionInput(
      conflictCapture,
      'manual-assignment-conflict',
      destination,
    ))
    expect(conflict).toMatchObject({
      status: 'company_assignment_blocked',
      existingJobId: existing.id,
      currentCompanyId: existing.id,
    })
    expect(await countRows(database)).toEqual({
      ...before,
      generations: before.generations + 1,
      lineage: before.lineage,
    })
  })

  it('returns every current owner and validates attach decisions against the full snapshot', async () => {
    const { captures, completion, database, jobIdentityService, jobService } = await setup()
    const first = await createExistingJob(jobService, 'First Conflict')
    const second = await createExistingJob(jobService, 'Second Conflict')
    const firstIdentity = 'https://jobs.manual-completion.acme.com/roles/first-conflict'
    const secondIdentity = 'https://jobs.manual-completion.acme.com/roles/second-conflict'
    await establishStrongIdentity(jobIdentityService, first.id, firstIdentity)
    await establishStrongIdentity(jobIdentityService, second.id, secondIdentity)
    const capture = await acceptCapture(captures, 'multi-owner')
    const owners = [
      {
        kind: 'canonical_destination',
        provider: 'jobs.manual-completion.acme.com',
        account: 'jobs.manual-completion.acme.com',
        value: firstIdentity,
        strength: 'strong',
      },
      {
        kind: 'canonical_destination',
        provider: 'jobs.manual-completion.acme.com',
        account: 'jobs.manual-completion.acme.com',
        value: secondIdentity,
        strength: 'strong',
      },
    ]
    const base = completionInput(capture, 'manual-multi-owner', undefined, {
      destination: null,
      jobFacts: jobFacts('Conflict Labs', 'Conflict Engineer', null),
      externalIdentities: owners,
    })
    const blocked = await completion.complete(base)
    expect(blocked).toMatchObject({
      status: 'duplicate_blocked',
      blockerCode: 'strong_identity_conflict',
      allowedDecisions: ['attach', 'merge'],
    })
    if (blocked.status !== 'duplicate_blocked') return
    expect(blocked.conflictingJobs.map((job) => job.jobId).sort())
      .toEqual([first.id, second.id].sort())

    const foreignTarget = await completion.complete({
      ...base,
      idempotencyKey: 'manual-multi-owner-foreign',
      duplicateResolution: {
        action: 'attach',
        targetJobId: '01980c4f-2222-7000-8000-000000000001',
        expectedJobFactsRevision: 1,
        expectedAssignmentRevision: 1,
      },
    })
    expect(foreignTarget).toMatchObject({
      status: 'duplicate_blocked',
      conflictingJobs: [{ jobId: expect.any(String) }, { jobId: expect.any(String) }],
    })

    const factsMismatch = await completion.complete({
      ...base,
      idempotencyKey: 'manual-multi-owner-facts',
      duplicateResolution: {
        action: 'attach',
        targetJobId: first.id,
        expectedJobFactsRevision: 2,
        expectedAssignmentRevision: 1,
      },
    })
    expect(factsMismatch).toMatchObject({ status: 'duplicate_blocked' })
    if (factsMismatch.status === 'duplicate_blocked') {
      expect(factsMismatch.conflictingJobs.find((job) => job.jobId === first.id))
        .toMatchObject({ jobFactsRevision: 1 })
    }

    const assignmentMismatch = await completion.complete({
      ...base,
      idempotencyKey: 'manual-multi-owner-assignment',
      duplicateResolution: {
        action: 'attach',
        targetJobId: first.id,
        expectedJobFactsRevision: 1,
        expectedAssignmentRevision: 2,
      },
    })
    expect(assignmentMismatch).toMatchObject({
      status: 'blocked',
      failure: {
        kind: 'stale_guard',
        recovery: {
          guards: [{
            kind: 'assignment_revision',
            jobId: first.id,
            expectedRevision: 2,
            currentRevision: 1,
          }],
        },
      },
    })

    const attached = await completion.complete({
      ...base,
      idempotencyKey: 'manual-multi-owner-attach',
      companyResolution: {
        action: 'use_local',
        companyId: first.id,
        expectedCompanyRevision: 1,
        restoreIfArchived: false,
      },
      duplicateResolution: {
        action: 'attach',
        targetJobId: first.id,
        expectedJobFactsRevision: 1,
        expectedAssignmentRevision: 1,
      },
    })
    expect(attached).toMatchObject({ status: 'created', jobId: first.id, createdJob: false })
    expect(await database.select({ value: count() }).from(jobCaptureEvidenceReferences)
      .where(eq(jobCaptureEvidenceReferences.captureId, capture.id)))
      .toEqual([{ value: 1 }])
  })

  it('bounds a 21-owner blocker while accepting recovery against the complete owner set', async () => {
    const { captures, completion, jobIdentityService, jobService } = await setup()
    const owners = await createExactOwners(jobService, jobIdentityService, 21)
    const capture = await acceptCapture(captures, 'twenty-one-owners')
    const base = completionInput(capture, 'manual-twenty-one-owners', undefined, {
      destination: null,
      jobFacts: jobFacts('Bounded Owners', 'Bounded Engineer', null),
      externalIdentities: owners.map((owner) => owner.identity),
    })

    const blocked = await completion.complete(base)
    expect(blocked).toMatchObject({
      status: 'duplicate_blocked',
      blockerCode: 'strong_identity_conflict',
      allowedDecisions: ['attach', 'merge'],
    })
    if (blocked.status !== 'duplicate_blocked') return
    expect(blocked.conflictingJobs).toHaveLength(20)
    completeCaptureManuallyResultSchema.parse(blocked)

    const hiddenOwner = owners.find((owner) =>
      !blocked.conflictingJobs.some((listed) => listed.jobId === owner.jobId))
    if (!hiddenOwner) throw new Error('Expected one owner outside the bounded public snapshot.')
    const attached = await completion.complete({
      ...base,
      idempotencyKey: 'manual-twenty-one-owners-attach',
      companyResolution: {
        action: 'use_local',
        companyId: hiddenOwner.jobId,
        expectedCompanyRevision: 1,
        restoreIfArchived: false,
      },
      duplicateResolution: {
        action: 'attach',
        targetJobId: hiddenOwner.jobId,
        expectedJobFactsRevision: 1,
        expectedAssignmentRevision: 1,
      },
    })
    expect(attached).toMatchObject({
      status: 'created',
      jobId: hiddenOwner.jobId,
      createdJob: false,
    })
  }, 30_000)

  it('returns a closed typed blocker for the maximum 100 exact owners', async () => {
    const { captures, completion, database, jobIdentityService, jobService } = await setup()
    const owners = await createExactOwners(jobService, jobIdentityService, 100)
    const capture = await acceptCapture(captures, 'one-hundred-owners')

    const blocked = await completion.complete(completionInput(
      capture,
      'manual-one-hundred-owners',
      undefined,
      {
        destination: null,
        jobFacts: jobFacts('Maximum Owners', 'Maximum Owner Engineer', null),
        externalIdentities: owners.map((owner) => owner.identity),
      },
    ))

    expect(blocked).toMatchObject({
      status: 'duplicate_blocked',
      blockerCode: 'strong_identity_conflict',
    })
    if (blocked.status !== 'duplicate_blocked') return
    expect(blocked.conflictingJobs).toHaveLength(20)
    completeCaptureManuallyResultSchema.parse(blocked)
    const [promotionStage] = await database.select({
      resultJson: captureResolutionStageResults.resultJson,
    }).from(captureResolutionStageResults)
      .where(eq(captureResolutionStageResults.stage, 'promotion'))
    expect(completeCaptureManuallyResultSchema.parse(
      JSON.parse(promotionStage!.resultJson),
    )).toEqual(blocked)
  }, 30_000)

  it('merges all exact owners, finalizes on the canonical winner, and keeps its Company assignment', async () => {
    const { captures, completion, database, jobIdentityService, jobService } = await setup()
    const winner = await createExistingJob(jobService, 'Canonical Winner')
    const loser = await createExistingJob(jobService, 'Merged Loser')
    const winnerIdentity = 'https://jobs.manual-completion.acme.com/roles/canonical-winner'
    const loserIdentity = 'https://jobs.manual-completion.acme.com/roles/merged-loser'
    await establishStrongIdentity(jobIdentityService, winner.id, winnerIdentity)
    await establishStrongIdentity(jobIdentityService, loser.id, loserIdentity)
    const capture = await acceptCapture(captures, 'real-merge')
    const result = await completion.complete(completionInput(capture, 'manual-real-merge', undefined, {
      destination: null,
      jobFacts: jobFacts('Canonical Winner', 'Merged Engineer', null),
      externalIdentities: [
        {
          kind: 'canonical_destination',
          provider: 'jobs.manual-completion.acme.com',
          account: 'jobs.manual-completion.acme.com',
          value: winnerIdentity,
          strength: 'strong',
        },
        {
          kind: 'canonical_destination',
          provider: 'jobs.manual-completion.acme.com',
          account: 'jobs.manual-completion.acme.com',
          value: loserIdentity,
          strength: 'strong',
        },
      ],
      companyResolution: {
        action: 'use_local',
        companyId: winner.id,
        expectedCompanyRevision: 1,
        restoreIfArchived: false,
      },
      duplicateResolution: {
        action: 'merge',
        targetJobId: loser.id,
        expectedJobFactsRevision: 1,
        expectedAssignmentRevision: 1,
      },
    }))
    expect(result).toMatchObject({
      status: 'created',
      jobId: winner.id,
      companyId: winner.id,
      createdJob: false,
    })
    expect(await database.select({ removedAt: jobs.removedAt }).from(jobs)
      .where(eq(jobs.id, loser.id))).toEqual([{ removedAt: expect.any(String) }])
    expect(await database.select({ jobId: jobCaptureEvidenceReferences.jobId })
      .from(jobCaptureEvidenceReferences)
      .where(eq(jobCaptureEvidenceReferences.captureId, capture.id)))
      .toEqual([{ jobId: winner.id }])
    expect(await database.select({ companyId: jobCompanyAssignments.companyId })
      .from(jobCompanyAssignments)
      .where(eq(jobCompanyAssignments.jobId, winner.id)))
      .toEqual([{ companyId: winner.id }])
    expect(await database.select({ value: count() }).from(jobExternalIdentities)
      .where(and(eq(jobExternalIdentities.jobId, winner.id), isNull(jobExternalIdentities.removedAt))))
      .toEqual([{ value: 2 }])
  })

  it('rolls back and replays a typed merge failure under the original receipt lock', async () => {
    const { captures, database, jobIdentityService, jobService, now, promotion } = await setup()
    const first = await createExistingJob(jobService, 'Failed Merge First')
    const second = await createExistingJob(jobService, 'Failed Merge Second')
    const firstIdentity = 'https://jobs.manual-completion.acme.com/roles/failed-merge-first'
    const secondIdentity = 'https://jobs.manual-completion.acme.com/roles/failed-merge-second'
    await establishStrongIdentity(jobIdentityService, first.id, firstIdentity)
    await establishStrongIdentity(jobIdentityService, second.id, secondIdentity)
    const failure: JobFailure = {
      ok: false,
      code: 'invalid_input',
      message: 'Injected merge failure.',
    }
    const failingIdentityService: JobIdentityService = {
      ...jobIdentityService,
      mergeOn: vi.fn(async () => failure),
    }
    const completion = createManualCaptureCompletionService(database, {
      workspaceId: WORKSPACE,
      jobService,
      jobIdentityService: failingIdentityService,
      promotion,
      now,
    })
    const capture = await acceptCapture(captures, 'typed-merge-failure')
    const request = completionInput(capture, 'manual-typed-merge-failure', undefined, {
      destination: null,
      jobFacts: jobFacts('Failed Merge First', 'Failed Merge Engineer', null),
      externalIdentities: [
        {
          kind: 'canonical_destination',
          provider: 'jobs.manual-completion.acme.com',
          account: 'jobs.manual-completion.acme.com',
          value: firstIdentity,
          strength: 'strong',
        },
        {
          kind: 'canonical_destination',
          provider: 'jobs.manual-completion.acme.com',
          account: 'jobs.manual-completion.acme.com',
          value: secondIdentity,
          strength: 'strong',
        },
      ],
      companyResolution: {
        action: 'use_local',
        companyId: first.id,
        expectedCompanyRevision: 1,
        restoreIfArchived: false,
      },
      duplicateResolution: {
        action: 'merge',
        targetJobId: second.id,
        expectedJobFactsRevision: 1,
        expectedAssignmentRevision: 1,
      },
    })
    const result = await completion.complete(request)
    expect(result).toMatchObject({
      status: 'blocked',
      failure: { kind: 'lifecycle_failure', blocker: { code: 'strong_identity_conflict' } },
    })
    expect(await completion.complete(request)).toEqual(result)
    expect(await database.select({ value: count() }).from(jobs)
      .where(isNull(jobs.removedAt))).toEqual([{ value: 2 }])
    expect(await database.select({ value: count() }).from(jobCaptureEvidenceReferences))
      .toEqual([{ value: 0 }])
  })
})
