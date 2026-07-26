import { useCallback, useState } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import { scopedLoadFailure } from '../../app/app-load-failure'
import type { HistoryEntrySummary, LifecycleOutcome } from './lifecycle-outcome-types'

const HISTORY_LOAD_FAILURE = 'History could not be loaded.'

/**
 * Read-only aggregate history. The revision list is a lifecycle query keyed by
 * the addressed resource, so a request superseded by a newer target can no
 * longer resolve into the open modal; the target itself stays local UI state,
 * and closing the modal drops it without cancelling anything the view still owns.
 */
export function useLifecycleHistory<Row>(
  family: readonly unknown[],
  identify: (row: Row) => string,
  load: (row: Row) => Promise<ReadonlyArray<HistoryEntrySummary>>,
) {
  const [target, setTarget] = useState<Row | null>(null)
  const query = useQuery({
    queryKey: [...family, 'history', target === null ? null : identify(target)],
    queryFn: () => load(target as Row),
    enabled: target !== null,
    staleTime: 0,
  })
  const pending = target !== null && (query.isPending || query.isFetching)
  return {
    target,
    pending,
    outcome: target === null || pending ? null : historyOutcome(query),
    open: setTarget,
    close: useCallback(() => setTarget(null), []),
  }
}

function historyOutcome(
  query: UseQueryResult<ReadonlyArray<HistoryEntrySummary>>,
): LifecycleOutcome | null {
  if (!query.isError) return query.data ? { kind: 'history', entries: query.data } : null
  const message = scopedLoadFailure(query.error, HISTORY_LOAD_FAILURE, false)?.message
    ?? HISTORY_LOAD_FAILURE
  return { kind: 'error', blocker: { code: 'impossible_state', message }, message }
}
