/**
 * Opportunity 0.27 create/promote contract bridge (#304, stage 2) — red-first proofs
 * through the public `create` command: idempotencyKey create-dedup, the
 * expectedJobFactsRevision optimistic lineage guard, duplicate attach/merge onto the
 * one active (workspace, job) Opportunity, and the warning override persisted on the
 * resource. Runs on a migrated PGlite owner.
 */
import { describe, expect, it } from 'vitest'
import { useResettablePgliteTestOwner } from '../../test/pglite-test-owner'
import { workspaces } from '@sparxie/valedictorian-local-runtime/testing/db/workspaces.schema'
import { createPgliteJobServiceWithCompanies } from '../../test/job-service-with-companies'
import { createPgliteOpportunityService } from '@sparxie/valedictorian-local-runtime/testing/modules/opportunity/opportunity.service'

const resettableOwner = useResettablePgliteTestOwner()
const ACTOR = { type: 'user', id: 'user-1' } as const

function monotonicClock(startMs = Date.UTC(2026, 6, 20, 0, 0, 0)) {
  let tick = 0
  return () => new Date(startMs + tick++ * 1000)
}

async function setup() {
  const { database } = resettableOwner()
  for (const id of ['ws-a', 'ws-b']) {
    await database.insert(workspaces).values({ id, name: id, createdAt: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z' })
  }
  const clock = monotonicClock()
  const jobs = createPgliteJobServiceWithCompanies(database, { now: clock })
  const opportunities = createPgliteOpportunityService(database, { now: clock })
  return { jobs, opportunities }
}

async function makeJob(
  jobs: ReturnType<typeof createPgliteJobServiceWithCompanies>,
  workspaceId = 'ws-a',
) {
  const r = await jobs.create({ workspaceId, facts: { title: 'Staff Engineer' }, actor: ACTOR })
  if (!r.ok) throw new Error('job create failed')
  return r.job.id
}

describe.sequential('Opportunity 0.27 create bridge (#304)', () => {
  it('dedups a keyed create onto the same Opportunity, scoped to the workspace', async () => {
    const { jobs, opportunities } = await setup()
    const jobId = await makeJob(jobs)
    const first = await opportunities.create({ workspaceId: 'ws-a', jobId, actor: ACTOR, idempotencyKey: 'k1' })
    const again = await opportunities.create({ workspaceId: 'ws-a', jobId, actor: ACTOR, idempotencyKey: 'k1' })
    if (!first.ok || !again.ok) throw new Error('expected ok')
    expect(first.created).toBe(true)
    expect(again.created).toBe(false)
    expect(again.opportunity.id).toBe(first.opportunity.id)
  })

  it('enforces the expectedJobFactsRevision optimistic guard', async () => {
    const { jobs, opportunities } = await setup()
    const jobId = await makeJob(jobs) // facts revision 1
    const stale = await opportunities.create({ workspaceId: 'ws-a', jobId, actor: ACTOR, expectedJobFactsRevision: 2 })
    expect(stale.ok).toBe(false)
    if (stale.ok) return
    expect(stale.code).toBe('revision_conflict')
    const ok = await opportunities.create({ workspaceId: 'ws-a', jobId, actor: ACTOR, expectedJobFactsRevision: 1 })
    expect(ok.ok).toBe(true)
  })

  it('attaches to the existing active Opportunity on a duplicate, and blocks without resolution', async () => {
    const { jobs, opportunities } = await setup()
    const jobId = await makeJob(jobs)
    const original = await opportunities.create({ workspaceId: 'ws-a', jobId, actor: ACTOR })
    if (!original.ok) throw new Error('expected ok')
    // No resolution → deterministic_duplicate.
    const blocked = await opportunities.create({ workspaceId: 'ws-a', jobId, actor: ACTOR })
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.code).toBe('deterministic_duplicate')
    // attach onto the correct target → converges (created:false).
    const attached = await opportunities.create({
      workspaceId: 'ws-a', jobId, actor: ACTOR,
      duplicateResolution: { action: 'attach', targetResourceId: original.opportunity.id },
    })
    if (!attached.ok) throw new Error('expected attach ok')
    expect(attached.created).toBe(false)
    expect(attached.opportunity.id).toBe(original.opportunity.id)
    // merge reduces to the same 1:1 target.
    const merged = await opportunities.create({
      workspaceId: 'ws-a', jobId, actor: ACTOR,
      duplicateResolution: { action: 'merge', targetResourceId: original.opportunity.id },
    })
    if (!merged.ok) throw new Error('expected merge ok')
    expect(merged.opportunity.id).toBe(original.opportunity.id)
    // Wrong target → invalid_input.
    const wrong = await opportunities.create({
      workspaceId: 'ws-a', jobId, actor: ACTOR,
      duplicateResolution: { action: 'attach', targetResourceId: 'not-the-target' },
    })
    expect(wrong.ok).toBe(false)
    if (!wrong.ok) expect(wrong.code).toBe('invalid_input')
  })

  it('persists a warning override supplied at create', async () => {
    const { jobs, opportunities } = await setup()
    const jobId = await makeJob(jobs)
    const created = await opportunities.create({
      workspaceId: 'ws-a', jobId, actor: ACTOR,
      override: { actor: { id: 'user-1', type: 'user', displayName: 'Kenny' }, rationale: 'accepted the weak match', warningCodes: ['weak_possible_match'] },
    })
    if (!created.ok) throw new Error('expected ok')
    expect(created.opportunity.override).toEqual({
      actor: { id: 'user-1', type: 'user', displayName: 'Kenny' },
      rationale: 'accepted the weak match',
      warningCodes: ['weak_possible_match'],
    })
  })
})
