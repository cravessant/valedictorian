import type { WorkspaceCursorDirection, WorkspaceLocation } from './workspace-location'

/**
 * A canonical page request. The three shapes are kept distinct so a request
 * spread into a list input still satisfies the contract's `after`-xor-`before`
 * union rather than widening to "both possibly present".
 */
export type WorkspacePageRequest =
  | { readonly after?: never; readonly before?: never }
  | { readonly after: string; readonly before?: never }
  | { readonly before: string; readonly after?: never }

/** The page a workspace location's addressed cursor and direction ask a list for. */
export function workspacePageRequest(
  cursor: string | undefined,
  cursorDirection: WorkspaceCursorDirection | undefined,
): WorkspacePageRequest {
  if (cursor === undefined) return {}
  return cursorDirection === 'before' ? { before: cursor } : { after: cursor }
}

export interface WorkspacePageInfo {
  readonly startCursor: string | null
  readonly endCursor: string | null
  readonly hasPreviousPage: boolean
  readonly hasNextPage: boolean
}

/**
 * The next/previous location a canonical page addresses.
 *
 * Both directions are answered entirely by the page's own boundaries, so a
 * workspace location is self-contained: no client-side history of visited
 * cursors is kept or needed.
 *
 * A page emptied by concurrent removals reports no boundary of its own. The
 * cursor it was addressed by is still an exact boundary of the remaining rows,
 * so the opposite direction re-addresses that same cursor rather than
 * fabricating one — which is what lets a stale cursor URL walk back to rows
 * that still exist instead of stranding the workspace.
 */
export function nextWorkspacePage(
  location: WorkspaceLocation,
  pageInfo: WorkspacePageInfo,
): WorkspaceLocation | null {
  if (!pageInfo.hasNextPage) return null
  const cursor = pageInfo.endCursor ?? addressedCursor(location, 'before')
  return cursor === null ? null : pageLocation(location, cursor, 'after')
}

export function previousWorkspacePage(
  location: WorkspaceLocation,
  pageInfo: WorkspacePageInfo,
): WorkspaceLocation | null {
  if (!pageInfo.hasPreviousPage) return null
  const cursor = pageInfo.startCursor ?? addressedCursor(location, 'after')
  return cursor === null ? null : pageLocation(location, cursor, 'before')
}

/** The cursor this location holds, when it was addressed in the given direction. */
function addressedCursor(
  location: WorkspaceLocation,
  cursorDirection: WorkspaceCursorDirection,
): string | null {
  return location.cursorDirection === cursorDirection ? location.cursor ?? null : null
}

function pageLocation(
  location: WorkspaceLocation,
  cursor: string,
  cursorDirection: 'after' | 'before',
): WorkspaceLocation {
  const { resourceId: _resourceId, ...list } = location
  return { ...list, cursor, cursorDirection }
}
