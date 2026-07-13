import { useEffect, useMemo, useState } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { RawSourceRecordSummary } from 'sparxie'
import { formatTimestamp } from '../../app/format'
import type { RawNormalizationRunFilter, RawRecordsReadApi } from './raw-normalization.types'
import {
  buildRawRecordQuery,
  emptyRawRecordFilters,
  RawNormalizationFilters,
  type RawRecordFilters,
} from './RawNormalizationFilters'
import { RawNormalizationDetail } from './RawNormalizationDetail'
import { isSafeDisplayString, sanitizeDisplayText } from './raw-detail-sanitization'

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
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [retryKey, setRetryKey] = useState(0)
  const [selectedSummary, setSelectedSummary] = useState<RawSourceRecordSummary | null>(null)
  const [scanLimitReached, setScanLimitReached] = useState(false)
  const query = useMemo(
    () => buildRawRecordQuery(filters, cursorHistory[pageIndex]),
    [cursorHistory, filters, pageIndex],
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    setItems([])
    setNextCursor(null)
    setScanLimitReached(false)
    setSelectedSummary(null)
    void loadRawRecords(api, query, runFilter).then((result) => {
      if (!cancelled) {
        setItems(result.items)
        setNextCursor(result.nextCursor)
        setScanLimitReached(result.scanLimitReached)
        setError(false)
      }
    }).catch(() => {
      if (!cancelled) {
        setItems([])
        setError(true)
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
            Follow connector capture through normalization, admission, and sourcing projection.
          </p>
        </header>
        <RawNormalizationFilters
          filters={filters}
          onChange={(nextFilters) => {
            setFilters(nextFilters)
            setCursorHistory([undefined])
            setPageIndex(0)
          }}
        />
        {runFilter ? (
          <p
            aria-label={`Filtered to connector run ${runFilter.connectorRunId}`}
            className="rounded-md border border-primary/40 bg-primary/10 p-3 text-sm"
            role="status"
          >
            Showing records with captured occurrence lineage from connector run {runFilter.connectorRunId}.
          </p>
        ) : null}
        {scanLimitReached ? (
          <p
            aria-label="Connector run search limit reached"
            className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm text-warning"
            role="status"
          >
            Search limit reached. Matching rows shown may be incomplete; refine the connector filters.
          </p>
        ) : null}
        {loading ? (
          <p aria-label="Loading raw sourcing records" role="status">
            Loading raw sourcing records...
          </p>
        ) : null}
        {error ? (
          <div
            aria-label={runFilter
              ? 'Connector run records could not be verified'
              : 'Raw sourcing records unavailable'}
            className="rounded-md border border-destructive/50 bg-destructive/10 p-4"
            role="alert"
          >
            <p className="text-sm text-destructive">
              {runFilter
                ? 'Occurrence lineage could not be verified, so no connector-run results are shown.'
                : 'Raw sourcing records could not be loaded.'}
            </p>
            <button
              type="button"
              className="mt-3 rounded-md border border-border px-3 py-2 text-sm"
              onClick={() => setRetryKey((key) => key + 1)}
            >
              Retry
            </button>
          </div>
        ) : null}
        {!loading && !error && items.length === 0 ? (
          <p
            aria-label="No raw sourcing records match the current filters"
            className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground"
            role="status"
          >
            No raw sourcing records match the current filters.
          </p>
        ) : null}
        {!loading && !error && items.length > 0 ? (
          <RawRecordsTable items={items} onSelect={setSelectedSummary} />
        ) : null}
        {!error && !loading && !runFilter ? (
          <nav aria-label="Raw sourcing pagination" className="flex items-center justify-end gap-2">
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

const MAX_RUN_FILTER_SCAN_PAGES = 25

async function loadRawRecords(
  api: RawRecordsReadApi,
  query: ReturnType<typeof buildRawRecordQuery>,
  runFilter?: RawNormalizationRunFilter | null,
) {
  if (!runFilter) {
    const result = await api.list(query)
    return { ...result, scanLimitReached: false }
  }
  const items: RawSourceRecordSummary[] = []
  let cursor: string | undefined
  let pages = 0
  do {
    const page = await api.list({
      ...query,
      connectorInstanceId: runFilter.connectorInstanceId,
      cursor,
      limit: 100,
    })
    const matches = await Promise.all(page.items.map(async (item) => {
      if (item.latestConnectorRunId === runFilter.connectorRunId) return item
      const detail = await api.get(item.id)
      return detail.occurrences.some((occurrence) =>
        occurrence.capture?.connectorRunId === runFilter.connectorRunId) ? item : null
    }))
    items.push(...matches.filter((item): item is RawSourceRecordSummary => item !== null))
    cursor = page.nextCursor ?? undefined
    pages += 1
  } while (cursor && pages < MAX_RUN_FILTER_SCAN_PAGES)
  return { items, nextCursor: null, scanLimitReached: Boolean(cursor) }
}

function RawRecordsTable({
  items,
  onSelect,
}: {
  items: RawSourceRecordSummary[]
  onSelect: (item: RawSourceRecordSummary) => void
}) {
  return (
    <Table aria-label="Raw sourcing normalization">
      <TableHeader>
        <TableRow>
          <TableHead>Connector capture</TableHead>
          <TableHead>Captured facts</TableHead>
          <TableHead>Seen</TableHead>
          <TableHead>Lineage</TableHead>
          <TableHead>Normalization resolver</TableHead>
          <TableHead>Sourcing admission gate</TableHead>
          <TableHead>Canonical candidate</TableHead>
          <TableHead>Sourcing projection</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableCell>
              <CaptureOwnership item={item} />
              <ProviderIdentity item={item} />
              <button
                type="button"
                aria-label={`Inspect raw record ${sanitizeDisplayText(item.id)}`}
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
              {item.occurrenceCount} occurrences · {item.revisionCount} revisions
            </TableCell>
            <TableCell>{statusLabel(item.normalizationStatus)}</TableCell>
            <TableCell>
              {item.gateStatus ? statusLabel(item.gateStatus) : 'Not evaluated'}
            </TableCell>
            <TableCell>
              {item.canonicalCandidateId
                ? sanitizeDisplayText(item.canonicalCandidateId)
                : 'No candidate'}
            </TableCell>
            <TableCell>{projectionLabel(item)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function CaptureOwnership({ item }: { item: RawSourceRecordSummary }) {
  const adapterKind = item.adapter.kind ? statusLabel(item.adapter.kind) : 'Unknown kind'
  return (
    <span className="block text-xs">
      <span className="block font-medium">
        Capture adapter {sanitizeDisplayText(item.adapter.id)} · {adapterKind}
      </span>
      {item.connectorInstanceId ? (
        <span className="block text-muted-foreground">
          Connector instance {sanitizeDisplayText(item.connectorInstanceId)}
        </span>
      ) : null}
      {item.reportedOrigin ? (
        <span className="block text-muted-foreground">
          Reported origin {sanitizeDisplayText(item.reportedOrigin.name)}
        </span>
      ) : null}
    </span>
  )
}

function ProviderIdentity({ item }: { item: RawSourceRecordSummary }) {
  const labels = [
    item.providerRecordId && isSafeDisplayString(item.providerRecordId)
      ? `Provider record ${item.providerRecordId}`
      : null,
    item.reportedOrigin?.providerId && isSafeDisplayString(item.reportedOrigin.providerId)
      ? `Provider ${item.reportedOrigin.providerId}`
      : null,
  ].filter((label): label is string => label !== null)
  return (
    <span className="mt-1 block text-xs text-muted-foreground">
      {labels.length > 0 ? labels.join(' · ') : 'Provider identity unavailable'}
    </span>
  )
}

function statusLabel(value: string) {
  const label = value.replace(/_/g, ' ')
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function projectionLabel(item: RawSourceRecordSummary) {
  if (item.projectionStatus === 'projected') {
    return `Finding ${item.findingId ? sanitizeDisplayText(item.findingId) : 'unavailable'}`
  }
  if (item.projectionStatus === 'pending') {
    return `Candidate ${item.canonicalCandidateId
      ? sanitizeDisplayText(item.canonicalCandidateId)
      : 'unavailable'}`
  }
  if (item.projectionStatus === 'failed') return 'Projection failed'
  return 'Not projected'
}
