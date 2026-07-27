/**
 * Application read-model proofs (issue #304, stage 3) on a migrated PGlite owner.
 *
 * Drives the REAL Job + Opportunity + Application aggregate services to write
 * canonical rows, then reads them back through the read-model. Proves the flattened
 * schema-valid `Application` resource (derived pursuit snapshot, links, status,
 * tombstone), the list page (isolation, opportunityId/jobId/status filters,
 * includeRemoved gating, keyset pagination), the attempt/event technical-list pages,
 * and the reconstructed history. Also proves the additive `capturedAt` persists and
 * advances on refreshSnapshot.
 */
import { describe, expect, it } from 'vitest'
import {
  applicationAttemptsListResultSchema,
  applicationEventsListResultSchema,
  applicationSchema,
  lifecycleApplicationHistoryResultSchema,
  lifecycleApplicationListResultSchema,
} from '@sparxie/sdk'
import { useResettablePgliteTestOwner } from '../../test/pglite-test-owner'
import { workspaces } from '../../db/workspaces.schema'
import type { JobService } from '../job/job.service'
import { createPgliteJobServiceWithCompanies } from '../../test/job-service-with-companies'
import { createPgliteOpportunityService, type OpportunityService } from '../opportunity/opportunity.service'
import { createPgliteApplicationAggregateService, type ApplicationAggregateService } from './application.aggregate.service'
import { createPgliteApplicationReadModel } from './application.read-model'

const resettableOwner = useResettablePgliteTestOwner()
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
  const jobs = createPgliteJobServiceWithCompanies(database, { now: clock })
  const opportunities = createPgliteOpportunityService(database, { now: clock })
  const applications = createPgliteApplicationAggregateService(database, { now: clock })
  const readModel = createPgliteApplicationReadModel(database)
  return { database, jobs, opportunities, applications, readModel }
}

async function makeLineage(jobs: JobService, opportunities: OpportunityService, workspaceId = 'ws-a', facts: Record<string, unknown> = { company: 'Acme', title: 'Staff Engineer' }) {
  const job = await jobs.create({ workspaceId, facts, actor: ACTOR })
  if (!job.ok) throw new Error(`job create failed: ${job.code}`)
  const opp = await opportunities.create({ workspaceId, jobId: job.job.id, actor: ACTOR })
  if (!opp.ok) throw new Error(`opportunity create failed: ${opp.code}`)
  return { opportunityId: opp.opportunity.id, jobId: job.job.id }
}

async function makeApplication(applications: ApplicationAggregateService, opportunityId: string, workspaceId = 'ws-a') {
  const result = await applications.create({ workspaceId, opportunityId, actor: ACTOR })
  if (!result.ok) throw new Error(`application create failed: ${result.code} ${result.message}`)
  return result.application.id
}

/** Address one direction of the canonical page contract without widening the union. */
const afterPage = (after: string | undefined) => (after === undefined ? {} : { after })
const beforePage = (before: string | undefined) => (before === undefined ? {} : { before })

describe.sequential('Application read-model (#304)', () => {
  it('reads a created application back as a flattened, schema-valid resource with a derived snapshot', async () => {
    const { jobs, opportunities, applications, readModel } = await setup()
    const { opportunityId } = await makeLineage(jobs, opportunities)
    const applicationId = await makeApplication(applications, opportunityId)

    const dto = await readModel.getApplication('ws-a', applicationId)
    expect(dto).not.toBeNull()
    expect(() => applicationSchema.parse(dto)).not.toThrow()
    expect(dto).toMatchObject({ id: applicationId, workspaceId: 'ws-a', opportunityId, status: 'active', revision: 1 })
    // Placeholder job facts still derive a schema-valid snapshot; capturedAt persisted at create.
    expect(dto?.snapshot.jobFactsRevision).toBe(1)
    expect(dto?.snapshot.capturedAt).toBe(dto?.createdAt)
    expect(dto?.snapshot.companyName).toBe('Acme')
    expect(dto?.links).toEqual([])
  })

  it('reflects status/company/link edits and the tombstone; never resolves across workspaces', async () => {
    const { jobs, opportunities, applications, readModel } = await setup()
    const { opportunityId } = await makeLineage(jobs, opportunities)
    const applicationId = await makeApplication(applications, opportunityId)

    await applications.transitionStatus({ workspaceId: 'ws-a', applicationId, status: 'submitted', actor: ACTOR })
    await applications.editCompany({ workspaceId: 'ws-a', applicationId, companyName: 'Acme Corp', actor: ACTOR })
    await applications.addLink({ workspaceId: 'ws-a', applicationId, link: { kind: 'portal', label: 'Portal', url: 'https://acme.example/apply' }, actor: ACTOR })

    const dto = await readModel.getApplication('ws-a', applicationId)
    expect(() => applicationSchema.parse(dto)).not.toThrow()
    expect(dto).toMatchObject({ status: 'submitted', companyName: 'Acme Corp' })
    expect(dto?.links.map((entry) => entry.label)).toEqual(['Portal'])

    // The link is a dependent, so removal requires an explicit dependent choice.
    const removed = await applications.remove({ workspaceId: 'ws-a', applicationId, actor: ACTOR, dependents: 'cascade' })
    expect(removed.ok).toBe(true)
    expect((await readModel.getApplication('ws-a', applicationId))?.removedAt).not.toBeNull()
    expect(await readModel.getApplication('ws-b', applicationId)).toBeNull()
  })

  it('advances capturedAt on refreshSnapshot', async () => {
    const { jobs, opportunities, applications, readModel } = await setup()
    const { opportunityId, jobId } = await makeLineage(jobs, opportunities)
    const applicationId = await makeApplication(applications, opportunityId)
    const before = await readModel.getApplication('ws-a', applicationId)

    // Advance the Job facts, then refresh so capturedAt reflects the new capture time.
    await jobs.correctFacts({ workspaceId: 'ws-a', jobId, facts: { company: 'Acme', title: 'Principal Engineer' }, actor: ACTOR })
    await applications.refreshSnapshot({ workspaceId: 'ws-a', applicationId, actor: ACTOR, preserveCompanyEdit: true, preserveSourceEdit: true, preserveLinkEdits: true })

    const after = await readModel.getApplication('ws-a', applicationId)
    expect(after!.snapshot.capturedAt > before!.snapshot.capturedAt).toBe(true)
    expect(after!.snapshot.jobFactsRevision).toBe(2)
  })

  it('lists applications with opportunityId/jobId/status filters and includeRemoved gating', async () => {
    const { jobs, opportunities, applications, readModel } = await setup()
    const a = await makeLineage(jobs, opportunities)
    const b = await makeLineage(jobs, opportunities)
    const c = await makeLineage(jobs, opportunities)
    const appA = await makeApplication(applications, a.opportunityId)
    const appB = await makeApplication(applications, b.opportunityId)
    const appC = await makeApplication(applications, c.opportunityId)
    await applications.transitionStatus({ workspaceId: 'ws-a', applicationId: appB, status: 'submitted', actor: ACTOR })
    await applications.remove({ workspaceId: 'ws-a', applicationId: appC, actor: ACTOR })

    const active = await readModel.listApplications('ws-a')
    expect(() => lifecycleApplicationListResultSchema.parse(active)).not.toThrow()
    expect(active.items.map((item) => item.id).sort()).toEqual([appA, appB].sort())

    expect((await readModel.listApplications('ws-a', { opportunityId: a.opportunityId })).items.map((item) => item.id)).toEqual([appA])
    expect((await readModel.listApplications('ws-a', { jobId: b.jobId })).items.map((item) => item.id)).toEqual([appB])
    expect((await readModel.listApplications('ws-a', { status: 'submitted' })).items.map((item) => item.id)).toEqual([appB])
    expect((await readModel.listApplications('ws-a', { includeRemoved: true })).items.some((item) => item.id === appC)).toBe(true)
  })

  it('serves the attempt + event technical lists, workspace-scoped and paginated', async () => {
    const { jobs, opportunities, applications, readModel } = await setup()
    const { opportunityId } = await makeLineage(jobs, opportunities)
    const applicationId = await makeApplication(applications, opportunityId)

    for (let index = 0; index < 3; index += 1) {
      await applications.recordAttempt({ workspaceId: 'ws-a', applicationId, attempt: { state: 'succeeded', startedAt: `2026-07-20T01:0${index}:00.000Z`, summary: `run ${index}` }, actor: ACTOR })
      await applications.recordEvent({ workspaceId: 'ws-a', applicationId, event: { type: 'note', summary: `note ${index}` }, actor: ACTOR })
    }

    const attempts = await readModel.listAttempts('ws-a', { applicationId })
    expect(() => applicationAttemptsListResultSchema.parse(attempts)).not.toThrow()
    expect(attempts.items).toHaveLength(3)

    const events = await readModel.listEvents('ws-a', { applicationId })
    expect(() => applicationEventsListResultSchema.parse(events)).not.toThrow()
    expect(events.items).toHaveLength(3)

    // Keyset pagination over attempts walks every row exactly once.
    const seen: string[] = []
    const back: string[] = []
    let after: string | undefined
    let before: string | undefined
    for (let guard = 0; guard < 6; guard += 1) {
      const page = await readModel.listAttempts('ws-a', { applicationId, limit: 2, ...afterPage(after) })
      seen.push(...page.items.map((item) => item.id))
      if (!page.pageInfo.hasNextPage) {
        back.push(...page.items.map((item) => item.id))
        before = page.pageInfo.hasPreviousPage ? page.pageInfo.startCursor ?? undefined : undefined
        break
      }
      after = page.pageInfo.endCursor ?? undefined
    }

    // Walking back from the final page rebuilds the same sequence in the same order.
    for (let guard = 0; guard < 6 && before !== undefined; guard += 1) {
      const page = await readModel.listAttempts('ws-a', { applicationId, limit: 2, ...beforePage(before) })
      back.unshift(...page.items.map((item) => item.id))
      before = page.pageInfo.hasPreviousPage ? page.pageInfo.startCursor ?? undefined : undefined
    }
    expect(back).toEqual(seen)
    expect(new Set(seen).size).toBe(3)

    // A foreign workspace sees no technical records.
    expect((await readModel.listAttempts('ws-b', { applicationId })).items).toEqual([])
  })

  it('reconstructs the create->status->company->remove->restore history as schema-valid snapshots', async () => {
    const { jobs, opportunities, applications, readModel } = await setup()
    const { opportunityId } = await makeLineage(jobs, opportunities)
    const applicationId = await makeApplication(applications, opportunityId)
    await applications.transitionStatus({ workspaceId: 'ws-a', applicationId, status: 'submitted', actor: ACTOR })
    await applications.editCompany({ workspaceId: 'ws-a', applicationId, companyName: 'Acme Corp', actor: ACTOR })
    await applications.remove({ workspaceId: 'ws-a', applicationId, actor: ACTOR })
    await applications.restore({ workspaceId: 'ws-a', applicationId, actor: ACTOR })

    const history = await readModel.historyApplications('ws-a', { id: applicationId })
    expect(() => lifecycleApplicationHistoryResultSchema.parse(history)).not.toThrow()
    expect(history.items.map((item) => item.kind)).toEqual(['created', 'status_changed', 'company_edited', 'removed', 'restored'])
    expect(history.items[1]!.snapshot.status).toBe('submitted')
    expect(history.items[3]!.snapshot.removedAt).not.toBeNull()
    expect(history.items[4]!.snapshot.removedAt).toBeNull()
    for (const item of history.items) expect(item.snapshot.id).toBe(applicationId)

    expect((await readModel.historyApplications('ws-a', { id: '01890000-0000-7000-8000-0000000000ff' })).items).toEqual([])
  })
})
