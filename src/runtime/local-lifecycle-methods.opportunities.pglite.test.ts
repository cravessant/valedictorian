/**
 * In-process lifecycle facade — OPPORTUNITIES vertical, red-first pglite proofs (#304).
 *
 * Proves the facade composes the Opportunity service, Opportunity read-model, removal
 * orchestration, and the Opportunity→Application promotion into the strict sparxie
 * `opportunities` surface. Every result is re-parsed through the concrete sparxie
 * result schema (contract-valid output the routes and typed client render). Covers
 * create (carrying the caller evaluation + disposition), get/list, evaluation and
 * disposition updates bumping the revision, the deterministic-duplicate block
 * (conflicting id + attach/merge resolutions), remove/restore, history, the promoted
 * Opportunity→Application, and workspace isolation.
 */
import { describe, expect, it } from 'vitest'
import {
  opportunityHistoryResultSchema,
  opportunityListResultSchema,
  opportunityMutationResultSchema,
  opportunitySchema,
  promoteOpportunityToApplicationResultSchema,
  removalResultSchema,
  restoreResultSchema,
} from 'sparxie'
import { useResettablePgliteTestOwner } from '../test/pglite-test-owner'
import { workspaces } from '../db/workspaces.schema'
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
  providerRecordId: null, providerSchema: null, payload: null,
  evidence: [{ kind: 'title', label: 'Title', value: 'Engineer' }],
}
const FACTS = {
  companyName: 'Acme', roleTitle: 'Engineer', sourceName: 'greenhouse', roleKind: 'experienced' as const,
  term: null, terms: [], timingMode: 'unknown' as const, startDate: null, endDate: null, location: null,
  workMode: 'remote' as const, employmentType: 'full_time' as const, seniority: 'senior' as const,
  compensation: null, postedAt: null, destination: null,
}
const AVAILABILITY = { state: 'open' as const, observedAt: '2026-07-21T00:00:00.000Z' }
const EVALUATION = { fit: 'fit' as const, rank: 1, cutoff: 'above' as const, disposition: 'reviewing' as const }

let keyCounter = 0
const key = () => `idem-${(keyCounter += 1)}`

async function createJob(methods: Awaited<ReturnType<typeof setup>>['methods']) {
  const capture = await methods.captures.create(CAPTURE_INPUT)
  if (capture.status !== 'succeeded') throw new Error('capture create failed')
  const job = await methods.jobs.create({
    idempotencyKey: key(), actor: USER, facts: FACTS, availability: AVAILABILITY,
    evidenceReferences: [{ captureId: capture.resource.id, captureRevision: capture.resource.revision, evidenceIndexes: [0] }],
    externalIdentities: [],
  })
  if (job.status !== 'succeeded') throw new Error('job create failed')
  return job.resource.id
}

async function createOpportunity(methods: Awaited<ReturnType<typeof setup>>['methods'], jobId?: string) {
  const id = jobId ?? (await createJob(methods))
  const result = await methods.opportunities.create({
    idempotencyKey: key(), actor: USER, jobId: id, expectedJobFactsRevision: 1,
    fit: EVALUATION.fit, rank: EVALUATION.rank, cutoff: EVALUATION.cutoff, disposition: EVALUATION.disposition,
  })
  return { result, jobId: id }
}

describe.sequential('local lifecycle facade — opportunities', () => {
  it('creates an opportunity carrying the caller evaluation + disposition (contract-valid)', async () => {
    const { methods } = await setup()
    const { result } = await createOpportunity(methods)
    expect(() => opportunityMutationResultSchema.parse(result)).not.toThrow()
    expect(result.status).toBe('succeeded')
    if (result.status !== 'succeeded') throw new Error('unreachable')
    expect(result.resource.fit).toBe('fit')
    expect(result.resource.disposition).toBe('reviewing')
    expect(result.audit.actor).toEqual({ id: 'u-1', type: 'user' })
  })

  it('reads an opportunity back via get and list (contract-valid)', async () => {
    const { methods } = await setup()
    const { result } = await createOpportunity(methods)
    if (result.status !== 'succeeded') throw new Error('unreachable')
    const fetched = await methods.opportunities.get(result.resource.id)
    expect(() => opportunitySchema.parse(fetched)).not.toThrow()
    const listed = await methods.opportunities.list()
    expect(() => opportunityListResultSchema.parse(listed)).not.toThrow()
    expect(listed.items.map((o) => o.id)).toContain(result.resource.id)
  })

  it('updates evaluation and disposition, bumping the resource revision', async () => {
    const { methods } = await setup()
    const { result } = await createOpportunity(methods)
    if (result.status !== 'succeeded') throw new Error('unreachable')
    const id = result.resource.id

    const evaluated = await methods.opportunities.updateEvaluation({ opportunityId: id, expectedRevision: 1, actor: USER, fit: 'possible', rank: 2, cutoff: 'below' })
    expect(() => opportunityMutationResultSchema.parse(evaluated)).not.toThrow()
    if (evaluated.status !== 'succeeded') throw new Error('unreachable')
    expect(evaluated.resource.fit).toBe('possible')
    expect(evaluated.resource.revision).toBe(2)

    const disposed = await methods.opportunities.updateDisposition({ opportunityId: id, expectedRevision: 2, actor: USER, disposition: 'pursue', rationale: 'strong match' })
    if (disposed.status !== 'succeeded') throw new Error('unreachable')
    expect(disposed.resource.disposition).toBe('pursue')
    expect(disposed.resource.revision).toBe(3)
  })

  it('blocks a duplicate opportunity for the same job with the conflicting id + resolutions', async () => {
    const { methods } = await setup()
    const { jobId } = await createOpportunity(methods)
    const duplicate = await methods.opportunities.create({
      idempotencyKey: key(), actor: USER, jobId, expectedJobFactsRevision: 1,
      fit: 'fit', rank: 1, cutoff: 'above', disposition: 'reviewing',
    })
    expect(() => opportunityMutationResultSchema.parse(duplicate)).not.toThrow()
    expect(duplicate.status).toBe('blocked')
    if (duplicate.status !== 'blocked') throw new Error('unreachable')
    expect(duplicate.blocker.code).toBe('deterministic_duplicate')
    expect(typeof duplicate.blocker.conflictingResourceId).toBe('string')
    expect(duplicate.blocker.allowedDuplicateResolutions).toEqual(expect.arrayContaining(['attach', 'merge']))
  })

  it('removes and restores an opportunity (contract-valid)', async () => {
    const { methods } = await setup()
    const { result } = await createOpportunity(methods)
    if (result.status !== 'succeeded') throw new Error('unreachable')
    const id = result.resource.id

    const removed = await methods.opportunities.remove({ id, choice: 'reject_if_dependents', actor: USER, rationale: 'drop' })
    expect(() => removalResultSchema.parse(removed)).not.toThrow()
    expect(removed.status).toBe('removed')

    const restored = await methods.opportunities.restore({ id, actor: USER, rationale: 'back' })
    expect(() => restoreResultSchema.parse(restored)).not.toThrow()
    expect(restored.status).toBe('restored')
  })

  it('reconstructs opportunity history (contract-valid)', async () => {
    const { methods } = await setup()
    const { result } = await createOpportunity(methods)
    if (result.status !== 'succeeded') throw new Error('unreachable')
    await methods.opportunities.updateDisposition({ opportunityId: result.resource.id, expectedRevision: 1, actor: USER, disposition: 'pursue', rationale: 'r' })
    const history = await methods.opportunities.history({ id: result.resource.id })
    expect(() => opportunityHistoryResultSchema.parse(history)).not.toThrow()
    expect(history.items.map((h) => h.kind)).toEqual(expect.arrayContaining(['created', 'disposition_changed']))
  })

  it('promotes an opportunity to an application (contract-valid promoteToApplication)', async () => {
    const { methods } = await setup()
    const { result, jobId } = await createOpportunity(methods)
    if (result.status !== 'succeeded') throw new Error('unreachable')
    const promoted = await methods.opportunities.promoteToApplication({
      idempotencyKey: key(), actor: USER, opportunityId: result.resource.id, expectedJobId: jobId,
    })
    expect(() => promoteOpportunityToApplicationResultSchema.parse(promoted)).not.toThrow()
    expect(promoted.status).toBe('promoted')
    if (promoted.status !== 'promoted') throw new Error('unreachable')
    expect(promoted.resource.workspaceId).toBe('ws-a')
  })

  it('isolates opportunities across workspaces', async () => {
    const { database, now } = await setup()
    const wsA = createCoveredLocalLifecycleMethods(database, { workspaceId: 'ws-a', now })
    const wsB = createCoveredLocalLifecycleMethods(database, { workspaceId: 'ws-b', now })
    const { result } = await createOpportunity(wsA)
    if (result.status !== 'succeeded') throw new Error('unreachable')
    expect(await wsB.opportunities.get(result.resource.id)).toBeNull()
    expect((await wsB.opportunities.list()).items).toEqual([])
  })
})
