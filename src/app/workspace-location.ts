export const workspaceViews = [
  'captures',
  'jobs',
  'opportunities',
  'applications',
  'companies',
] as const
export type WorkspaceView = (typeof workspaceViews)[number]
export type WorkspaceCursorDirection = 'after' | 'before'

export interface WorkspaceLocation {
  readonly view: WorkspaceView
  readonly resourceId?: string
  readonly mode?: string
  readonly filter?: string
  readonly sort?: string
  readonly cursor?: string
  readonly cursorDirection?: WorkspaceCursorDirection
}

export interface WorkspaceHistoryEntry {
  readonly location: WorkspaceLocation
  readonly cursorChain: readonly WorkspaceLocation[]
  readonly focusAnchor?: string
}

export const safeWorkspaceLocation: WorkspaceLocation = { view: 'captures' }
const viewModes: Readonly<Record<WorkspaceView, ReadonlySet<string>>> = {
  captures: new Set(),
  jobs: new Set(),
  opportunities: new Set(),
  applications: new Set(['all', 'action-queue']),
  companies: new Set(),
}
const viewFilters: Readonly<Record<WorkspaceView, ReadonlySet<string>>> = {
  captures: new Set(),
  jobs: new Set(['all', 'include_removed']),
  opportunities: new Set(),
  applications: new Set(),
  companies: new Set(['all', 'active', 'archived', 'merged']),
}
const viewSorts: Readonly<Record<WorkspaceView, ReadonlySet<string>>> = {
  captures: new Set(),
  jobs: new Set(),
  opportunities: new Set(),
  applications: new Set(),
  companies: new Set(['display_name_asc']),
}

export function parseWorkspaceLocation(url: URL): WorkspaceLocation {
  const view = url.searchParams.get('view')
  if (!workspaceViews.includes(view as WorkspaceView)) return safeWorkspaceLocation
  const candidate: WorkspaceLocation = {
    view: view as WorkspaceView,
    ...readOptional(url, 'resource', 'resourceId'),
    ...readOptional(url, 'mode', 'mode'),
    ...readOptional(url, 'filter', 'filter'),
    ...readOptional(url, 'sort', 'sort'),
    ...readOptional(url, 'cursor', 'cursor'),
    ...readDirection(url),
  }
  return isWorkspaceLocation(candidate) ? candidate : safeWorkspaceLocation
}

export function serializeWorkspaceLocation(
  location: WorkspaceLocation,
  currentUrl: URL,
): URL {
  if (!isWorkspaceLocation(location)) {
    throw new Error('Cannot serialize an invalid workspace location.')
  }
  const url = new URL(currentUrl)
  for (const key of [
    'view',
    'resource',
    'mode',
    'filter',
    'sort',
    'cursor',
    'direction',
  ]) {
    url.searchParams.delete(key)
  }
  url.searchParams.set('view', location.view)
  setOptional(url, 'resource', location.resourceId)
  setOptional(url, 'mode', location.mode)
  setOptional(url, 'filter', location.filter)
  setOptional(url, 'sort', location.sort)
  setOptional(url, 'cursor', location.cursor)
  setOptional(url, 'direction', location.cursorDirection)
  return url
}

export function isWorkspaceLocation(value: unknown): value is WorkspaceLocation {
  if (!value || typeof value !== 'object') return false
  const location = value as Partial<WorkspaceLocation>
  if (!workspaceViews.includes(location.view as WorkspaceView)) return false
  const view = location.view as WorkspaceView
  if (!optionalBounded(location.resourceId)
    || !optionalMember(location.mode, viewModes[view])
    || !optionalMember(location.filter, viewFilters[view])
    || !optionalMember(location.sort, viewSorts[view])
    || !optionalCursor(location.cursor)) {
    return false
  }
  if (location.resourceId !== undefined && view !== 'jobs' && view !== 'companies') {
    return false
  }
  if (location.cursor === undefined) return location.cursorDirection === undefined
  if (view === 'jobs') return location.cursorDirection === 'after'
  if (view === 'companies') {
    return location.cursorDirection === 'after' || location.cursorDirection === 'before'
  }
  return false
}

export function isWorkspaceHistoryEntry(value: unknown): value is WorkspaceHistoryEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<WorkspaceHistoryEntry>
  return isWorkspaceLocation(entry.location)
    && Array.isArray(entry.cursorChain)
    && entry.cursorChain.length <= 100
    && entry.cursorChain.every((location) =>
      isWorkspaceLocation(location) && location.view === entry.location?.view)
    && optionalBounded(entry.focusAnchor)
}

export function resetWorkspaceQuery(
  location: WorkspaceLocation,
  change: Pick<WorkspaceLocation, 'filter' | 'sort'>,
): WorkspaceLocation {
  return {
    view: location.view,
    ...(change.filter === undefined ? {} : { filter: change.filter }),
    ...(change.sort === undefined ? {} : { sort: change.sort }),
  }
}

function readOptional<Key extends string>(
  url: URL,
  queryKey: string,
  property: Key,
): Partial<Record<Key, string>> {
  const value = url.searchParams.get(queryKey)
  return value === null ? {} : { [property]: value } as Partial<Record<Key, string>>
}

function readDirection(url: URL): Pick<WorkspaceLocation, 'cursorDirection'> {
  const value = url.searchParams.get('direction')
  return value === null ? {} : { cursorDirection: value as WorkspaceCursorDirection }
}

function setOptional(url: URL, key: string, value: string | undefined) {
  if (value !== undefined) url.searchParams.set(key, value)
}

function optionalBounded(value: unknown): boolean {
  return value === undefined || (typeof value === 'string'
    && value.length >= 1
    && value.length <= 2048
    && hasNoControlCharacters(value))
}

function optionalCursor(value: unknown): boolean {
  return value === undefined || (typeof value === 'string'
    && value.length >= 1
    && value.length <= 2048
    && hasOnlyUnicodeScalarValues(value))
}

// URLSearchParams converts inputs to Web IDL USVString and replaces lone
// surrogates, so reject them instead of corrupting an opaque backend cursor.
function hasOnlyUnicodeScalarValues(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xDC00 && next <= 0xDFFF)) return false
      index += 1
    } else if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) {
      return false
    }
  }
  return true
}

function hasNoControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit < 32 || codeUnit === 127) return false
  }
  return true
}

function optionalMember(value: unknown, allowed: ReadonlySet<string>): boolean {
  return value === undefined || (typeof value === 'string' && allowed.has(value))
}
