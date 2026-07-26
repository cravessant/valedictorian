/**
 * Job read-model proofs (issue #304, stage 3) on a migrated PGlite owner.
 *
 * Drives the REAL Job service to write canonical `jobs` / `job_history`
 * rows (create, correctFacts, updateAvailability, remove, restore), and seeds the
 * founding capture lineage the strict `jobSchema` requires (a real capture +
 * one `job_capture_evidence_references` row) plus one strong external identity as
 * canonical rows — the promotion (#300) owns writing those, and its provisional
 * initial facts are out of scope here. Reads everything back through the
 * read-model, proving the flattened schema-valid `Job` resource, the
 * `JobListResult` page (isolation, availability filter, includeRemoved gating,
 * keyset pagination walking every row once), and the reconstructed history.
 */
import { describe, expect, it } from 'vitest'
import { jobHistoryResultSchema, jobListResultSchema, jobSchema } from '@sparxie/sdk'
import { useResettablePgliteTestOwner } from '../../test/pglite-test-owner'
import { workspaces } from '../../db/workspaces.schema'
import { createPgliteCaptureService, type CaptureService } from '../capture/capture.service'
import type { JobService } from './job.service'
import { createCoveredPgliteJobService } from '../../test/covered-job-service'
import { jobCaptureEvidenceReferences, jobExternalIdentities } from './job.schema'
import { createPgliteJobReadModel } from './job.read-model'

const resettableOwner = useResettablePgliteTestOwner()

function monotonicClock(startMs = Date.UTC(2026, 6, 20, 0, 0, 0)) {
  let tick = 0
  return () => new Date(startMs + tick++ * 1000)
}

const ACTOR = { type: 'user', id: 'u' } as const

const VALID_FACTS = {
  companyName: 'Acme',
  roleTitle: 'Staff Engineer',
  sourceName: 'LinkedIn',
  roleKind: 'experienced' as const,
  term: null,
  terms: [],
  timingMode: 'unknown' as const,
  startDate: null,
  endDate: null,
  location: null,
  workMode: 'remote' as const,
  employmentType: 'full_time' as const,
  seniority: 'senior' as const,
  compensation: null,
  postedAt: null,
  destination: null,
}

async function setup(workspaceIds: readonly string[] = ['ws-a', 'ws-b']) {
  const { database } = resettableOwner()
  for (const id of workspaceIds) {
    await database
      .insert(workspaces)
      .values({ id, name: id, createdAt: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z' })
  }
  const clock = monotonicClock()
  const captures = createPgliteCaptureService(database, { now: clock })
  const jobs = createCoveredPgliteJobService(database, { now: clock })
  const readModel = createPgliteJobReadModel(database)
  return { database, captures, jobs, readModel }
}

type Database = Awaited<ReturnType<typeof setup>>['database']

let seedCounter = 0

/**
 * Create a Job via the real service with contract-valid facts, then seed its
 * founding capture lineage (a real capture revision + one evidence reference) and
 * one strong external identity as canonical rows (the promotion writes these in
 * production; here they are seeded so the read-back conforms to the strict schema).
 */
async function mintJob(
  database: Database,
  captures: CaptureService,
  jobs: JobService,
  overrides: { workspaceId?: string; providerRecordId?: string } = {},
): Promise<string> {
  const workspaceId = overrides.workspaceId ?? 'ws-a'
  const suffix = seedCounter++
  const accepted = await captures.accept({
    workspaceId,
    provenance: {
      adapterId: 'jobright.resolver',
      adapterKind: 'connector',
      adapterVersion: '1.0.0',
      providerRecordId: overrides.providerRecordId ?? `rec-${suffix}`,
      providerSchema: 'jobright.v1',
      observedAt: '2026-07-19T10:00:00.000Z',
    },
    evidenceMode: 'ats_details_provided',
    evidence: [{ kind: 'title', label: 'Title', value: 'Engineer' }],
    actor: ACTOR,
  })
  if (!accepted.ok) throw new Error(`accept failed: ${accepted.code}`)

  const created = await jobs.create({ workspaceId, facts: VALID_FACTS, actor: ACTOR })
  if (!created.ok) throw new Error(`create failed: ${created.code}`)
  const jobId = created.job.id

  await database.insert(jobCaptureEvidenceReferences).values({
    id: `ref-${suffix}`,
    jobId,
    captureId: accepted.capture.id,
    captureRevision: 1,
    evidenceIndexesJson: '[0]',
    createdAt: created.job.createdAt,
  })
  await database.insert(jobExternalIdentities).values({
    id: `ident-${suffix}`,
    jobId,
    kind: 'ats_job',
    provider: 'greenhouse',
    account: 'acme',
    value: `req-${suffix}`,
    strength: 'strong',
    provenanceKind: 'ats_job',
    provenanceVersion: '1.0.0',
    evidenceJson: '{"via":"promotion"}',
    removedAt: null,
    createdAt: created.job.createdAt,
  })
  return jobId
}

/** Address one direction of the canonical page contract without widening the union. */
const afterPage = (after: string | undefined) => (after === undefined ? {} : { after })
const beforePage = (before: string | undefined) => (before === undefined ? {} : { before })

describe.sequential('Job read-model (#304)', () => {
  it('reads a created job back as a flattened, schema-valid resource with lineage + identity', async () => {
    const { database, captures, jobs, readModel } = await setup()
    const jobId = await mintJob(database, captures, jobs)

    const dto = await readModel.getJob('ws-a', jobId)
    expect(dto).not.toBeNull()
    expect(() => jobSchema.parse(dto)).not.toThrow()
    expect(dto).toMatchObject({ id: jobId, workspaceId: 'ws-a', factsRevision: 1 })
    expect(dto?.facts).toMatchObject({ companyName: 'Acme', roleTitle: 'Staff Engineer' })
    expect(dto?.externalIdentities).toEqual([
      { kind: 'ats_job', provider: 'greenhouse', account: 'acme', value: expect.stringMatching(/^req-/), strength: 'strong' },
    ])
    expect(dto?.captureEvidenceReferences.length).toBeGreaterThanOrEqual(1)
  })

  it('reflects availability changes and tombstone state, never resolving across workspaces', async () => {
    const { database, captures, jobs, readModel } = await setup()
    const jobId = await mintJob(database, captures, jobs)

    await jobs.updateAvailability({ workspaceId: 'ws-a', jobId, state: 'closed', observedAt: '2026-07-20T01:00:00.000Z', actor: ACTOR })
    const updated = await readModel.getJob('ws-a', jobId)
    expect(updated?.availability).toEqual({ state: 'closed', observedAt: '2026-07-20T01:00:00.000Z' })

    await jobs.remove({ workspaceId: 'ws-a', jobId, actor: ACTOR })
    const removed = await readModel.getJob('ws-a', jobId)
    expect(removed?.removedAt).not.toBeNull()
    // Cross-workspace isolation: the same id under another workspace is absent.
    expect(await readModel.getJob('ws-b', jobId)).toBeNull()
  })

  it('lists jobs with the availability filter and includeRemoved gating', async () => {
    const { database, captures, jobs, readModel } = await setup()
    const openJob = await mintJob(database, captures, jobs, { providerRecordId: 'rec-open' })
    const closedJob = await mintJob(database, captures, jobs, { providerRecordId: 'rec-closed' })
    const removedJob = await mintJob(database, captures, jobs, { providerRecordId: 'rec-removed' })
    await jobs.updateAvailability({ workspaceId: 'ws-a', jobId: closedJob, state: 'closed', observedAt: '2026-07-20T01:00:00.000Z', actor: ACTOR })
    await jobs.remove({ workspaceId: 'ws-a', jobId: removedJob, actor: ACTOR })

    const active = await readModel.listJobs('ws-a')
    expect(() => jobListResultSchema.parse(active)).not.toThrow()
    expect(active.items.map((item) => item.id).sort()).toEqual([openJob, closedJob].sort())
    expect(active.items.some((item) => item.id === removedJob)).toBe(false)

    const closedOnly = await readModel.listJobs('ws-a', { availability: 'closed' })
    expect(closedOnly.items.map((item) => item.id)).toEqual([closedJob])

    const withRemoved = await readModel.listJobs('ws-a', { includeRemoved: true })
    expect(withRemoved.items.some((item) => item.id === removedJob)).toBe(true)
  })

  it('reconstructs the create->correct->availability->remove->restore history as schema-valid snapshots', async () => {
    const { database, captures, jobs, readModel } = await setup()
    const jobId = await mintJob(database, captures, jobs)
    await jobs.correctFacts({ workspaceId: 'ws-a', jobId, facts: { ...VALID_FACTS, roleTitle: 'Principal Engineer' }, actor: ACTOR })
    await jobs.updateAvailability({ workspaceId: 'ws-a', jobId, state: 'closed', observedAt: '2026-07-20T02:00:00.000Z', actor: ACTOR })
    await jobs.remove({ workspaceId: 'ws-a', jobId, actor: ACTOR })
    await jobs.restore({ workspaceId: 'ws-a', jobId, actor: ACTOR })

    const history = await readModel.historyJobs('ws-a', { id: jobId })
    expect(() => jobHistoryResultSchema.parse(history)).not.toThrow()
    expect(history.items.map((item) => item.kind)).toEqual([
      'created', 'facts_corrected', 'availability_changed', 'removed', 'restored',
    ])
    expect(history.items.find((item) => item.kind === 'facts_corrected')?.snapshot.facts.roleTitle).toBe('Principal Engineer')
    const removedItem = history.items.find((item) => item.kind === 'removed')
    const restoredItem = history.items.find((item) => item.kind === 'restored')
    expect(removedItem?.snapshot.removedAt).not.toBeNull()
    expect(restoredItem?.snapshot.removedAt).toBeNull()
    // Every snapshot carries the founding lineage the strict schema requires.
    for (const item of history.items) {
      expect(item.snapshot.id).toBe(jobId)
      expect(item.snapshot.captureEvidenceReferences.length).toBeGreaterThanOrEqual(1)
    }

    // Missing job yields an empty page, never a throw.
    const empty = await readModel.historyJobs('ws-a', { id: '01890000-0000-7000-8000-0000000000ff' })
    expect(empty.items).toEqual([])
  })

  it('paginates the full active set exactly once via the keyset cursor', async () => {
    const { database, captures, jobs, readModel } = await setup()
    const ids: string[] = []
    for (let index = 0; index < 5; index += 1) {
      ids.push(await mintJob(database, captures, jobs, { providerRecordId: `rec-${index}` }))
    }

    const seen: string[] = []
    const back: string[] = []
    let after: string | undefined
    let before: string | undefined
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await readModel.listJobs('ws-a', { limit: 2, ...afterPage(after) })
      seen.push(...page.items.map((item) => item.id))
      if (!page.pageInfo.hasNextPage) {
        back.push(...page.items.map((item) => item.id))
        before = page.pageInfo.hasPreviousPage ? page.pageInfo.startCursor ?? undefined : undefined
        break
      }
      after = page.pageInfo.endCursor ?? undefined
    }

    // Walking back from the final page rebuilds the same sequence in the same order.
    for (let guard = 0; guard < 10 && before !== undefined; guard += 1) {
      const page = await readModel.listJobs('ws-a', { limit: 2, ...beforePage(before) })
      back.unshift(...page.items.map((item) => item.id))
      before = page.pageInfo.hasPreviousPage ? page.pageInfo.startCursor ?? undefined : undefined
    }
    expect(back).toEqual(seen)
    expect(seen.sort()).toEqual([...ids].sort())
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('reports adjacency for the surviving rows after the followed cursor is orphaned', async () => {
    const { database, captures, jobs, readModel } = await setup()
    const ids: string[] = []
    for (let index = 0; index < 4; index += 1) {
      ids.push(await mintJob(database, captures, jobs, { providerRecordId: `stale-${index}` }))
    }

    const first = await readModel.listJobs('ws-a', { limit: 2 })
    expect(first.items.map((item) => item.id)).toEqual(ids.slice(0, 2))
    const second = await readModel.listJobs('ws-a', {
      limit: 2, ...afterPage(first.pageInfo.endCursor ?? undefined),
    })
    expect(second.items.map((item) => item.id)).toEqual(ids.slice(2))
    expect(second.pageInfo).toMatchObject({ hasPreviousPage: true, hasNextPage: false })

    // Everything the cursor was anchored on is removed while the page is held.
    for (const removed of ids.slice(0, 2)) {
      await jobs.remove({ workspaceId: 'ws-a', jobId: removed, actor: ACTOR })
    }

    const refreshed = await readModel.listJobs('ws-a', {
      limit: 2, ...afterPage(first.pageInfo.endCursor ?? undefined),
    })
    expect(refreshed.items.map((item) => item.id)).toEqual(ids.slice(2))
    expect(refreshed.pageInfo).toMatchObject({ hasPreviousPage: false, hasNextPage: false })

    // The stale cursor still resolves, and Previous is no longer offered from it.
    const backwards = await readModel.listJobs('ws-a', {
      limit: 2, ...beforePage(first.pageInfo.endCursor ?? undefined),
    })
    expect(backwards.items).toEqual([])
    expect(backwards.pageInfo).toMatchObject({ hasPreviousPage: false, hasNextPage: true })
  })

  it('keeps a page emptied by removals addressable back toward surviving rows', async () => {
    const { database, captures, jobs, readModel } = await setup()
    const ids: string[] = []
    for (let index = 0; index < 4; index += 1) {
      ids.push(await mintJob(database, captures, jobs, { providerRecordId: `emptied-${index}` }))
    }

    const first = await readModel.listJobs('ws-a', { limit: 2 })
    const boundary = first.pageInfo.endCursor ?? undefined

    // The whole tail the boundary pointed forward at is removed.
    for (const removed of ids.slice(2)) {
      await jobs.remove({ workspaceId: 'ws-a', jobId: removed, actor: ACTOR })
    }

    const emptied = await readModel.listJobs('ws-a', { limit: 2, ...afterPage(boundary) })
    expect(emptied.items).toEqual([])
    expect(emptied.pageInfo).toEqual({
      startCursor: null,
      endCursor: null,
      hasPreviousPage: true,
      hasNextPage: false,
    })

    // Re-addressing the same boundary backwards reaches rows that still exist.
    const recovered = await readModel.listJobs('ws-a', { limit: 2, ...beforePage(boundary) })
    expect(recovered.items.map((item) => item.id)).toEqual([ids[0]])
    expect(recovered.pageInfo).toMatchObject({ hasPreviousPage: false, hasNextPage: true })
  })

  it('drops the stale Next a backward request used to assert', async () => {
    const { database, captures, jobs, readModel } = await setup()
    const ids: string[] = []
    for (let index = 0; index < 4; index += 1) {
      ids.push(await mintJob(database, captures, jobs, { providerRecordId: `tail-${index}` }))
    }

    const second = await readModel.listJobs('ws-a', {
      limit: 2, ...afterPage((await readModel.listJobs('ws-a', { limit: 2 })).pageInfo.endCursor ?? undefined),
    })
    expect(second.items.map((item) => item.id)).toEqual(ids.slice(2))
    const boundary = second.pageInfo.startCursor ?? undefined

    // Everything ahead of the backward page is removed while it is held.
    for (const removed of ids.slice(2)) {
      await jobs.remove({ workspaceId: 'ws-a', jobId: removed, actor: ACTOR })
    }

    const backwards = await readModel.listJobs('ws-a', { limit: 2, ...beforePage(boundary) })
    expect(backwards.items.map((item) => item.id)).toEqual(ids.slice(0, 2))
    expect(backwards.pageInfo).toMatchObject({ hasPreviousPage: false, hasNextPage: false })
  })
})
