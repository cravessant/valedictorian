import { useCallback, useEffect, useState } from 'react'
import {
  isWorkspaceHistoryEntry,
  parseWorkspaceLocation,
  safeWorkspaceLocation,
  serializeWorkspaceLocation,
  type WorkspaceHistoryEntry,
  type WorkspaceLocation,
} from './workspace-location'

interface NavigateOptions {
  readonly cursorChain?: readonly WorkspaceLocation[]
  readonly focusAnchor?: string
  readonly replace?: boolean
}

export function useWorkspaceLocation() {
  const [entry, setEntry] = useState<WorkspaceHistoryEntry>(() => initialEntry())

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const next = isWorkspaceHistoryEntry(event.state)
        ? event.state
        : entryFromUrl()
      setEntry(next)
      if (!next.location.resourceId) restoreAnchor(next.focusAnchor)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const navigate = useCallback((
    location: WorkspaceLocation,
    options: NavigateOptions = {},
  ) => {
    if (options.focusAnchor) {
      window.history.replaceState({
        ...entry,
        focusAnchor: options.focusAnchor,
      }, '', window.location.href)
    }
    const next: WorkspaceHistoryEntry = {
      location,
      cursorChain: options.cursorChain ?? [],
      ...(options.focusAnchor ? { focusAnchor: options.focusAnchor } : {}),
    }
    const url = serializeWorkspaceLocation(location, new URL(window.location.href))
    if (options.replace) window.history.replaceState(next, '', url)
    else window.history.pushState(next, '', url)
    setEntry(next)
  }, [entry])

  const back = useCallback(() => window.history.back(), [])
  return { back, entry, navigate }
}

function initialEntry(): WorkspaceHistoryEntry {
  const fromState = window.history.state
  const entry = isWorkspaceHistoryEntry(fromState) ? fromState : entryFromUrl()
  const url = serializeWorkspaceLocation(entry.location, new URL(window.location.href))
  window.history.replaceState(entry, '', url)
  return entry
}

function entryFromUrl(): WorkspaceHistoryEntry {
  const parsed = parseWorkspaceLocation(new URL(window.location.href))
  return {
    location: parsed ?? safeWorkspaceLocation,
    cursorChain: [],
  }
}

function restoreAnchor(anchor: string | undefined) {
  if (!anchor) return
  window.setTimeout(() => document.getElementById(anchor)?.focus(), 0)
}
