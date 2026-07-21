/**
 * Opportunity DTO serializer proofs (issue #304, stage 3) — pure, no database.
 *
 * Proves the domain -> sparxie `Opportunity` flattening conforms to
 * `opportunitySchema` exactly (strict), that the head `override_json` round-trips
 * into the warning override, that history reconstruction replays
 * fit/rank/cutoff/disposition/tombstone from the ordered delta payloads while
 * carrying `override: null` per revision (head-only contract reading), and that
 * the keyset cursor encode/decode is total.
 */
import { describe, expect, it } from 'vitest'
import { opportunityHistoryResultSchema, opportunityListResultSchema, opportunitySchema } from 'sparxie'
import {
  decodeOpportunityCursor,
  encodeOpportunityCursor,
  reconstructOpportunityHistory,
  toOpportunityListResult,
  toOpportunityResource,
  type OpportunityHeadRow,
  type OpportunityHistoryRow,
} from './opportunity.dto'

const override = { actor: { id: 'u-1', type: 'user' as const }, rationale: 'reviewed the cutoff', warningCodes: ['cutoff' as const] }

const head: OpportunityHeadRow = {
  id: '01890000-0000-7000-8000-0000000000aa',
  workspaceId: 'ws-a',
  jobId: '01890000-0000-7000-8000-0000000000bb',
  revision: 3,
  fit: 'fit',
  rank: 4,
  cutoff: 'above',
  disposition: 'pursue',
  overrideJson: JSON.stringify(override),
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:03.000Z',
  removedAt: null,
}

describe('toOpportunityResource', () => {
  it('flattens the head row into a schema-valid Opportunity with the head override', () => {
    const dto = toOpportunityResource(head)
    expect(() => opportunitySchema.parse(dto)).not.toThrow()
    expect(dto).toMatchObject({ fit: 'fit', rank: 4, cutoff: 'above', disposition: 'pursue' })
    expect(dto.override).toEqual(override)
  })

  it('presents a null override and null rank when the head has none', () => {
    const dto = toOpportunityResource({ ...head, overrideJson: null, rank: null })
    expect(() => opportunitySchema.parse(dto)).not.toThrow()
    expect(dto.override).toBeNull()
    expect(dto.rank).toBeNull()
  })
})

describe('reconstructOpportunityHistory', () => {
  it('replays evaluation/disposition/tombstone deltas, carrying override null per revision', () => {
    const history: OpportunityHistoryRow[] = [
      { revision: 1, kind: 'created', snapshotJson: JSON.stringify({ fit: 'unknown', rank: null, cutoff: 'not_evaluated', disposition: 'reviewing' }), auditJson: '{"actor":{"type":"system"}}', createdAt: '2026-07-20T00:00:00.000Z' },
      { revision: 2, kind: 'evaluation_changed', snapshotJson: JSON.stringify({ fit: 'fit', cutoff: 'above', rank: 4 }), auditJson: '{"actor":{"type":"agent","id":"a"}}', createdAt: '2026-07-20T00:00:01.000Z' },
      { revision: 3, kind: 'disposition_changed', snapshotJson: JSON.stringify({ disposition: 'pursue', priorDisposition: 'reviewing', rationale: 'go' }), auditJson: '{"actor":{"type":"user","id":"u"}}', createdAt: '2026-07-20T00:00:02.000Z' },
      { revision: 4, kind: 'removed', snapshotJson: JSON.stringify({ kind: 'removed', priorRevision: 3 }), auditJson: '{"actor":{"type":"user","id":"u"}}', createdAt: '2026-07-20T00:00:03.000Z' },
      { revision: 5, kind: 'restored', snapshotJson: JSON.stringify({ kind: 'restored', priorRevision: 4 }), auditJson: '{"actor":{"type":"user","id":"u"}}', createdAt: '2026-07-20T00:00:04.000Z' },
    ]
    const result = reconstructOpportunityHistory(head, history, { limit: 50 })
    expect(() => opportunityHistoryResultSchema.parse(result)).not.toThrow()
    expect(result.items.map((item) => item.kind)).toEqual([
      'created', 'evaluation_changed', 'disposition_changed', 'removed', 'restored',
    ])
    // Created snapshot is the defaults; the evaluation/disposition bump forward.
    expect(result.items[0]!.snapshot).toMatchObject({ fit: 'unknown', rank: null, cutoff: 'not_evaluated', disposition: 'reviewing' })
    expect(result.items[1]!.snapshot).toMatchObject({ fit: 'fit', rank: 4, cutoff: 'above', disposition: 'reviewing' })
    expect(result.items[2]!.snapshot.disposition).toBe('pursue')
    // Tombstone toggles; override is head-only, never per-revision.
    expect(result.items[3]!.snapshot.removedAt).toBe('2026-07-20T00:00:03.000Z')
    expect(result.items[4]!.snapshot.removedAt).toBeNull()
    for (const item of result.items) expect(item.snapshot.override).toBeNull()
  })

  it('windows the reconstructed page by the after-revision cursor', () => {
    const history: OpportunityHistoryRow[] = [1, 2, 3].map((revision) => ({
      revision,
      kind: revision === 1 ? 'created' : 'evaluation_changed',
      snapshotJson: JSON.stringify(revision === 1 ? { fit: 'unknown', rank: null, cutoff: 'not_evaluated', disposition: 'reviewing' } : { fit: 'fit' }),
      auditJson: '{"actor":{"type":"system"}}',
      createdAt: `2026-07-20T00:00:0${revision}.000Z`,
    }))
    const page = reconstructOpportunityHistory(head, history, { limit: 1 })
    expect(page.items.map((item) => item.revision)).toEqual([1])
    expect(page.nextCursor).toBe('1')
    const next = reconstructOpportunityHistory(head, history, { limit: 5, afterRevision: 1 })
    expect(next.items.map((item) => item.revision)).toEqual([2, 3])
    expect(next.nextCursor).toBeNull()
  })
})

describe('opportunity list cursor + result', () => {
  it('round-trips the keyset cursor and rejects garbage', () => {
    const cursor = { createdAt: head.createdAt, id: head.id }
    expect(decodeOpportunityCursor(encodeOpportunityCursor(cursor))).toEqual(cursor)
    expect(decodeOpportunityCursor('not base64 !!')).toBeNull()
  })

  it('drives nextCursor only when a further page exists', () => {
    const dto = toOpportunityResource(head)
    expect(() => opportunityListResultSchema.parse(toOpportunityListResult([dto], 10, false))).not.toThrow()
    expect(toOpportunityListResult([dto], 10, false).nextCursor).toBeNull()
    expect(toOpportunityListResult([dto], 1, true).nextCursor).not.toBeNull()
  })
})
