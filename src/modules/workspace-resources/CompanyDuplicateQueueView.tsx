import type { CompanyDuplicatePage } from '@sparxie/sdk'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { WorkspaceHistoryEntry, WorkspaceLocation } from '@/app/workspace-location'
import { nextWorkspacePage, previousWorkspacePage } from '@/app/workspace-page'

export function CompanyDuplicateQueueView({
  entry,
  failure,
  loading,
  onNavigate,
  onOpen,
  page,
}: {
  readonly entry: WorkspaceHistoryEntry
  readonly failure: string | null
  readonly loading: boolean
  readonly onNavigate: (
    location: WorkspaceLocation,
    options?: { cursorChain?: readonly WorkspaceLocation[]; focusAnchor?: string },
  ) => void
  readonly onOpen: (candidateId: string, anchor: string) => void
  readonly page: CompanyDuplicatePage
}) {
  const location = entry.location
  return (
    <section aria-label="Possible duplicate Companies" className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="w-48 text-sm font-medium">
          Review status
          <NativeSelect
            className="mt-1"
            aria-label="Duplicate review status"
            value={location.filter ?? 'open'}
            onChange={(event) => onNavigate({
              view: 'companies',
              mode: 'duplicates',
              filter: event.target.value,
              sort: 'score_desc',
            })}
          >
            <NativeSelectOption value="open">Open</NativeSelectOption>
            <NativeSelectOption value="all">All</NativeSelectOption>
          </NativeSelect>
        </label>
        <p className="text-sm text-muted-foreground">
          {page.totalCount} possible {page.totalCount === 1 ? 'pair' : 'pairs'}
        </p>
      </div>
      <Table aria-label="Possible duplicate Companies">
        <TableHeader>
          <TableRow>
            <TableHead>Company pair</TableHead>
            <TableHead>Confidence</TableHead>
            <TableHead>Signals</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {page.items.map((candidate) => {
            const anchor = `company-duplicate-link-${candidate.candidateId}`
            return (
              <TableRow key={candidate.candidateId}>
                <TableCell>
                  <Button
                    id={anchor}
                    type="button"
                    variant="link"
                    className="h-auto max-w-[30rem] flex-col items-start p-0 text-left"
                    onClick={() => onOpen(candidate.candidateId, anchor)}
                  >
                    <span>{candidate.left.displayName}</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      and {candidate.right.displayName}
                    </span>
                  </Button>
                </TableCell>
                <TableCell className="font-medium tabular-nums">
                  {Math.round(candidate.score * 100)}%
                </TableCell>
                <TableCell>
                  <div className="flex max-w-sm flex-wrap gap-1">
                    {candidate.reasons.map((reason) => (
                      <Badge key={reason.code} variant="outline">{reason.label}</Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="capitalize">
                  {candidate.status.replaceAll('_', ' ')}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      {page.items.length === 0 && !loading ? (
        <div className="rounded-md border border-dashed border-border px-5 py-8 text-center">
          <p className="font-medium">No possible duplicates in this view</p>
          <p className="mt-1 text-sm text-muted-foreground">
            New pairs appear when Company names, aliases, or declared domains overlap.
          </p>
        </div>
      ) : null}
      <Pagination aria-label="Possible duplicate pages" className="justify-end">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              disabled={!page.pageInfo.hasPreviousPage}
              onClick={() => {
                const transition = previousWorkspacePage(entry, page.pageInfo)
                if (transition) onNavigate(transition.location, {
                  cursorChain: transition.cursorChain,
                })
              }}
            >
              Previous
            </PaginationPrevious>
          </PaginationItem>
          <PaginationItem>
            <PaginationNext
              disabled={!page.pageInfo.hasNextPage}
              onClick={() => {
                const transition = nextWorkspacePage(entry, page.pageInfo)
                if (transition) onNavigate(transition.location, {
                  cursorChain: transition.cursorChain,
                })
              }}
            >
              Next
            </PaginationNext>
          </PaginationItem>
        </PaginationContent>
      </Pagination>
      {loading ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner aria-label="Loading possible duplicates" className="size-4" />
          Loading possible duplicates…
        </p>
      ) : null}
      {failure ? <p role="alert" className="text-sm text-destructive">{failure}</p> : null}
    </section>
  )
}
