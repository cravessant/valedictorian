/**
 * Canonical lifecycle page assembly.
 *
 * Every lifecycle read model answers the same bidirectional contract: a request
 * carries `after`, `before`, or neither, and the response reports authoritative
 * boundaries for both directions. This module owns that translation once so the
 * Capture, Job, Opportunity, and Application read models only supply their own
 * ordering, filters, and cursor payload.
 */
import type { LifecyclePageInfo } from '@sparxie/sdk'

export const DEFAULT_PAGE_LIMIT = 50
export const MAX_PAGE_LIMIT = 200

/** The canonical bidirectional page request every lifecycle list accepts. */
export interface LifecyclePageRequest {
  readonly after?: string
  readonly before?: string
  readonly limit?: number
}

/** A resolved request: how far to read, from where, and in which direction. */
export interface LifecyclePageWindow {
  readonly limit: number
  readonly cursor: string | null
  /** True when `before` was supplied: the keyset is walked against the ordering. */
  readonly backward: boolean
}

/** An opaque keyset cursor over a stable (primary, id) ordering. */
export interface LifecycleKeysetCursor {
  readonly primary: string
  readonly id: string
}

export function encodeKeysetCursor(cursor: LifecycleKeysetCursor): string {
  return Buffer.from(JSON.stringify([cursor.primary, cursor.id]), 'utf8').toString('base64url')
}

export function decodeKeysetCursor(cursor: string): LifecycleKeysetCursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (
      Array.isArray(parsed)
      && parsed.length === 2
      && typeof parsed[0] === 'string'
      && typeof parsed[1] === 'string'
    ) {
      return { primary: parsed[0], id: parsed[1] }
    }
    return null
  } catch {
    return null
  }
}

export function readPageWindow(
  input: LifecyclePageRequest,
  fallbackLimit: number = DEFAULT_PAGE_LIMIT,
  maxLimit: number = MAX_PAGE_LIMIT,
): LifecyclePageWindow {
  return {
    limit: clampLimit(input.limit, fallbackLimit, maxLimit),
    cursor: input.before ?? input.after ?? null,
    backward: input.before !== undefined,
  }
}

function clampLimit(requested: number | undefined, fallback: number, max: number): number {
  if (requested === undefined || !Number.isFinite(requested)) return Math.min(fallback, max)
  const floored = Math.floor(requested)
  if (floored < 1) return 1
  if (floored > max) return max
  return floored
}

/**
 * Whether any row still survives strictly beyond `cursor`, walking `backward`
 * against the list ordering or forward along it, under the list's own filters.
 */
export type LifecycleAdjacencyProbe = (cursor: string, backward: boolean) => Promise<boolean>

/**
 * Cut a fetched `limit + 1` window down to the page and its boundaries.
 *
 * `rows` arrive in traversal order — descending for a `before` request — and the
 * returned rows are always restored to the list's own ascending order.
 *
 * The sentinel row answers the direction the window was read in. The opposite
 * direction cannot be inferred from the request: the rows a cursor URL was
 * anchored on may have been removed since, so `after` no longer implies a
 * previous page and `before` no longer implies a next one. That side is probed
 * against the live filtered dataset instead — from the page's own near boundary,
 * or from the addressed cursor when the page came back empty. A first-page
 * request needs no probe: nothing precedes the start of the ordering.
 */
export async function toLifecyclePage<Row>(
  rows: readonly Row[],
  window: LifecyclePageWindow,
  cursorOf: (row: Row) => string,
  probe: LifecycleAdjacencyProbe,
): Promise<{ readonly rows: readonly Row[]; readonly pageInfo: LifecyclePageInfo }> {
  const hasMore = rows.length > window.limit
  const page = rows.slice(0, window.limit)
  if (window.backward) page.reverse()
  const near = window.backward ? page.at(-1) : page[0]
  const anchor = near === undefined ? window.cursor : cursorOf(near)
  // An empty page leaves `hasMore` false, so the probed side is the only one
  // that can report a neighbour — which is exactly the stale-cursor case.
  const opposite = window.cursor === null || anchor === null
    ? false
    : await probe(anchor, !window.backward)
  return {
    rows: page,
    pageInfo: pageBoundaries(page, cursorOf, {
      hasPreviousPage: window.backward ? hasMore : opposite,
      hasNextPage: window.backward ? opposite : hasMore,
    }),
  }
}

/**
 * Window an already-reconstructed, ascending history projection.
 *
 * History snapshots depend on every earlier revision, so the list cannot be
 * windowed in the database; the cursor is the sequence number of a boundary
 * entry and the page is taken from whichever end the direction addresses.
 *
 * The whole projection is already in hand, so both directions are answered by
 * looking past the page rather than by trusting the request direction — an
 * entry the cursor referred to may no longer be in the reconstruction.
 */
export function sliceLifecycleHistoryPage<Entry>(
  ascending: readonly Entry[],
  window: LifecyclePageWindow,
  sequenceOf: (entry: Entry) => number,
): { readonly items: Entry[]; readonly pageInfo: LifecyclePageInfo } {
  const boundary = window.cursor === null ? null : Number.parseInt(window.cursor, 10)
  const anchor = boundary !== null && Number.isFinite(boundary) ? boundary : null
  const remaining = anchor === null
    ? ascending
    : ascending.filter((entry) =>
      window.backward ? sequenceOf(entry) < anchor : sequenceOf(entry) > anchor)
  const items = window.backward
    ? remaining.slice(Math.max(0, remaining.length - window.limit))
    : remaining.slice(0, window.limit)
  const first = items[0]
  const last = items.at(-1)
  // Each side is measured from the page's own edge, or from the addressed
  // cursor when the page is empty — so a cursor whose entry no longer exists
  // still reports the direction that leads back to entries that do.
  const lower = first === undefined ? anchor : sequenceOf(first)
  const upper = last === undefined ? anchor : sequenceOf(last)
  return {
    items,
    pageInfo: pageBoundaries(items, (entry) => String(sequenceOf(entry)), {
      hasPreviousPage: lower !== null && ascending.some((entry) => sequenceOf(entry) < lower),
      hasNextPage: upper !== null && ascending.some((entry) => sequenceOf(entry) > upper),
    }),
  }
}

/** An addressable page with no items keeps null cursors but still reports its neighbours. */
function pageBoundaries<Item>(
  items: readonly Item[],
  cursorOf: (item: Item) => string,
  adjacency: { readonly hasPreviousPage: boolean; readonly hasNextPage: boolean },
): LifecyclePageInfo {
  const first = items[0]
  const last = items.at(-1)
  if (first === undefined || last === undefined) {
    return { startCursor: null, endCursor: null, ...adjacency }
  }
  return {
    startCursor: cursorOf(first) as LifecyclePageInfo['startCursor'],
    endCursor: cursorOf(last) as LifecyclePageInfo['endCursor'],
    ...adjacency,
  }
}

/** The page a read model answers when the addressed resource does not exist. */
export function emptyLifecyclePage<Item>(): { items: Item[]; pageInfo: LifecyclePageInfo } {
  return {
    items: [],
    pageInfo: {
      startCursor: null,
      endCursor: null,
      hasPreviousPage: false,
      hasNextPage: false,
    },
  }
}
