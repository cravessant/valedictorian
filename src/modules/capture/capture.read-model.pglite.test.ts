/**
 * Capture read-model proofs (issue #304, stage 3) on a migrated PGlite owner.
 *
 * Drives the real Capture service to write canonical rows, then reads them back
 * through the read-model, proving the flattened `Capture` resource (adapter,
 * observedAt/receivedAt, payload, cumulative evidence, tombstone state) and the
 * `CaptureListResult` page: workspace isolation, evidenceMode/adapter filters,
 * includeRemoved gating, and keyset pagination that walks every row exactly once.
 */
import { describe, expect, it } from 'vitest'
import { captureHistoryResultSchema, captureListResultSchema, captureSchema } from '@sparxie/sdk'
import { useResettablePgliteTestOwner } from '../../test/pglite-test-owner'
import { workspaces } from '../../db/workspaces.schema'
import {
  createPgliteCaptureService,
  type AcceptCaptureInput,
  type CaptureService,
} from './capture.service'
import { createPgliteCaptureReadModel } from './capture.read-model'

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
  const service = createPgliteCaptureService(database, { now: monotonicClock() })
  const readModel = createPgliteCaptureReadModel(database)
  return { database, service, readModel }
}

function acceptInput(overrides: Partial<AcceptCaptureInput> = {}): AcceptCaptureInput {
  return {
    workspaceId: 'ws-a',
    provenance: {
      adapterId: 'jobright.resolver',
      adapterKind: 'connector',
      adapterVersion: '0.16.0',
      providerRecordId: 'provider-record-1',
      providerSchema: 'jobright.v1',
      observedAt: '2026-07-19T10:00:00.000Z',
    },
    evidenceMode: 'reported',
    evidence: [
      { kind: 'title', label: 'Job title', value: 'Staff Engineer' },
      { kind: 'company', label: 'Company', value: { name: 'Acme' } },
    ],
    payload: { source: 'feed' },
    actor: { type: 'system' },
    ...overrides,
  }
}

async function accept(service: CaptureService, overrides: Partial<AcceptCaptureInput> = {}) {
  const result = await service.accept(acceptInput(overrides))
  if (!result.ok) throw new Error(`accept failed: ${result.code} ${result.message}`)
  return result
}

describe.sequential('Capture read-model (#304)', () => {
  it('reads a created capture back as a flattened, schema-valid resource', async () => {
    const { service, readModel } = await setup()
    const created = await accept(service)

    const dto = await readModel.getCapture('ws-a', created.capture.id)
    expect(dto).not.toBeNull()
    expect(() => captureSchema.parse(dto)).not.toThrow()
    expect(dto).toMatchObject({
      id: created.capture.id,
      workspaceId: 'ws-a',
      evidenceMode: 'reported',
      adapter: { id: 'jobright.resolver', kind: 'connector', version: '0.16.0' },
      observedAt: '2026-07-19T10:00:00.000Z',
      providerRecordId: 'provider-record-1',
      providerSchema: 'jobright.v1',
      payload: { source: 'feed' },
      revision: 1,
      removedAt: null,
    })
    expect(dto?.receivedAt).toBe(dto?.createdAt)
    expect(dto?.evidence).toEqual([
      { kind: 'title', label: 'Job title', value: 'Staff Engineer' },
      { kind: 'company', label: 'Company', value: { name: 'Acme' } },
    ])
  })

  it('reflects tombstone state and never resolves across workspaces', async () => {
    const { service, readModel } = await setup()
    const created = await accept(service)
    await service.remove({ workspaceId: 'ws-a', captureId: created.capture.id, actor: { type: 'user', id: 'u1' } })

    const removed = await readModel.getCapture('ws-a', created.capture.id)
    expect(removed?.removedAt).not.toBeNull()
    // Cross-workspace isolation: the same id under another workspace is absent.
    expect(await readModel.getCapture('ws-b', created.capture.id)).toBeNull()
  })

  it('lists captures with evidenceMode/adapter filters and includeRemoved gating', async () => {
    const { service, readModel } = await setup()
    const reported = await accept(service, {
      provenance: { ...acceptInput().provenance, providerRecordId: 'r-1' },
    })
    const otherMode = await accept(service, {
      evidenceMode: 'ats_details_provided',
      provenance: { ...acceptInput().provenance, adapterId: 'other.adapter', providerRecordId: 'r-2' },
    })
    const removed = await accept(service, {
      provenance: { ...acceptInput().provenance, providerRecordId: 'r-3' },
    })
    await service.remove({ workspaceId: 'ws-a', captureId: removed.capture.id, actor: { type: 'user', id: 'u1' } })

    // Default list: every ACTIVE capture in the workspace, no mode filter applied.
    const active = await readModel.listCaptures('ws-a')
    expect(() => captureListResultSchema.parse(active)).not.toThrow()
    expect(active.items.map((item) => item.id).sort()).toEqual(
      [reported.capture.id, otherMode.capture.id].sort(),
    )
    // The tombstoned capture is excluded from the default active view.
    expect(active.items.some((item) => item.id === removed.capture.id)).toBe(false)

    const byMode = await readModel.listCaptures('ws-a', { evidenceMode: 'ats_details_provided' })
    expect(byMode.items.map((item) => item.adapter.id)).toEqual(['other.adapter'])

    const withRemoved = await readModel.listCaptures('ws-a', { includeRemoved: true })
    expect(withRemoved.items.some((item) => item.id === removed.capture.id)).toBe(true)
  })

  it('reconstructs the create->correct->remove->restore history as schema-valid snapshots', async () => {
    const { service, readModel } = await setup()
    const created = await accept(service)
    const captureId = created.capture.id
    const actor = { type: 'user' as const, id: 'u-1' }
    await service.correct({ workspaceId: 'ws-a', captureId, correction: { note: 'fix' }, actor })
    await service.remove({ workspaceId: 'ws-a', captureId, actor })
    await service.restore({ workspaceId: 'ws-a', captureId, actor })

    const history = await readModel.historyCaptures('ws-a', { id: captureId })
    expect(() => captureHistoryResultSchema.parse(history)).not.toThrow()
    expect(history.items.map((item) => item.kind)).toEqual(['created', 'corrected', 'removed', 'restored'])
    expect(history.items[2]!.snapshot.removedAt).not.toBeNull()
    expect(history.items[3]!.snapshot.removedAt).toBeNull()
    // Every snapshot carries the capture identity the client's protocol guard checks.
    for (const item of history.items) {
      expect(item.snapshot.id).toBe(captureId)
      expect(item.snapshot.workspaceId).toBe('ws-a')
    }

    // Missing capture yields an empty page, never a throw.
    const empty = await readModel.historyCaptures('ws-a', { id: 'nope' })
    expect(empty.items).toEqual([])
  })

  it('filters by any connector run occurrence and returns lossless revision provenance', async () => {
    const { service, readModel } = await setup()
    const connectorProvenance = {
      connectorInstanceId: 'jobright/session one',
      connectorRunId: 'run/one',
      executionScopeId: 'scope.run-one',
      reportedOrigin: {
        kind: 'job_board' as const,
        name: '  Jobright  ',
        providerId: '',
        url: 'jobright-internal://record/1',
      },
    }
    const created = await accept(service, {
      provenance: { ...acceptInput().provenance, adapterVersion: '0.17.0' },
      connectorProvenance,
    })
    await accept(service, {
      provenance: { ...acceptInput().provenance, adapterVersion: '0.17.0' },
      connectorProvenance: {
        ...connectorProvenance,
        connectorRunId: 'run/two',
        executionScopeId: 'scope.run-two',
        reportedOrigin: null,
      },
    })
    await service.correct({
      workspaceId: 'ws-a',
      captureId: created.capture.id,
      correction: { note: 'user correction' },
      actor: { type: 'user', id: 'u-1' },
    })
    await accept(service, {
      workspaceId: 'ws-b',
      provenance: { ...acceptInput().provenance, providerRecordId: 'workspace-b-record' },
      connectorProvenance,
    })

    const firstRun = await readModel.listCaptures('ws-a', { connectorRunId: 'run/one' })
    expect(firstRun.items.map((item) => item.id)).toEqual([created.capture.id])
    const secondRun = await readModel.listCaptures('ws-a', { connectorRunId: 'run/two' })
    expect(secondRun.items.map((item) => item.id)).toEqual([created.capture.id])
    expect(await readModel.listCaptures('ws-a', { connectorRunId: 'missing' })).toMatchObject({ items: [] })

    const history = await readModel.historyCaptures('ws-a', { id: created.capture.id })
    expect(() => captureHistoryResultSchema.parse(history)).not.toThrow()
    expect(history.items[0]?.connectorProvenance).toEqual(connectorProvenance)
    expect(history.items[1]?.connectorProvenance).toMatchObject({
      connectorRunId: 'run/two',
      reportedOrigin: null,
    })
    expect(history.items[2]?.connectorProvenance).toBeUndefined()
  })

  it('paginates the full result set exactly once via the keyset cursor', async () => {
    const { service, readModel } = await setup()
    const ids: string[] = []
    for (let index = 0; index < 5; index += 1) {
      const created = await accept(service, {
        evidenceMode: 'ats_details_provided',
        evidence: [],
        provenance: { ...acceptInput().provenance, adapterId: 'paged.adapter', providerRecordId: `p-${index}` },
      })
      ids.push(created.capture.id)
    }

    const seen: string[] = []
    let cursor: string | undefined
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await readModel.listCaptures('ws-a', { adapterId: 'paged.adapter', limit: 2, cursor })
      seen.push(...page.items.map((item) => item.id))
      if (!page.nextCursor) break
      cursor = page.nextCursor
    }
    expect(seen.sort()).toEqual([...ids].sort())
    expect(new Set(seen).size).toBe(seen.length)
  })
})
