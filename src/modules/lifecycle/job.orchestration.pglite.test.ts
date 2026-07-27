/**
 * Job write orchestration — red-first pglite proofs (issue #304).
 *
 * The write half of the Job HTTP surface: `createJob` / `correctFacts` /
 * `updateAvailability` / `addExternalIdentity` / `removeExternalIdentity` compose
 * the Job service cores, the Job-owned evidence-reference and external-identity
 * conversations, and the Job identity service in one transaction per write.
 * Proves: every requested evidence reference lands on the job (the client's create
 * correlation), lineage/ownership are validated as blocks (missing/foreign
 * lineage) not transport errors, create-time strong identities establish and
 * conflict deterministically, idempotency-key re-create converges, corrections and
 * availability updates bump revisions and link their supporting evidence,
 * external-identity add/remove flow through the identity service, duplicate
 * attach/merge resolve to the target job, and workspace isolation holds.
 */
import { describe, expect, it } from 'vitest'
import { and, eq, isNull } from 'drizzle-orm'
import { useResettablePgliteTestOwner } from '../../test/pglite-test-owner'
import { workspaces } from '../../db/workspaces.schema'
import { createPgliteCaptureService, type CaptureService } from '../capture/capture.service'
import { createPgliteJobServiceWithCompanies } from '../../test/job-service-with-companies'
import { createPgliteJobIdentityService } from '../job/job.identity'
import { jobCaptureEvidenceReferences, jobExternalIdentities } from '../job/job.schema'
import { createLifecycleJobOrchestration, type JobEvidenceReferenceInput } from './job.orchestration'

const resettableOwner = useResettablePgliteTestOwner()

function monotonicClock(startMs = Date.UTC(2026, 6, 21, 0, 0, 0)) {
  let tick = 0
  return () => new Date(startMs + tick++ * 1000)
}

const ACTOR = { type: 'user', id: 'u-1' } as const

async function setup() {
  const { database } = resettableOwner()
  for (const id of ['ws-a', 'ws-b']) {
    await database.insert(workspaces).values({ id, name: id, createdAt: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z' })
  }
  const now = monotonicClock()
  const captures = createPgliteCaptureService(database, { now })
  const jobService = createPgliteJobServiceWithCompanies(database, { now })
  const jobIdentityService = createPgliteJobIdentityService(database, { now })
  const orchestration = createLifecycleJobOrchestration(database, { jobService, jobIdentityService, now })
  return { database, captures, jobService, jobIdentityService, orchestration }
}

let recordCounter = 0
async function acceptCapture(captures: CaptureService, workspaceId = 'ws-a'): Promise<JobEvidenceReferenceInput> {
  recordCounter += 1
  const result = await captures.accept({
    workspaceId,
    provenance: { adapterId: 'cli', adapterKind: 'cli', adapterVersion: '1.0.0', providerRecordId: `rec-${recordCounter}`, providerSchema: null, observedAt: '2026-07-19T10:00:00.000Z' },
    evidenceMode: 'reported',
    evidence: [{ kind: 'title', label: 'Title', value: 'Engineer' }],
    actor: ACTOR,
  })
  if (!result.ok) throw new Error(`accept failed: ${result.code}`)
  return { captureId: result.capture.id, captureRevision: result.capture.revision, evidenceIndexes: [0] }
}

const FACTS = { companyName: 'Acme', roleTitle: 'Engineer' }
const AVAILABILITY = { state: 'open', observedAt: '2026-07-21T00:00:00.000Z' }

function evidenceRefRows(database: Awaited<ReturnType<typeof setup>>['database'], jobId: string) {
  return database.select().from(jobCaptureEvidenceReferences).where(eq(jobCaptureEvidenceReferences.jobId, jobId))
}
function activeIdentityRows(database: Awaited<ReturnType<typeof setup>>['database'], jobId: string) {
  return database.select().from(jobExternalIdentities).where(and(eq(jobExternalIdentities.jobId, jobId), isNull(jobExternalIdentities.removedAt)))
}

describe.sequential('Job write orchestration (#304)', () => {
  it('creates a job, links every requested evidence reference, and establishes external identities', async () => {
    const { database, captures, jobService, orchestration } = await setup()
    const ref = await acceptCapture(captures)
    const outcome = await orchestration.createJob({
      workspaceId: 'ws-a', actor: ACTOR, facts: FACTS, availability: AVAILABILITY,
      evidenceReferences: [ref],
      externalIdentities: [{ kind: 'ats_job', provider: 'greenhouse', account: 'acme', value: 'job-1', strength: 'strong' }],
    })
    expect(outcome).toMatchObject({ ok: true, created: true })
    if (!outcome.ok) return
    expect(await jobService.get('ws-a', outcome.jobId)).not.toBeNull()
    const refs = await evidenceRefRows(database, outcome.jobId)
    expect(refs.map((r) => r.captureId)).toContain(ref.captureId)
    const identities = await activeIdentityRows(database, outcome.jobId)
    expect(identities.map((i) => i.value)).toContain('job-1')
    expect((await jobService.history('ws-a', outcome.jobId)).map((h) => h.kind)).toContain('identity_added')
  })

  it('blocks a create whose evidence reference names an unknown capture (missing_lineage)', async () => {
    const { orchestration } = await setup()
    const outcome = await orchestration.createJob({
      workspaceId: 'ws-a', actor: ACTOR, facts: FACTS, availability: AVAILABILITY,
      evidenceReferences: [{ captureId: 'nope', captureRevision: 1, evidenceIndexes: [0] }],
      externalIdentities: [],
    })
    expect(outcome).toMatchObject({ ok: false, failure: { code: 'missing_lineage' } })
  })

  it('blocks a create whose evidence reference belongs to another workspace (foreign_lineage)', async () => {
    const { captures, orchestration } = await setup()
    const foreignRef = await acceptCapture(captures, 'ws-b')
    const outcome = await orchestration.createJob({
      workspaceId: 'ws-a', actor: ACTOR, facts: FACTS, availability: AVAILABILITY,
      evidenceReferences: [foreignRef], externalIdentities: [],
    })
    expect(outcome).toMatchObject({ ok: false, failure: { code: 'foreign_lineage' } })
  })

  it('converges an idempotency-key re-create to the already-created job', async () => {
    const { captures, orchestration } = await setup()
    const ref = await acceptCapture(captures)
    const first = await orchestration.createJob({ workspaceId: 'ws-a', actor: ACTOR, facts: FACTS, availability: AVAILABILITY, idempotencyKey: 'k-1', evidenceReferences: [ref], externalIdentities: [] })
    const second = await orchestration.createJob({ workspaceId: 'ws-a', actor: ACTOR, facts: FACTS, availability: AVAILABILITY, idempotencyKey: 'k-1', evidenceReferences: [ref], externalIdentities: [] })
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(second.jobId).toBe(first.jobId)
    expect(second.created).toBe(false)
  })

  it('blocks a create claiming a strong identity already owned by another job (strong_identity_conflict)', async () => {
    const { captures, orchestration } = await setup()
    const refA = await acceptCapture(captures)
    const refB = await acceptCapture(captures)
    const identity = { kind: 'ats_job', provider: 'greenhouse', account: 'acme', value: 'shared', strength: 'strong' as const }
    const a = await orchestration.createJob({ workspaceId: 'ws-a', actor: ACTOR, facts: FACTS, availability: AVAILABILITY, evidenceReferences: [refA], externalIdentities: [identity] })
    expect(a.ok).toBe(true)
    const b = await orchestration.createJob({ workspaceId: 'ws-a', actor: ACTOR, facts: FACTS, availability: AVAILABILITY, evidenceReferences: [refB], externalIdentities: [identity] })
    expect(b).toMatchObject({ ok: false, failure: { code: 'strong_identity_conflict' } })
  })

  it('corrects facts (bumping the revision) and links the correction-supporting evidence', async () => {
    const { database, captures, jobService, orchestration } = await setup()
    const ref = await acceptCapture(captures)
    const created = await orchestration.createJob({ workspaceId: 'ws-a', actor: ACTOR, facts: FACTS, availability: AVAILABILITY, evidenceReferences: [ref], externalIdentities: [] })
    if (!created.ok) throw new Error('create failed')
    const supportRef = await acceptCapture(captures)
    const corrected = await orchestration.correctFacts({
      workspaceId: 'ws-a', jobId: created.jobId, actor: ACTOR, facts: { companyName: 'Acme', roleTitle: 'Senior Engineer' },
      expectedFactsRevision: 1, evidenceReferences: [supportRef],
    })
    expect(corrected.ok).toBe(true)
    const job = await jobService.get('ws-a', created.jobId)
    expect(job?.factsRevision).toBe(2)
    const refs = await evidenceRefRows(database, created.jobId)
    expect(refs.map((r) => r.captureId)).toEqual(expect.arrayContaining([ref.captureId, supportRef.captureId]))
  })

  it('surfaces a stale facts correction as a revision conflict', async () => {
    const { captures, orchestration } = await setup()
    const ref = await acceptCapture(captures)
    const created = await orchestration.createJob({ workspaceId: 'ws-a', actor: ACTOR, facts: FACTS, availability: AVAILABILITY, evidenceReferences: [ref], externalIdentities: [] })
    if (!created.ok) throw new Error('create failed')
    const outcome = await orchestration.correctFacts({ workspaceId: 'ws-a', jobId: created.jobId, actor: ACTOR, facts: FACTS, expectedFactsRevision: 99, evidenceReferences: [ref] })
    expect(outcome).toMatchObject({ ok: false, failure: { code: 'revision_conflict' } })
  })

  it('updates availability (bumping the revision)', async () => {
    const { captures, jobService, orchestration } = await setup()
    const ref = await acceptCapture(captures)
    const created = await orchestration.createJob({ workspaceId: 'ws-a', actor: ACTOR, facts: FACTS, availability: AVAILABILITY, evidenceReferences: [ref], externalIdentities: [] })
    if (!created.ok) throw new Error('create failed')
    const outcome = await orchestration.updateAvailability({ workspaceId: 'ws-a', jobId: created.jobId, actor: ACTOR, state: 'closed', observedAt: '2026-07-22T00:00:00.000Z', expectedAvailabilityRevision: 1, evidenceReferences: [ref] })
    expect(outcome.ok).toBe(true)
    const job = await jobService.get('ws-a', created.jobId)
    expect(job?.availability.state).toBe('closed')
    expect(job?.availability.revision).toBe(2)
  })

  it('adds then removes an external identity through the identity service', async () => {
    const { database, captures, orchestration } = await setup()
    const ref = await acceptCapture(captures)
    const created = await orchestration.createJob({ workspaceId: 'ws-a', actor: ACTOR, facts: FACTS, availability: AVAILABILITY, evidenceReferences: [ref], externalIdentities: [] })
    if (!created.ok) throw new Error('create failed')
    const identity = { kind: 'posting', provider: 'linkedin', account: null, value: 'posting-1', strength: 'provisional' as const }
    const added = await orchestration.addExternalIdentity({ workspaceId: 'ws-a', jobId: created.jobId, actor: ACTOR, identity })
    expect(added).toMatchObject({ ok: true, jobId: created.jobId })
    expect((await activeIdentityRows(database, created.jobId)).map((i) => i.value)).toContain('posting-1')
    const removed = await orchestration.removeExternalIdentity({ workspaceId: 'ws-a', jobId: created.jobId, actor: ACTOR, identity })
    expect(removed).toMatchObject({ ok: true })
    expect((await activeIdentityRows(database, created.jobId)).map((i) => i.value)).not.toContain('posting-1')
  })

  it('attaches a duplicate create onto the target job, returning the target', async () => {
    const { database, captures, orchestration } = await setup()
    const targetRef = await acceptCapture(captures)
    const target = await orchestration.createJob({ workspaceId: 'ws-a', actor: ACTOR, facts: FACTS, availability: AVAILABILITY, evidenceReferences: [targetRef], externalIdentities: [] })
    if (!target.ok) throw new Error('target create failed')
    const dupRef = await acceptCapture(captures)
    const outcome = await orchestration.createJob({
      workspaceId: 'ws-a', actor: ACTOR, facts: FACTS, availability: AVAILABILITY,
      evidenceReferences: [dupRef], externalIdentities: [],
      duplicateResolution: { action: 'attach', targetResourceId: target.jobId },
    })
    expect(outcome).toMatchObject({ ok: true, jobId: target.jobId, created: false })
    const refs = await evidenceRefRows(database, target.jobId)
    expect(refs.map((r) => r.captureId)).toEqual(expect.arrayContaining([targetRef.captureId, dupRef.captureId]))
  })

  it('merges a duplicate create into the target job, returning the surviving target', async () => {
    const { captures, jobService, orchestration } = await setup()
    const targetRef = await acceptCapture(captures)
    const target = await orchestration.createJob({ workspaceId: 'ws-a', actor: ACTOR, facts: FACTS, availability: AVAILABILITY, evidenceReferences: [targetRef], externalIdentities: [] })
    if (!target.ok) throw new Error('target create failed')
    const dupRef = await acceptCapture(captures)
    const outcome = await orchestration.createJob({
      workspaceId: 'ws-a', actor: ACTOR, facts: FACTS, availability: AVAILABILITY,
      evidenceReferences: [dupRef], externalIdentities: [],
      duplicateResolution: { action: 'merge', targetResourceId: target.jobId },
    })
    expect(outcome).toMatchObject({ ok: true, jobId: target.jobId })
    expect(await jobService.get('ws-a', target.jobId)).not.toBeNull()
  })

  it('isolates jobs across workspaces', async () => {
    const { captures, jobService, orchestration } = await setup()
    const ref = await acceptCapture(captures)
    const created = await orchestration.createJob({ workspaceId: 'ws-a', actor: ACTOR, facts: FACTS, availability: AVAILABILITY, evidenceReferences: [ref], externalIdentities: [] })
    if (!created.ok) throw new Error('create failed')
    expect(await jobService.get('ws-b', created.jobId)).toBeNull()
  })
})
