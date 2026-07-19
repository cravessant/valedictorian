import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { GlobalFailureAlert } from '@/components/ui/error-primitives'
import type { ErrorPresentation } from './error-presentation'

/** Stable producer IDs for app-wide global failure ownership. */
export type GlobalFailureSourceId =
  | 'applications'
  | 'action-queue'
  | 'connector-status'
  | 'sourcing'
  | 'settings'
  | 'workspace'
  | 'profile'
  | 'policy'
  | 'connector-settings'
  | 'connector-runs'
  | 'connector-schedules'
  | 'raw-normalization'

interface GlobalFailureEntry {
  failure: ErrorPresentation
  onRetry: (() => void) | null
  reportedAt: number
}

/**
 * Arbitration rule: the displayed failure is the most recently reported distinct
 * source entry. Clearing a source removes only that entry and reveals the next
 * most-recent remaining entry (if any). Retry invokes only the displayed entry's
 * callback.
 */
export interface GlobalFailureOwnerValue {
  clearGlobalFailure: (sourceId: GlobalFailureSourceId) => void
  failure: ErrorPresentation | null
  reportGlobalFailure: (
    sourceId: GlobalFailureSourceId,
    failure: ErrorPresentation,
    onRetry?: () => void,
  ) => void
  retryGlobalFailure: () => void
}

const GlobalFailureOwnerContext = createContext<GlobalFailureOwnerValue | null>(null)

function selectDisplayedEntry(
  entries: ReadonlyMap<GlobalFailureSourceId, GlobalFailureEntry>,
): GlobalFailureEntry | null {
  let newest: GlobalFailureEntry | null = null
  for (const entry of entries.values()) {
    if (!newest || entry.reportedAt >= newest.reportedAt) {
      newest = entry
    }
  }
  return newest
}

export function useCreateGlobalFailureOwner(): GlobalFailureOwnerValue {
  const [entries, setEntries] = useState(
    () => new Map<GlobalFailureSourceId, GlobalFailureEntry>(),
  )
  const entriesRef = useRef(entries)
  entriesRef.current = entries
  const reportSequenceRef = useRef(0)

  const reportGlobalFailure = useCallback((
    sourceId: GlobalFailureSourceId,
    nextFailure: ErrorPresentation,
    nextOnRetry?: () => void,
  ) => {
    if (nextFailure.surface !== 'global') {
      return
    }
    reportSequenceRef.current += 1
    const reportedAt = reportSequenceRef.current
    setEntries((current) => {
      const next = new Map(current)
      next.set(sourceId, {
        failure: nextFailure,
        onRetry: nextOnRetry ?? null,
        reportedAt,
      })
      return next
    })
  }, [])

  const clearGlobalFailure = useCallback((sourceId: GlobalFailureSourceId) => {
    setEntries((current) => {
      if (!current.has(sourceId)) {
        return current
      }
      const next = new Map(current)
      next.delete(sourceId)
      return next
    })
  }, [])

  const retryGlobalFailure = useCallback(() => {
    const displayed = selectDisplayedEntry(entriesRef.current)
    displayed?.onRetry?.()
  }, [])

  const displayed = selectDisplayedEntry(entries)

  return useMemo(() => ({
    clearGlobalFailure,
    failure: displayed?.failure ?? null,
    reportGlobalFailure,
    retryGlobalFailure,
  }), [clearGlobalFailure, displayed?.failure, reportGlobalFailure, retryGlobalFailure])
}

export function GlobalFailureOwnerProvider({
  children,
  value,
}: {
  children: ReactNode
  value: GlobalFailureOwnerValue
}) {
  return (
    <GlobalFailureOwnerContext.Provider value={value}>
      {children}
    </GlobalFailureOwnerContext.Provider>
  )
}

export function useGlobalFailureOwner(): GlobalFailureOwnerValue | null {
  return useContext(GlobalFailureOwnerContext)
}

export function AppWideGlobalFailure() {
  const owner = useGlobalFailureOwner()
  const failure = owner?.failure ?? null
  if (!failure || !owner) {
    return null
  }

  return (
    <div className="border-b border-border bg-background px-4 py-3 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-7xl">
        <GlobalFailureAlert
          message={failure.message}
          title={failure.title}
          onRetry={failure.retryable ? owner.retryGlobalFailure : undefined}
        />
      </div>
    </div>
  )
}

/**
 * Route a load presentation for `sourceId` through the app-wide owner.
 *
 * - Global surfaces replace this source's entry and return null (app-wide alert owns it).
 * - Any other current result (null/cancellation, authentication, scoped, stale, …)
 *   atomically clears this source's prior global entry before the caller stores it.
 * Unrelated sources are left untouched.
 */
export function takeLocalLoadFailure(
  failure: ErrorPresentation | null,
  owner: GlobalFailureOwnerValue | null,
  sourceId: GlobalFailureSourceId,
  onRetry?: () => void,
): ErrorPresentation | null {
  if (failure?.surface === 'global' && owner) {
    owner.reportGlobalFailure(sourceId, failure, onRetry)
    return null
  }
  owner?.clearGlobalFailure(sourceId)
  return failure
}
