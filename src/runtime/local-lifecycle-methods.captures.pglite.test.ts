/**
 * In-process lifecycle facade — CAPTURE vertical, red-first pglite proofs (#304, task 4).
 *
 * The covered local lifecycle facade is the in-process
 * transport that both the HTTP routes and the rewired local client compose. It mirrors
 * sparxie's `createLifecycleHttpMethods`: contract inputs in (validated by the sparxie input
 * schema), contract results out (mapped by the Stage-3 DTOs), `get` returns null on miss, and
 * existence/concurrency failures raise a `LifecycleHttpError` (404/409) exactly as the typed
 * HTTP client raises `ValedictorianHttpError`. Reads compose the read-model; writes compose the
 * Stage-2 service; remove/restore compose the removal orchestration; timestamps re-read the head.
 *
 * This covers ONLY the capture aggregate's create/read/list/correct/remove/restore/history seam.
 * promoteToJob lands with the job vertical (it needs the extended capture→job promotion).
 */
import { describe, expect, it } from 'vitest'
import { useResettablePgliteTestOwner } from '../test/pglite-test-owner'
import { workspaces } from '@sparxie/valedictorian-local-runtime/testing/db/workspaces.schema'
import { createPgliteJobServiceWithCompanies } from '../test/job-service-with-companies'
import { jobCaptureEvidenceReferences } from '@sparxie/valedictorian-local-runtime/testing/modules/job/job.schema'
import { LifecycleHttpError } from '@sparxie/valedictorian-local-runtime/lifecycle'
import { createLocalLifecycleMethodsWithCompanies } from '../test/lifecycle-methods-with-companies'

const resettableOwner = useResettablePgliteTestOwner()

function monotonicClock(startMs = Date.UTC(2026, 6, 21, 0, 0, 0)) {
  let tick = 0
  return () => new Date(startMs + tick++ * 1000)
}

async function setup(workspaceId = 'ws-a') {
  const { database } = resettableOwner()
  for (const id of ['ws-a', 'ws-b']) {
    await database.insert(workspaces).values({
      id,
      name: id,
      createdAt: '2026-07-20T00:00:00.000Z',
      updatedAt: '2026-07-20T00:00:00.000Z',
    })
  }
  const now = monotonicClock()
  const methods = createLocalLifecycleMethodsWithCompanies(database, { workspaceId, now })
  return { database, methods, now }
}

const CREATE_INPUT = {
  evidenceMode: 'reported' as const,
  adapter: { id: 'cli', kind: 'cli' as const, version: '1.0.0' },
  observedAt: '2026-07-21T00:00:00.000Z',
  providerRecordId: null,
  providerSchema: null,
  payload: null,
  evidence: [{ kind: 'title', label: 'Title', value: 'Engineer' }],
}

const USER = { id: 'u-1', type: 'user' as const }

describe.sequential('local lifecycle facade — captures', () => {
  it('creates a capture and returns a contract-shaped succeeded mutation result', async () => {
    const { methods } = await setup()
    const result = await methods.captures.create(CREATE_INPUT)
    expect(result.status).toBe('succeeded')
    if (result.status !== 'succeeded') throw new Error('unreachable')
    expect(result.resource.workspaceId).toBe('ws-a')
    expect(result.resource.revision).toBe(1)
    expect(result.resource.evidenceMode).toBe('reported')
    expect(result.resource.evidence).toEqual([{ kind: 'title', label: 'Title', value: 'Engineer' }])
    expect(result.audit.actor.type).toBe('system')
  })

  it('reads a created capture back via get and list (scoped to the workspace)', async () => {
    const { methods } = await setup()
    const created = await methods.captures.create(CREATE_INPUT)
    if (created.status !== 'succeeded') throw new Error('unreachable')
    const captureId = created.resource.id

    const fetched = await methods.captures.get(captureId)
    expect(fetched?.id).toBe(captureId)

    const listed = await methods.captures.list()
    expect(listed.items.map((item) => item.id)).toContain(captureId)
  })

  it('returns null from get for an unknown capture', async () => {
    const { methods } = await setup()
    expect(await methods.captures.get('does-not-exist')).toBeNull()
  })

  it('appends a user-attributed corrected revision without rewriting observed head data', async () => {
    const { methods } = await setup()
    const created = await methods.captures.create(CREATE_INPUT)
    if (created.status !== 'succeeded') throw new Error('unreachable')
    const captureId = created.resource.id

    const corrected = await methods.captures.correct({
      captureId,
      expectedRevision: 1,
      actor: USER,
      rationale: 'fix the title',
      correction: { payload: { note: 'corrected' } },
    })
    expect(corrected.status).toBe('succeeded')
    if (corrected.status !== 'succeeded') throw new Error('unreachable')
    expect(corrected.resource.revision).toBe(2)
    // Observed evidence is preserved across a user correction.
    expect(corrected.resource.evidence).toEqual([{ kind: 'title', label: 'Title', value: 'Engineer' }])
    expect(corrected.audit.actor).toMatchObject({ id: 'u-1', type: 'user' })
  })

  it('raises a 409 LifecycleHttpError when a correction hits a revision conflict', async () => {
    const { methods } = await setup()
    const created = await methods.captures.create(CREATE_INPUT)
    if (created.status !== 'succeeded') throw new Error('unreachable')
    const captureId = created.resource.id

    await expect(
      methods.captures.correct({
        captureId,
        expectedRevision: 99,
        actor: USER,
        rationale: 'stale',
        correction: { payload: { note: 'x' } },
      }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('raises a 404 LifecycleHttpError when correcting an unknown capture', async () => {
    const { methods } = await setup()
    await expect(
      methods.captures.correct({
        captureId: 'missing',
        expectedRevision: 1,
        actor: USER,
        rationale: 'x',
        correction: { payload: { note: 'x' } },
      }),
    ).rejects.toBeInstanceOf(LifecycleHttpError)
    await expect(
      methods.captures.correct({
        captureId: 'missing',
        expectedRevision: 1,
        actor: USER,
        rationale: 'x',
        correction: { payload: { note: 'x' } },
      }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('removes a capture with no dependents (reject_if_dependents) and reports the tombstone', async () => {
    const { methods } = await setup()
    const created = await methods.captures.create(CREATE_INPUT)
    if (created.status !== 'succeeded') throw new Error('unreachable')
    const captureId = created.resource.id

    const removed = await methods.captures.remove({
      id: captureId,
      choice: 'reject_if_dependents',
      actor: USER,
      rationale: 'remove it',
    })
    expect(removed.status).toBe('removed')
    if (removed.status !== 'removed') throw new Error('unreachable')
    expect(removed.id).toBe(captureId)
    expect(removed.choice).toBe('reject_if_dependents')
    expect(typeof removed.removedAt).toBe('string')
    expect(removed.affectedDependentIds).toEqual([])
  })

  it('blocks a reject_if_dependents removal when an active job references the capture', async () => {
    const { database, methods, now } = await setup()
    const created = await methods.captures.create(CREATE_INPUT)
    if (created.status !== 'succeeded') throw new Error('unreachable')
    const captureId = created.resource.id

    const jobService = createPgliteJobServiceWithCompanies(database, { now })
    const job = await jobService.create({ workspaceId: 'ws-a', facts: { title: 'Dependent' }, actor: USER })
    if (!job.ok) throw new Error('failed to seed dependent job')
    await database.insert(jobCaptureEvidenceReferences).values({
      id: 'ref-1',
      jobId: job.job.id,
      captureId,
      captureRevision: 1,
      evidenceIndexesJson: '[0]',
      createdAt: now().toISOString(),
    })

    const blocked = await methods.captures.remove({
      id: captureId,
      choice: 'reject_if_dependents',
      actor: USER,
      rationale: 'try to remove',
    })
    expect(blocked.status).toBe('blocked')
    if (blocked.status !== 'blocked') throw new Error('unreachable')
    expect(blocked.dependentIds).toContain(job.job.id)
    expect(blocked.blocker.code).toBe('impossible_state')
  })

  it('restores a removed capture and reports it as restored', async () => {
    const { methods } = await setup()
    const created = await methods.captures.create(CREATE_INPUT)
    if (created.status !== 'succeeded') throw new Error('unreachable')
    const captureId = created.resource.id
    await methods.captures.remove({ id: captureId, choice: 'reject_if_dependents', actor: USER, rationale: 'r' })

    const restored = await methods.captures.restore({ id: captureId, actor: USER, rationale: 'bring it back' })
    expect(restored.status).toBe('restored')
    if (restored.status !== 'restored') throw new Error('unreachable')
    expect(restored.id).toBe(captureId)
    expect(typeof restored.restoredAt).toBe('string')

    const fetched = await methods.captures.get(captureId)
    expect(fetched?.removedAt).toBeNull()
  })

  it('raises a 404 LifecycleHttpError when removing an unknown capture', async () => {
    const { methods } = await setup()
    await expect(
      methods.captures.remove({ id: 'missing', choice: 'cascade_tombstone', actor: USER, rationale: 'x' }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('reconstructs capture history across the created and corrected revisions', async () => {
    const { methods } = await setup()
    const created = await methods.captures.create(CREATE_INPUT)
    if (created.status !== 'succeeded') throw new Error('unreachable')
    const captureId = created.resource.id
    await methods.captures.correct({
      captureId,
      expectedRevision: 1,
      actor: USER,
      rationale: 'r',
      correction: { payload: { note: 'x' } },
    })

    const history = await methods.captures.history({ id: captureId })
    expect(history.items.length).toBeGreaterThanOrEqual(2)
    expect(history.items.every((item) => item.snapshot.id === captureId)).toBe(true)
  })

  it('isolates captures across workspaces (a foreign workspace cannot read the capture)', async () => {
    const { database, now } = await setup()
    const wsA = createLocalLifecycleMethodsWithCompanies(database, { workspaceId: 'ws-a', now })
    const wsB = createLocalLifecycleMethodsWithCompanies(database, { workspaceId: 'ws-b', now })
    const created = await wsA.captures.create(CREATE_INPUT)
    if (created.status !== 'succeeded') throw new Error('unreachable')

    expect(await wsB.captures.get(created.resource.id)).toBeNull()
    const listedInB = await wsB.captures.list()
    expect(listedInB.items).toEqual([])
  })
})
