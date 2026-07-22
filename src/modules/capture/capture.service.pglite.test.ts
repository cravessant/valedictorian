/**
 * Capture module contract — red-first proofs through the PUBLIC commands/queries
 * (issue #299, slice 1). Exercises the canonical `captures` /
 * `capture_revisions` / `capture_evidence_items` tables on a migrated PGlite
 * owner. Covers cross-workspace isolation, concurrency, idempotent repeated
 * intake, correction history, removal/restore, tombstone-surviving re-intake,
 * immutable evidence mode, and input validation.
 */
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { useResettablePgliteTestOwner } from '../../test/pglite-test-owner'
import { workspaces } from '../../db/workspaces.schema'
import { captures } from './capture.schema'
import {
  createPgliteCaptureService,
  type AcceptCaptureInput,
  type CaptureProvenance,
  type CaptureService,
} from './capture.service'

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
  return { database, service }
}

const connectorProvenance: CaptureProvenance = {
  adapterId: 'jobright.resolver',
  adapterKind: 'connector',
  adapterVersion: '0.16.0',
  providerRecordId: 'provider-record-1',
  providerSchema: 'jobright.v1',
  observedAt: '2026-07-19T10:00:00.000Z',
}

function acceptInput(overrides: Partial<AcceptCaptureInput> = {}): AcceptCaptureInput {
  return {
    workspaceId: 'ws-a',
    provenance: connectorProvenance,
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

async function countCaptures(database: Awaited<ReturnType<typeof setup>>['database'], workspaceId: string) {
  const rows = await database.select().from(captures).where(eq(captures.workspaceId, workspaceId))
  return rows.length
}

describe.sequential('Capture module contract (#299)', () => {
  it('accepts a durable capture with a created revision, observed evidence, and stored mode', async () => {
    const { service } = await setup()

    const result = await accept(service)
    expect(result.created).toBe(true)
    expect(result.capture.revision).toBe(1)
    expect(result.capture.evidenceMode).toBe('reported')
    expect(result.capture.removedAt).toBeNull()
    expect(result.capture.provenance.adapterKind).toBe('connector')

    const fetched = await service.get('ws-a', result.capture.id)
    expect(fetched?.id).toBe(result.capture.id)

    const history = await service.history('ws-a', result.capture.id)
    expect(history.map((entry) => entry.kind)).toEqual(['created'])
    expect(history[0]?.actor.type).toBe('system')

    const evidence = await service.evidence('ws-a', result.capture.id)
    expect(evidence?.evidenceMode).toBe('reported')
    expect(evidence?.items.map((item) => item.kind)).toEqual(['title', 'company'])
    expect(evidence?.items[1]?.value).toEqual({ name: 'Acme' })
  })

  it('differs by provenance only: connector, cli, manual, import all create through one contract', async () => {
    const { service } = await setup()
    for (const adapterKind of ['connector', 'cli', 'manual', 'import'] as const) {
      const result = await accept(service, {
        provenance: { ...connectorProvenance, adapterKind, providerRecordId: `record-${adapterKind}` },
        actor: adapterKind === 'manual' ? { type: 'user', id: 'user-1' } : { type: 'system' },
      })
      expect(result.capture.provenance.adapterKind).toBe(adapterKind)
    }
  })

  it('resolves provenance identity to one capture id forever (idempotent repeated intake)', async () => {
    const { database, service } = await setup()

    const first = await accept(service)
    const second = await accept(service)

    expect(second.created).toBe(false)
    expect(second.capture.id).toBe(first.capture.id)
    expect(second.capture.revision).toBe(2)
    expect(await countCaptures(database, 'ws-a')).toBe(1)

    // The re-observation appends a revision and an evidence occurrence.
    const history = await service.history('ws-a', first.capture.id)
    expect(history.map((entry) => entry.revision)).toEqual([1, 2])
    const evidence = await service.evidence('ws-a', first.capture.id)
    expect(evidence?.items.map((item) => item.revision)).toEqual([1, 1, 2, 2])
  })

  it('never collides manual captures that carry a null provider record id', async () => {
    const { database, service } = await setup()
    const manual = { ...connectorProvenance, adapterKind: 'manual' as const, providerRecordId: null }

    const a = await accept(service, { provenance: manual, actor: { type: 'user', id: 'u' } })
    const b = await accept(service, { provenance: manual, actor: { type: 'user', id: 'u' } })

    expect(a.capture.id).not.toBe(b.capture.id)
    expect(a.created).toBe(true)
    expect(b.created).toBe(true)
    expect(await countCaptures(database, 'ws-a')).toBe(2)
  })

  it('holds evidence mode immutable: a re-intake declaring a different mode is rejected', async () => {
    const { service } = await setup()
    const created = await accept(service, { evidenceMode: 'reported' })

    const conflict = await service.accept(acceptInput({ evidenceMode: 'ats_details_provided' }))
    expect(conflict).toMatchObject({ ok: false, code: 'evidence_mode_conflict' })

    const unchanged = await service.get('ws-a', created.capture.id)
    expect(unchanged?.evidenceMode).toBe('reported')
    expect(unchanged?.revision).toBe(1)
  })

  it('appends user-attributed corrections without rewriting observed evidence', async () => {
    const { service } = await setup()
    const created = await accept(service)

    const corrected = await service.correct({
      workspaceId: 'ws-a',
      captureId: created.capture.id,
      correction: { title: 'Staff Software Engineer' },
      actor: { type: 'user', id: 'user-9' },
    })
    expect(corrected.ok).toBe(true)
    if (!corrected.ok) return
    expect(corrected.capture.revision).toBe(2)

    const history = await service.history('ws-a', created.capture.id)
    expect(history.map((entry) => entry.kind)).toEqual(['created', 'corrected'])
    expect(history[1]?.actor).toEqual({ type: 'user', id: 'user-9' })

    // Observed evidence is untouched by the correction (still only the intake items).
    const evidence = await service.evidence('ws-a', created.capture.id)
    expect(evidence?.items.map((item) => item.revision)).toEqual([1, 1])
  })

  it('tombstones on removal and restores deterministically, both idempotent', async () => {
    const { service } = await setup()
    const created = await accept(service)
    const actor = { type: 'user', id: 'user-1' } as const

    const removed = await service.remove({ workspaceId: 'ws-a', captureId: created.capture.id, actor })
    expect(removed.ok).toBe(true)
    if (!removed.ok) return
    expect(removed.capture.removedAt).not.toBeNull()

    // Double remove is an idempotent no-op (no new revision).
    const removedAgain = await service.remove({ workspaceId: 'ws-a', captureId: created.capture.id, actor })
    expect(removedAgain.ok).toBe(true)

    const restored = await service.restore({ workspaceId: 'ws-a', captureId: created.capture.id, actor })
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect(restored.capture.removedAt).toBeNull()

    const history = await service.history('ws-a', created.capture.id)
    expect(history.map((entry) => entry.kind)).toEqual(['created', 'removed', 'restored'])

    // Restore of an already-active capture is an idempotent no-op.
    const restoredAgain = await service.restore({ workspaceId: 'ws-a', captureId: created.capture.id, actor })
    expect(restoredAgain.ok).toBe(true)
    const historyAfter = await service.history('ws-a', created.capture.id)
    expect(historyAfter).toHaveLength(3)
  })

  it('keeps the user tombstone when an adapter re-observes a removed capture', async () => {
    const { service } = await setup()
    const created = await accept(service)
    await service.remove({ workspaceId: 'ws-a', captureId: created.capture.id, actor: { type: 'user', id: 'u' } })

    const reintake = await accept(service)
    expect(reintake.capture.id).toBe(created.capture.id)

    // Re-observation appends occurrences/revisions but does NOT clear the tombstone.
    const after = await service.get('ws-a', created.capture.id)
    expect(after?.removedAt).not.toBeNull()

    const history = await service.history('ws-a', created.capture.id)
    expect(history.map((entry) => entry.kind)).toEqual(['created', 'removed', 'corrected'])
  })

  it('isolates captures across workspaces for every command and query', async () => {
    const { service } = await setup()
    const created = await accept(service, { workspaceId: 'ws-a' })
    const actor = { type: 'user', id: 'u' } as const

    expect(await service.get('ws-b', created.capture.id)).toBeNull()
    expect(await service.evidence('ws-b', created.capture.id)).toBeNull()
    expect(await service.history('ws-b', created.capture.id)).toEqual([])
    expect(
      await service.getByProvenance(
        'ws-b',
        connectorProvenance.adapterId,
        connectorProvenance.providerSchema ?? null,
        connectorProvenance.providerRecordId as string,
      ),
    ).toBeNull()

    expect(await service.correct({ workspaceId: 'ws-b', captureId: created.capture.id, correction: {}, actor }))
      .toMatchObject({ ok: false, code: 'not_found' })
    expect(await service.remove({ workspaceId: 'ws-b', captureId: created.capture.id, actor }))
      .toMatchObject({ ok: false, code: 'not_found' })
    expect(await service.restore({ workspaceId: 'ws-b', captureId: created.capture.id, actor }))
      .toMatchObject({ ok: false, code: 'not_found' })

    // The same provenance identity in another workspace is a distinct capture.
    const other = await accept(service, { workspaceId: 'ws-b' })
    expect(other.capture.id).not.toBe(created.capture.id)
  })

  it('converges concurrent intake of one provenance identity to a single capture', async () => {
    const { database, service } = await setup()
    const results = await Promise.allSettled([accept(service), accept(service), accept(service)])
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true)
    expect(await countCaptures(database, 'ws-a')).toBe(1)
  })

  it('surfaces a revision conflict when two corrections race the same base revision', async () => {
    const { service } = await setup()
    const created = await accept(service)
    const base = created.capture.revision
    const actor = { type: 'user', id: 'u' } as const

    const [a, b] = await Promise.all([
      service.correct({ workspaceId: 'ws-a', captureId: created.capture.id, correction: { a: 1 }, actor, expectedRevision: base }),
      service.correct({ workspaceId: 'ws-a', captureId: created.capture.id, correction: { b: 2 }, actor, expectedRevision: base }),
    ])
    const oks = [a, b].filter((r) => r.ok).length
    const conflicts = [a, b].filter((r) => !r.ok && r.code === 'revision_conflict').length
    expect(oks).toBe(1)
    expect(conflicts).toBe(1)
  })

  it('rejects an expected-revision mismatch on correction', async () => {
    const { service } = await setup()
    const created = await accept(service)
    const stale = await service.correct({
      workspaceId: 'ws-a',
      captureId: created.capture.id,
      correction: {},
      actor: { type: 'user', id: 'u' },
      expectedRevision: 99,
    })
    expect(stale).toMatchObject({ ok: false, code: 'revision_conflict' })
  })

  it('rejects invalid input, oversized payloads, and forbidden sensitive keys', async () => {
    const { service } = await setup()

    expect(await service.accept(acceptInput({ evidenceMode: 'nope' as never })))
      .toMatchObject({ ok: false, code: 'invalid_input' })

    expect(await service.accept(acceptInput({ payload: { blob: 'x'.repeat(300_000) } })))
      .toMatchObject({ ok: false, code: 'bounded_data_violation' })

    expect(
      await service.accept(
        acceptInput({ evidence: [{ kind: 'auth', label: 'creds', value: { authorization: 'Bearer abc' } }] }),
      ),
    ).toMatchObject({ ok: false, code: 'security_violation' })
  })

  it('returns a typed failure for a crafted actor id instead of a raw DB error', async () => {
    const { service } = await setup()
    // A crafted actor.id smuggles a forbidden JSON key into the audit payload,
    // which carries a CHECK constraint. It must be caught up front as a typed
    // failure across every mutating command, never a raw DB error mid-transaction.
    const maliciousActor = { type: 'user' as const, id: 'x","password":"leaked' }

    expect(await service.accept(acceptInput({ actor: maliciousActor })))
      .toMatchObject({ ok: false, code: 'security_violation' })

    const created = await accept(service)
    expect(await service.correct({ workspaceId: 'ws-a', captureId: created.capture.id, correction: {}, actor: maliciousActor }))
      .toMatchObject({ ok: false, code: 'security_violation' })
    expect(await service.remove({ workspaceId: 'ws-a', captureId: created.capture.id, actor: maliciousActor }))
      .toMatchObject({ ok: false, code: 'security_violation' })
    expect(await service.restore({ workspaceId: 'ws-a', captureId: created.capture.id, actor: maliciousActor }))
      .toMatchObject({ ok: false, code: 'security_violation' })
  })

  it('keeps captures distinct when the same provider record is re-observed under a bumped provider schema', async () => {
    const { database, service } = await setup()
    const v1 = await accept(service, { provenance: { ...connectorProvenance, providerSchema: 'jobright.v1' } })
    const v2 = await accept(service, { provenance: { ...connectorProvenance, providerSchema: 'jobright.v2' } })

    expect(v1.capture.id).not.toBe(v2.capture.id)
    expect(v1.created && v2.created).toBe(true)
    expect(await countCaptures(database, 'ws-a')).toBe(2)

    // Provenance resolution is keyed on provider_schema, matching the widened 0002 index.
    const resolved = await service.getByProvenance(
      'ws-a',
      connectorProvenance.adapterId,
      'jobright.v1',
      connectorProvenance.providerRecordId as string,
    )
    expect(resolved?.id).toBe(v1.capture.id)
  })

  it('shares one implementation between the standalone accept and the composable acceptOn (#300 tx-composability)', async () => {
    const { database, service } = await setup()

    // Standalone path: create then idempotent re-accept.
    const s1 = await service.accept(acceptInput({ provenance: { ...connectorProvenance, providerRecordId: 'standalone-rec' } }))
    const s2 = await service.accept(acceptInput({ provenance: { ...connectorProvenance, providerRecordId: 'standalone-rec' } }))
    expect(s1.ok && s2.ok).toBe(true)
    if (!s1.ok || !s2.ok) return

    // Composable path (in a caller's transaction): same idempotency + result shape.
    const composed = { ...connectorProvenance, providerRecordId: 'composed-rec' }
    const c1 = await database.transaction((tx) => service.acceptOn(tx, acceptInput({ provenance: composed })))
    const c2 = await database.transaction((tx) => service.acceptOn(tx, acceptInput({ provenance: composed })))
    expect(c1.ok && c2.ok).toBe(true)
    if (!c1.ok || !c2.ok) return

    expect({ created: s2.created, sameId: s2.capture.id === s1.capture.id })
      .toEqual({ created: c2.created, sameId: c2.capture.id === c1.capture.id })
    expect(c2.created).toBe(false)
    expect(c2.capture.id).toBe(c1.capture.id)

    // Validation + evidence-mode immutability are identical on both paths.
    expect(await service.accept(acceptInput({ evidenceMode: 'nope' as never })))
      .toEqual(await database.transaction((tx) => service.acceptOn(tx, acceptInput({ evidenceMode: 'nope' as never }))))
    expect(await service.accept(acceptInput({ provenance: composed, evidenceMode: 'ats_details_provided' })))
      .toEqual(await database.transaction((tx) => service.acceptOn(tx, acceptInput({ provenance: composed, evidenceMode: 'ats_details_provided' }))))
  })
})
