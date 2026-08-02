/**
 * Provenance parity contract (issue #299, slice 4) — AC1.
 *
 * User, connector, CLI, and import creation flow through ONE Capture contract and
 * differ ONLY by typed provenance (`adapterKind`) and declared capability
 * (`evidenceMode`), never by downstream control. These red-first proofs pin that
 * the full public surface (accept / correct / remove / restore / history /
 * evidence) behaves identically for manual and import provenance as for
 * connector/cli, that evidence-mode rules hold for user-supplied evidence, and
 * that null-provider_record_id manual captures never collide.
 *
 * Contract-level only: actual CLI command parity is #306, and the renderer
 * creation UI is #305 — neither lands here.
 */
import { describe, expect, it } from 'vitest'
import { useResettablePgliteTestOwner } from '../../test/pglite-test-owner'
import { workspaces } from '@sparxie/valedictorian-local-runtime/testing/db/workspaces.schema'
import {
  createPgliteCaptureService,
  type CaptureAdapterKind,
  type CaptureProvenance,
} from '@sparxie/valedictorian-local-runtime/testing/modules/capture/capture.service'

const resettableOwner = useResettablePgliteTestOwner()

function monotonicClock(startMs = Date.UTC(2026, 6, 20, 0, 0, 0)) {
  let tick = 0
  return () => new Date(startMs + tick++ * 1000)
}

async function setup() {
  const { database } = resettableOwner()
  await database
    .insert(workspaces)
    .values({ id: 'ws-a', name: 'ws-a', createdAt: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z' })
  return createPgliteCaptureService(database, { now: monotonicClock() })
}

function provenanceFor(adapterKind: CaptureAdapterKind, providerRecordId: string | null): CaptureProvenance {
  return {
    adapterId: adapterKind === 'manual' ? 'manual' : `adapter-${adapterKind}`,
    adapterKind,
    adapterVersion: '1.0.0',
    providerRecordId,
    providerSchema: adapterKind === 'manual' ? null : `${adapterKind}.v1`,
    observedAt: '2026-07-19T10:00:00.000Z',
  }
}

const USER = { type: 'user', id: 'user-1' } as const

describe.sequential('Capture provenance parity (#299 AC1)', () => {
  // Manual/import carry the same downstream control as connector/cli: the whole
  // lifecycle runs identically regardless of the typed provenance kind.
  for (const adapterKind of ['connector', 'cli', 'manual', 'import'] as const) {
    it(`runs the full accept→correct→remove→restore lifecycle for ${adapterKind} provenance`, async () => {
      const service = await setup()
      const providerRecordId = adapterKind === 'manual' ? null : `record-${adapterKind}`

      const created = await service.accept({
        workspaceId: 'ws-a',
        provenance: provenanceFor(adapterKind, providerRecordId),
        evidenceMode: 'reported',
        evidence: [{ kind: 'title', label: 'Job title', value: 'Staff Engineer' }],
        actor: adapterKind === 'manual' ? USER : { type: 'system' },
      })
      expect(created.ok).toBe(true)
      if (!created.ok) return
      expect(created.capture.provenance.adapterKind).toBe(adapterKind)

      const corrected = await service.correct({
        workspaceId: 'ws-a',
        captureId: created.capture.id,
        correction: { title: 'Staff Software Engineer' },
        actor: USER,
      })
      expect(corrected.ok).toBe(true)

      const removed = await service.remove({ workspaceId: 'ws-a', captureId: created.capture.id, actor: USER })
      expect(removed.ok && removed.capture.removedAt).not.toBeNull()

      const restored = await service.restore({ workspaceId: 'ws-a', captureId: created.capture.id, actor: USER })
      expect(restored.ok && restored.capture.removedAt).toBeNull()

      // Identical history shape and retrievable observed evidence for every kind.
      const history = await service.history('ws-a', created.capture.id)
      expect(history.map((entry) => entry.kind)).toEqual(['created', 'corrected', 'removed', 'restored'])
      const evidence = await service.evidence('ws-a', created.capture.id)
      expect(evidence?.items).toHaveLength(1)
    })
  }

  it('creates a distinct, independently-controllable capture for every null-provider manual create', async () => {
    const service = await setup()
    const manual = provenanceFor('manual', null)

    const first = await service.accept({
      workspaceId: 'ws-a', provenance: manual, evidenceMode: 'reported',
      evidence: [{ kind: 'note', label: 'Note', value: 'first' }], actor: USER,
    })
    const second = await service.accept({
      workspaceId: 'ws-a', provenance: manual, evidenceMode: 'reported',
      evidence: [{ kind: 'note', label: 'Note', value: 'second' }], actor: USER,
    })
    const third = await service.accept({
      workspaceId: 'ws-a', provenance: manual, evidenceMode: 'reported',
      evidence: [{ kind: 'note', label: 'Note', value: 'third' }], actor: USER,
    })
    expect(first.ok && second.ok && third.ok).toBe(true)
    if (!first.ok || !second.ok || !third.ok) return

    const ids = new Set([first.capture.id, second.capture.id, third.capture.id])
    expect(ids.size).toBe(3)
    expect([first, second, third].every((result) => result.created)).toBe(true)

    // Each manual capture is its own aggregate: correcting one does not touch another.
    await service.correct({ workspaceId: 'ws-a', captureId: first.capture.id, correction: { edited: true }, actor: USER })
    expect((await service.history('ws-a', first.capture.id)).map((entry) => entry.kind)).toEqual(['created', 'corrected'])
    expect((await service.history('ws-a', second.capture.id)).map((entry) => entry.kind)).toEqual(['created'])
  })

  it('deduplicates import re-intake by provider record id to a single capture', async () => {
    const service = await setup()
    const importProvenance = provenanceFor('import', 'import-record-1')

    const first = await service.accept({
      workspaceId: 'ws-a', provenance: importProvenance, evidenceMode: 'reported',
      evidence: [{ kind: 'row', label: 'Imported row', value: { n: 1 } }], actor: { type: 'system' },
    })
    const second = await service.accept({
      workspaceId: 'ws-a', provenance: importProvenance, evidenceMode: 'reported',
      evidence: [{ kind: 'row', label: 'Imported row', value: { n: 1 } }], actor: { type: 'system' },
    })
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(second.created).toBe(false)
    expect(second.capture.id).toBe(first.capture.id)
    expect(second.capture.revision).toBe(2)
  })

  it('holds evidence-mode rules for user-supplied and imported evidence', async () => {
    const service = await setup()

    // A manual capture accepts either declared capability and keeps it immutable
    // across user corrections; user-supplied evidence is retrievable under it.
    const manualAts = await service.accept({
      workspaceId: 'ws-a', provenance: provenanceFor('manual', null), evidenceMode: 'ats_details_provided',
      evidence: [{ kind: 'ats_field', label: 'ATS detail', value: { salary: '100k' } }], actor: USER,
    })
    expect(manualAts.ok).toBe(true)
    if (!manualAts.ok) return
    await service.correct({ workspaceId: 'ws-a', captureId: manualAts.capture.id, correction: { note: 'x' }, actor: USER })
    const afterCorrect = await service.get('ws-a', manualAts.capture.id)
    expect(afterCorrect?.evidenceMode).toBe('ats_details_provided')
    const evidence = await service.evidence('ws-a', manualAts.capture.id)
    expect(evidence?.evidenceMode).toBe('ats_details_provided')
    expect(evidence?.items[0]?.value).toEqual({ salary: '100k' })

    // An import re-intake that declares a different mode is rejected — evidence
    // mode is immutable per capture regardless of provenance kind.
    const imported = await service.accept({
      workspaceId: 'ws-a', provenance: provenanceFor('import', 'import-mode-1'), evidenceMode: 'reported',
      evidence: [{ kind: 'row', label: 'Imported row', value: { n: 1 } }], actor: { type: 'system' },
    })
    expect(imported.ok).toBe(true)
    const conflict = await service.accept({
      workspaceId: 'ws-a', provenance: provenanceFor('import', 'import-mode-1'), evidenceMode: 'ats_details_provided',
      evidence: [{ kind: 'row', label: 'Imported row', value: { n: 1 } }], actor: { type: 'system' },
    })
    expect(conflict).toMatchObject({ ok: false, code: 'evidence_mode_conflict' })
  })
})
