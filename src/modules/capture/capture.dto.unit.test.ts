/**
 * Capture DTO serializer proofs (issue #304, stage 3) — pure, no database.
 *
 * Proves the domain -> sparxie `Capture` flattening conforms to `captureSchema`
 * exactly (strict, so unknown/missing keys fail), that evidence orders across
 * revisions, that payload round-trips (object and null), and that the keyset
 * cursor encode/decode is total (round-trips, rejects garbage) and drives the
 * `CaptureListResult.nextCursor` only when a further page exists.
 */
import { describe, expect, it } from 'vitest'
import { captureSchema } from 'sparxie'
import {
  decodeCaptureCursor,
  encodeCaptureCursor,
  toCaptureListResult,
  toCaptureResource,
  type CaptureEvidenceRow,
  type CaptureHeadRow,
} from './capture.dto'

const head: CaptureHeadRow = {
  id: 'cap-1',
  workspaceId: 'ws-a',
  evidenceMode: 'ats_details_provided',
  adapterId: 'jobright.resolver',
  adapterKind: 'connector',
  adapterVersion: '1.4.0',
  observedAt: '2026-07-20T00:00:00.000Z',
  receivedAt: '2026-07-20T00:00:01.000Z',
  providerRecordId: 'prov-9',
  providerSchema: 'v2',
  payloadJson: JSON.stringify({ title: 'Staff Engineer', remote: true }),
  revision: 3,
  createdAt: '2026-07-20T00:00:01.000Z',
  updatedAt: '2026-07-20T00:00:09.000Z',
  removedAt: null,
}

describe('toCaptureResource', () => {
  it('flattens the head row + evidence into a schema-valid Capture', () => {
    const evidence: CaptureEvidenceRow[] = [
      { captureRevision: 1, evidenceIndex: 0, kind: 'title', label: 'Title', valueJson: '"Staff Engineer"' },
      { captureRevision: 1, evidenceIndex: 1, kind: 'comp', label: 'Comp', valueJson: '{"min":200000}' },
    ]
    const dto = toCaptureResource(head, evidence)
    // Strict schema: any missing or extra key throws here.
    expect(() => captureSchema.parse(dto)).not.toThrow()
    expect(dto.adapter).toEqual({ id: 'jobright.resolver', kind: 'connector', version: '1.4.0' })
    expect(dto.payload).toEqual({ title: 'Staff Engineer', remote: true })
    expect(dto.providerRecordId).toBe('prov-9')
    expect(dto.evidence).toEqual([
      { kind: 'title', label: 'Title', value: 'Staff Engineer' },
      { kind: 'comp', label: 'Comp', value: { min: 200000 } },
    ])
  })

  it('orders evidence across revisions by (revision, index) and tolerates a null payload', () => {
    const evidence: CaptureEvidenceRow[] = [
      { captureRevision: 2, evidenceIndex: 0, kind: 'b', label: 'B', valueJson: '"later"' },
      { captureRevision: 1, evidenceIndex: 1, kind: 'a1', label: 'A1', valueJson: '"first-second"' },
      { captureRevision: 1, evidenceIndex: 0, kind: 'a0', label: 'A0', valueJson: '"first-first"' },
    ]
    const dto = toCaptureResource({ ...head, payloadJson: null, removedAt: '2026-07-20T00:00:20.000Z' }, evidence)
    expect(() => captureSchema.parse(dto)).not.toThrow()
    expect(dto.payload).toBeNull()
    expect(dto.removedAt).toBe('2026-07-20T00:00:20.000Z')
    expect(dto.evidence.map((item) => item.kind)).toEqual(['a0', 'a1', 'b'])
  })
})

describe('capture keyset cursor', () => {
  it('round-trips a (createdAt, id) anchor', () => {
    const encoded = encodeCaptureCursor({ createdAt: '2026-07-20T00:00:01.000Z', id: 'cap-1' })
    expect(decodeCaptureCursor(encoded)).toEqual({ createdAt: '2026-07-20T00:00:01.000Z', id: 'cap-1' })
  })

  it('returns null for malformed cursors instead of throwing', () => {
    expect(decodeCaptureCursor('not-base64-$$')).toBeNull()
    expect(decodeCaptureCursor(Buffer.from('{"nope":1}', 'utf8').toString('base64url'))).toBeNull()
    expect(decodeCaptureCursor(Buffer.from('[1,2]', 'utf8').toString('base64url'))).toBeNull()
  })
})

describe('toCaptureListResult', () => {
  const resource = toCaptureResource(head, [])

  it('emits a nextCursor anchored on the last item when more pages remain', () => {
    const result = toCaptureListResult([resource], 1, true)
    expect(result.limit).toBe(1)
    expect(result.items).toHaveLength(1)
    expect(result.nextCursor).toBe(encodeCaptureCursor({ createdAt: head.createdAt, id: head.id }))
  })

  it('emits a null nextCursor on the final page', () => {
    const result = toCaptureListResult([resource], 50, false)
    expect(result.nextCursor).toBeNull()
  })

  it('emits a null nextCursor for an empty page', () => {
    expect(toCaptureListResult([], 50, false).nextCursor).toBeNull()
  })
})
