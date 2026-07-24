import { count, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { workspaces } from '../../db/workspaces.schema'
import { useResettablePgliteTestOwner } from '../../test/pglite-test-owner'
import {
  captureEffectiveRevisionInputs,
  captureEvidenceItems,
  captureMaterializationIssues,
  captureResolutionGenerations,
  captureResolutionStageResults,
  captureRevisions,
  captures as captureHeads,
} from './capture.schema'
import { createCaptureMaterializationService } from './capture.materialization'
import { createCaptureResolutionService } from './capture.resolution'
import { jobCaptureEvidenceReferences, jobs } from '../job/job.schema'
import {
  createPgliteCaptureService,
  type AcceptCaptureInput,
} from './capture.service'

const resettableOwner = useResettablePgliteTestOwner()
const WORKSPACE = 'capture-resolution-workspace'
const CREATED_AT = Date.parse('2026-07-23T00:00:00.000Z')

function monotonicClock() {
  let tick = 0
  return () => new Date(CREATED_AT + tick++ * 1000)
}

async function setup() {
  const { database } = resettableOwner()
  await database.insert(workspaces).values({
    id: WORKSPACE,
    name: WORKSPACE,
    createdAt: new Date(CREATED_AT).toISOString(),
    updatedAt: new Date(CREATED_AT).toISOString(),
  })
  const now = monotonicClock()
  const captures = createPgliteCaptureService(database, { now })
  const materialization = createCaptureMaterializationService(database, {
    now,
    pageSize: 1,
  })
  const resolution = createCaptureResolutionService(database, {
    workspaceId: WORKSPACE,
    materialization,
  })
  return { captures, database, materialization, resolution }
}

function input(
  providerRecordId: string | null,
  overrides: Partial<AcceptCaptureInput> = {},
): AcceptCaptureInput {
  return {
    workspaceId: WORKSPACE,
    provenance: {
      adapterId: providerRecordId ? 'jobright.resolver' : 'manual.capture',
      adapterKind: providerRecordId ? 'connector' : 'manual',
      adapterVersion: '1.0.0',
      providerRecordId,
      providerSchema: providerRecordId ? 'jobright.v1' : null,
      observedAt: '2026-07-22T12:00:00.000Z',
    },
    evidenceMode: 'reported',
    evidence: [
      { kind: 'title', label: 'Role title', value: 'Staff Engineer' },
      { kind: 'company', label: 'Company', value: { name: 'Northstar Labs' } },
    ],
    payload: { source: 'fixture' },
    actor: { id: 'capture-test', type: 'user' },
    ...overrides,
  }
}

async function accept(
  service: ReturnType<typeof createPgliteCaptureService>,
  value: AcceptCaptureInput,
) {
  const result = await service.accept(value)
  if (!result.ok) throw new Error(result.message)
  return result.capture
}

describe.sequential('Capture resolution materialization and projections', () => {
  it('materializes exact evidence, creates an intake generation, and serves detail', async () => {
    const { captures, database, materialization, resolution } = await setup()
    const capture = await accept(captures, input(null))

    await materialization.migrateToReady(WORKSPACE)
    await materialization.migrateToReady(WORKSPACE)
    const page = await resolution.list({ filter: 'all', sort: 'observed_desc' })
    expect(page).toMatchObject({
      totalCount: 1,
      items: [{
        captureId: capture.id,
        captureRevision: 1,
        lead: {
          roleTitle: 'Staff Engineer',
          companyName: 'Northstar Labs',
        },
        destination: { state: 'not_required' },
        readiness: 'ready',
        processingSummary: 'awaiting_information',
        primaryIntent: { kind: 'complete_job_information' },
      }],
    })
    const detail = await resolution.get(capture.id)
    expect(detail).toMatchObject({
      captureId: capture.id,
      captureRevision: 1,
      destination: { status: 'not_required', url: null },
      jobDefaults: {
        roleTitle: 'Staff Engineer',
        companyName: 'Northstar Labs',
      },
      exactEvidenceReferences: [{
        captureId: capture.id,
        captureRevision: 1,
        evidenceIndexes: [0, 1],
      }],
    })
    expect(detail.rawEvidence).toHaveLength(2)
    expect(await database.select({ value: count() }).from(
      captureEffectiveRevisionInputs,
    )).toEqual([{ value: 1 }])
    expect(await database.select({ value: count() }).from(
      captureResolutionGenerations,
    )).toEqual([{ value: 1 }])
    expect(await database.select({ value: count() }).from(
      captureResolutionStageResults,
    )).toEqual([{ value: 3 }])
  })

  it('does not relabel earlier evidence onto a corrected revision', async () => {
    const { captures, database, materialization, resolution } = await setup()
    const capture = await accept(captures, input(null))
    await materialization.migrateToReady(WORKSPACE)
    const corrected = await captures.correct({
      workspaceId: WORKSPACE,
      captureId: capture.id,
      expectedRevision: 1,
      correction: { payload: { companyName: 'Northstar Labs', roleTitle: 'Principal Engineer' } },
      actor: { id: 'capture-test', type: 'user' },
    })
    expect(corrected).toMatchObject({ ok: true, capture: { revision: 2 } })

    const page = await resolution.list({ filter: 'all', sort: 'observed_desc' })
    expect(page.items[0]).toMatchObject({
      captureRevision: 2,
      lead: {
        roleTitle: 'Principal Engineer',
        companyName: 'Northstar Labs',
      },
      processingSummary: 'awaiting_information',
    })
    const copied = await database.select({
      revision: captureEvidenceItems.captureRevision,
      index: captureEvidenceItems.evidenceIndex,
    }).from(captureEvidenceItems)
      .where(eq(captureEvidenceItems.captureId, capture.id))
    expect(copied).toEqual([
      { revision: 1, index: 0 },
      { revision: 1, index: 1 },
    ])
    const generations = await database.select({
      status: captureResolutionGenerations.status,
      revision: captureResolutionGenerations.captureRevision,
    }).from(captureResolutionGenerations)
    expect(generations).toEqual(expect.arrayContaining([
      { status: 'superseded', revision: 1 },
      { status: 'active', revision: 2 },
    ]))
    expect((await resolution.get(capture.id))).toMatchObject({
      rawEvidence: [],
      exactEvidenceReferences: [],
    })
  })

  it('checkpoints one revision at a time and resumes from the next revision', async () => {
    const { captures, database, materialization, resolution } = await setup()
    const capture = await accept(captures, input(null))
    for (let expectedRevision = 1; expectedRevision <= 2; expectedRevision += 1) {
      const corrected = await captures.correct({
        workspaceId: WORKSPACE,
        captureId: capture.id,
        expectedRevision,
        correction: { payload: { sequence: expectedRevision } },
        actor: { id: 'capture-test', type: 'user' },
      })
      expect(corrected).toMatchObject({
        ok: true,
        capture: { revision: expectedRevision + 1 },
      })
    }

    expect(await materialization.materializeNextRevision(
      WORKSPACE,
      capture.id,
    )).toBe(true)
    expect(await database.select({
      revision: captureEffectiveRevisionInputs.captureRevision,
    }).from(captureEffectiveRevisionInputs)).toEqual([{ revision: 1 }])

    const restarted = createCaptureMaterializationService(database, {
      now: monotonicClock(),
      pageSize: 1,
    })
    await restarted.migrateToReady(WORKSPACE)
    expect(await database.select({
      revision: captureEffectiveRevisionInputs.captureRevision,
    }).from(captureEffectiveRevisionInputs).orderBy(
      captureEffectiveRevisionInputs.captureRevision,
    )).toEqual([
      { revision: 1 },
      { revision: 2 },
      { revision: 3 },
    ])
    expect((await resolution.list({
      filter: 'all',
      sort: 'observed_desc',
    })).items[0]).toMatchObject({
      captureRevision: 3,
      readiness: 'ready',
    })
  })

  it('materializes existing Capture-to-Job lineage as a promoted generation', async () => {
    const { captures, database, materialization, resolution } = await setup()
    const capture = await accept(captures, input('existing-job'))
    const jobId = '01900000-0000-7000-8000-000000000001'
    const createdAt = new Date(CREATED_AT + 5000).toISOString()
    await database.insert(jobs).values({
      id: jobId,
      workspaceId: WORKSPACE,
      factsRevision: 1,
      factsJson: JSON.stringify({
        companyName: 'Northstar Labs',
        roleTitle: 'Staff Engineer',
        sourceName: 'Jobright',
        roleKind: 'new_grad',
        term: null,
        terms: [],
        timingMode: 'unknown',
        startDate: null,
        endDate: null,
        location: null,
        workMode: 'unknown',
        employmentType: 'full_time',
        seniority: 'entry',
        compensation: null,
        postedAt: null,
        destination: null,
      }),
      availabilityState: 'unknown',
      availabilityObservedAt: createdAt,
      availabilityRevision: 1,
      createdAt,
      updatedAt: createdAt,
    })
    await database.insert(jobCaptureEvidenceReferences).values({
      id: 'capture-resolution-existing-job-reference',
      jobId,
      captureId: capture.id,
      captureRevision: 1,
      evidenceIndexesJson: '[0,1]',
      createdAt,
    })

    await materialization.migrateToReady(WORKSPACE)
    const [generation] = await database.select({
      trigger: captureResolutionGenerations.trigger,
      status: captureResolutionGenerations.status,
      summary: captureResolutionGenerations.processingSummary,
    }).from(captureResolutionGenerations)
    expect(generation).toEqual({
      trigger: 'legacy_promotion',
      status: 'promoted',
      summary: 'promoted',
    })
    expect((await resolution.list({
      filter: 'all',
      sort: 'observed_desc',
    })).items[0]).toMatchObject({
      linkedJob: {
        jobId,
        roleTitle: 'Staff Engineer',
        companyName: 'Northstar Labs',
      },
      processingSummary: 'promoted',
      primaryIntent: { kind: 'view_job', jobId },
    })
  })

  it('keeps synthetic promoted coverage when the linked Job is tombstoned', async () => {
    const { captures, database, materialization } = await setup()
    const capture = await accept(captures, input('removed-job'))
    const jobId = '01900000-0000-7000-8000-000000000002'
    const createdAt = new Date(CREATED_AT + 5000).toISOString()
    await database.insert(jobs).values({
      id: jobId,
      workspaceId: WORKSPACE,
      factsRevision: 1,
      factsJson: JSON.stringify({
        companyName: 'Northstar Labs',
        roleTitle: 'Staff Engineer',
        sourceName: 'Jobright',
        roleKind: 'new_grad',
        term: null,
        terms: [],
        timingMode: 'unknown',
        startDate: null,
        endDate: null,
        location: null,
        workMode: 'unknown',
        employmentType: 'full_time',
        seniority: 'entry',
        compensation: null,
        postedAt: null,
        destination: null,
      }),
      availabilityState: 'unknown',
      availabilityObservedAt: createdAt,
      availabilityRevision: 1,
      createdAt,
      updatedAt: createdAt,
      removedAt: createdAt,
    })
    await database.insert(jobCaptureEvidenceReferences).values({
      id: 'capture-resolution-removed-job-reference',
      jobId,
      captureId: capture.id,
      captureRevision: 1,
      evidenceIndexesJson: '[0,1]',
      createdAt,
    })

    await materialization.migrateToReady(WORKSPACE)
    expect(await database.select({
      linkedJobId: captureResolutionGenerations.linkedJobId,
      status: captureResolutionGenerations.status,
      trigger: captureResolutionGenerations.trigger,
    }).from(captureResolutionGenerations)).toEqual([{
      linkedJobId: jobId,
      status: 'promoted',
      trigger: 'legacy_promotion',
    }])
  })

  it('records malformed history as a bounded attention item without inventing evidence', async () => {
    const { captures, database, materialization, resolution } = await setup()
    const capture = await accept(captures, input(null))
    await materialization.migrateToReady(WORKSPACE)
    await database.insert(captureRevisions).values({
      captureId: capture.id,
      revision: 2,
      kind: 'corrected',
      snapshotJson: 'not-json',
      auditJson: '{"actor":{"id":"capture-test","type":"user"}}',
      connectorInstanceId: null,
      connectorRunId: null,
      executionScopeId: null,
      reportedOriginJson: null,
      contentHash: null,
      payloadJson: null,
      createdAt: new Date(CREATED_AT + 5000).toISOString(),
    })
    await database.update(captureHeads).set({
      revision: 2,
      updatedAt: new Date(CREATED_AT + 5000).toISOString(),
    }).where(eq(captureHeads.id, capture.id))

    await materialization.ensureCapture(WORKSPACE, capture.id)
    const attention = await resolution.list({
      filter: 'needs_attention',
      sort: 'observed_desc',
    })
    expect(attention.items).toEqual([
      expect.objectContaining({
        captureId: capture.id,
        readiness: 'materialization_blocked',
        processingSummary: null,
        primaryIntent: { kind: 'correct_capture' },
      }),
    ])
    const [issue] = await database.select().from(captureMaterializationIssues)
    expect(issue).toMatchObject({
      captureRevision: 2,
      code: 'revision_materialization_failed',
      detailsJson: '{"captureRevision":2}',
      resolvedAt: null,
    })
    expect(await database.select({ value: count() }).from(captureEvidenceItems))
      .toEqual([{ value: 2 }])
    expect(await database.select({
      status: captureResolutionGenerations.status,
    }).from(captureResolutionGenerations)).toEqual([{ status: 'superseded' }])
    await expect(resolution.get(capture.id)).rejects.toMatchObject({
      statusCode: 409,
    })

    const corrected = await captures.correct({
      workspaceId: WORKSPACE,
      captureId: capture.id,
      expectedRevision: 2,
      correction: {
        evidenceMode: 'reported',
        adapter: { id: 'manual.capture', kind: 'manual', version: '1.0.0' },
        observedAt: '2026-07-22T12:00:00.000Z',
        providerRecordId: null,
        providerSchema: null,
        payload: { corrected: true },
        evidence: [
          { kind: 'title', label: 'Role title', value: 'Principal Engineer' },
          { kind: 'company', label: 'Company', value: { name: 'Northstar Labs' } },
        ],
      },
      actor: { id: 'capture-test', type: 'user' },
    })
    expect(corrected).toMatchObject({ ok: true, capture: { revision: 3 } })
    await materialization.ensureCapture(WORKSPACE, capture.id)
    expect((await resolution.list({
      filter: 'needs_attention',
      sort: 'observed_desc',
    })).items).toEqual([
      expect.objectContaining({
        captureRevision: 3,
        readiness: 'ready',
        processingSummary: 'awaiting_information',
      }),
    ])
    expect((await resolution.get(capture.id)).jobDefaults).toMatchObject({
      roleTitle: 'Principal Engineer',
      companyName: 'Northstar Labs',
    })
    expect(await database.select({
      resolvedAt: captureMaterializationIssues.resolvedAt,
    }).from(captureMaterializationIssues)).toEqual([
      { resolvedAt: expect.any(String) },
    ])
  })

  it.each(['payload', 'evidence'])(
    'blocks malformed %s JSON instead of coercing it to null',
    async (kind) => {
      const { captures, database, materialization, resolution } = await setup()
      const capture = await accept(captures, input(null))
      const createdAt = new Date(CREATED_AT + 5000).toISOString()
      await database.insert(captureRevisions).values({
        captureId: capture.id,
        revision: 2,
        kind: 'corrected',
        snapshotJson: JSON.stringify({
          evidenceMode: 'reported',
          adapterId: 'manual.capture',
          adapterKind: 'manual',
          adapterVersion: '1.0.0',
          providerRecordId: null,
          providerSchema: null,
          observedAt: '2026-07-22T12:00:00.000Z',
          revision: 2,
        }),
        auditJson: '{"actor":{"id":"capture-test","type":"user"}}',
        connectorInstanceId: null,
        connectorRunId: null,
        executionScopeId: null,
        reportedOriginJson: null,
        contentHash: null,
        payloadJson: kind === 'payload' ? 'not-json' : '{}',
        createdAt,
      })
      if (kind === 'evidence') {
        await database.insert(captureEvidenceItems).values({
          id: 'malformed-evidence',
          captureId: capture.id,
          captureRevision: 2,
          evidenceIndex: 0,
          kind: 'title',
          label: 'Role title',
          valueJson: 'not-json',
          createdAt,
        })
      }
      await database.update(captureHeads).set({
        revision: 2,
        updatedAt: createdAt,
      }).where(eq(captureHeads.id, capture.id))

      await materialization.migrateToReady(WORKSPACE)

      expect((await resolution.list({
        filter: 'needs_attention',
        sort: 'observed_desc',
      })).items).toEqual([
        expect.objectContaining({
          captureId: capture.id,
          readiness: 'materialization_blocked',
        }),
      ])
      expect(await database.select({ value: count() }).from(
        captureEffectiveRevisionInputs,
      )).toEqual([{ value: 1 }])
    },
  )

  it('uses opaque bidirectional keysets and keeps removed rows out of All', async () => {
    const { captures, database, materialization, resolution } = await setup()
    const older = await accept(captures, input(null, {
      provenance: {
        ...input(null).provenance,
        observedAt: '2026-07-21T12:00:00.000Z',
      },
    }))
    const newer = await accept(captures, input(null, {
      provenance: {
        ...input(null).provenance,
        observedAt: '2026-07-23T12:00:00.000Z',
      },
    }))
    await materialization.migrateToReady(WORKSPACE)

    const first = await resolution.list({
      filter: 'all',
      sort: 'observed_desc',
      limit: 1,
    })
    expect(first.items[0]?.captureId).toBe(newer.id)
    expect(first.pageInfo).toMatchObject({
      hasPreviousPage: false,
      hasNextPage: true,
    })
    const second = await resolution.list({
      filter: 'all',
      sort: 'observed_desc',
      limit: 1,
      after: first.pageInfo.endCursor!,
    })
    expect(second.items[0]?.captureId).toBe(older.id)
    const previous = await resolution.list({
      filter: 'all',
      sort: 'observed_desc',
      limit: 1,
      before: second.pageInfo.startCursor!,
    })
    expect(previous.items[0]?.captureId).toBe(newer.id)

    await captures.remove({
      workspaceId: WORKSPACE,
      captureId: older.id,
      expectedRevision: 1,
      actor: { id: 'capture-test', type: 'user' },
    })
    await materialization.ensureCapture(WORKSPACE, older.id)
    expect(await database.select({
      status: captureResolutionGenerations.status,
    }).from(captureResolutionGenerations).where(
      eq(captureResolutionGenerations.captureId, older.id),
    )).toEqual([{ status: 'cancelled' }])
    expect((await resolution.list({
      filter: 'all',
      sort: 'observed_desc',
    })).items.map((row) => row.captureId)).toEqual([newer.id])
    expect((await resolution.list({
      filter: 'removed',
      sort: 'observed_desc',
    })).items).toEqual([
      expect.objectContaining({ captureId: older.id, readiness: 'removed' }),
    ])
  })
})
