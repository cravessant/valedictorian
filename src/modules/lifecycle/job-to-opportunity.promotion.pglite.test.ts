/**
 * Job → Opportunity promotion — red-first proofs through the PUBLIC orchestration
 * (issue #301). Covers idempotency for every structurally valid Job, warnings/defaults
 * for fit / cutoff / missing-optional-facts / third-party-destination / weak-match
 * instead of hard blocks, the policy evaluation port as a narrow public contract,
 * atomic rollback on an injected failure, concurrency races converging to ONE
 * Opportunity, retryability without duplicate Opportunities, and cross-workspace
 * isolation. Only typed deterministic failures are terminal.
 */
import { describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { useResettablePgliteTestOwner } from '../../test/pglite-test-owner'
import { workspaces } from '../../db/workspaces.schema'
import type { JobService } from '../job/job.service'
import { createCoveredPgliteJobService } from '../../test/covered-job-service'
import { createPgliteOpportunityService } from '../opportunity/opportunity.service'
import { opportunities } from '../opportunity/opportunity.schema'
import {
  createPgliteJobToOpportunityPromotion,
  type OpportunityEvaluation,
  type OpportunityEvaluationPort,
} from './job-to-opportunity.promotion'

const resettableOwner = useResettablePgliteTestOwner()
const ACTOR = { type: 'user', id: 'u' } as const

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
  const jobs = createCoveredPgliteJobService(database, { now: clock })
  const opportunities = createPgliteOpportunityService(database, { now: clock })
  let evaluation: OpportunityEvaluation = { fit: 'unknown', rank: null, cutoff: 'not_evaluated', signals: [] }
  const evaluateSpy = vi.fn(async () => evaluation)
  const port: OpportunityEvaluationPort = { evaluate: evaluateSpy }
  const promotion = createPgliteJobToOpportunityPromotion(database, opportunities, { now: clock, evaluationPort: port })
  return {
    database, jobs, opportunities, promotion, evaluateSpy,
    setEvaluation: (e: OpportunityEvaluation) => { evaluation = e },
  }
}

async function makeJob(jobs: JobService, workspaceId = 'ws-a') {
  const result = await jobs.create({ workspaceId, facts: { title: 'Staff Engineer' }, actor: ACTOR })
  if (!result.ok) throw new Error(`job create failed: ${result.code}`)
  return result.job.id
}

async function countOpportunities(database: Awaited<ReturnType<typeof setup>>['database'], jobId: string) {
  return (await database.select().from(opportunities).where(eq(opportunities.jobId, jobId))).length
}

describe.sequential('Job→Opportunity promotion (#301)', () => {
  it('promotes a structurally valid Job into exactly one Opportunity carrying the evaluation', async () => {
    const { database, jobs, opportunities, promotion, setEvaluation } = await setup()
    const jobId = await makeJob(jobs)
    setEvaluation({ fit: 'fit', rank: 2, cutoff: 'above', signals: [] })
    const result = await promotion.promoteJob({ workspaceId: 'ws-a', jobId, actor: ACTOR })
    expect(result).toMatchObject({ ok: true, created: true, attached: false, warnings: [] })
    if (!result.ok) return
    const opportunity = await opportunities.get('ws-a', result.opportunityId)
    expect(opportunity).toMatchObject({ jobId, fit: 'fit', rank: 2, cutoff: 'above', disposition: 'reviewing' })
    expect(await countOpportunities(database, jobId)).toBe(1)
  })

  it('is idempotent: re-promoting attaches the existing Opportunity without re-running policy', async () => {
    const { database, jobs, promotion, evaluateSpy } = await setup()
    const jobId = await makeJob(jobs)
    const first = await promotion.promoteJob({ workspaceId: 'ws-a', jobId, actor: ACTOR })
    const second = await promotion.promoteJob({ workspaceId: 'ws-a', jobId, actor: ACTOR })
    expect(first).toMatchObject({ ok: true, created: true })
    expect(second).toMatchObject({ ok: true, created: false, attached: true })
    if (first.ok && second.ok) expect(second.opportunityId).toBe(first.opportunityId)
    expect(await countOpportunities(database, jobId)).toBe(1)
    // idempotency short-circuits BEFORE the policy port fires again.
    expect(evaluateSpy).toHaveBeenCalledTimes(1)
  })

  it('returns fit/cutoff/third-party/weak-match/missing-optional-fact as warnings, never blocks', async () => {
    const { jobs, promotion, setEvaluation } = await setup()
    const jobId = await makeJob(jobs)
    setEvaluation({
      fit: 'not_fit', rank: null, cutoff: 'below',
      signals: ['fit', 'cutoff', 'third_party_destination', 'weak_possible_match', 'missing_optional_facts'],
    })
    const result = await promotion.promoteJob({ workspaceId: 'ws-a', jobId, actor: ACTOR })
    expect(result).toMatchObject({ ok: true, created: true })
    if (!result.ok) return
    expect(result.warnings.map((w) => w.code).sort()).toEqual(
      ['cutoff', 'fit', 'missing_optional_facts', 'rank', 'third_party_destination', 'weak_possible_match'],
    )
  })

  it('defaults durable values and a missing_optional_facts warning when no policy port is wired', async () => {
    const { database, jobs, opportunities } = await setup()
    const promotion = createPgliteJobToOpportunityPromotion(database, opportunities, { now: monotonicClock() })
    const jobId = await makeJob(jobs)
    const result = await promotion.promoteJob({ workspaceId: 'ws-a', jobId, actor: ACTOR })
    expect(result).toMatchObject({ ok: true, created: true })
    if (!result.ok) return
    expect(await opportunities.get('ws-a', result.opportunityId)).toMatchObject({ fit: 'unknown', cutoff: 'not_evaluated' })
    expect(result.warnings.map((w) => w.code)).toContain('missing_optional_facts')
  })

  it('blocks with a typed deterministic failure for an absent or removed Job', async () => {
    const { jobs, promotion } = await setup()
    expect(await promotion.promoteJob({ workspaceId: 'ws-a', jobId: 'missing', actor: ACTOR }))
      .toMatchObject({ ok: false, code: 'not_found' })
    const jobId = await makeJob(jobs)
    await jobs.remove({ workspaceId: 'ws-a', jobId, actor: ACTOR })
    expect(await promotion.promoteJob({ workspaceId: 'ws-a', jobId, actor: ACTOR }))
      .toMatchObject({ ok: false })
  })

  it('rolls the whole promotion back atomically on an injected evaluation failure', async () => {
    const { database, jobs, opportunities } = await setup()
    const failingPort: OpportunityEvaluationPort = {
      evaluate: vi.fn(async () => { throw new Error('policy service exploded') }),
    }
    const promotion = createPgliteJobToOpportunityPromotion(database, opportunities, { now: monotonicClock(), evaluationPort: failingPort })
    const jobId = await makeJob(jobs)
    await expect(promotion.promoteJob({ workspaceId: 'ws-a', jobId, actor: ACTOR })).rejects.toThrow()
    // transient failure left NO partial Opportunity, and a retry (working port) succeeds once.
    expect(await countOpportunities(database, jobId)).toBe(0)
    const working = createPgliteJobToOpportunityPromotion(database, opportunities, { now: monotonicClock() })
    expect(await working.promoteJob({ workspaceId: 'ws-a', jobId, actor: ACTOR })).toMatchObject({ ok: true })
    expect(await countOpportunities(database, jobId)).toBe(1)
  })

  it('converges concurrent promotions of one Job to a single Opportunity', async () => {
    const { database, jobs, promotion } = await setup()
    const jobId = await makeJob(jobs)
    const [a, b] = await Promise.all([
      promotion.promoteJob({ workspaceId: 'ws-a', jobId, actor: ACTOR }),
      promotion.promoteJob({ workspaceId: 'ws-a', jobId, actor: ACTOR }),
    ])
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) expect(a.opportunityId).toBe(b.opportunityId)
    expect(await countOpportunities(database, jobId)).toBe(1)
  })

  it('cannot promote a Job across a workspace boundary', async () => {
    const { jobs, promotion } = await setup()
    const jobId = await makeJob(jobs, 'ws-a')
    expect(await promotion.promoteJob({ workspaceId: 'ws-b', jobId, actor: ACTOR }))
      .toMatchObject({ ok: false, code: 'not_found' })
  })
})

describe.sequential('Job→Opportunity promotion #304 threading', () => {
  it('threads a warning override onto the minted Opportunity resource', async () => {
    const { jobs, opportunities, promotion } = await setup()
    const jobId = await makeJob(jobs)
    const result = await promotion.promoteJob({
      workspaceId: 'ws-a', jobId, actor: ACTOR,
      override: { actor: { id: 'u', type: 'user' }, rationale: 'accepting the cutoff', warningCodes: ['cutoff'] },
    })
    expect(result).toMatchObject({ ok: true, created: true })
    if (!result.ok) return
    const opportunity = await opportunities.get('ws-a', result.opportunityId)
    expect(opportunity?.override).toMatchObject({ rationale: 'accepting the cutoff', warningCodes: ['cutoff'] })
  })

  it('threads a stale expectedJobFactsRevision into a typed revision_conflict', async () => {
    const { jobs, promotion } = await setup()
    const jobId = await makeJob(jobs)
    await jobs.correctFacts({ workspaceId: 'ws-a', jobId, facts: { title: 'Staff Engineer II' }, actor: ACTOR }) // factsRevision 1 → 2
    expect(await promotion.promoteJob({ workspaceId: 'ws-a', jobId, actor: ACTOR, expectedJobFactsRevision: 1 }))
      .toMatchObject({ ok: false, code: 'revision_conflict' })
    // The current revision (2) promotes cleanly.
    expect(await promotion.promoteJob({ workspaceId: 'ws-a', jobId, actor: ACTOR, expectedJobFactsRevision: 2 }))
      .toMatchObject({ ok: true })
  })

  it('duplicateResolution attach converges to the active Opportunity for the job', async () => {
    const { database, jobs, promotion } = await setup()
    const jobId = await makeJob(jobs)
    const first = await promotion.promoteJob({ workspaceId: 'ws-a', jobId, actor: ACTOR })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const attach = await promotion.promoteJob({
      workspaceId: 'ws-a', jobId, actor: ACTOR,
      duplicateResolution: { action: 'attach', targetResourceId: first.opportunityId },
    })
    expect(attach).toMatchObject({ ok: true })
    if (attach.ok) expect(attach.opportunityId).toBe(first.opportunityId)
    expect(await countOpportunities(database, jobId)).toBe(1)
  })
})
