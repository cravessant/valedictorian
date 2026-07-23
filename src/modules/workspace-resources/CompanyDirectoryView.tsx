import type { CompanyDirectoryPage } from '@sparxie/sdk'
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
import { resetWorkspaceQuery } from '@/app/workspace-location'
import { nextWorkspacePage, previousWorkspacePage } from '@/app/workspace-page'

export function CompanyDirectoryView({
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
  readonly onOpen: (companyId: string, anchor: string) => void
  readonly page: CompanyDirectoryPage
}) {
  const location = entry.location
  return (
    <section aria-label="Companies directory" className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="w-48 text-sm font-medium">
          Status
          <NativeSelect
            className="mt-1"
            aria-label="Company status"
            value={location.filter ?? 'all'}
            onChange={(event) => onNavigate(resetWorkspaceQuery(location, {
              filter: event.target.value,
              sort: 'display_name_asc',
            }))}
          >
            <NativeSelectOption value="all">All</NativeSelectOption>
            <NativeSelectOption value="active">Active</NativeSelectOption>
            <NativeSelectOption value="archived">Archived</NativeSelectOption>
            <NativeSelectOption value="merged">Merged</NativeSelectOption>
          </NativeSelect>
        </label>
        <p className="text-sm text-muted-foreground">{page.totalCount} Companies</p>
      </div>
      <Table aria-label="Companies">
        <TableHeader>
          <TableRow>
            <TableHead>Company</TableHead>
            <TableHead>Jobs</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Possible matches</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {page.items.map((company) => {
            const anchor = `company-link-${company.companyId}`
            return (
              <TableRow key={company.companyId}>
                <TableCell>
                  <Button
                    id={anchor}
                    type="button"
                    variant="link"
                    className="h-auto justify-start p-0 text-left"
                    onClick={() => onOpen(company.companyId, anchor)}
                  >
                    {company.displayName}
                  </Button>
                  {company.websiteHost ? (
                    <span className="block text-xs text-muted-foreground">
                      {company.websiteHost}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>{company.assignedJobCount}</TableCell>
                <TableCell className="capitalize">{company.status}</TableCell>
                <TableCell>{company.openDuplicateCandidateCount}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      {page.items.length === 0 && !loading ? (
        <div className="rounded-md border border-dashed border-border px-5 py-8 text-center">
          <p className="font-medium">No Companies in this view</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Change the status filter or create a Company.
          </p>
        </div>
      ) : null}
      <Pagination aria-label="Companies pages" className="justify-end">
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
          <Spinner aria-label="Loading Companies" className="size-4" />
          Loading Companies…
        </p>
      ) : null}
      {failure ? <p role="alert" className="text-sm text-destructive">{failure}</p> : null}
    </section>
  )
}
