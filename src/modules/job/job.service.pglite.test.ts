/**
 * Job module contract — red-first proofs through the PUBLIC commands/queries
 * (issue #300, slice 1). Exercises canonical `jobs` + append-only
 * `job_history` on a migrated PGlite owner: UUIDv7 identities, versioned facts and
 * availability, remove/restore tombstones, history, cross-workspace isolation,
 * concurrency, and input validation.
 */
import { describe, expect, it } from 'vitest'
import { useResettablePgliteTestOwner } from '../../test/pglite-test-owner'
import { workspaces } from '@sparxie/valedictorian-local-runtime/testing/db/workspaces.schema'
import { UUID_V7_PATTERN } from '@sparxie/valedictorian-local-runtime/testing/db/lifecycle-vocabulary'
import type { CreateJobInput, JobService } from '@sparxie/valedictorian-local-runtime/testing/modules/job/job.service'
import { createPgliteJobServiceWithCompanies } from '../../test/job-service-with-companies'

const resettableOwner = useResettablePgliteTestOwner()
const uuidV7Regex = new RegExp(UUID_V7_PATTERN, 'i')

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
  return createPgliteJobServiceWithCompanies(database, { now: monotonicClock() })
}

function createInput(overrides: Partial<CreateJobInput> = {}): CreateJobInput {
  return {
    workspaceId: 'ws-a',
    facts: { title: 'Staff Engineer', company: 'Acme' },
    actor: { type: 'user', id: 'user-1' },
    ...overrides,
  }
}

async function create(service: JobService, overrides: Partial<CreateJobInput> = {}) {
  const result = await service.create(createInput(overrides))
  if (!result.ok) throw new Error(`create failed: ${result.code} ${result.message}`)
  return result.job
}

describe.sequential('Job module contract (#300)', () => {
  it('creates a durable job with a UUIDv7 id, versioned facts + availability, and created history', async () => {
    const service = await setup()
    const job = await create(service)

    expect(job.id).toMatch(uuidV7Regex)
    expect(job.facts).toEqual({ title: 'Staff Engineer', company: 'Acme' })
    expect(job.factsRevision).toBe(1)
    expect(job.availability).toMatchObject({ state: 'unknown', revision: 1 })
    expect(job.removedAt).toBeNull()

    expect((await service.get('ws-a', job.id))?.id).toBe(job.id)
    expect((await service.history('ws-a', job.id)).map((entry) => entry.kind)).toEqual(['created'])
  })

  it('versions facts on correction and availability on update, appending ordered history', async () => {
    const service = await setup()
    const job = await create(service)

    const corrected = await service.correctFacts({
      workspaceId: 'ws-a', jobId: job.id, facts: { title: 'Staff Software Engineer' }, actor: { type: 'user', id: 'u' },
    })
    expect(corrected.ok && corrected.job.factsRevision).toBe(2)

    const availability = await service.updateAvailability({
      workspaceId: 'ws-a', jobId: job.id, state: 'closed', observedAt: '2026-07-21T00:00:00.000Z', actor: { type: 'user', id: 'u' },
    })
    expect(availability.ok && availability.job.availability).toMatchObject({ state: 'closed', revision: 2 })

    const refreshed = await service.get('ws-a', job.id)
    expect(refreshed?.facts).toEqual({ title: 'Staff Software Engineer' })
    expect((await service.history('ws-a', job.id)).map((entry) => entry.kind))
      .toEqual(['created', 'facts_corrected', 'availability_changed'])
  })

  it('rejects a stale expected revision on facts and availability', async () => {
    const service = await setup()
    const job = await create(service)
    expect(await service.correctFacts({ workspaceId: 'ws-a', jobId: job.id, facts: {}, actor: { type: 'user', id: 'u' }, expectedFactsRevision: 99 }))
      .toMatchObject({ ok: false, code: 'revision_conflict' })
    expect(await service.updateAvailability({ workspaceId: 'ws-a', jobId: job.id, state: 'open', observedAt: '2026-07-21T00:00:00.000Z', actor: { type: 'user', id: 'u' }, expectedAvailabilityRevision: 99 }))
      .toMatchObject({ ok: false, code: 'revision_conflict' })
  })

  it('tombstones on removal and restores, both idempotent, with history', async () => {
    const service = await setup()
    const job = await create(service)
    const actor = { type: 'user', id: 'u' } as const

    const removed = await service.remove({ workspaceId: 'ws-a', jobId: job.id, actor })
    expect(removed.ok && removed.job.removedAt).not.toBeNull()
    expect(await service.remove({ workspaceId: 'ws-a', jobId: job.id, actor })).toMatchObject({ ok: true }) // idempotent

    const restored = await service.restore({ workspaceId: 'ws-a', jobId: job.id, actor })
    expect(restored.ok && restored.job.removedAt).toBeNull()
    expect(await service.restore({ workspaceId: 'ws-a', jobId: job.id, actor })).toMatchObject({ ok: true }) // idempotent

    expect((await service.history('ws-a', job.id)).map((entry) => entry.kind)).toEqual(['created', 'removed', 'restored'])
  })

  it('lists workspace jobs and excludes removed unless requested', async () => {
    const service = await setup()
    const a = await create(service)
    const b = await create(service)
    await service.remove({ workspaceId: 'ws-a', jobId: b.id, actor: { type: 'user', id: 'u' } })

    const active = await service.list('ws-a')
    expect(active.map((job) => job.id).sort()).toEqual([a.id].sort())
    const all = await service.list('ws-a', { includeRemoved: true })
    expect(all).toHaveLength(2)
  })

  it('isolates jobs across workspaces for every command and query', async () => {
    const service = await setup()
    const job = await create(service, { workspaceId: 'ws-a' })
    const actor = { type: 'user', id: 'u' } as const

    expect(await service.get('ws-b', job.id)).toBeNull()
    expect(await service.history('ws-b', job.id)).toEqual([])
    expect(await service.list('ws-b')).toEqual([])
    expect(await service.correctFacts({ workspaceId: 'ws-b', jobId: job.id, facts: {}, actor })).toMatchObject({ ok: false, code: 'not_found' })
    expect(await service.remove({ workspaceId: 'ws-b', jobId: job.id, actor })).toMatchObject({ ok: false, code: 'not_found' })
    expect(await service.updateAvailability({ workspaceId: 'ws-b', jobId: job.id, state: 'open', observedAt: '2026-07-21T00:00:00.000Z', actor })).toMatchObject({ ok: false, code: 'not_found' })
  })

  it('surfaces a revision conflict when two facts corrections race', async () => {
    const service = await setup()
    const job = await create(service)
    const actor = { type: 'user', id: 'u' } as const
    const [a, b] = await Promise.all([
      service.correctFacts({ workspaceId: 'ws-a', jobId: job.id, facts: { a: 1 }, actor, expectedFactsRevision: 1 }),
      service.correctFacts({ workspaceId: 'ws-a', jobId: job.id, facts: { b: 2 }, actor, expectedFactsRevision: 1 }),
    ])
    expect([a, b].filter((r) => r.ok)).toHaveLength(1)
    expect([a, b].filter((r) => !r.ok && r.code === 'revision_conflict')).toHaveLength(1)
  })

  it('rejects invalid input, oversized facts, forbidden keys, and crafted actor ids', async () => {
    const service = await setup()

    expect(await service.create(createInput({ facts: { blob: 'x'.repeat(300_000) } })))
      .toMatchObject({ ok: false, code: 'bounded_data_violation' })
    expect(await service.create(createInput({ facts: { authorization: 'Bearer abc' } })))
      .toMatchObject({ ok: false, code: 'security_violation' })
    expect(await service.create(createInput({ availability: { state: 'nope' as never, observedAt: '2026-07-20T00:00:00.000Z' } })))
      .toMatchObject({ ok: false, code: 'invalid_input' })

    const job = await create(service)
    expect(await service.correctFacts({ workspaceId: 'ws-a', jobId: job.id, facts: {}, actor: { type: 'user', id: 'x","password":"leaked' } }))
      .toMatchObject({ ok: false, code: 'security_violation' })
  })
})
