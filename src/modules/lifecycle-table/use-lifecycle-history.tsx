import { useCallback, useState, type ReactElement } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { LifecyclePageInfo } from '@sparxie/sdk'

import { scopedLoadFailure } from '../../app/app-load-failure'
import { HistoryModal } from './history-modal'
import type { HistoryEntrySummary, LifecycleOutcome } from './lifecycle-outcome-types'
import { afterPage, loadAllPages } from './load-pages'

const HISTORY_LOAD_FAILURE = 'History could not be loaded.'
const HISTORY_PAGE_LIMIT = 50

/** The audited envelope every aggregate's history entries share. */
export interface AuditedHistoryEntry {
  readonly kind: string
  readonly audit: {
    readonly actor: HistoryEntrySummary['actor']
    readonly timestamp: string
  }
}

export interface AuditedHistoryPage<Entry> {
  readonly items: ReadonlyArray<Entry>
  readonly pageInfo: LifecyclePageInfo
}

/** One addressed history page, keeping the canonical exclusive-cursor shape intact. */
export type AuditedHistoryPageRequest = { readonly limit: number } & ReturnType<typeof afterPage>

export interface LifecycleHistory<Row> {
  readonly open: (row: Row) => void
  readonly modal: ReactElement
}

/**
 * Read-only aggregate history. The drained revision list is a lifecycle query
 * keyed by the addressed resource, so a request superseded by a newer target can
 * no longer resolve into the open modal; the target itself stays local UI state,
 * and closing the modal drops it without cancelling anything the view still owns.
 * Each aggregate supplies its own addressed page reader and entry description.
 */
export function useLifecycleHistory<Row, Entry extends AuditedHistoryEntry>(
  family: readonly unknown[],
  identify: (row: Row) => string,
  loadPage: (row: Row, page: AuditedHistoryPageRequest) => Promise<AuditedHistoryPage<Entry>>,
  describe: (entry: Entry) => { readonly revision: number; readonly summary: string },
): LifecycleHistory<Row> {
  const [target, setTarget] = useState<Row | null>(null)
  const query = useQuery({
    queryKey: [...family, 'history', target === null ? null : identify(target)],
    queryFn: async (): Promise<ReadonlyArray<HistoryEntrySummary>> => {
      const row = target as Row
      const entries = await loadAllPages<Entry>((after) =>
        loadPage(row, { limit: HISTORY_PAGE_LIMIT, ...afterPage(after) }))
      return entries.map((entry) => ({
        kind: entry.kind,
        actor: entry.audit.actor,
        timestamp: entry.audit.timestamp,
        ...describe(entry),
      }))
    },
    enabled: target !== null,
    staleTime: 0,
  })
  const pending = target !== null && (query.isPending || query.isFetching)
  const close = useCallback(() => setTarget(null), [])
  return {
    open: setTarget,
    modal: (
      <HistoryModal
        open={target !== null}
        title={target === null ? 'History' : `History · ${identify(target)}`}
        outcome={target === null || pending ? null : historyOutcome(query)}
        pending={pending}
        onClose={close}
      />
    ),
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
