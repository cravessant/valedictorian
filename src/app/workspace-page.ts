import type { WorkspaceHistoryEntry, WorkspaceLocation } from './workspace-location'

export interface WorkspacePageInfo {
  readonly startCursor: string | null
  readonly endCursor: string | null
  readonly hasPreviousPage: boolean
  readonly hasNextPage: boolean
}

export interface WorkspacePageTransition {
  readonly location: WorkspaceLocation
  readonly cursorChain: readonly WorkspaceLocation[]
}

export function nextWorkspacePage(
  entry: WorkspaceHistoryEntry,
  pageInfo: WorkspacePageInfo,
): WorkspacePageTransition | null {
  if (!pageInfo.hasNextPage || pageInfo.endCursor === null) return null
  return {
    location: pageLocation(entry.location, pageInfo.endCursor, 'after'),
    cursorChain: [...entry.cursorChain, listLocation(entry.location)],
  }
}

export function previousWorkspacePage(
  entry: WorkspaceHistoryEntry,
  pageInfo: WorkspacePageInfo,
): WorkspacePageTransition | null {
  if (!pageInfo.hasPreviousPage || pageInfo.startCursor === null) return null
  return {
    location: pageLocation(entry.location, pageInfo.startCursor, 'before'),
    cursorChain: entry.cursorChain.slice(0, -1),
  }
}

export function nextLegacyForwardCursorPage(
  entry: WorkspaceHistoryEntry,
  nextCursor: string | null,
): WorkspacePageTransition | null {
  if (nextCursor === null) return null
  return {
    location: pageLocation(entry.location, nextCursor, 'after'),
    cursorChain: [...entry.cursorChain, locationWithoutResource(entry.location)],
  }
}

export function previousLegacyForwardCursorPage(
  entry: WorkspaceHistoryEntry,
): WorkspacePageTransition | null {
  const previous = entry.cursorChain.at(-1)
  if (!previous) return null
  return {
    location: previous,
    cursorChain: entry.cursorChain.slice(0, -1),
  }
}

function pageLocation(
  location: WorkspaceLocation,
  cursor: string,
  cursorDirection: 'after' | 'before',
): WorkspaceLocation {
  const { resourceId: _resourceId, ...list } = location
  return { ...list, cursor, cursorDirection }
}

function listLocation(location: WorkspaceLocation): WorkspaceLocation {
  const {
    cursor: _cursor,
    cursorDirection: _cursorDirection,
    resourceId: _resourceId,
    ...list
  } = location
  return list
}

function locationWithoutResource(location: WorkspaceLocation): WorkspaceLocation {
  const { resourceId: _resourceId, ...list } = location
  return list
}
