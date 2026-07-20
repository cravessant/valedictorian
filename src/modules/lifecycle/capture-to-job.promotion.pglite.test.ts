/**
 * Capture → Job promotion — red-first proofs through the PUBLIC orchestration
 * (issue #300, slice 3). Covers idempotency, ATTACH via the strong identity,
 * per-mode retrieval authority, boundary-owned retrieval (resolved / third-party /
 * security-rejected), warnings vs typed blocks, manual Job creation, atomic
 * rollback on an injected failure between writes, concurrency races, and
 * cross-workspace isolation.
 */
import { describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { useResettablePgliteTestOwner } from '../../test/pglite-test-owner'
import { workspaces } from '../../db/workspaces.schema'
import { captureEvidenceItems, lifecycleCaptures } from '../capture/capture.schema'
import { jobCaptureEvidenceReferences, lifecycleJobs } from '../job/job.schema'
import { createPgliteCaptureService, type CaptureService } from '../capture/capture.service'
import { createPgliteJobService } from '../job/job.service'
import {
  createPgliteJobPromotion,
  type DestinationResolution,
  type JobResolutionPort,
} from './capture-to-job.promotion'

const resettableOwner = useResettablePgliteTestOwner()

function monotonicClock(startMs = Date.UTC(2026, 6, 20, 0, 0, 0)) {
  let tick = 0
  return () => new Date(startMs + tick++ * 1000)
}

const ACTOR = { type: 'user', id: 'u' } as const

async function setup() {
  const { database } = resettableOwner()
  for (const id of ['ws-a', 'ws-b']) {
    await database.insert(workspaces).values({ id, name: id, createdAt: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z' })
  }
  const clock = monotonicClock()
  const captures = createPgliteCaptureService(database, { now: clock })
  const jobs = createPgliteJobService(database, { now: clock })
  let resolution: DestinationResolution = { status: 'unavailable' }
  const resolveSpy = vi.fn(async () => resolution)
  const port: JobResolutionPort = { resolveDestination: resolveSpy }
  const promotion = createPgliteJobPromotion(database, captures, jobs, { now: clock, resolutionPort: port })
  return { database, captures, jobs, promotion, resolveSpy, setResolution: (r: DestinationResolution) => { resolution = r } }
}

async function acceptCapture(captures: CaptureService, overrides: { workspaceId?: string; providerRecordId?: string | null; evidenceMode?: 'reported' | 'ats_details_provided' } = {}) {
  const result = await captures.accept({
    workspaceId: overrides.workspaceId ?? 'ws-a',
    provenance: { adapterId: 'jobright.resolver', adapterKind: 'connector', adapterVersion: '1.0.0', providerRecordId: overrides.providerRecordId ?? 'rec-1', providerSchema: 'jobright.v1', observedAt: '2026-07-19T10:00:00.000Z' },
    evidenceMode: overrides.evidenceMode ?? 'reported',
    evidence: [{ kind: 'title', label: 'Title', value: 'Engineer' }],
    actor: ACTOR,
  })
  if (!result.ok) throw new Error(`accept failed: ${result.code}`)
  return result.capture
}

async function countJobs(database: Awaited<ReturnType<typeof setup>>['database'], workspaceId: string) {
  return (await database.select().from(lifecycleJobs).where(eq(lifecycleJobs.workspaceId, workspaceId))).length
}

describe.sequential('Capture→Job promotion (#300)', () => {
  it('promotes an ats_details_provided capture to a Job with a strong identity + lineage', async () => {
    const { database, captures, jobs, promotion } = await setup()
    const capture = await acceptCapture(captures, { evidenceMode: 'ats_details_provided' })
    const result = await promotion.promoteCapture({ workspaceId: 'ws-a', captureId: capture.id, actor: ACTOR })
    expect(result).toMatchObject({ ok: true, created: true, attached: false })
    if (!result.ok) return
    expect(await jobs.get('ws-a', result.jobId)).not.toBeNull()
    expect((await jobs.history('ws-a', result.jobId)).map((h) => h.kind)).toContain('identity_added')
    expect(await countJobs(database, 'ws-a')).toBe(1)
  })

  it('is idempotent: re-promoting the same capture returns the same Job (lineage)', async () => {
    const { database, captures, promotion } = await setup()
    const capture = await acceptCapture(captures, { evidenceMode: 'ats_details_provided' })
    const first = await promotion.promoteCapture({ workspaceId: 'ws-a', captureId: capture.id, actor: ACTOR })
    const second = await promotion.promoteCapture({ workspaceId: 'ws-a', captureId: capture.id, actor: ACTOR })
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(second.jobId).toBe(first.jobId)
    expect(second.created).toBe(false)
    expect(await countJobs(database, 'ws-a')).toBe(1)
  })

  it('enforces per-mode authority: a reported capture without retrieval yields a provisional identity + warning', async () => {
    const { captures, promotion } = await setup() // port default: unavailable
    const capture = await acceptCapture(captures, { evidenceMode: 'reported' })
    const result = await promotion.promoteCapture({ workspaceId: 'ws-a', captureId: capture.id, actor: ACTOR })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings.map((w) => w.code)).toContain('retrieval_unavailable')
  })

  it('retrieves at the boundary: employer_or_ast resolves strong; third-party is a WARNING; security_rejected BLOCKS', async () => {
    const { captures, promotion, setResolution } = await setup()

    setResolution({ status: 'resolved', canonicalUrl: 'https://boards.greenhouse.io/acme/jobs/1', classification: 'employer_or_ats' })
    const strong = await promotion.promoteCapture({ workspaceId: 'ws-a', captureId: (await acceptCapture(captures, { providerRecordId: 'rec-strong' })).id, actor: ACTOR })
    expect(strong).toMatchObject({ ok: true, created: true })

    setResolution({ status: 'resolved', canonicalUrl: 'https://linkedin.com/jobs/2', classification: 'third_party' })
    const thirdParty = await promotion.promoteCapture({ workspaceId: 'ws-a', captureId: (await acceptCapture(captures, { providerRecordId: 'rec-3p' })).id, actor: ACTOR })
    expect(thirdParty.ok).toBe(true)
    if (thirdParty.ok) expect(thirdParty.warnings.map((w) => w.code)).toContain('third_party_destination')

    setResolution({ status: 'security_rejected' })
    const blocked = await promotion.promoteCapture({ workspaceId: 'ws-a', captureId: (await acceptCapture(captures, { providerRecordId: 'rec-sec' })).id, actor: ACTOR })
    expect(blocked).toMatchObject({ ok: false, code: 'security_violation' })
  })

  it('ATTACHes: two captures resolving to the same strong destination promote to ONE Job', async () => {
    const { database, captures, promotion, setResolution } = await setup()
    setResolution({ status: 'resolved', canonicalUrl: 'https://boards.greenhouse.io/acme/jobs/1', classification: 'employer_or_ats' })

    const a = await promotion.promoteCapture({ workspaceId: 'ws-a', captureId: (await acceptCapture(captures, { providerRecordId: 'rec-a' })).id, actor: ACTOR })
    const b = await promotion.promoteCapture({ workspaceId: 'ws-a', captureId: (await acceptCapture(captures, { providerRecordId: 'rec-b' })).id, actor: ACTOR })
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    expect(b.attached).toBe(true)
    expect(b.jobId).toBe(a.jobId)
    expect(await countJobs(database, 'ws-a')).toBe(1)
  })

  it('creates a manual Job atomically with a manual Capture lineage', async () => {
    const { database, jobs, promotion } = await setup()
    const result = await promotion.createManualJob({ workspaceId: 'ws-a', facts: { title: 'Manual role' }, evidence: [{ kind: 'note', label: 'Note', value: 'x' }], actor: ACTOR })
    expect(result).toMatchObject({ ok: true, created: true })
    if (!result.ok) return
    expect((await jobs.get('ws-a', result.jobId))?.facts).toMatchObject({ title: 'Manual role' })
    const captureRows = await database.select().from(lifecycleCaptures).where(eq(lifecycleCaptures.id, result.captureId))
    expect(captureRows).toHaveLength(1)
    expect(captureRows[0]?.adapterKind).toBe('manual')
  })

  it('rolls back atomically when a write fails between the Capture and Job writes', async () => {
    const { database, captures, jobs } = await setup()
    const failingJobs = { ...jobs, createOn: vi.fn(async () => { throw new Error('job write boom') }) }
    const promotion = createPgliteJobPromotion(database, captures, failingJobs, { now: monotonicClock() })
    await expect(promotion.createManualJob({ workspaceId: 'ws-a', facts: {}, evidence: [{ kind: 'note', label: 'N', value: 'x' }], actor: ACTOR }))
      .rejects.toThrow('job write boom')
    // The manual Capture accepted earlier in the same transaction must have rolled back.
    expect(await database.select().from(lifecycleCaptures)).toHaveLength(0)
    expect(await countJobs(database, 'ws-a')).toBe(0)
  })

  it('converges concurrent promotion of one capture to a single Job', async () => {
    const { database, captures, promotion } = await setup()
    const capture = await acceptCapture(captures, { evidenceMode: 'ats_details_provided' })
    const results = await Promise.allSettled([
      promotion.promoteCapture({ workspaceId: 'ws-a', captureId: capture.id, actor: ACTOR }),
      promotion.promoteCapture({ workspaceId: 'ws-a', captureId: capture.id, actor: ACTOR }),
    ])
    expect(results.every((r) => r.status === 'fulfilled' && r.value.ok)).toBe(true)
    expect(await countJobs(database, 'ws-a')).toBe(1)
  })

  it('isolates promotion across workspaces', async () => {
    const { captures, promotion } = await setup()
    const capture = await acceptCapture(captures, { workspaceId: 'ws-a', evidenceMode: 'ats_details_provided' })
    expect(await promotion.promoteCapture({ workspaceId: 'ws-b', captureId: capture.id, actor: ACTOR })).toMatchObject({ ok: false, code: 'not_found' })
  })

  it('converges concurrent promotion of a PROVISIONAL-identity capture to one Job (blocker)', async () => {
    const { database, captures, promotion } = await setup() // port default unavailable → provisional identity
    const capture = await acceptCapture(captures, { evidenceMode: 'reported', providerRecordId: 'rec-prov' })
    const results = await Promise.allSettled([
      promotion.promoteCapture({ workspaceId: 'ws-a', captureId: capture.id, actor: ACTOR }),
      promotion.promoteCapture({ workspaceId: 'ws-a', captureId: capture.id, actor: ACTOR }),
    ])
    expect(results.every((r) => r.status === 'fulfilled' && r.value.ok)).toBe(true)
    expect(await countJobs(database, 'ws-a')).toBe(1)
    const refs = await database.select().from(jobCaptureEvidenceReferences).where(eq(jobCaptureEvidenceReferences.captureId, capture.id))
    expect(refs).toHaveLength(1)
  })

  it('does not re-run boundary retrieval on a re-promote (idempotency before the port)', async () => {
    const { captures, promotion, resolveSpy, setResolution } = await setup()
    setResolution({ status: 'resolved', canonicalUrl: 'https://boards.greenhouse.io/acme/jobs/9', classification: 'employer_or_ats' })
    const capture = await acceptCapture(captures, { providerRecordId: 'rec-once' })
    await promotion.promoteCapture({ workspaceId: 'ws-a', captureId: capture.id, actor: ACTOR })
    expect(resolveSpy).toHaveBeenCalledTimes(1)

    // A destination that later flips to security_rejected must NOT block an already-promoted capture.
    setResolution({ status: 'security_rejected' })
    const rePromote = await promotion.promoteCapture({ workspaceId: 'ws-a', captureId: capture.id, actor: ACTOR })
    expect(rePromote).toMatchObject({ ok: true, attached: true })
    expect(resolveSpy).toHaveBeenCalledTimes(1) // not re-fired
  })

  it('wires providerRecordId through manual creation so #299 provenance idempotency dedups the Capture', async () => {
    const { database, promotion } = await setup()
    const a = await promotion.createManualJob({ workspaceId: 'ws-a', facts: { t: 1 }, evidence: [{ kind: 'row', label: 'R', value: '1' }], providerRecordId: 'import-1', actor: ACTOR })
    const b = await promotion.createManualJob({ workspaceId: 'ws-a', facts: { t: 2 }, evidence: [{ kind: 'row', label: 'R', value: '1' }], providerRecordId: 'import-1', actor: ACTOR })
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    expect(b.captureId).toBe(a.captureId) // same import-provenance Capture reused
    expect((await database.select().from(lifecycleCaptures).where(eq(lifecycleCaptures.providerRecordId, 'import-1')))).toHaveLength(1)
  })

  it('links the second import Job to the evidence-bearing HEAD revision, not a stale revision (delta-1)', async () => {
    const { database, promotion } = await setup()
    // First import: 1 evidence item → Capture revision 1.
    const a = await promotion.createManualJob({ workspaceId: 'ws-a', facts: { t: 1 }, evidence: [{ kind: 'row', label: 'R', value: '1' }], providerRecordId: 'import-x', actor: ACTOR })
    // Second import (same providerRecordId, DIFFERENT evidence count): dedups the
    // Capture and appendObservation advances it to revision 2 with 2 evidence items.
    const b = await promotion.createManualJob({ workspaceId: 'ws-a', facts: { t: 2 }, evidence: [{ kind: 'row', label: 'R', value: '1' }, { kind: 'row2', label: 'R2', value: '2' }], providerRecordId: 'import-x', actor: ACTOR })
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    expect(b.captureId).toBe(a.captureId)

    // b's lineage must point at the evidence-bearing HEAD revision (2) with indexes valid there.
    const [bRef] = await database.select().from(jobCaptureEvidenceReferences).where(eq(jobCaptureEvidenceReferences.jobId, b.jobId))
    expect(bRef?.captureRevision).toBe(2)
    expect(bRef?.evidenceIndexesJson).toBe('[0,1]')
    // The claimed indexes actually exist at that revision (no orphaned evidence / stale pointer).
    const revEvidence = await database.select().from(captureEvidenceItems)
      .where(and(eq(captureEvidenceItems.captureId, b.captureId), eq(captureEvidenceItems.captureRevision, 2)))
    expect(revEvidence.map((e) => e.evidenceIndex).sort((x, y) => x - y)).toEqual([0, 1])
  })

  it('blocks an over-bound resolved identity as a typed failure (not a raw DB CHECK)', async () => {
    const { database, captures, promotion, setResolution } = await setup()
    setResolution({ status: 'resolved', canonicalUrl: `https://acme.com/${'x'.repeat(2100)}`, classification: 'employer_or_ats' })
    const capture = await acceptCapture(captures, { providerRecordId: 'rec-huge' })
    const result = await promotion.promoteCapture({ workspaceId: 'ws-a', captureId: capture.id, actor: ACTOR })
    expect(result).toMatchObject({ ok: false, code: 'bounded_data_violation' })
    expect(await countJobs(database, 'ws-a')).toBe(0) // no partial state
  })

  it('rolls back the composed transaction on a genuine second-write failure (manual facts over bound)', async () => {
    const { database, promotion } = await setup()
    // The manual Capture accepts (first write), then createOn rejects the over-bound
    // facts (second write) — the whole transaction must roll back, leaving no Capture.
    const result = await promotion.createManualJob({ workspaceId: 'ws-a', facts: { blob: 'x'.repeat(300_000) }, evidence: [{ kind: 'note', label: 'N', value: 'x' }], actor: ACTOR })
    expect(result).toMatchObject({ ok: false, code: 'bounded_data_violation' })
    expect(await database.select().from(lifecycleCaptures)).toHaveLength(0)
    expect(await countJobs(database, 'ws-a')).toBe(0)
  })
})
