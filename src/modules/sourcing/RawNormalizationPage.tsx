import { useEffect, useMemo, useRef, useState } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { LoadFailureView } from '@/components/ui/load-failure-view'
import type { RawSourceRecordSummary } from 'sparxie'
import { formatTimestamp } from '../../app/format'
import {
  ownedLoadFailure,
  presentLoadFailure,
  type ErrorPresentation,
} from '../../app/error-presentation'
import type { RawNormalizationRunFilter, RawRecordsReadApi } from './raw-normalization.types'
import {
  buildRawRecordQuery,
  emptyRawRecordFilters,
  RawNormalizationFilters,
  type RawRecordFilters,
} from './RawNormalizationFilters'
import { RawNormalizationDetail } from './RawNormalizationDetail'
import { sanitizeDisplayText } from './raw-detail-sanitization'

export function RawNormalizationPage({
  api,
  contentColumnClass,
  onOpenFinding,
  runFilter,
}: {
  api: RawRecordsReadApi
  contentColumnClass: string
  onOpenFinding?: (findingId: string) => void
  runFilter?: RawNormalizationRunFilter | null
}) {
  const [filters, setFilters] = useState<RawRecordFilters>(() => ({
    ...emptyRawRecordFilters,
    connectorInstanceId: runFilter?.connectorInstanceId ?? '',
  }))
  const [cursorHistory, setCursorHistory] = useState<Array<string | undefined>>([undefined])
  const [pageIndex, setPageIndex] = useState(0)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [items, setItems] = useState<RawSourceRecordSummary[]>([])
  const [loadFailure, setLoadFailure] = useState<ErrorPresentation | null>(null)
  const [loading, setLoading] = useState(true)
  const [retryKey, setRetryKey] = useState(0)
  const [selectedSummary, setSelectedSummary] = useState<RawSourceRecordSummary | null>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items
  const query = useMemo(
    () => buildRawRecordQuery(filters, cursorHistory[pageIndex]),
    [cursorHistory, filters, pageIndex],
  )
  const queryIdentityRef = useRef({ query, runFilter })

  useEffect(() => {
    let cancelled = false
    const previousItems = itemsRef.current
    const previousIdentity = queryIdentityRef.current
    const queryChanged =
      previousIdentity.query !== query || previousIdentity.runFilter !== runFilter
    queryIdentityRef.current = { query, runFilter }
    setLoading(true)
    if (queryChanged) {
      setLoadFailure(null)
      setItems([])
      setNextCursor(null)
      setSelectedSummary(null)
    }
    void loadRawRecords(api, query, runFilter).then((result) => {
      if (!cancelled) {
        setItems(result.items)
        setNextCursor(result.nextCursor)
        setLoadFailure(null)
      }
    }).catch((reason: unknown) => {
      if (!cancelled) {
        if (!queryChanged) {
          setItems(previousItems)
        }
        const hadItems = !queryChanged && previousItems.length > 0
        setLoadFailure(ownedLoadFailure(presentLoadFailure(reason, {
          fallbackMessage: runFilter
            ? 'Capture lineage could not be verified, so no connector-run results are shown.'
            : 'Capture lineages could not be loaded.',
          hasStaleData: hadItems,
          trigger: hadItems ? 'refresh' : 'load',
        })))
      }
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [api, query, retryKey, runFilter])

  return (
    <main className={`h-full min-w-0 overflow-auto px-4 py-5 text-foreground md:h-[calc(100vh-3rem)] sm:px-6 lg:px-8 ${contentColumnClass}`}>
      <section className="mx-auto w-full max-w-7xl space-y-4">
        <header className="border-b border-border pb-4">
          <p className="text-xs font-medium uppercase text-muted-foreground">Sourcing</p>
          <h1 className="mt-1 text-2xl font-semibold text-foreground">Normalization</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Follow Captures through Job normalization, Opportunity admission, and projection.
          </p>
        </header>
        <RawNormalizationFilters
          filters={filters}
          onChange={(nextFilters) => {
            setFilters(nextFilters)
            setCursorHistory([undefined])
            setPageIndex(0)
            setItems([])
            setSelectedSummary(null)
          }}
        />
        {runFilter ? (
          <p
            aria-label={`Filtered to connector run ${runFilter.connectorRunId}`}
            className="rounded-md border border-primary/40 bg-primary/10 p-3 text-sm"
            role="status"
          >
            Showing Capture lineages with Captures from connector run {runFilter.connectorRunId}.
          </p>
        ) : null}
        {loading && items.length === 0 ? (
          <p aria-label="Loading Capture lineages" role="status">
            Loading Capture lineages...
          </p>
        ) : null}
        {loadFailure ? (
          <LoadFailureView
            failure={loadFailure}
            onRetry={() => setRetryKey((key) => key + 1)}
          />
        ) : null}
        {!loading && !loadFailure && items.length === 0 ? (
          <p
            aria-label="No Capture lineages match the current filters"
            className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground"
            role="status"
          >
            No Capture lineages match the current filters.
          </p>
        ) : null}
        {items.length > 0 ? (
          <RawRecordsTable items={items} onSelect={setSelectedSummary} />
        ) : null}
        {!loadFailure && !loading && !runFilter ? (
          <nav aria-label="Capture lineage pagination" className="flex items-center justify-end gap-2">
            <button
              type="button"
              className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50"
              disabled={pageIndex === 0}
              onClick={() => setPageIndex((index) => Math.max(0, index - 1))}
            >
              Previous page
            </button>
            <span className="text-sm text-muted-foreground">Page {pageIndex + 1}</span>
            <button
              type="button"
              className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50"
              disabled={!nextCursor}
              onClick={() => {
                if (!nextCursor) return
                setCursorHistory((history) => [...history.slice(0, pageIndex + 1), nextCursor])
                setPageIndex((index) => index + 1)
              }}
            >
              Next page
            </button>
          </nav>
        ) : null}
      </section>
      {selectedSummary ? (
        <RawNormalizationDetail
          api={api}
          summary={selectedSummary}
          onClose={() => setSelectedSummary(null)}
          onOpenFinding={onOpenFinding}
        />
      ) : null}
    </main>
  )
}

async function loadRawRecords(
  api: RawRecordsReadApi,
  query: ReturnType<typeof buildRawRecordQuery>,
  runFilter?: RawNormalizationRunFilter | null,
) {
  return api.list(runFilter ? {
    ...query,
    connectorInstanceId: runFilter.connectorInstanceId,
    connectorRunId: runFilter.connectorRunId,
  } : query)
}

function RawRecordsTable({
  items,
  onSelect,
}: {
  items: RawSourceRecordSummary[]
  onSelect: (item: RawSourceRecordSummary) => void
}) {
  return (
    <Table aria-label="Capture-to-Job normalization">
      <TableHeader>
        <TableRow>
          <TableHead>Source</TableHead>
          <TableHead>Provider facts</TableHead>
          <TableHead>Seen</TableHead>
          <TableHead>Capture history</TableHead>
          <TableHead>Job normalization</TableHead>
          <TableHead>Opportunity admission</TableHead>
          <TableHead>Job fact version</TableHead>
          <TableHead>Opportunity projection</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableCell>
              <SourceLabel item={item} />
              <button
                type="button"
                aria-label="Inspect Capture lineage"
                className="mt-2 rounded-md border border-border px-2 py-1 text-xs"
                onClick={() => onSelect(item)}
              >
                Inspect
              </button>
            </TableCell>
            <TableCell>
              <span className="block font-medium">
                {item.roleTitle ? sanitizeDisplayText(item.roleTitle) : 'Missing title'}
              </span>
              <span className="block text-xs text-muted-foreground">
                {item.companyName ? sanitizeDisplayText(item.companyName) : 'Missing company'}
              </span>
            </TableCell>
            <TableCell className="text-xs">
              {formatTimestamp(item.firstObservedAt)} – {formatTimestamp(item.lastObservedAt)}
            </TableCell>
            <TableCell className="text-xs">
              {item.occurrenceCount} Captures · {item.revisionCount} evidence versions
            </TableCell>
            <TableCell>{statusLabel(item.normalizationStatus)}</TableCell>
            <TableCell>
              {item.gateStatus ? statusLabel(item.gateStatus) : 'Not evaluated'}
            </TableCell>
            <TableCell>
              {item.canonicalCandidateId
                ? 'Job facts persisted'
                : 'No Job facts'}
            </TableCell>
            <TableCell>{projectionLabel(item)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function SourceLabel({ item }: { item: RawSourceRecordSummary }) {
  return (
    <span className="block text-xs font-medium">
      {item.reportedOrigin
        ? sanitizeDisplayText(item.reportedOrigin.name)
        : 'Unknown source'}
    </span>
  )
}

function statusLabel(value: string) {
  const label = value.replace(/_/g, ' ')
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function projectionLabel(item: RawSourceRecordSummary) {
  if (item.projectionStatus === 'projected') return 'Projected'
  if (item.projectionStatus === 'pending') return 'Projection pending'
  if (item.projectionStatus === 'failed') return 'Projection failed'
  return 'Not projected'
}
