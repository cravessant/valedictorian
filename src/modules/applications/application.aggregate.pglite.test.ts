/**
 * Application module contract — red-first proofs through the PUBLIC commands/queries
 * (issue #302). Exercises the canonical `applications` + `pursuit_links` +
 * `application_attempt_records` + `application_event_records` + append-only
 * `application_history` on a migrated PGlite owner: UUIDv7 identities, direct
 * Opportunity + Job lineage with DB-enforced workspace ownership, company/source
 * edits, links (add/update/unlink with a single-primary rule), status transitions,
 * explicit snapshot/refresh that never silently rewrites on a later Job revision,
 * attempts + events generation, remove/restore tombstones with an explicit dependent
 * choice, append-only history, concurrency, deterministic duplicate on the
 * (workspace, opportunity) key, and cross-workspace isolation.
 */
import { describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { useResettablePgliteTestOwner } from '../../test/pglite-test-owner'
import { workspaces } from '../../db/workspaces.schema'
import { UUID_V7_PATTERN } from '../../db/lifecycle-vocabulary'
import type { JobService } from '../job/job.service'
import { createCoveredPgliteJobService } from '../../test/covered-job-service'
import { createPgliteOpportunityService, type OpportunityService } from '../opportunity/opportunity.service'
import { applications as applicationRows } from '../application/application.schema'
import {
  createPgliteApplicationAggregateService,
  type ApplicationAggregateService,
  type CreateApplicationInput,
} from './application.aggregate.service'

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
  const jobs = createCoveredPgliteJobService(database, { now: clock })
  const opportunities = createPgliteOpportunityService(database, { now: clock })
  const applications = createPgliteApplicationAggregateService(database, { now: clock })
  return { database, jobs, opportunities, applications }
}

async function makeOpportunity(jobs: JobService, opportunities: OpportunityService, workspaceId = 'ws-a', facts: Record<string, unknown> = { company: 'Acme', title: 'Staff Engineer' }) {
  const job = await jobs.create({ workspaceId, facts, actor: ACTOR })
  if (!job.ok) throw new Error(`job create failed: ${job.code}`)
  const opp = await opportunities.create({ workspaceId, jobId: job.job.id, actor: ACTOR })
  if (!opp.ok) throw new Error(`opportunity create failed: ${opp.code}`)
  return { jobId: job.job.id, opportunityId: opp.opportunity.id }
}

async function makeApplication(applications: ApplicationAggregateService, opportunityId: string, overrides: Partial<CreateApplicationInput> = {}) {
  const result = await applications.create({ workspaceId: 'ws-a', opportunityId, actor: ACTOR, ...overrides })
  if (!result.ok) throw new Error(`application create failed: ${result.code} ${result.message}`)
  return result.application
}

describe.sequential('Application module contract (#302)', () => {
  it('creates a durable application with a UUIDv7 id, direct Opportunity + Job lineage, snapshot, and created history', async () => {
    const { jobs, opportunities, applications } = await setup()
    const { jobId, opportunityId } = await makeOpportunity(jobs, opportunities)
    const application = await makeApplication(applications, opportunityId, { sourceName: 'Referral' })

    expect(application.id).toMatch(uuidV7Regex)
    expect(application).toMatchObject({ opportunityId, jobId, revision: 1, status: 'active', companyName: 'Acme', sourceName: 'Referral' })
    expect(application.jobFactsRevision).toBe(1)
    expect(application.snapshot).toMatchObject({ job: { factsRevision: 1 } })
    expect(application.removedAt).toBeNull()

    expect((await applications.get('ws-a', application.id))?.id).toBe(application.id)
    expect((await applications.list('ws-a')).map((a) => a.id)).toEqual([application.id])
    expect((await applications.history('ws-a', application.id)).map((e) => e.kind)).toEqual(['created'])
  })

  it('rejects a create whose Opportunity is absent or lives in another workspace with missing_lineage', async () => {
    const { jobs, opportunities, applications } = await setup()
    const foreign = await makeOpportunity(jobs, opportunities, 'ws-b')
    expect(await applications.create({ workspaceId: 'ws-a', opportunityId: 'nope', actor: ACTOR }))
      .toMatchObject({ ok: false, code: 'missing_lineage' })
    expect(await applications.create({ workspaceId: 'ws-a', opportunityId: foreign.opportunityId, actor: ACTOR }))
      .toMatchObject({ ok: false, code: 'missing_lineage' })
  })

  it('enforces one active application per (workspace, Opportunity) with a deterministic_duplicate', async () => {
    const { jobs, opportunities, applications } = await setup()
    const { opportunityId } = await makeOpportunity(jobs, opportunities)
    await makeApplication(applications, opportunityId)
    expect(await applications.create({ workspaceId: 'ws-a', opportunityId, actor: ACTOR }))
      .toMatchObject({ ok: false, code: 'deterministic_duplicate' })
  })

  it('edits company and source and transitions status, appending ordered history', async () => {
    const { jobs, opportunities, applications } = await setup()
    const { opportunityId } = await makeOpportunity(jobs, opportunities)
    const application = await makeApplication(applications, opportunityId)
    expect((await applications.editCompany({ workspaceId: 'ws-a', applicationId: application.id, companyName: 'Acme Corp', actor: ACTOR })))
      .toMatchObject({ ok: true, application: { companyName: 'Acme Corp', revision: 2 } })
    expect((await applications.editSource({ workspaceId: 'ws-a', applicationId: application.id, sourceName: 'LinkedIn', actor: ACTOR })))
      .toMatchObject({ ok: true, application: { sourceName: 'LinkedIn', revision: 3 } })
    expect((await applications.transitionStatus({ workspaceId: 'ws-a', applicationId: application.id, status: 'submitted', actor: ACTOR })))
      .toMatchObject({ ok: true, application: { status: 'submitted', revision: 4 } })
    expect((await applications.history('ws-a', application.id)).map((e) => e.kind))
      .toEqual(['created', 'company_edited', 'source_edited', 'status_changed'])
  })

  it('manages links: add, update, single-primary enforcement, and unlink', async () => {
    const { jobs, opportunities, applications } = await setup()
    const { opportunityId } = await makeOpportunity(jobs, opportunities)
    const application = await makeApplication(applications, opportunityId)
    const first = await applications.addLink({ workspaceId: 'ws-a', applicationId: application.id, link: { kind: 'posting', label: 'Job posting', url: 'https://a.example/1', isPrimary: true }, actor: ACTOR })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = await applications.addLink({ workspaceId: 'ws-a', applicationId: application.id, link: { kind: 'ats', label: 'ATS', url: 'https://b.example/2', isPrimary: true }, actor: ACTOR })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    // adding a second primary demotes the first (single-primary rule).
    const links = await applications.listLinks('ws-a', application.id)
    expect(links.filter((l) => l.isPrimary).map((l) => l.id)).toEqual([second.link.id])

    const updated = await applications.updateLink({ workspaceId: 'ws-a', applicationId: application.id, linkId: first.link.id, patch: { label: 'Renamed' }, actor: ACTOR })
    expect(updated).toMatchObject({ ok: true })
    const removed = await applications.removeLink({ workspaceId: 'ws-a', applicationId: application.id, linkId: second.link.id, actor: ACTOR })
    expect(removed).toMatchObject({ ok: true })
    expect((await applications.listLinks('ws-a', application.id)).map((l) => l.id)).toEqual([first.link.id])
    expect((await applications.history('ws-a', application.id)).map((e) => e.kind))
      .toEqual(['created', 'link_created', 'link_created', 'link_updated', 'link_removed'])
  })

  it('holds its snapshot across a later Job revision until an explicit refresh (AC3)', async () => {
    const { jobs, opportunities, applications } = await setup()
    const { jobId, opportunityId } = await makeOpportunity(jobs, opportunities)
    const application = await makeApplication(applications, opportunityId)
    expect(application.jobFactsRevision).toBe(1)
    // a later Job correction must NOT silently rewrite the active application.
    await jobs.correctFacts({ workspaceId: 'ws-a', jobId, facts: { company: 'Acme', title: 'Principal Engineer' }, actor: ACTOR })
    expect((await applications.get('ws-a', application.id))?.jobFactsRevision).toBe(1)
    // explicit refresh re-snapshots at the current Job facts revision.
    const refreshed = await applications.refreshSnapshot({ workspaceId: 'ws-a', applicationId: application.id, actor: ACTOR })
    expect(refreshed).toMatchObject({ ok: true, application: { jobFactsRevision: 2 } })
    if (refreshed.ok) expect(refreshed.application.snapshot).toMatchObject({ job: { facts: { title: 'Principal Engineer' } } })
    expect((await applications.history('ws-a', application.id)).map((e) => e.kind)).toEqual(['created', 'snapshot_refreshed'])
  })

  it('generates attempt and event records readable through the aggregate', async () => {
    const { jobs, opportunities, applications } = await setup()
    const { opportunityId } = await makeOpportunity(jobs, opportunities)
    const application = await makeApplication(applications, opportunityId)
    await applications.recordEvent({ workspaceId: 'ws-a', applicationId: application.id, event: { type: 'note', summary: 'Reached out to recruiter' }, actor: ACTOR })
    await applications.recordAttempt({ workspaceId: 'ws-a', applicationId: application.id, attempt: { state: 'succeeded', startedAt: '2026-07-21T00:00:00.000Z', completedAt: '2026-07-21T00:01:00.000Z', summary: 'submitted' }, actor: ACTOR })
    expect((await applications.listEvents('ws-a', application.id)).map((e) => e.type)).toEqual(['note'])
    expect((await applications.listAttempts('ws-a', application.id)).map((a) => a.state)).toEqual(['succeeded'])
  })

  it('requires an explicit dependent choice to remove an application that has dependents (AC7)', async () => {
    const { jobs, opportunities, applications } = await setup()
    const { opportunityId } = await makeOpportunity(jobs, opportunities)
    const application = await makeApplication(applications, opportunityId)
    await applications.addLink({ workspaceId: 'ws-a', applicationId: application.id, link: { kind: 'posting', label: 'L', url: 'https://a.example/1', isPrimary: false }, actor: ACTOR })
    // omitting the dependent choice with dependents present is a deterministic rejection.
    expect(await applications.remove({ workspaceId: 'ws-a', applicationId: application.id, actor: ACTOR }))
      .toMatchObject({ ok: false, code: 'dependent_choice_required' })
    // preserve keeps the dependents as history; cascade would delete them.
    const removed = await applications.remove({ workspaceId: 'ws-a', applicationId: application.id, actor: ACTOR, dependents: 'preserve' })
    expect(removed.ok && removed.application.removedAt).not.toBeNull()
    expect((await applications.listLinks('ws-a', application.id)).length).toBe(1)
    expect((await applications.list('ws-a')).length).toBe(0)
  })

  it('cascades dependents on removal when the caller chooses cascade, leaving no orphaned children', async () => {
    const { database, jobs, opportunities, applications } = await setup()
    const { opportunityId } = await makeOpportunity(jobs, opportunities)
    const application = await makeApplication(applications, opportunityId)
    await applications.addLink({ workspaceId: 'ws-a', applicationId: application.id, link: { kind: 'posting', label: 'L', url: 'https://a.example/1', isPrimary: false }, actor: ACTOR })
    await applications.recordEvent({ workspaceId: 'ws-a', applicationId: application.id, event: { type: 'note', summary: 'x' }, actor: ACTOR })
    const removed = await applications.remove({ workspaceId: 'ws-a', applicationId: application.id, actor: ACTOR, dependents: 'cascade' })
    expect(removed).toMatchObject({ ok: true })
    expect((await applications.listLinks('ws-a', application.id)).length).toBe(0)
    expect((await applications.listEvents('ws-a', application.id)).length).toBe(0)
    void database
  })

  it('reclaims the (workspace, Opportunity) key after removal and rejects a duplicate restore', async () => {
    const { jobs, opportunities, applications } = await setup()
    const { opportunityId } = await makeOpportunity(jobs, opportunities)
    const first = await makeApplication(applications, opportunityId)
    await applications.remove({ workspaceId: 'ws-a', applicationId: first.id, actor: ACTOR, dependents: 'preserve' })
    const second = await makeApplication(applications, opportunityId)
    expect(second.id).not.toBe(first.id)
    expect(await applications.restore({ workspaceId: 'ws-a', applicationId: first.id, actor: ACTOR }))
      .toMatchObject({ ok: false, code: 'deterministic_duplicate' })
  })

  it('rejects a stale expected revision and serializes concurrent mutations', async () => {
    const { jobs, opportunities, applications } = await setup()
    const { opportunityId } = await makeOpportunity(jobs, opportunities)
    const application = await makeApplication(applications, opportunityId)
    expect(await applications.transitionStatus({ workspaceId: 'ws-a', applicationId: application.id, status: 'submitted', actor: ACTOR, expectedRevision: 99 }))
      .toMatchObject({ ok: false, code: 'revision_conflict' })
    const [a, b] = await Promise.all([
      applications.editCompany({ workspaceId: 'ws-a', applicationId: application.id, companyName: 'One', actor: ACTOR, expectedRevision: 1 }),
      applications.editSource({ workspaceId: 'ws-a', applicationId: application.id, sourceName: 'Two', actor: ACTOR, expectedRevision: 1 }),
    ])
    expect([a, b].filter((r) => r.ok).length).toBe(1)
    expect([a, b].filter((r) => !r.ok && r.code === 'revision_conflict').length).toBe(1)
  })

  it('isolates applications across workspaces', async () => {
    const { database, jobs, opportunities, applications } = await setup()
    const { opportunityId } = await makeOpportunity(jobs, opportunities, 'ws-a')
    const application = await makeApplication(applications, opportunityId)
    expect(await applications.get('ws-b', application.id)).toBeNull()
    expect((await applications.list('ws-b')).length).toBe(0)
    expect(await applications.transitionStatus({ workspaceId: 'ws-b', applicationId: application.id, status: 'submitted', actor: ACTOR }))
      .toMatchObject({ ok: false, code: 'not_found' })
    const [row] = await database.select().from(applicationRows).where(and(eq(applicationRows.workspaceId, 'ws-a'), eq(applicationRows.id, application.id)))
    expect(row?.jobId).toBeTruthy()
  })
})
