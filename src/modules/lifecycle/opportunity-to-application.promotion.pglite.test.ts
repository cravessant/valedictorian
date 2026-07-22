/**
 * Opportunity → Application promotion — red-first proofs through the PUBLIC
 * orchestration (issue #302). Covers the ONE idempotent transaction that creates or
 * attaches the Application plus its initial links, event, workflow state, and both
 * lineage directions; deterministic-duplicate attach; policy judgments never block;
 * atomic rollback on an injected failure between multi-write steps (no partial
 * Application, no orphaned links/events); concurrency convergence to a single
 * Application; cross-workspace isolation; and the manual Capture→Job→Opportunity→
 * Application chain minted atomically in one transaction (AC4).
 */
import { describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { useResettablePgliteTestOwner } from '../../test/pglite-test-owner'
import { workspaces } from '../../db/workspaces.schema'
import { createPgliteCaptureService } from '../capture/capture.service'
import { createPgliteJobService, type JobService } from '../job/job.service'
import { createPgliteOpportunityService, type OpportunityService } from '../opportunity/opportunity.service'
import { createPgliteApplicationAggregateService } from '../applications/application.aggregate.service'
import { lifecycleApplications, pursuitLinks, applicationEventRecords, applicationHistory } from '../application/application.schema'
import { lifecycleCaptures } from '../capture/capture.schema'
import { lifecycleJobs } from '../job/job.schema'
import { lifecycleOpportunities } from '../opportunity/opportunity.schema'
import { createPgliteOpportunityToApplicationPromotion } from './opportunity-to-application.promotion'

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
  const captures = createPgliteCaptureService(database, { now: clock })
  const jobs = createPgliteJobService(database, { now: clock })
  const opportunities = createPgliteOpportunityService(database, { now: clock })
  const applications = createPgliteApplicationAggregateService(database, { now: clock })
  const promotion = createPgliteOpportunityToApplicationPromotion(
    database,
    { captureService: captures, jobService: jobs, opportunityService: opportunities, applicationService: applications },
    { now: clock },
  )
  return { database, captures, jobs, opportunities, applications, promotion }
}

async function makeOpportunity(jobs: JobService, opportunities: OpportunityService, workspaceId = 'ws-a') {
  const job = await jobs.create({ workspaceId, facts: { company: 'Acme', title: 'Staff Engineer' }, actor: ACTOR })
  if (!job.ok) throw new Error('job create failed')
  const opp = await opportunities.create({ workspaceId, jobId: job.job.id, actor: ACTOR })
  if (!opp.ok) throw new Error('opportunity create failed')
  return { jobId: job.job.id, opportunityId: opp.opportunity.id }
}

async function countApplications(database: Awaited<ReturnType<typeof setup>>['database'], opportunityId: string) {
  return (await database.select().from(lifecycleApplications).where(eq(lifecycleApplications.opportunityId, opportunityId))).length
}

describe.sequential('Opportunity→Application promotion (#302)', () => {
  it('promotes an Opportunity into one Application with both lineage directions, initial link, event, and workflow state', async () => {
    const { database, jobs, opportunities, applications, promotion } = await setup()
    const { jobId, opportunityId } = await makeOpportunity(jobs, opportunities)
    const result = await promotion.promoteOpportunity({
      workspaceId: 'ws-a', opportunityId, actor: ACTOR, sourceName: 'Referral',
      links: [{ kind: 'posting', label: 'Posting', url: 'https://a.example/1', isPrimary: true }],
      event: { type: 'promoted', summary: 'created from opportunity' },
    })
    expect(result).toMatchObject({ ok: true, created: true, attached: false, jobId, opportunityId })
    if (!result.ok) return
    const application = await applications.get('ws-a', result.applicationId)
    expect(application).toMatchObject({ opportunityId, jobId, status: 'active', companyName: 'Acme', sourceName: 'Referral' })
    expect((await applications.listLinks('ws-a', result.applicationId)).length).toBe(1)
    expect((await applications.listEvents('ws-a', result.applicationId)).map((e) => e.type)).toEqual(['promoted'])
    expect(await countApplications(database, opportunityId)).toBe(1)
  })

  it('is idempotent: re-promoting attaches the existing Application without minting a duplicate', async () => {
    const { database, jobs, opportunities, promotion } = await setup()
    const { opportunityId } = await makeOpportunity(jobs, opportunities)
    const first = await promotion.promoteOpportunity({ workspaceId: 'ws-a', opportunityId, actor: ACTOR })
    const second = await promotion.promoteOpportunity({ workspaceId: 'ws-a', opportunityId, actor: ACTOR })
    expect(first).toMatchObject({ ok: true, created: true })
    expect(second).toMatchObject({ ok: true, created: false, attached: true })
    if (first.ok && second.ok) expect(second.applicationId).toBe(first.applicationId)
    expect(await countApplications(database, opportunityId)).toBe(1)
  })

  it('does not block on any policy judgment (declined/not_fit opportunity still promotes)', async () => {
    const { jobs, opportunities, promotion } = await setup()
    const { opportunityId } = await makeOpportunity(jobs, opportunities)
    await opportunities.reevaluate({ workspaceId: 'ws-a', opportunityId, fit: 'not_fit', cutoff: 'below', actor: { type: 'system' } })
    await opportunities.setDisposition({ workspaceId: 'ws-a', opportunityId, disposition: 'declined', rationale: 'x', actor: ACTOR })
    expect(await promotion.promoteOpportunity({ workspaceId: 'ws-a', opportunityId, actor: ACTOR })).toMatchObject({ ok: true, created: true })
  })

  it('rolls the whole promotion back atomically on an injected failure between multi-write steps', async () => {
    const { database, jobs, opportunities, applications, promotion } = await setup()
    const { opportunityId } = await makeOpportunity(jobs, opportunities)
    // inject a failure after the Application row but during initial-link creation.
    const spy = vi.spyOn(applications, 'addLinkOn').mockRejectedValueOnce(new Error('link write exploded'))
    await expect(promotion.promoteOpportunity({
      workspaceId: 'ws-a', opportunityId, actor: ACTOR,
      links: [{ kind: 'posting', label: 'L', url: 'https://a.example/1', isPrimary: true }],
    })).rejects.toThrow()
    spy.mockRestore()
    expect(await countApplications(database, opportunityId)).toBe(0)
    expect((await database.select().from(pursuitLinks)).length).toBe(0)
    expect((await database.select().from(applicationEventRecords)).length).toBe(0)
    // a clean retry then succeeds exactly once.
    expect(await promotion.promoteOpportunity({ workspaceId: 'ws-a', opportunityId, actor: ACTOR })).toMatchObject({ ok: true })
    expect(await countApplications(database, opportunityId)).toBe(1)
  })

  it('converges concurrent promotions of one Opportunity to a single Application', async () => {
    const { database, jobs, opportunities, promotion } = await setup()
    const { opportunityId } = await makeOpportunity(jobs, opportunities)
    const [a, b] = await Promise.all([
      promotion.promoteOpportunity({ workspaceId: 'ws-a', opportunityId, actor: ACTOR }),
      promotion.promoteOpportunity({ workspaceId: 'ws-a', opportunityId, actor: ACTOR }),
    ])
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) expect(a.applicationId).toBe(b.applicationId)
    expect(await countApplications(database, opportunityId)).toBe(1)
  })

  it('blocks a cross-workspace promotion and a removed Opportunity with typed failures', async () => {
    const { jobs, opportunities, promotion } = await setup()
    const { opportunityId } = await makeOpportunity(jobs, opportunities, 'ws-a')
    expect(await promotion.promoteOpportunity({ workspaceId: 'ws-b', opportunityId, actor: ACTOR }))
      .toMatchObject({ ok: false, code: 'not_found' })
    await opportunities.remove({ workspaceId: 'ws-a', opportunityId, actor: ACTOR })
    expect(await promotion.promoteOpportunity({ workspaceId: 'ws-a', opportunityId, actor: ACTOR }))
      .toMatchObject({ ok: false })
  })

  it('mints the manual Capture→Job→Opportunity→Application chain atomically in one transaction (AC4)', async () => {
    const { database, applications, promotion } = await setup()
    const result = await promotion.createManualApplication({
      workspaceId: 'ws-a',
      actor: ACTOR,
      jobFacts: { company: 'Globex', title: 'Principal Engineer' },
      capture: { evidence: [{ kind: 'title', label: 'Title', value: 'Principal Engineer' }] },
      sourceName: 'Manual entry',
    })
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    // every upstream aggregate exists and is linked.
    expect((await database.select().from(lifecycleCaptures).where(eq(lifecycleCaptures.id, result.captureId))).length).toBe(1)
    expect((await database.select().from(lifecycleJobs).where(eq(lifecycleJobs.id, result.jobId))).length).toBe(1)
    expect((await database.select().from(lifecycleOpportunities).where(eq(lifecycleOpportunities.id, result.opportunityId))).length).toBe(1)
    const application = await applications.get('ws-a', result.applicationId)
    expect(application).toMatchObject({ opportunityId: result.opportunityId, jobId: result.jobId, companyName: 'Globex', sourceName: 'Manual entry' })
  })

  it('leaves no partial chain when the manual creation fails midway (Opportunity step injected)', async () => {
    const { database, opportunities, promotion } = await setup()
    // inject a failure at the Opportunity step, AFTER the capture + job + lineage writes.
    const spy = vi.spyOn(opportunities, 'createOn').mockRejectedValueOnce(new Error('opportunity write exploded'))
    await expect(promotion.createManualApplication({
      workspaceId: 'ws-a', actor: ACTOR,
      jobFacts: { company: 'Globex' },
      capture: { evidence: [{ kind: 'title', label: 'Title', value: 'Engineer' }] },
      sourceName: 'Manual',
    })).rejects.toThrow()
    spy.mockRestore()
    // the whole chain rolled back: no capture, job, opportunity, or application survives.
    expect((await database.select().from(lifecycleCaptures)).length).toBe(0)
    expect((await database.select().from(lifecycleJobs)).length).toBe(0)
    expect((await database.select().from(lifecycleOpportunities)).length).toBe(0)
    expect((await database.select().from(lifecycleApplications)).length).toBe(0)
    // a clean retry then mints the full chain exactly once.
    const ok = await promotion.createManualApplication({
      workspaceId: 'ws-a', actor: ACTOR,
      jobFacts: { company: 'Globex' },
      capture: { evidence: [{ kind: 'title', label: 'Title', value: 'Engineer' }] },
      sourceName: 'Manual',
    })
    expect(ok).toMatchObject({ ok: true })
    expect((await database.select().from(lifecycleApplications)).length).toBe(1)
  })
})

describe.sequential('Opportunity→Application promotion #304 threading', () => {
  it('threads a stale expectedJobFactsRevision into a typed revision_conflict', async () => {
    const { jobs, opportunities, promotion } = await setup()
    const { jobId, opportunityId } = await makeOpportunity(jobs, opportunities)
    await jobs.correctFacts({ workspaceId: 'ws-a', jobId, facts: { company: 'Acme', title: 'Principal' }, actor: ACTOR }) // → factsRevision 2
    expect(await promotion.promoteOpportunity({ workspaceId: 'ws-a', opportunityId, actor: ACTOR, expectedJobFactsRevision: 1 }))
      .toMatchObject({ ok: false, code: 'revision_conflict' })
    expect(await promotion.promoteOpportunity({ workspaceId: 'ws-a', opportunityId, actor: ACTOR, expectedJobFactsRevision: 2 }))
      .toMatchObject({ ok: true })
  })

  it('threads a mismatched expectedJobId into a typed missing_lineage', async () => {
    const { jobs, opportunities, promotion } = await setup()
    const { opportunityId } = await makeOpportunity(jobs, opportunities)
    expect(await promotion.promoteOpportunity({ workspaceId: 'ws-a', opportunityId, actor: ACTOR, expectedJobId: 'some-other-job' }))
      .toMatchObject({ ok: false, code: 'missing_lineage' })
  })

  it('threads a warning override into the minted Application created-history audit', async () => {
    const { database, jobs, opportunities, promotion } = await setup()
    const { opportunityId } = await makeOpportunity(jobs, opportunities)
    const result = await promotion.promoteOpportunity({
      workspaceId: 'ws-a', opportunityId, actor: ACTOR,
      override: { actor: { id: 'u', type: 'user' }, rationale: 'accept unknown fit', warningCodes: ['fit'] },
    })
    expect(result).toMatchObject({ ok: true, created: true })
    if (!result.ok) return
    const [row] = await database
      .select({ auditJson: applicationHistory.auditJson })
      .from(applicationHistory)
      .where(and(eq(applicationHistory.applicationId, result.applicationId), eq(applicationHistory.revision, 1)))
    const audit = JSON.parse(row!.auditJson) as { override?: { rationale: string; warningCodes: string[] } }
    expect(audit.override).toMatchObject({ rationale: 'accept unknown fit', warningCodes: ['fit'] })
  })
})
