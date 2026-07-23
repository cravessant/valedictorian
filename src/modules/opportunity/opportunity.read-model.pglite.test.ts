/**
 * Opportunity read-model proofs (issue #304, stage 3) on a migrated PGlite owner.
 *
 * Drives the REAL Job + Opportunity services to write canonical rows, then reads
 * them back through the read-model. Proves the flattened schema-valid `Opportunity`
 * resource (evaluation, disposition, head override, tombstone), the
 * `OpportunityListResult` page (workspace isolation, jobId/fit/disposition filters,
 * includeRemoved gating, keyset pagination walking every row once), and the
 * reconstructed create/evaluation/disposition/remove/restore history.
 */
import { describe, expect, it } from 'vitest'
import { opportunityHistoryResultSchema, opportunityListResultSchema, opportunitySchema } from 'sparxie'
import { useResettablePgliteTestOwner } from '../../test/pglite-test-owner'
import { workspaces } from '../../db/workspaces.schema'
import type { JobService } from '../job/job.service'
import { createCoveredPgliteJobService } from '../../test/covered-job-service'
import { createPgliteOpportunityService, type OpportunityService } from './opportunity.service'
import { createPgliteOpportunityReadModel } from './opportunity.read-model'

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
  const jobs = createCoveredPgliteJobService(database, { now: clock })
  const opportunities = createPgliteOpportunityService(database, { now: clock })
  const readModel = createPgliteOpportunityReadModel(database)
  return { database, jobs, opportunities, readModel }
}

async function makeJob(jobs: JobService, workspaceId = 'ws-a') {
  const result = await jobs.create({ workspaceId, facts: { title: 'Staff Engineer' }, actor: ACTOR })
  if (!result.ok) throw new Error(`job create failed: ${result.code}`)
  return result.job.id
}

async function makeOpportunity(opportunities: OpportunityService, jobId: string, workspaceId = 'ws-a') {
  const result = await opportunities.create({ workspaceId, jobId, actor: ACTOR })
  if (!result.ok) throw new Error(`opportunity create failed: ${result.code} ${result.message}`)
  return result.opportunity.id
}

describe.sequential('Opportunity read-model (#304)', () => {
  it('reads a created opportunity back as a flattened, schema-valid resource', async () => {
    const { jobs, opportunities, readModel } = await setup()
    const opportunityId = await makeOpportunity(opportunities, await makeJob(jobs))

    const dto = await readModel.getOpportunity('ws-a', opportunityId)
    expect(dto).not.toBeNull()
    expect(() => opportunitySchema.parse(dto)).not.toThrow()
    expect(dto).toMatchObject({ id: opportunityId, workspaceId: 'ws-a', fit: 'unknown', cutoff: 'not_evaluated', disposition: 'reviewing', revision: 1 })
    expect(dto?.override).toBeNull()
  })

  it('reflects an evaluation change with a head override, then the tombstone; never resolves across workspaces', async () => {
    const { jobs, opportunities, readModel } = await setup()
    const opportunityId = await makeOpportunity(opportunities, await makeJob(jobs))

    await opportunities.correct({
      workspaceId: 'ws-a',
      opportunityId,
      fit: 'fit',
      cutoff: 'above',
      rank: 2,
      actor: ACTOR,
      override: { actor: ACTOR, rationale: 'accepted the cutoff warning', warningCodes: ['cutoff'] },
    })
    const evaluated = await readModel.getOpportunity('ws-a', opportunityId)
    expect(evaluated).toMatchObject({ fit: 'fit', cutoff: 'above', rank: 2 })
    expect(evaluated?.override).toMatchObject({ rationale: 'accepted the cutoff warning', warningCodes: ['cutoff'] })

    await opportunities.remove({ workspaceId: 'ws-a', opportunityId, actor: ACTOR })
    expect((await readModel.getOpportunity('ws-a', opportunityId))?.removedAt).not.toBeNull()
    expect(await readModel.getOpportunity('ws-b', opportunityId)).toBeNull()
  })

  it('lists opportunities with jobId/fit/disposition filters and includeRemoved gating', async () => {
    const { jobs, opportunities, readModel } = await setup()
    const jobA = await makeJob(jobs)
    const jobB = await makeJob(jobs)
    const jobC = await makeJob(jobs)
    const oppA = await makeOpportunity(opportunities, jobA)
    const oppB = await makeOpportunity(opportunities, jobB)
    const oppC = await makeOpportunity(opportunities, jobC)
    await opportunities.correct({ workspaceId: 'ws-a', opportunityId: oppB, fit: 'fit', actor: ACTOR })
    await opportunities.setDisposition({ workspaceId: 'ws-a', opportunityId: oppA, disposition: 'pursue', rationale: 'go', actor: ACTOR })
    await opportunities.remove({ workspaceId: 'ws-a', opportunityId: oppC, actor: ACTOR })

    const active = await readModel.listOpportunities('ws-a')
    expect(() => opportunityListResultSchema.parse(active)).not.toThrow()
    expect(active.items.map((item) => item.id).sort()).toEqual([oppA, oppB].sort())

    expect((await readModel.listOpportunities('ws-a', { jobId: jobA })).items.map((item) => item.id)).toEqual([oppA])
    expect((await readModel.listOpportunities('ws-a', { fit: 'fit' })).items.map((item) => item.id)).toEqual([oppB])
    expect((await readModel.listOpportunities('ws-a', { disposition: 'pursue' })).items.map((item) => item.id)).toEqual([oppA])
    expect((await readModel.listOpportunities('ws-a', { includeRemoved: true })).items.some((item) => item.id === oppC)).toBe(true)
  })

  it('reconstructs the create->evaluate->disposition->remove->restore history as schema-valid snapshots', async () => {
    const { jobs, opportunities, readModel } = await setup()
    const opportunityId = await makeOpportunity(opportunities, await makeJob(jobs))
    await opportunities.correct({ workspaceId: 'ws-a', opportunityId, fit: 'fit', cutoff: 'above', rank: 1, actor: ACTOR })
    await opportunities.setDisposition({ workspaceId: 'ws-a', opportunityId, disposition: 'pursue', rationale: 'go', actor: ACTOR })
    await opportunities.remove({ workspaceId: 'ws-a', opportunityId, actor: ACTOR })
    await opportunities.restore({ workspaceId: 'ws-a', opportunityId, actor: ACTOR })

    const history = await readModel.historyOpportunities('ws-a', { id: opportunityId })
    expect(() => opportunityHistoryResultSchema.parse(history)).not.toThrow()
    expect(history.items.map((item) => item.kind)).toEqual([
      'created', 'evaluation_changed', 'disposition_changed', 'removed', 'restored',
    ])
    expect(history.items[1]!.snapshot).toMatchObject({ fit: 'fit', cutoff: 'above', rank: 1 })
    expect(history.items[2]!.snapshot.disposition).toBe('pursue')
    expect(history.items[3]!.snapshot.removedAt).not.toBeNull()
    expect(history.items[4]!.snapshot.removedAt).toBeNull()
    for (const item of history.items) expect(item.snapshot.id).toBe(opportunityId)

    // Missing opportunity yields an empty page, never a throw.
    expect((await readModel.historyOpportunities('ws-a', { id: '01890000-0000-7000-8000-0000000000ff' })).items).toEqual([])
  })

  it('paginates the full active set exactly once via the keyset cursor', async () => {
    const { jobs, opportunities, readModel } = await setup()
    const ids: string[] = []
    for (let index = 0; index < 5; index += 1) {
      ids.push(await makeOpportunity(opportunities, await makeJob(jobs)))
    }

    const seen: string[] = []
    let cursor: string | undefined
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await readModel.listOpportunities('ws-a', { limit: 2, cursor })
      seen.push(...page.items.map((item) => item.id))
      if (!page.nextCursor) break
      cursor = page.nextCursor
    }
    expect(seen.sort()).toEqual([...ids].sort())
    expect(new Set(seen).size).toBe(seen.length)
  })
})
