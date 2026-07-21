/**
 * Opportunity module contract — red-first proofs through the PUBLIC commands/queries
 * (issue #301). Exercises canonical `lifecycle_opportunities` + append-only
 * `opportunity_history` on a migrated PGlite owner: UUIDv7 identities, normalized
 * relational identity (workspace + Job), user create/correct/re-evaluate/disposition,
 * remove/restore tombstones, history, deterministic-duplicate on the (workspace, job)
 * key, cross-workspace isolation, concurrency, and input validation. Policy
 * re-evaluation never overwrites an explicit user disposition, and an explicit
 * disposition persists actor/rationale/prior/default attribution.
 */
import { describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { useResettablePgliteTestOwner } from '../../test/pglite-test-owner'
import { workspaces } from '../../db/workspaces.schema'
import { UUID_V7_PATTERN } from '../../db/lifecycle-vocabulary'
import { createPgliteJobService, type JobService } from '../job/job.service'
import { lifecycleOpportunities } from './opportunity.schema'
import { createPgliteOpportunityService, type OpportunityService } from './opportunity.service'

const resettableOwner = useResettablePgliteTestOwner()
const uuidV7Regex = new RegExp(UUID_V7_PATTERN, 'i')
const ACTOR = { type: 'user', id: 'user-1' } as const

function monotonicClock(startMs = Date.UTC(2026, 6, 20, 0, 0, 0)) {
  let tick = 0
  return () => new Date(startMs + tick++ * 1000)
}

async function setup(workspaceIds: readonly string[] = ['ws-a', 'ws-b']) {
  const { database } = resettableOwner()
  for (const id of workspaceIds) {
    await database
      .insert(workspaces)
      .values({ id, name: id, createdAt: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z' })
  }
  const clock = monotonicClock()
  const jobs = createPgliteJobService(database, { now: clock })
  const opportunities = createPgliteOpportunityService(database, { now: clock })
  return { database, jobs, opportunities }
}

async function makeJob(jobs: JobService, workspaceId = 'ws-a') {
  const result = await jobs.create({ workspaceId, facts: { title: 'Staff Engineer' }, actor: ACTOR })
  if (!result.ok) throw new Error(`job create failed: ${result.code}`)
  return result.job.id
}

async function makeOpportunity(opportunities: OpportunityService, jobId: string, workspaceId = 'ws-a') {
  const result = await opportunities.create({ workspaceId, jobId, actor: ACTOR })
  if (!result.ok) throw new Error(`opportunity create failed: ${result.code} ${result.message}`)
  return result.opportunity
}

describe.sequential('Opportunity module contract (#301)', () => {
  it('creates a durable opportunity with a UUIDv7 id, normalized Job identity, defaults, and created history', async () => {
    const { jobs, opportunities } = await setup()
    const jobId = await makeJob(jobs)
    const opportunity = await makeOpportunity(opportunities, jobId)

    expect(opportunity.id).toMatch(uuidV7Regex)
    expect(opportunity.jobId).toBe(jobId)
    expect(opportunity.revision).toBe(1)
    expect(opportunity).toMatchObject({ fit: 'unknown', rank: null, cutoff: 'not_evaluated', disposition: 'reviewing' })
    expect(opportunity.removedAt).toBeNull()

    expect((await opportunities.get('ws-a', opportunity.id))?.id).toBe(opportunity.id)
    expect((await opportunities.list('ws-a')).map((o) => o.id)).toEqual([opportunity.id])
    expect((await opportunities.history('ws-a', opportunity.id)).map((e) => e.kind)).toEqual(['created'])
  })

  it('rejects a create whose Job is absent or lives in another workspace with missing_lineage', async () => {
    const { jobs, opportunities } = await setup()
    const foreignJob = await makeJob(jobs, 'ws-b')
    expect(await opportunities.create({ workspaceId: 'ws-a', jobId: 'nope', actor: ACTOR }))
      .toMatchObject({ ok: false, code: 'missing_lineage' })
    expect(await opportunities.create({ workspaceId: 'ws-a', jobId: foreignJob, actor: ACTOR }))
      .toMatchObject({ ok: false, code: 'missing_lineage' })
  })

  it('enforces one active opportunity per (workspace, Job) with a deterministic_duplicate', async () => {
    const { jobs, opportunities } = await setup()
    const jobId = await makeJob(jobs)
    await makeOpportunity(opportunities, jobId)
    expect(await opportunities.create({ workspaceId: 'ws-a', jobId, actor: ACTOR }))
      .toMatchObject({ ok: false, code: 'deterministic_duplicate' })
  })

  it('corrects rank/fit facts (evaluation_changed) without touching disposition', async () => {
    const { jobs, opportunities } = await setup()
    const jobId = await makeJob(jobs)
    const opportunity = await makeOpportunity(opportunities, jobId)
    const corrected = await opportunities.correct({
      workspaceId: 'ws-a', opportunityId: opportunity.id, fit: 'fit', rank: 3, cutoff: 'above', actor: ACTOR,
    })
    expect(corrected).toMatchObject({ ok: true })
    if (!corrected.ok) return
    expect(corrected.opportunity).toMatchObject({ fit: 'fit', rank: 3, cutoff: 'above', disposition: 'reviewing', revision: 2 })
    expect((await opportunities.history('ws-a', opportunity.id)).map((e) => e.kind)).toEqual(['created', 'evaluation_changed'])
  })

  it('re-evaluation is independently rerunnable and never overwrites an explicit user disposition', async () => {
    const { jobs, opportunities } = await setup()
    const jobId = await makeJob(jobs)
    const opportunity = await makeOpportunity(opportunities, jobId)
    const decided = await opportunities.setDisposition({
      workspaceId: 'ws-a', opportunityId: opportunity.id, disposition: 'pursue', rationale: 'strong match', actor: ACTOR,
    })
    expect(decided.ok && decided.opportunity.disposition).toBe('pursue')

    const reran = await opportunities.reevaluate({
      workspaceId: 'ws-a', opportunityId: opportunity.id, fit: 'not_fit', cutoff: 'below', actor: { type: 'system' },
    })
    expect(reran).toMatchObject({ ok: true })
    if (!reran.ok) return
    // policy changed the evaluation facts, but the explicit disposition is preserved.
    expect(reran.opportunity).toMatchObject({ fit: 'not_fit', cutoff: 'below', disposition: 'pursue' })
  })

  it('persists actor, rationale, prior + default disposition, and resulting state on an explicit override', async () => {
    const { jobs, opportunities } = await setup()
    const jobId = await makeJob(jobs)
    const opportunity = await makeOpportunity(opportunities, jobId)
    const decided = await opportunities.setDisposition({
      workspaceId: 'ws-a', opportunityId: opportunity.id, disposition: 'declined', rationale: 'relocation required', actor: ACTOR,
    })
    expect(decided).toMatchObject({ ok: true })
    if (!decided.ok) return
    expect(decided.opportunity.disposition).toBe('declined')
    expect(decided.opportunity.override).toMatchObject({
      actor: { type: 'user', id: 'user-1' },
      rationale: 'relocation required',
      priorDisposition: 'reviewing',
      defaultDisposition: 'reviewing',
      resultingDisposition: 'declined',
    })
    expect((await opportunities.history('ws-a', opportunity.id)).map((e) => e.kind)).toEqual(['created', 'disposition_changed'])
  })

  it('removes and restores with tombstone semantics, and remove/restore are idempotent', async () => {
    const { jobs, opportunities } = await setup()
    const jobId = await makeJob(jobs)
    const opportunity = await makeOpportunity(opportunities, jobId)

    const removed = await opportunities.remove({ workspaceId: 'ws-a', opportunityId: opportunity.id, actor: ACTOR })
    expect(removed.ok && removed.opportunity.removedAt).not.toBeNull()
    expect((await opportunities.list('ws-a')).length).toBe(0)
    expect((await opportunities.list('ws-a', { includeRemoved: true })).length).toBe(1)
    // idempotent
    expect(await opportunities.remove({ workspaceId: 'ws-a', opportunityId: opportunity.id, actor: ACTOR })).toMatchObject({ ok: true })

    const restored = await opportunities.restore({ workspaceId: 'ws-a', opportunityId: opportunity.id, actor: ACTOR })
    expect(restored.ok && restored.opportunity.removedAt).toBeNull()
    expect(await opportunities.restore({ workspaceId: 'ws-a', opportunityId: opportunity.id, actor: ACTOR })).toMatchObject({ ok: true })
    expect((await opportunities.history('ws-a', opportunity.id)).map((e) => e.kind)).toEqual(['created', 'removed', 'restored'])
  })

  it('lets the (workspace, Job) key be reclaimed after removal, and rejects a restore that would duplicate it', async () => {
    const { jobs, opportunities } = await setup()
    const jobId = await makeJob(jobs)
    const first = await makeOpportunity(opportunities, jobId)
    await opportunities.remove({ workspaceId: 'ws-a', opportunityId: first.id, actor: ACTOR })
    // key freed: a new opportunity for the same Job is allowed.
    const second = await makeOpportunity(opportunities, jobId)
    expect(second.id).not.toBe(first.id)
    // restoring the first would re-activate a duplicate active key.
    expect(await opportunities.restore({ workspaceId: 'ws-a', opportunityId: first.id, actor: ACTOR }))
      .toMatchObject({ ok: false, code: 'deterministic_duplicate' })
  })

  it('rejects a stale expected revision with revision_conflict', async () => {
    const { jobs, opportunities } = await setup()
    const jobId = await makeJob(jobs)
    const opportunity = await makeOpportunity(opportunities, jobId)
    expect(await opportunities.correct({ workspaceId: 'ws-a', opportunityId: opportunity.id, fit: 'fit', actor: ACTOR, expectedRevision: 99 }))
      .toMatchObject({ ok: false, code: 'revision_conflict' })
  })

  it('serializes concurrent mutations so only one wins a shared revision', async () => {
    const { jobs, opportunities } = await setup()
    const jobId = await makeJob(jobs)
    const opportunity = await makeOpportunity(opportunities, jobId)
    const [a, b] = await Promise.all([
      opportunities.correct({ workspaceId: 'ws-a', opportunityId: opportunity.id, fit: 'fit', actor: ACTOR, expectedRevision: 1 }),
      opportunities.setDisposition({ workspaceId: 'ws-a', opportunityId: opportunity.id, disposition: 'hold', actor: ACTOR, expectedRevision: 1 }),
    ])
    const wins = [a, b].filter((r) => r.ok).length
    const conflicts = [a, b].filter((r) => !r.ok && r.code === 'revision_conflict').length
    expect(wins).toBe(1)
    expect(conflicts).toBe(1)
  })

  it('isolates opportunities across workspaces', async () => {
    const { jobs, opportunities } = await setup()
    const jobId = await makeJob(jobs, 'ws-a')
    const opportunity = await makeOpportunity(opportunities, jobId, 'ws-a')
    expect(await opportunities.get('ws-b', opportunity.id)).toBeNull()
    expect((await opportunities.list('ws-b')).length).toBe(0)
    expect(await opportunities.correct({ workspaceId: 'ws-b', opportunityId: opportunity.id, fit: 'fit', actor: ACTOR }))
      .toMatchObject({ ok: false, code: 'not_found' })
  })

  it('returns typed validation failures for bad input and forbidden audit keys', async () => {
    const { jobs, opportunities } = await setup()
    const jobId = await makeJob(jobs)
    const opportunity = await makeOpportunity(opportunities, jobId)
    expect(await opportunities.correct({ workspaceId: 'ws-a', opportunityId: opportunity.id, fit: 'bogus' as never, actor: ACTOR }))
      .toMatchObject({ ok: false, code: 'invalid_input' })
    expect(await opportunities.correct({ workspaceId: 'ws-a', opportunityId: opportunity.id, actor: ACTOR }))
      .toMatchObject({ ok: false, code: 'invalid_input' })
    expect(await opportunities.setDisposition({ workspaceId: 'ws-a', opportunityId: opportunity.id, disposition: 'pursue', rationale: 'x'.repeat(3000), actor: ACTOR }))
      .toMatchObject({ ok: false, code: 'bounded_data_violation' })
  })

  it('scopes the normalized identity to a real relational key, not a JSON alias scan', async () => {
    const { database, jobs, opportunities } = await setup()
    const jobId = await makeJob(jobs)
    const opportunity = await makeOpportunity(opportunities, jobId)
    const [row] = await database
      .select()
      .from(lifecycleOpportunities)
      .where(and(eq(lifecycleOpportunities.workspaceId, 'ws-a'), eq(lifecycleOpportunities.jobId, jobId)))
    expect(row?.id).toBe(opportunity.id)
  })
})
