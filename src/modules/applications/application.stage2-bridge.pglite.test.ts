/**
 * Application 0.27 create/promote contract bridge (#304, stage 2) — red-first proofs
 * through the public `create` command: idempotencyKey create-dedup, the
 * expectedJobFactsRevision + expectedJobId optimistic lineage guards, duplicate
 * attach/merge onto the one active (workspace, opportunity) Application, and the
 * warning override recorded in the created-history audit envelope (the Application
 * resource carries no override column). Runs on a migrated PGlite owner.
 */
import { describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { useResettablePgliteTestOwner } from '../../test/pglite-test-owner'
import { workspaces } from '../../db/workspaces.schema'
import { createCoveredPgliteJobService } from '../../test/covered-job-service'
import { createPgliteOpportunityService } from '../opportunity/opportunity.service'
import { applicationHistory, applications as applicationRows } from '../application/application.schema'
import { createPgliteApplicationAggregateService } from './application.aggregate.service'

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
  const jobs = createCoveredPgliteJobService(database, { now: clock })
  const opportunities = createPgliteOpportunityService(database, { now: clock })
  const applications = createPgliteApplicationAggregateService(database, { now: clock })
  return { database, jobs, opportunities, applications }
}

async function makeLineage(jobs: ReturnType<typeof createPgliteJobService>, opportunities: ReturnType<typeof createPgliteOpportunityService>) {
  const job = await jobs.create({ workspaceId: 'ws-a', facts: { company: 'Acme', title: 'Staff Engineer' }, actor: ACTOR })
  if (!job.ok) throw new Error('job create failed')
  const opp = await opportunities.create({ workspaceId: 'ws-a', jobId: job.job.id, actor: ACTOR })
  if (!opp.ok) throw new Error('opportunity create failed')
  return { jobId: job.job.id, opportunityId: opp.opportunity.id }
}

describe.sequential('Application 0.27 create bridge (#304)', () => {
  it('dedups a keyed create onto the same Application', async () => {
    const { jobs, opportunities, applications } = await setup()
    const { opportunityId } = await makeLineage(jobs, opportunities)
    const first = await applications.create({ workspaceId: 'ws-a', opportunityId, actor: ACTOR, idempotencyKey: 'k1' })
    const again = await applications.create({ workspaceId: 'ws-a', opportunityId, actor: ACTOR, idempotencyKey: 'k1' })
    if (!first.ok || !again.ok) throw new Error('expected ok')
    expect(first.created).toBe(true)
    expect(again.created).toBe(false)
    expect(again.application.id).toBe(first.application.id)
  })

  it('persists capturedAt in the stored snapshot at create and advances it on refreshSnapshot (#304)', async () => {
    const { database, jobs, opportunities, applications } = await setup()
    const { jobId, opportunityId } = await makeLineage(jobs, opportunities)
    const created = await applications.create({ workspaceId: 'ws-a', opportunityId, actor: ACTOR })
    if (!created.ok) throw new Error('expected ok')

    const readSnapshot = async () => {
      const [row] = await database
        .select({ snapshotJson: applicationRows.snapshotJson })
        .from(applicationRows)
        .where(eq(applicationRows.id, created.application.id))
      return JSON.parse(row!.snapshotJson) as { capturedAt?: string }
    }

    const atCreate = await readSnapshot()
    expect(typeof atCreate.capturedAt).toBe('string')
    expect(atCreate.capturedAt).toBe(created.application.createdAt)

    // A refresh re-captures now, so capturedAt advances past the create time.
    await jobs.correctFacts({ workspaceId: 'ws-a', jobId, facts: { company: 'Acme', title: 'Principal' }, actor: ACTOR })
    const refreshed = await applications.refreshSnapshot({ workspaceId: 'ws-a', applicationId: created.application.id, actor: ACTOR })
    expect(refreshed.ok).toBe(true)
    const afterRefresh = await readSnapshot()
    expect(afterRefresh.capturedAt! > atCreate.capturedAt!).toBe(true)
  })

  it('enforces the expectedJobFactsRevision and expectedJobId lineage guards', async () => {
    const { jobs, opportunities, applications } = await setup()
    const { jobId, opportunityId } = await makeLineage(jobs, opportunities)
    // Advance the Job facts so the pinned revision is stale.
    const corrected = await jobs.correctFacts({ workspaceId: 'ws-a', jobId, facts: { company: 'Acme', title: 'Principal' }, actor: ACTOR })
    if (!corrected.ok) throw new Error('correct failed')
    const stale = await applications.create({ workspaceId: 'ws-a', opportunityId, actor: ACTOR, expectedJobFactsRevision: 1 })
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.code).toBe('revision_conflict')
    const wrongJob = await applications.create({ workspaceId: 'ws-a', opportunityId, actor: ACTOR, expectedJobId: 'some-other-job' })
    expect(wrongJob.ok).toBe(false)
    if (!wrongJob.ok) expect(wrongJob.code).toBe('missing_lineage')
    const ok = await applications.create({ workspaceId: 'ws-a', opportunityId, actor: ACTOR, expectedJobId: jobId, expectedJobFactsRevision: 2 })
    expect(ok.ok).toBe(true)
  })

  it('attaches to the existing active Application on a duplicate, and blocks without resolution', async () => {
    const { jobs, opportunities, applications } = await setup()
    const { opportunityId } = await makeLineage(jobs, opportunities)
    const original = await applications.create({ workspaceId: 'ws-a', opportunityId, actor: ACTOR })
    if (!original.ok) throw new Error('expected ok')
    const blocked = await applications.create({ workspaceId: 'ws-a', opportunityId, actor: ACTOR })
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.code).toBe('deterministic_duplicate')
    const attached = await applications.create({
      workspaceId: 'ws-a', opportunityId, actor: ACTOR,
      duplicateResolution: { action: 'attach', targetResourceId: original.application.id },
    })
    if (!attached.ok) throw new Error('expected attach ok')
    expect(attached.created).toBe(false)
    expect(attached.application.id).toBe(original.application.id)
    const wrong = await applications.create({
      workspaceId: 'ws-a', opportunityId, actor: ACTOR,
      duplicateResolution: { action: 'merge', targetResourceId: 'not-the-target' },
    })
    expect(wrong.ok).toBe(false)
    if (!wrong.ok) expect(wrong.code).toBe('invalid_input')
  })

  it('records the warning override in the created-history audit envelope', async () => {
    const { database, jobs, opportunities, applications } = await setup()
    const { opportunityId } = await makeLineage(jobs, opportunities)
    const created = await applications.create({
      workspaceId: 'ws-a', opportunityId, actor: ACTOR,
      override: { actor: { id: 'user-1', type: 'user' }, rationale: 'overrode third-party destination', warningCodes: ['third_party_destination'] },
    })
    if (!created.ok) throw new Error('expected ok')
    const [row] = await database
      .select({ auditJson: applicationHistory.auditJson })
      .from(applicationHistory)
      .where(and(eq(applicationHistory.applicationId, created.application.id), eq(applicationHistory.revision, 1)))
    const audit = JSON.parse(row!.auditJson) as { override?: { rationale: string; warningCodes: string[] } }
    expect(audit.override).toEqual({
      actor: { id: 'user-1', type: 'user' },
      rationale: 'overrode third-party destination',
      warningCodes: ['third_party_destination'],
    })
  })

  it('guards refreshSnapshot with expectedJobFactsRevision: a stale pin is a revision_conflict, the current one refreshes', async () => {
    const { jobs, opportunities, applications } = await setup()
    const { jobId, opportunityId } = await makeLineage(jobs, opportunities)
    const created = await applications.create({ workspaceId: 'ws-a', opportunityId, actor: ACTOR })
    if (!created.ok) throw new Error('expected ok')
    expect(created.application.jobFactsRevision).toBe(1)
    // Advance the Job facts so the application snapshot is stale (still at revision 1).
    const corrected = await jobs.correctFacts({ workspaceId: 'ws-a', jobId, facts: { company: 'Acme', title: 'Principal' }, actor: ACTOR })
    if (!corrected.ok) throw new Error('correct failed')
    const stale = await applications.refreshSnapshot({ workspaceId: 'ws-a', applicationId: created.application.id, actor: ACTOR, expectedJobFactsRevision: 1 })
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.code).toBe('revision_conflict')
    const refreshed = await applications.refreshSnapshot({ workspaceId: 'ws-a', applicationId: created.application.id, actor: ACTOR, expectedJobFactsRevision: 2 })
    expect(refreshed.ok).toBe(true)
    if (refreshed.ok) expect(refreshed.application.jobFactsRevision).toBe(2)
  })
})
