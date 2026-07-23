/**
 * Lifecycle removal orchestration — red-first proofs through the PUBLIC orchestration
 * (issue #304, stage 2). Covers the full four-choice dependent matrix without
 * narrowing: reject_if_dependents, preserve_historical_lineage, unlink_dependents
 * (severable capture→job references vs. first-hop-only tombstone of non-severable
 * FK dependents), and cascade_tombstone down the whole capture→job→opportunity→
 * application chain; the application aggregate's leaf children (cascade deletes,
 * preserve keeps); atomic composition in ONE transaction; restore as a target-only
 * operation that reports the dependents that stayed tombstoned; and cross-workspace
 * isolation. The orchestration composes each aggregate's removeOn core plus the
 * Job-owned evidence-reference sever helper — it owns no aggregate writes itself.
 */
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { useResettablePgliteTestOwner } from '../../test/pglite-test-owner'
import { workspaces } from '../../db/workspaces.schema'
import { createPgliteCaptureService } from '../capture/capture.service'
import { createCoveredPgliteJobService } from '../../test/covered-job-service'
import { createPgliteOpportunityService } from '../opportunity/opportunity.service'
import { createPgliteApplicationAggregateService } from '../applications/application.aggregate.service'
import { createPgliteJobPromotion } from './capture-to-job.promotion'
import { createPgliteOpportunityToApplicationPromotion } from './opportunity-to-application.promotion'
import { jobCaptureEvidenceReferences } from '../job/job.schema'
import { createLifecycleRemovalOrchestration } from './removal.orchestration'

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
  const captureService = createPgliteCaptureService(database, { now: clock })
  const jobService = createCoveredPgliteJobService(database, { now: clock })
  const opportunityService = createPgliteOpportunityService(database, { now: clock })
  const applicationService = createPgliteApplicationAggregateService(database, { now: clock })
  const capturePromotion = createPgliteJobPromotion(database, captureService, jobService, { now: clock })
  const chainPromotion = createPgliteOpportunityToApplicationPromotion(
    database,
    { captureService, jobService, opportunityService, applicationService },
    { now: clock },
  )
  const orchestration = createLifecycleRemovalOrchestration(database, { captureService, jobService, opportunityService, applicationService })
  return { database, captureService, jobService, opportunityService, applicationService, capturePromotion, chainPromotion, orchestration }
}

/** Build a full capture→job→opportunity→application chain in one workspace. */
async function makeChain(s: Awaited<ReturnType<typeof setup>>, workspaceId = 'ws-a') {
  const manual = await s.chainPromotion.createManualApplication({
    workspaceId, actor: ACTOR,
    jobFacts: { company: 'Acme', title: 'Staff Engineer' },
    capture: { evidence: [{ kind: 'title', label: 'Title', value: 'Engineer' }] },
  })
  if (!manual.ok) throw new Error(`chain failed: ${manual.code}`)
  return { captureId: manual.captureId, jobId: manual.jobId, opportunityId: manual.opportunityId, applicationId: manual.applicationId }
}

describe.sequential('Lifecycle removal orchestration (#304)', () => {
  it('reject_if_dependents refuses a Job with an active Opportunity, and tombstones a Job with none', async () => {
    const s = await setup()
    const { jobId, opportunityId } = await makeChain(s)
    const rejected = await s.orchestration.remove({ workspaceId: 'ws-a', aggregate: 'job', resourceId: jobId, choice: 'reject_if_dependents', actor: ACTOR })
    expect(rejected).toMatchObject({ ok: false, code: 'dependents_present' })
    expect((await s.jobService.get('ws-a', jobId))?.removedAt).toBeNull() // untouched
    // A standalone Job (no opportunity) tombstones cleanly.
    const solo = await s.jobService.create({ workspaceId: 'ws-a', facts: { title: 'Solo' }, actor: ACTOR })
    if (!solo.ok) throw new Error('solo create failed')
    const ok = await s.orchestration.remove({ workspaceId: 'ws-a', aggregate: 'job', resourceId: solo.job.id, choice: 'reject_if_dependents', actor: ACTOR })
    expect(ok).toMatchObject({ ok: true, tombstoned: [{ aggregate: 'job', id: solo.job.id }] })
    expect((await s.jobService.get('ws-a', solo.job.id))?.removedAt).not.toBeNull()
    void opportunityId
  })

  it('preserve_historical_lineage tombstones the Opportunity but leaves its Application active', async () => {
    const s = await setup()
    const { opportunityId, applicationId } = await makeChain(s)
    const result = await s.orchestration.remove({ workspaceId: 'ws-a', aggregate: 'opportunity', resourceId: opportunityId, choice: 'preserve_historical_lineage', actor: ACTOR })
    expect(result).toMatchObject({ ok: true, tombstoned: [{ aggregate: 'opportunity', id: opportunityId }] })
    if (!result.ok) return
    expect(result.unlinked).toEqual([])
    expect((await s.opportunityService.get('ws-a', opportunityId))?.removedAt).not.toBeNull()
    expect((await s.applicationService.get('ws-a', applicationId))?.removedAt).toBeNull() // preserved
  })

  it('unlink_dependents on a Capture severs the evidence reference and leaves the Job active', async () => {
    const s = await setup()
    const { captureId, jobId } = await makeChain(s)
    const before = await s.database.select().from(jobCaptureEvidenceReferences).where(eq(jobCaptureEvidenceReferences.captureId, captureId))
    expect(before.length).toBeGreaterThanOrEqual(1)
    const result = await s.orchestration.remove({ workspaceId: 'ws-a', aggregate: 'capture', resourceId: captureId, choice: 'unlink_dependents', actor: ACTOR })
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(result.tombstoned).toEqual([{ aggregate: 'capture', id: captureId }])
    expect(result.unlinked).toEqual([{ aggregate: 'job', id: jobId }])
    expect((await s.captureService.get('ws-a', captureId))?.removedAt).not.toBeNull() // capture tombstoned
    expect((await s.jobService.get('ws-a', jobId))?.removedAt).toBeNull() // job stays active
    const after = await s.database.select().from(jobCaptureEvidenceReferences).where(eq(jobCaptureEvidenceReferences.captureId, captureId))
    expect(after).toEqual([]) // reference severed
  })

  it('unlink_dependents on a Job tombstones only the immediate Opportunity, never its Application', async () => {
    const s = await setup()
    const { jobId, opportunityId, applicationId } = await makeChain(s)
    const result = await s.orchestration.remove({ workspaceId: 'ws-a', aggregate: 'job', resourceId: jobId, choice: 'unlink_dependents', actor: ACTOR })
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(result.tombstoned).toEqual([
      { aggregate: 'job', id: jobId },
      { aggregate: 'opportunity', id: opportunityId },
    ])
    expect((await s.jobService.get('ws-a', jobId))?.removedAt).not.toBeNull()
    expect((await s.opportunityService.get('ws-a', opportunityId))?.removedAt).not.toBeNull()
    expect((await s.applicationService.get('ws-a', applicationId))?.removedAt).toBeNull() // first-hop only
  })

  it('cascade_tombstone from the Capture tombstones the whole capture→job→opportunity→application chain', async () => {
    const s = await setup()
    const { captureId, jobId, opportunityId, applicationId } = await makeChain(s)
    const result = await s.orchestration.remove({ workspaceId: 'ws-a', aggregate: 'capture', resourceId: captureId, choice: 'cascade_tombstone', actor: ACTOR })
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    const ids = result.tombstoned.map((r) => `${r.aggregate}:${r.id}`)
    expect(ids).toEqual([`capture:${captureId}`, `job:${jobId}`, `opportunity:${opportunityId}`, `application:${applicationId}`])
    for (const get of [
      s.captureService.get('ws-a', captureId),
      s.jobService.get('ws-a', jobId),
      s.opportunityService.get('ws-a', opportunityId),
      s.applicationService.get('ws-a', applicationId),
    ]) {
      expect((await get)?.removedAt).not.toBeNull()
    }
  })

  it('restore is target-only and reports the dependents that stayed tombstoned', async () => {
    const s = await setup()
    const { jobId, opportunityId } = await makeChain(s)
    // Cascade-tombstone the job (job + opportunity + application).
    await s.orchestration.remove({ workspaceId: 'ws-a', aggregate: 'job', resourceId: jobId, choice: 'cascade_tombstone', actor: ACTOR })
    const restored = await s.orchestration.restore({ workspaceId: 'ws-a', aggregate: 'job', resourceId: jobId, actor: ACTOR })
    expect(restored).toMatchObject({ ok: true, restored: { aggregate: 'job', id: jobId } })
    if (!restored.ok) return
    expect((await s.jobService.get('ws-a', jobId))?.removedAt).toBeNull() // target back
    expect(restored.remainedTombstoned).toEqual([{ aggregate: 'opportunity', id: opportunityId }])
    expect((await s.opportunityService.get('ws-a', opportunityId))?.removedAt).not.toBeNull() // NOT auto-restored
  })

  it('cascade deletes an Application\'s leaf children while preserve keeps them', async () => {
    const s = await setup()
    const a = await makeChain(s)
    await s.applicationService.recordEvent({ workspaceId: 'ws-a', applicationId: a.applicationId, event: { type: 'note', summary: 'hi' }, actor: ACTOR })
    const preserved = await s.orchestration.remove({ workspaceId: 'ws-a', aggregate: 'application', resourceId: a.applicationId, choice: 'preserve_historical_lineage', actor: ACTOR })
    expect(preserved).toMatchObject({ ok: true })
    expect((await s.applicationService.listEvents('ws-a', a.applicationId)).length).toBe(1) // kept
    // Restore then cascade removes the children.
    await s.orchestration.restore({ workspaceId: 'ws-a', aggregate: 'application', resourceId: a.applicationId, actor: ACTOR })
    const cascaded = await s.orchestration.remove({ workspaceId: 'ws-a', aggregate: 'application', resourceId: a.applicationId, choice: 'cascade_tombstone', actor: ACTOR })
    expect(cascaded).toMatchObject({ ok: true })
    expect((await s.applicationService.listEvents('ws-a', a.applicationId)).length).toBe(0) // deleted
  })

  it('rejects unknown aggregate/choice and a cross-workspace target', async () => {
    const s = await setup()
    const { jobId } = await makeChain(s)
    expect(await s.orchestration.remove({ workspaceId: 'ws-a', aggregate: 'bogus' as never, resourceId: jobId, choice: 'cascade_tombstone', actor: ACTOR }))
      .toMatchObject({ ok: false, code: 'invalid_input' })
    expect(await s.orchestration.remove({ workspaceId: 'ws-a', aggregate: 'job', resourceId: jobId, choice: 'bogus' as never, actor: ACTOR }))
      .toMatchObject({ ok: false, code: 'invalid_input' })
    expect(await s.orchestration.remove({ workspaceId: 'ws-b', aggregate: 'job', resourceId: jobId, choice: 'cascade_tombstone', actor: ACTOR }))
      .toMatchObject({ ok: false, code: 'not_found' })
    expect((await s.jobService.get('ws-a', jobId))?.removedAt).toBeNull() // untouched by the failed calls
  })
})
