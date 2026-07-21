/**
 * Job create-dedup (#304, stage 2) — red-first proof through the public `create`
 * command that a caller-supplied idempotencyKey converges a repeated create onto the
 * already-created Job (created:false) and is scoped to the workspace, while keyless
 * creates never dedup. Runs on a migrated PGlite owner.
 */
import { describe, expect, it } from 'vitest'
import { useResettablePgliteTestOwner } from '../../test/pglite-test-owner'
import { workspaces } from '../../db/workspaces.schema'
import { createPgliteJobService, type CreateJobInput } from './job.service'

const resettableOwner = useResettablePgliteTestOwner()

function monotonicClock(startMs = Date.UTC(2026, 6, 20, 0, 0, 0)) {
  let tick = 0
  return () => new Date(startMs + tick++ * 1000)
}

async function setup(workspaceIds: readonly string[] = ['ws-a', 'ws-b']) {
  const { database } = resettableOwner()
  for (const id of workspaceIds) {
    await database.insert(workspaces).values({ id, name: id, createdAt: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z' })
  }
  return createPgliteJobService(database, { now: monotonicClock() })
}

function input(overrides: Partial<CreateJobInput> = {}): CreateJobInput {
  return { workspaceId: 'ws-a', facts: { title: 'Staff Engineer', company: 'Acme' }, actor: { type: 'user', id: 'user-1' }, ...overrides }
}

describe.sequential('Job create-dedup by idempotencyKey', () => {
  it('mints once and converges a repeated keyed create onto the same Job', async () => {
    const service = await setup()
    const first = await service.create(input({ idempotencyKey: 'k1' }))
    const second = await service.create(input({ idempotencyKey: 'k1', facts: { title: 'Different', company: 'Acme' } }))
    expect(first.ok && first.created).toBe(true)
    expect(second.ok && second.created).toBe(false)
    if (!first.ok || !second.ok) throw new Error('expected ok')
    expect(second.job.id).toBe(first.job.id)
    // The winning row's facts are the first create's — the repeat does not overwrite.
    expect(second.job.facts).toEqual(first.job.facts)
  })

  it('scopes the key to the workspace', async () => {
    const service = await setup()
    const a = await service.create(input({ workspaceId: 'ws-a', idempotencyKey: 'shared' }))
    const b = await service.create(input({ workspaceId: 'ws-b', idempotencyKey: 'shared' }))
    if (!a.ok || !b.ok) throw new Error('expected ok')
    expect(b.job.id).not.toBe(a.job.id)
  })

  it('never dedups keyless creates', async () => {
    const service = await setup()
    const a = await service.create(input())
    const b = await service.create(input())
    if (!a.ok || !b.ok) throw new Error('expected ok')
    expect(a.created).toBe(true)
    expect(b.created).toBe(true)
    expect(b.job.id).not.toBe(a.job.id)
  })

  it('converges concurrent keyed creates onto one Job', async () => {
    const service = await setup()
    const [a, b] = await Promise.all([
      service.create(input({ idempotencyKey: 'race' })),
      service.create(input({ idempotencyKey: 'race' })),
    ])
    if (!a.ok || !b.ok) throw new Error('expected ok')
    expect(a.job.id).toBe(b.job.id)
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1)
  })
})
