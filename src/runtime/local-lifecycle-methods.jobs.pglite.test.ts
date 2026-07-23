/**
 * In-process lifecycle facade — JOBS vertical + captures.promoteToJob, red-first pglite proofs (#304).
 *
 * Proves the facade composes the Job write orchestration, Job read-model, removal
 * orchestration, and the two promotions into the strict sparxie `jobs` surface plus
 * `captures.promoteToJob`. Every result is re-parsed through the concrete sparxie
 * result schema, so the facade output is proven contract-valid (what the typed HTTP
 * client and routes render). Covers create/read/list/correct/availability/identity
 * add-remove/remove/restore/history, the promoted Capture→Job (contract-valid facts +
 * the requested evidence reference on the resource), Job→Opportunity with the
 * caller's evaluation, lineage blocks, and workspace isolation.
 */
import { describe, expect, it } from 'vitest'
import {
  jobHistoryResultSchema,
  jobListResultSchema,
  jobMutationResultSchema,
  jobSchema,
  promoteCaptureToJobResultSchema,
  promoteJobToOpportunityResultSchema,
  removalResultSchema,
  restoreResultSchema,
} from '@sparxie/sdk'
import { useResettablePgliteTestOwner } from '../test/pglite-test-owner'
import { workspaces } from '../db/workspaces.schema'
import { LifecycleHttpError } from './local-lifecycle-methods'
import { createCoveredLocalLifecycleMethods } from '../test/covered-lifecycle-methods'

const resettableOwner = useResettablePgliteTestOwner()

function monotonicClock(startMs = Date.UTC(2026, 6, 21, 0, 0, 0)) {
  let tick = 0
  return () => new Date(startMs + tick++ * 1000)
}

async function setup(workspaceId = 'ws-a') {
  const { database } = resettableOwner()
  for (const id of ['ws-a', 'ws-b']) {
    await database.insert(workspaces).values({ id, name: id, createdAt: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z' })
  }
  const now = monotonicClock()
  const methods = createCoveredLocalLifecycleMethods(database, { workspaceId, now })
  return { database, methods, now }
}

const USER = { id: 'u-1', type: 'user' as const }

const CAPTURE_INPUT = {
  evidenceMode: 'reported' as const,
  adapter: { id: 'cli', kind: 'cli' as const, version: '1.0.0' },
  observedAt: '2026-07-21T00:00:00.000Z',
  providerRecordId: null,
  providerSchema: null,
  payload: null,
  evidence: [{ kind: 'title', label: 'Title', value: 'Engineer' }],
}

const FACTS = {
  companyName: 'Acme', roleTitle: 'Engineer', sourceName: 'greenhouse', roleKind: 'experienced' as const,
  term: null, terms: [], timingMode: 'unknown' as const, startDate: null, endDate: null, location: null,
  workMode: 'remote' as const, employmentType: 'full_time' as const, seniority: 'senior' as const,
  compensation: null, postedAt: null, destination: null,
}
const AVAILABILITY = { state: 'open' as const, observedAt: '2026-07-21T00:00:00.000Z' }

let keyCounter = 0
function key() {
  keyCounter += 1
  return `idem-${keyCounter}`
}

/** Create a capture through the facade and return an evidence reference to its head revision. */
async function makeEvidenceRef(methods: Awaited<ReturnType<typeof setup>>['methods']) {
  const created = await methods.captures.create(CAPTURE_INPUT)
  if (created.status !== 'succeeded') throw new Error('capture create failed')
  return { captureId: created.resource.id, captureRevision: created.resource.revision, evidenceIndexes: [0] }
}

async function createJob(methods: Awaited<ReturnType<typeof setup>>['methods'], overrides: Record<string, unknown> = {}) {
  const ref = await makeEvidenceRef(methods)
  const input = {
    idempotencyKey: key(), actor: USER, facts: FACTS, availability: AVAILABILITY,
    evidenceReferences: [ref], externalIdentities: [], ...overrides,
  }
  const result = await methods.jobs.create(input)
  return { result, ref }
}

describe.sequential('local lifecycle facade — jobs', () => {
  it('creates a job with a contract-valid succeeded result carrying the requested evidence reference', async () => {
    const { methods } = await setup()
    const { result, ref } = await createJob(methods)
    expect(() => jobMutationResultSchema.parse(result)).not.toThrow()
    expect(result.status).toBe('succeeded')
    if (result.status !== 'succeeded') throw new Error('unreachable')
    expect(result.resource.workspaceId).toBe('ws-a')
    expect(result.resource.captureEvidenceReferences.some((r) => r.captureId === ref.captureId && r.captureRevision === ref.captureRevision)).toBe(true)
    expect(result.audit.actor).toEqual({ id: 'u-1', type: 'user' })
  })

  it('reads a created job back via get and list (contract-valid, workspace-scoped)', async () => {
    const { methods } = await setup()
    const { result } = await createJob(methods)
    if (result.status !== 'succeeded') throw new Error('unreachable')
    const jobId = result.resource.id

    const fetched = await methods.jobs.get(jobId)
    expect(() => jobSchema.parse(fetched)).not.toThrow()
    expect(fetched?.id).toBe(jobId)

    const listed = await methods.jobs.list()
    expect(() => jobListResultSchema.parse(listed)).not.toThrow()
    expect(listed.items.map((j) => j.id)).toContain(jobId)
  })

  it('returns null from get for an unknown job', async () => {
    const { methods } = await setup()
    expect(await methods.jobs.get('01900000-0000-7000-8000-000000000000')).toBeNull()
  })

  it('blocks a create whose evidence reference names an unknown capture (missing_lineage blocked body)', async () => {
    const { methods } = await setup()
    const result = await methods.jobs.create({
      idempotencyKey: key(), actor: USER, facts: FACTS, availability: AVAILABILITY,
      evidenceReferences: [{ captureId: 'does-not-exist', captureRevision: 1, evidenceIndexes: [0] }],
      externalIdentities: [],
    })
    expect(() => jobMutationResultSchema.parse(result)).not.toThrow()
    expect(result.status).toBe('blocked')
    if (result.status !== 'blocked') throw new Error('unreachable')
    expect(result.blocker.code).toBe('missing_lineage')
  })

  it('corrects facts and updates availability, bumping the resource revisions', async () => {
    const { methods } = await setup()
    const { result } = await createJob(methods)
    if (result.status !== 'succeeded') throw new Error('unreachable')
    const jobId = result.resource.id
    const supportRef = await makeEvidenceRef(methods)

    const corrected = await methods.jobs.correctFacts({
      jobId, expectedFactsRevision: 1, actor: USER, rationale: 'sharpen title',
      facts: { ...FACTS, roleTitle: 'Staff Engineer' }, evidenceReferences: [supportRef],
    })
    expect(() => jobMutationResultSchema.parse(corrected)).not.toThrow()
    if (corrected.status !== 'succeeded') throw new Error('unreachable')
    expect(corrected.resource.factsRevision).toBe(2)
    expect(corrected.resource.facts.roleTitle).toBe('Staff Engineer')

    const availability = await methods.jobs.updateAvailability({
      jobId, expectedAvailabilityRevision: 1, actor: USER,
      availability: { state: 'closed', observedAt: '2026-07-22T00:00:00.000Z' }, evidenceReferences: [supportRef],
    })
    if (availability.status !== 'succeeded') throw new Error('unreachable')
    expect(availability.resource.availability.state).toBe('closed')
    expect(availability.resource.availabilityRevision).toBe(2)
  })

  it('raises a 409 LifecycleHttpError on a stale facts correction', async () => {
    const { methods } = await setup()
    const { result } = await createJob(methods)
    if (result.status !== 'succeeded') throw new Error('unreachable')
    const ref = await makeEvidenceRef(methods)
    await expect(methods.jobs.correctFacts({
      jobId: result.resource.id, expectedFactsRevision: 99, actor: USER, rationale: 'stale',
      facts: FACTS, evidenceReferences: [ref],
    })).rejects.toMatchObject({ status: 409 })
  })

  it('adds then removes an external identity, returning the same job each time', async () => {
    const { methods } = await setup()
    const { result } = await createJob(methods)
    if (result.status !== 'succeeded') throw new Error('unreachable')
    const jobId = result.resource.id
    const identity = { kind: 'posting' as const, provider: 'linkedin', account: null, value: 'posting-1', strength: 'provisional' as const }

    const added = await methods.jobs.externalIdentities.add({ jobId, actor: USER, identity })
    expect(() => jobMutationResultSchema.parse(added)).not.toThrow()
    if (added.status !== 'succeeded') throw new Error('unreachable')
    expect(added.resource.id).toBe(jobId)
    expect(added.resource.externalIdentities.some((i) => i.value === 'posting-1')).toBe(true)

    const removed = await methods.jobs.externalIdentities.remove({ jobId, actor: USER, identity, rationale: 'wrong link' })
    if (removed.status !== 'succeeded') throw new Error('unreachable')
    expect(removed.resource.externalIdentities.some((i) => i.value === 'posting-1')).toBe(false)
  })

  it('removes a job with no dependents and restores it (contract-valid results)', async () => {
    const { methods } = await setup()
    const { result } = await createJob(methods)
    if (result.status !== 'succeeded') throw new Error('unreachable')
    const jobId = result.resource.id

    const removed = await methods.jobs.remove({ id: jobId, choice: 'reject_if_dependents', actor: USER, rationale: 'drop it' })
    expect(() => removalResultSchema.parse(removed)).not.toThrow()
    expect(removed.status).toBe('removed')

    const restored = await methods.jobs.restore({ id: jobId, actor: USER, rationale: 'bring it back' })
    expect(() => restoreResultSchema.parse(restored)).not.toThrow()
    expect(restored.status).toBe('restored')
    expect((await methods.jobs.get(jobId))?.removedAt).toBeNull()
  })

  it('reconstructs job history across create and correction (contract-valid)', async () => {
    const { methods } = await setup()
    const { result } = await createJob(methods)
    if (result.status !== 'succeeded') throw new Error('unreachable')
    const jobId = result.resource.id
    const ref = await makeEvidenceRef(methods)
    await methods.jobs.correctFacts({ jobId, expectedFactsRevision: 1, actor: USER, rationale: 'r', facts: { ...FACTS, roleTitle: 'Lead' }, evidenceReferences: [ref] })

    const history = await methods.jobs.history({ id: jobId })
    expect(() => jobHistoryResultSchema.parse(history)).not.toThrow()
    expect(history.items.map((h) => h.kind)).toEqual(expect.arrayContaining(['created', 'facts_corrected']))
    expect(history.items.every((h) => h.snapshot.id === jobId)).toBe(true)
  })

  it('promotes a capture to a job with contract-valid facts and the requested evidence reference (captures.promoteToJob)', async () => {
    const { methods } = await setup()
    const created = await methods.captures.create(CAPTURE_INPUT)
    if (created.status !== 'succeeded') throw new Error('unreachable')
    const captureId = created.resource.id
    const captureRevision = created.resource.revision

    const result = await methods.captures.promoteToJob({
      idempotencyKey: key(), actor: USER, captureId, captureRevision, selectedFacts: FACTS,
      evidenceReferences: [{ captureId, captureRevision, evidenceIndexes: [0] }], externalIdentities: [],
    })
    expect(() => promoteCaptureToJobResultSchema.parse(result)).not.toThrow()
    expect(result.status).toBe('promoted')
    if (result.status !== 'promoted') throw new Error('unreachable')
    expect(result.resource.workspaceId).toBe('ws-a')
    expect(result.resource.captureEvidenceReferences.some((r) => r.captureId === captureId && r.captureRevision === captureRevision)).toBe(true)
    expect(result.audit.actor).toEqual({ id: 'u-1', type: 'user' })
  })

  it('promotes a job to an opportunity carrying the caller evaluation (jobs.promoteToOpportunity)', async () => {
    const { methods } = await setup()
    const { result: jobResult } = await createJob(methods)
    if (jobResult.status !== 'succeeded') throw new Error('unreachable')

    const result = await methods.jobs.promoteToOpportunity({
      idempotencyKey: key(), actor: USER, jobId: jobResult.resource.id, expectedFactsRevision: 1,
      evaluation: { fit: 'fit', rank: 1, cutoff: 'above', disposition: 'pursue' },
    })
    expect(() => promoteJobToOpportunityResultSchema.parse(result)).not.toThrow()
    expect(result.status).toBe('promoted')
    if (result.status !== 'promoted') throw new Error('unreachable')
    expect(result.resource.jobId).toBe(jobResult.resource.id)
    expect(result.resource.fit).toBe('fit')
    expect(result.resource.disposition).toBe('pursue')
  })

  it('isolates jobs across workspaces', async () => {
    const { database, now } = await setup()
    const wsA = createCoveredLocalLifecycleMethods(database, { workspaceId: 'ws-a', now })
    const wsB = createCoveredLocalLifecycleMethods(database, { workspaceId: 'ws-b', now })
    const capture = await wsA.captures.create(CAPTURE_INPUT)
    if (capture.status !== 'succeeded') throw new Error('unreachable')
    const created = await wsA.jobs.create({
      idempotencyKey: key(), actor: USER, facts: FACTS, availability: AVAILABILITY,
      evidenceReferences: [{ captureId: capture.resource.id, captureRevision: capture.resource.revision, evidenceIndexes: [0] }],
      externalIdentities: [],
    })
    if (created.status !== 'succeeded') throw new Error('unreachable')
    expect(await wsB.jobs.get(created.resource.id)).toBeNull()
    expect((await wsB.jobs.list()).items).toEqual([])
    void LifecycleHttpError
  })
})
