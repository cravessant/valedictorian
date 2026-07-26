/**
 * Canonical lifecycle page assembly proofs — pure, no database.
 *
 * Covers the four addressable page positions (empty, first, middle, final) in
 * both directions, and proves the reported adjacency describes the dataset the
 * probe answers for rather than the direction the request was made in.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  decodeKeysetCursor,
  emptyLifecyclePage,
  encodeKeysetCursor,
  readPageWindow,
  sliceLifecycleHistoryPage,
  toLifecyclePage,
} from './lifecycle-page.dto'

const cursorOf = (row: { id: string }) => row.id
const rows = (...ids: string[]) => ids.map((id) => ({ id }))
const window = (over: Partial<ReturnType<typeof readPageWindow>> = {}) =>
  ({ limit: 2, cursor: null, backward: false, ...over })

/** A probe over a known surviving set, mirroring the read models' keyset predicate. */
const surviving = (...ids: string[]) =>
  vi.fn(async (cursor: string, backward: boolean) =>
    ids.some((id) => (backward ? id < cursor : id > cursor)))

const never = vi.fn(async () => false)

describe('keyset cursor codec', () => {
  it('round-trips a (primary, id) anchor', () => {
    const cursor = { primary: '2026-07-20T00:00:01.000Z', id: 'row-1' }
    expect(decodeKeysetCursor(encodeKeysetCursor(cursor))).toEqual(cursor)
  })

  it('returns null for malformed cursors instead of throwing', () => {
    expect(decodeKeysetCursor('not-base64-$$')).toBeNull()
    expect(decodeKeysetCursor(Buffer.from('{"nope":1}', 'utf8').toString('base64url'))).toBeNull()
    expect(decodeKeysetCursor(Buffer.from('[1,2]', 'utf8').toString('base64url'))).toBeNull()
  })
})

describe('readPageWindow', () => {
  it('defaults to the first page and clamps the limit', () => {
    expect(readPageWindow({})).toEqual({ limit: DEFAULT_PAGE_LIMIT, cursor: null, backward: false })
    expect(readPageWindow({ limit: 0 }).limit).toBe(1)
    expect(readPageWindow({ limit: 10_000 }).limit).toBe(MAX_PAGE_LIMIT)
    expect(readPageWindow({ limit: Number.NaN }).limit).toBe(DEFAULT_PAGE_LIMIT)
  })

  it('reads the direction from whichever boundary the request supplies', () => {
    expect(readPageWindow({ after: 'a' })).toMatchObject({ cursor: 'a', backward: false })
    expect(readPageWindow({ before: 'b' })).toMatchObject({ cursor: 'b', backward: true })
  })
})

describe('toLifecyclePage', () => {
  it('reports only a forward neighbour on the first page and never probes', async () => {
    const probe = surviving('a', 'b', 'c')
    const page = await toLifecyclePage(rows('a', 'b', 'c'), window(), cursorOf, probe)
    expect(page.rows.map(cursorOf)).toEqual(['a', 'b'])
    expect(page.pageInfo).toEqual({
      startCursor: 'a',
      endCursor: 'b',
      hasPreviousPage: false,
      hasNextPage: true,
    })
    expect(probe).not.toHaveBeenCalled()
  })

  it('probes the page near boundary for the direction the window did not read', async () => {
    const probe = surviving('a', 'b', 'c', 'd', 'e')
    const page = await toLifecyclePage(rows('c', 'd', 'e'), window({ cursor: 'b' }), cursorOf, probe)
    expect(page.rows.map(cursorOf)).toEqual(['c', 'd'])
    expect(page.pageInfo).toMatchObject({ hasPreviousPage: true, hasNextPage: true })
    expect(probe).toHaveBeenCalledWith('c', true)
  })

  it('reports no forward neighbour on the final page', async () => {
    const page = await toLifecyclePage(
      rows('e', 'f'), window({ cursor: 'd' }), cursorOf, surviving('d', 'e', 'f'))
    expect(page.pageInfo).toEqual({
      startCursor: 'e',
      endCursor: 'f',
      hasPreviousPage: true,
      hasNextPage: false,
    })
  })

  it('restores list order and probes forward for a backward window', async () => {
    const probe = surviving('b', 'c', 'd', 'e')
    const page = await toLifecyclePage(
      rows('d', 'c', 'b'), window({ cursor: 'e', backward: true }), cursorOf, probe)
    expect(page.rows.map(cursorOf)).toEqual(['c', 'd'])
    expect(page.pageInfo).toEqual({
      startCursor: 'c',
      endCursor: 'd',
      hasPreviousPage: true,
      hasNextPage: true,
    })
    expect(probe).toHaveBeenCalledWith('d', false)
  })

  // The regression the request direction used to assert away: `after` no longer
  // implies a previous page once the rows it followed have been removed.
  it('drops Previous when every row before the followed cursor is gone', async () => {
    const page = await toLifecyclePage(
      rows('c', 'd'), window({ cursor: 'b' }), cursorOf, surviving('c', 'd'))
    expect(page.pageInfo).toMatchObject({ hasPreviousPage: false, hasNextPage: false })
  })

  it('drops Next when every row after the followed cursor is gone', async () => {
    const page = await toLifecyclePage(
      rows('b', 'a'), window({ cursor: 'c', backward: true }), cursorOf, surviving('a', 'b'))
    expect(page.rows.map(cursorOf)).toEqual(['a', 'b'])
    expect(page.pageInfo).toMatchObject({ hasPreviousPage: false, hasNextPage: false })
  })

  it('keeps an emptied forward page addressable backwards toward surviving rows', async () => {
    const page = await toLifecyclePage([], window({ cursor: 'd' }), cursorOf, surviving('a', 'b', 'c'))
    expect(page.rows).toEqual([])
    expect(page.pageInfo).toEqual({
      startCursor: null,
      endCursor: null,
      hasPreviousPage: true,
      hasNextPage: false,
    })
  })

  it('keeps an emptied backward page addressable forwards toward surviving rows', async () => {
    const page = await toLifecyclePage(
      [], window({ cursor: 'a', backward: true }), cursorOf, surviving('b', 'c'))
    expect(page.pageInfo).toEqual({
      startCursor: null,
      endCursor: null,
      hasPreviousPage: false,
      hasNextPage: true,
    })
  })

  it('reports no neighbour at all for an empty unaddressed first page', async () => {
    const page = await toLifecyclePage([], window(), cursorOf, never)
    expect(page.pageInfo).toEqual(emptyLifecyclePage().pageInfo)
    expect(never).not.toHaveBeenCalled()
  })
})

describe('sliceLifecycleHistoryPage', () => {
  const entries = [1, 2, 3, 4, 5].map((sequence) => ({ sequence }))
  const sequenceOf = (entry: { sequence: number }) => entry.sequence

  it('walks forward from the first page to the final page', () => {
    const first = sliceLifecycleHistoryPage(entries, window(), sequenceOf)
    expect(first.items.map(sequenceOf)).toEqual([1, 2])
    expect(first.pageInfo).toEqual({
      startCursor: '1',
      endCursor: '2',
      hasPreviousPage: false,
      hasNextPage: true,
    })

    const middle = sliceLifecycleHistoryPage(entries, window({ cursor: '2' }), sequenceOf)
    expect(middle.items.map(sequenceOf)).toEqual([3, 4])
    expect(middle.pageInfo).toMatchObject({ hasPreviousPage: true, hasNextPage: true })

    const final = sliceLifecycleHistoryPage(entries, window({ cursor: '4' }), sequenceOf)
    expect(final.items.map(sequenceOf)).toEqual([5])
    expect(final.pageInfo).toMatchObject({ hasPreviousPage: true, hasNextPage: false })
  })

  it('takes the entries immediately preceding a backward boundary', () => {
    const page = sliceLifecycleHistoryPage(entries, window({ cursor: '5', backward: true }), sequenceOf)
    expect(page.items.map(sequenceOf)).toEqual([3, 4])
    expect(page.pageInfo).toEqual({
      startCursor: '3',
      endCursor: '4',
      hasPreviousPage: true,
      hasNextPage: true,
    })
  })

  it('measures a truncated projection against the page, not the request direction', () => {
    // Revisions 1-2 are all that survive reconstruction; the cursor addressed 4.
    const truncated = entries.slice(0, 2)
    const page = sliceLifecycleHistoryPage(truncated, window({ cursor: '4' }), sequenceOf)
    expect(page.items).toEqual([])
    expect(page.pageInfo).toEqual({
      startCursor: null,
      endCursor: null,
      hasPreviousPage: true,
      hasNextPage: false,
    })
  })

  it('reports no boundary for an empty projection', () => {
    expect(sliceLifecycleHistoryPage([], window(), sequenceOf)).toEqual(emptyLifecyclePage())
    expect(sliceLifecycleHistoryPage([], window({ cursor: '4' }), sequenceOf).pageInfo)
      .toEqual(emptyLifecyclePage().pageInfo)
  })
})
