/**
 * Job external identities / conflicts / attach / merge — red-first proofs through
 * the PUBLIC identity surface (issue #300, slice 2). Covers establish (provisional
 * + strong, account required), strengthen provisional→strong, conflict inspection,
 * deterministic ATTACH on the strong-uniqueness index (including races), and the
 * minimal deterministic MERGE (identity move, lineage re-point, loser tombstone).
 */
import { describe, expect, it } from 'vitest'
import { and, eq, isNull } from 'drizzle-orm'
import { useResettablePgliteTestOwner } from '../../test/pglite-test-owner'
import { workspaces } from '@sparxie/valedictorian-local-runtime/testing/db/workspaces.schema'
import { jobCaptureEvidenceReferences, jobExternalIdentities } from '@sparxie/valedictorian-local-runtime/testing/db/schema'
import { createPgliteCaptureService } from '@sparxie/valedictorian-local-runtime/capture'
import { insertJobCaptureEvidenceReferences } from '@sparxie/valedictorian-local-runtime/testing/modules/job/job.repository'
import type { JobService } from '@sparxie/valedictorian-local-runtime/testing/modules/job/job.service'
import { createPgliteJobServiceWithCompanies } from '../../test/job-service-with-companies'
import { createPgliteJobIdentityService, type JobIdentityInput } from '@sparxie/valedictorian-local-runtime/testing/modules/job/job.identity'

const resettableOwner = useResettablePgliteTestOwner()

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
  return {
    database,
    jobs: createPgliteJobServiceWithCompanies(database, { now: clock }),
    identity: createPgliteJobIdentityService(database, { now: clock }),
    captures: createPgliteCaptureService(database, { now: clock }),
  }
}

async function createJob(jobs: JobService, workspaceId = 'ws-a') {
  const result = await jobs.create({ workspaceId, facts: { title: 'Engineer' }, actor: { type: 'user', id: 'u' } })
  if (!result.ok) throw new Error(`create job failed: ${result.code}`)
  return result.job
}

const ACTOR = { type: 'user', id: 'u' } as const

function strongIdentity(overrides: Partial<JobIdentityInput> = {}): JobIdentityInput {
  return {
    kind: 'ats_job', provider: 'Greenhouse', account: 'Acme', value: 'job-123',
    strength: 'strong', provenanceKind: 'capture', provenanceVersion: '1', evidence: { source: 'ats' }, ...overrides,
  }
}
function provisionalIdentity(overrides: Partial<JobIdentityInput> = {}): JobIdentityInput {
  return {
    kind: 'posting', provider: 'jobright', value: 'pr-1',
    strength: 'provisional', provenanceKind: 'capture', provenanceVersion: '1', evidence: { source: 'feed' }, ...overrides,
  }
}

async function activeStrongCount(database: Awaited<ReturnType<typeof setup>>['database'], value: string) {
  const rows = await database
    .select()
    .from(jobExternalIdentities)
    .where(and(eq(jobExternalIdentities.value, value), eq(jobExternalIdentities.strength, 'strong'), isNull(jobExternalIdentities.removedAt)))
  return rows.length
}

describe.sequential('Job identity contract (#300)', () => {
  it('establishes provisional and strong identities and lists active ones (provider/account lowercased)', async () => {
    const { jobs, identity } = await setup()
    const job = await createJob(jobs)

    const provisional = await identity.establish({ workspaceId: 'ws-a', jobId: job.id, identity: provisionalIdentity(), actor: ACTOR })
    expect(provisional).toMatchObject({ ok: true, attached: false, resolvedJobId: job.id })
    const strong = await identity.establish({ workspaceId: 'ws-a', jobId: job.id, identity: strongIdentity(), actor: ACTOR })
    expect(strong).toMatchObject({ ok: true, attached: false })

    const list = await identity.listIdentities('ws-a', job.id)
    expect(list).toHaveLength(2)
    expect(list.find((i) => i.strength === 'strong')).toMatchObject({ provider: 'greenhouse', account: 'acme', value: 'job-123' })
    expect((await jobs.history('ws-a', job.id)).map((h) => h.kind)).toEqual(['created', 'identity_added', 'identity_added'])
  })

  it('requires an account for a strong identity', async () => {
    const { jobs, identity } = await setup()
    const job = await createJob(jobs)
    expect(await identity.establish({ workspaceId: 'ws-a', jobId: job.id, identity: strongIdentity({ account: null }), actor: ACTOR }))
      .toMatchObject({ ok: false, code: 'invalid_input' })
  })

  it('ATTACHes: establishing a strong identity owned by another job resolves to it without a duplicate', async () => {
    const { database, jobs, identity } = await setup()
    const owner = await createJob(jobs)
    const other = await createJob(jobs)
    const first = await identity.establish({ workspaceId: 'ws-a', jobId: owner.id, identity: strongIdentity(), actor: ACTOR })
    expect(first.ok && first.attached).toBe(false)

    const attached = await identity.establish({ workspaceId: 'ws-a', jobId: other.id, identity: strongIdentity(), actor: ACTOR })
    expect(attached).toMatchObject({ ok: true, attached: true, resolvedJobId: owner.id })
    expect(await activeStrongCount(database, 'job-123')).toBe(1) // no duplicate minted
    expect(await identity.listIdentities('ws-a', other.id)).toHaveLength(0) // not added to the other job
  })

  it('is idempotent: re-establishing the same strong identity on the same job attaches to itself', async () => {
    const { jobs, identity } = await setup()
    const job = await createJob(jobs)
    await identity.establish({ workspaceId: 'ws-a', jobId: job.id, identity: strongIdentity(), actor: ACTOR })
    const again = await identity.establish({ workspaceId: 'ws-a', jobId: job.id, identity: strongIdentity(), actor: ACTOR })
    expect(again).toMatchObject({ ok: true, attached: true, resolvedJobId: job.id })
    expect(await identity.listIdentities('ws-a', job.id)).toHaveLength(1)
  })

  it('strengthens a provisional identity to strong (tombstone + insert), requiring an account', async () => {
    const { jobs, identity } = await setup()
    const job = await createJob(jobs)
    const established = await identity.establish({ workspaceId: 'ws-a', jobId: job.id, identity: provisionalIdentity(), actor: ACTOR })
    expect(established.ok).toBe(true)
    if (!established.ok) return

    const strengthened = await identity.strengthen({ workspaceId: 'ws-a', jobId: job.id, identityId: established.identityId, account: 'Acct-9', actor: ACTOR })
    expect(strengthened).toMatchObject({ ok: true, attached: false })

    const list = await identity.listIdentities('ws-a', job.id)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ strength: 'strong', account: 'acct-9', value: 'pr-1' })
    expect((await jobs.history('ws-a', job.id)).map((h) => h.kind))
      .toEqual(['created', 'identity_added', 'identity_removed', 'identity_added'])
  })

  it('inspects the owner of a strong identity, resolving conflicts', async () => {
    const { jobs, identity } = await setup()
    const job = await createJob(jobs)
    await identity.establish({ workspaceId: 'ws-a', jobId: job.id, identity: strongIdentity(), actor: ACTOR })
    expect(await identity.inspectOwner('ws-a', { kind: 'ats_job', provider: 'greenhouse', account: 'acme', value: 'job-123' }))
      .toMatchObject({ jobId: job.id })
    expect(await identity.inspectOwner('ws-a', { kind: 'ats_job', provider: 'greenhouse', account: 'acme', value: 'missing' })).toBeNull()
  })

  it('converges concurrent strong establishment on two jobs to one owner', async () => {
    const { database, jobs, identity } = await setup()
    const j1 = await createJob(jobs)
    const j2 = await createJob(jobs)
    const results = await Promise.allSettled([
      identity.establish({ workspaceId: 'ws-a', jobId: j1.id, identity: strongIdentity(), actor: ACTOR }),
      identity.establish({ workspaceId: 'ws-a', jobId: j2.id, identity: strongIdentity(), actor: ACTOR }),
    ])
    const ok = results.filter((r) => r.status === 'fulfilled' && r.value.ok)
    expect(ok).toHaveLength(2)
    expect(await activeStrongCount(database, 'job-123')).toBe(1)
  })

  it('merges two jobs deterministically: identities move, lineage re-points, loser is tombstoned', async () => {
    const { database, jobs, identity, captures } = await setup()
    const winner = await createJob(jobs) // created first → earliest → winner
    const loser = await createJob(jobs)

    await identity.establish({ workspaceId: 'ws-a', jobId: loser.id, identity: strongIdentity({ value: 'loser-strong' }), actor: ACTOR })
    // A durable capture + lineage reference on the loser.
    const capture = await captures.accept({
      workspaceId: 'ws-a',
      provenance: { adapterId: 'manual', adapterKind: 'manual', adapterVersion: '1.0.0', providerRecordId: null, providerSchema: null, observedAt: '2026-07-19T10:00:00.000Z' },
      evidenceMode: 'reported', evidence: [{ kind: 'title', label: 'Title', value: 'X' }], actor: ACTOR,
    })
    if (!capture.ok) throw new Error('capture failed')
    await insertJobCaptureEvidenceReferences(database).values({
      id: 'ref-loser', jobId: loser.id, captureId: capture.capture.id, captureRevision: 1, evidenceIndexesJson: '[0]', createdAt: '2026-07-20T00:00:00.000Z',
    })

    const merged = await identity.merge({ workspaceId: 'ws-a', jobIdA: loser.id, jobIdB: winner.id, actor: ACTOR })
    expect(merged).toMatchObject({ ok: true, winnerJobId: winner.id, loserJobId: loser.id })

    // Loser tombstoned; winner active.
    expect((await jobs.get('ws-a', loser.id))?.removedAt).not.toBeNull()
    expect((await jobs.get('ws-a', winner.id))?.removedAt).toBeNull()
    // Identity moved to winner, tombstoned on loser.
    expect(await identity.listIdentities('ws-a', winner.id)).toHaveLength(1)
    expect(await identity.listIdentities('ws-a', loser.id)).toHaveLength(0)
    // Lineage re-pointed to the winner.
    const winnerRefs = await database.select().from(jobCaptureEvidenceReferences).where(eq(jobCaptureEvidenceReferences.jobId, winner.id))
    const loserRefs = await database.select().from(jobCaptureEvidenceReferences).where(eq(jobCaptureEvidenceReferences.jobId, loser.id))
    expect(winnerRefs).toHaveLength(1)
    expect(loserRefs).toHaveLength(0)
    // History appended on both sides.
    expect((await jobs.history('ws-a', loser.id)).map((h) => h.kind)).toContain('removed')
    expect((await jobs.history('ws-a', winner.id)).map((h) => h.kind)).toContain('identity_added')
  })

  it('isolates identity operations across workspaces', async () => {
    const { jobs, identity } = await setup()
    const job = await createJob(jobs, 'ws-a')
    await identity.establish({ workspaceId: 'ws-a', jobId: job.id, identity: strongIdentity(), actor: ACTOR })

    expect(await identity.establish({ workspaceId: 'ws-b', jobId: job.id, identity: strongIdentity({ value: 'x' }), actor: ACTOR })).toMatchObject({ ok: false, code: 'not_found' })
    expect(await identity.strengthen({ workspaceId: 'ws-b', jobId: job.id, identityId: 'whatever', account: 'a', actor: ACTOR })).toMatchObject({ ok: false, code: 'not_found' })
    expect(await identity.merge({ workspaceId: 'ws-b', jobIdA: job.id, jobIdB: job.id, actor: ACTOR })).toMatchObject({ ok: true })
    expect(await identity.listIdentities('ws-b', job.id)).toEqual([])
    expect(await identity.inspectOwner('ws-b', { kind: 'ats_job', provider: 'greenhouse', account: 'acme', value: 'job-123' })).toBeNull()
  })
})
