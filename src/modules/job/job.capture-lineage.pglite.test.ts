/**
 * Capture→Job lineage seam — constraint-level red-first proofs (issue #299,
 * slice 2). Exercises the Job-side minting conversation
 * (`insertJobCaptureEvidenceReferences`) fed by Capture's evidence-reference read
 * conversation (`readCaptureEvidenceReference`), proving one-unambiguous-lineage
 * and no-divergent-owner at the DB constraint level. No production writer exists
 * yet (promotion is #300); this proves the seam and its invariants.
 */
import { describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { useResettablePgliteTestOwner } from '../../test/pglite-test-owner'
import { workspaces } from '../../db/workspaces.schema'
import { jobCaptureEvidenceReferences, lifecycleJobs } from '../../db/schema'
import { createPgliteCaptureService } from '../capture/capture.service'
import { readCaptureEvidenceReference } from '../capture/capture.lineage'
import { insertJobCaptureEvidenceReferences } from './job.repository'

const resettableOwner = useResettablePgliteTestOwner()

const JOB_A = '01890000-0000-7000-8000-000000000001'
const JOB_B = '01890000-0000-7000-8000-000000000002'

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
  const service = createPgliteCaptureService(database, { now: monotonicClock() })
  return { database, service }
}

async function seedJob(database: Awaited<ReturnType<typeof setup>>['database'], id: string, workspaceId: string) {
  await database.insert(lifecycleJobs).values({
    id,
    workspaceId,
    factsRevision: 1,
    factsJson: '{}',
    availabilityState: 'unknown',
    availabilityObservedAt: '2026-07-20T00:00:00.000Z',
    availabilityRevision: 1,
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
  })
}

async function seedCapture(service: Awaited<ReturnType<typeof setup>>['service'], workspaceId = 'ws-a', providerRecordId = 'record-1') {
  const result = await service.accept({
    workspaceId,
    provenance: {
      adapterId: 'jobright.resolver',
      adapterKind: 'connector',
      adapterVersion: '0.16.0',
      providerRecordId,
      providerSchema: 'jobright.v1',
      observedAt: '2026-07-19T10:00:00.000Z',
    },
    evidenceMode: 'reported',
    evidence: [
      { kind: 'title', label: 'Job title', value: 'Staff Engineer' },
      { kind: 'company', label: 'Company', value: { name: 'Acme' } },
    ],
    actor: { type: 'system' },
  })
  if (!result.ok) throw new Error(`accept failed: ${result.code}`)
  return result.capture
}

async function mintReference(
  database: Awaited<ReturnType<typeof setup>>['database'],
  reference: { id: string; jobId: string; captureId: string; captureRevision: number; evidenceIndexes: readonly number[] },
) {
  await insertJobCaptureEvidenceReferences(database).values({
    id: reference.id,
    jobId: reference.jobId,
    captureId: reference.captureId,
    captureRevision: reference.captureRevision,
    evidenceIndexesJson: JSON.stringify(reference.evidenceIndexes),
    createdAt: '2026-07-20T00:00:00.000Z',
  })
}

describe.sequential('Capture→Job lineage seam (#299)', () => {
  it("exposes a capture's observed evidence reference, workspace-scoped", async () => {
    const { database, service } = await setup()
    const capture = await seedCapture(service)

    const reference = await readCaptureEvidenceReference(database, { workspaceId: 'ws-a', captureId: capture.id })
    expect(reference).toEqual({
      captureId: capture.id,
      captureRevision: 1,
      evidenceMode: 'reported',
      evidenceIndexes: [0, 1],
    })

    // A lineage can never be read across a workspace boundary.
    expect(await readCaptureEvidenceReference(database, { workspaceId: 'ws-b', captureId: capture.id })).toBeNull()
  })

  it('mints one produced Job lineage from the capture read conversation', async () => {
    const { database, service } = await setup()
    const capture = await seedCapture(service)
    await seedJob(database, JOB_A, 'ws-a')

    const reference = await readCaptureEvidenceReference(database, { workspaceId: 'ws-a', captureId: capture.id })
    expect(reference).not.toBeNull()
    await mintReference(database, {
      id: 'ref-1',
      jobId: JOB_A,
      captureId: reference!.captureId,
      captureRevision: reference!.captureRevision,
      evidenceIndexes: reference!.evidenceIndexes,
    })

    const rows = await database
      .select()
      .from(jobCaptureEvidenceReferences)
      .where(
        and(
          eq(jobCaptureEvidenceReferences.jobId, JOB_A),
          eq(jobCaptureEvidenceReferences.captureId, capture.id),
        ),
      )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.evidenceIndexesJson).toBe('[0,1]')
  })

  it('forbids a divergent owner answer for the same (job, capture, revision)', async () => {
    const { database, service } = await setup()
    const capture = await seedCapture(service)
    await seedJob(database, JOB_A, 'ws-a')

    await mintReference(database, { id: 'ref-1', jobId: JOB_A, captureId: capture.id, captureRevision: 1, evidenceIndexes: [0, 1] })

    // A second, divergent reference for the same triple violates the unique lineage index.
    await expect(
      mintReference(database, { id: 'ref-2', jobId: JOB_A, captureId: capture.id, captureRevision: 1, evidenceIndexes: [0] }),
    ).rejects.toThrow()
  })

  it('forces the lineage to reference a real capture revision', async () => {
    const { database, service } = await setup()
    await seedCapture(service)
    await seedJob(database, JOB_A, 'ws-a')

    await expect(
      mintReference(database, { id: 'ref-x', jobId: JOB_A, captureId: 'no-such-capture', captureRevision: 1, evidenceIndexes: [0] }),
    ).rejects.toThrow()
  })

  it('forces the lineage to reference a real produced Job', async () => {
    const { database, service } = await setup()
    const capture = await seedCapture(service)

    await expect(
      mintReference(database, { id: 'ref-y', jobId: JOB_B, captureId: capture.id, captureRevision: 1, evidenceIndexes: [0, 1] }),
    ).rejects.toThrow()
  })

  it('lets distinct capture revisions of the same job coexist (evolution is not divergence)', async () => {
    const { database, service } = await setup()
    const capture = await seedCapture(service)
    // Re-observation advances the capture to revision 2 with its own evidence occurrence.
    const reobserved = await service.accept({
      workspaceId: 'ws-a',
      provenance: {
        adapterId: 'jobright.resolver',
        adapterKind: 'connector',
        adapterVersion: '0.16.0',
        providerRecordId: 'record-1',
        providerSchema: 'jobright.v1',
        observedAt: '2026-07-20T10:00:00.000Z',
      },
      evidenceMode: 'reported',
      evidence: [{ kind: 'title', label: 'Job title', value: 'Staff Software Engineer' }],
      actor: { type: 'system' },
    })
    expect(reobserved.ok && reobserved.capture.revision).toBe(2)
    await seedJob(database, JOB_A, 'ws-a')

    await mintReference(database, { id: 'ref-r1', jobId: JOB_A, captureId: capture.id, captureRevision: 1, evidenceIndexes: [0, 1] })
    await mintReference(database, { id: 'ref-r2', jobId: JOB_A, captureId: capture.id, captureRevision: 2, evidenceIndexes: [0] })

    const rows = await database
      .select()
      .from(jobCaptureEvidenceReferences)
      .where(eq(jobCaptureEvidenceReferences.captureId, capture.id))
    expect(rows.map((row) => row.captureRevision).sort((a, b) => a - b)).toEqual([1, 2])
  })
})
