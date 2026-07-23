import { useEffect, useState } from 'react'
import {
  companyDirectoryCursorSchema,
  type CompanyCapability,
  type CompanyDetail,
  type CompanyDirectoryFilter,
  type CompanyDirectoryPage,
  type WorkspaceCompaniesClient,
} from 'sparxie'
import { Building2 } from 'lucide-react'
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
import { useMediaQuery } from '@/app/useMediaQuery'
import {
  resetWorkspaceQuery,
  type WorkspaceHistoryEntry,
  type WorkspaceLocation,
} from '@/app/workspace-location'
import { nextWorkspacePage, previousWorkspacePage } from '@/app/workspace-page'
import { ResourceDetailFrame } from './ResourceDetailFrame'

const emptyPage: CompanyDirectoryPage = {
  items: [],
  pageInfo: {
    startCursor: null,
    endCursor: null,
    hasPreviousPage: false,
    hasNextPage: false,
  },
  totalCount: 0,
}

interface CompaniesWorkspaceProps {
  readonly client: Pick<WorkspaceCompaniesClient, 'capability' | 'directory' | 'get'> | null
  readonly entry: WorkspaceHistoryEntry
  readonly onBack: () => void
  readonly onNavigate: (
    location: WorkspaceLocation,
    options?: { cursorChain?: readonly WorkspaceLocation[]; focusAnchor?: string },
  ) => void
}

export function CompaniesWorkspace({
  client,
  entry,
  onBack,
  onNavigate,
}: CompaniesWorkspaceProps) {
  const location = entry.location
  const filter = (location.filter ?? 'all') as CompanyDirectoryFilter
  const isNarrow = useMediaQuery('(max-width: 767px)')
  const [page, setPage] = useState<CompanyDirectoryPage>(emptyPage)
  const [capability, setCapability] = useState<CompanyCapability | null>(null)
  const [capabilityFailure, setCapabilityFailure] = useState<string | null>(null)
  const [selectedDetail, setSelectedDetail] = useState<{
    readonly resourceId: string
    readonly detail: CompanyDetail
  } | null>(null)
  const [listFailure, setListFailure] = useState<string | null>(null)
  const [listLoading, setListLoading] = useState(true)
  const [detailFailure, setDetailFailure] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    let current = true
    setCapability(null)
    setCapabilityFailure(null)
    if (!client) {
      setCapabilityFailure('Workspace Company data is unavailable.')
      return
    }
    void client.capability.get().then((nextCapability) => {
      if (current) setCapability(nextCapability)
    }, () => {
      if (current) setCapabilityFailure('Workspace Company capability could not be loaded.')
    })
    return () => { current = false }
  }, [client])

  useEffect(() => {
    let current = true
    setPage(emptyPage)
    setListFailure(null)
    setListLoading(true)
    if (!client || capability?.status !== 'ready') {
      setListLoading(false)
      return
    }
    const parsedCursor = location.cursor
      ? companyDirectoryCursorSchema.safeParse(location.cursor)
      : null
    if (parsedCursor && !parsedCursor.success) {
      setListFailure('The requested Company page address is invalid.')
      setListLoading(false)
      return
    }
    const cursor = parsedCursor?.data
    void client.directory.list({
      filter,
      sort: 'display_name_asc',
      limit: 50,
      ...(cursor && location.cursorDirection === 'before'
        ? { before: cursor }
        : cursor ? { after: cursor } : {}),
    }).then((nextPage) => {
      if (!current) return
      setPage(nextPage)
      setListLoading(false)
    }, (error: unknown) => {
      if (!current) return
      setListFailure(error instanceof Error ? error.message : 'Companies could not be loaded.')
      setListLoading(false)
    })
    return () => { current = false }
  }, [capability?.status, client, filter, location.cursor, location.cursorDirection])

  useEffect(() => {
    let current = true
    const resourceId = location.resourceId
    setSelectedDetail(null)
    setDetailFailure(null)
    setDetailLoading(Boolean(resourceId))
    if (!resourceId) return
    if (!client || capability?.status !== 'ready') {
      setDetailLoading(false)
      return
    }
    void client.get(resourceId).then((nextDetail) => {
      if (!current) return
      setSelectedDetail({ resourceId, detail: nextDetail })
      setDetailLoading(false)
    }, (error: unknown) => {
      if (!current) return
      setDetailFailure(
        error instanceof Error ? error.message : 'Company detail could not be loaded.',
      )
      setDetailLoading(false)
    })
    return () => { current = false }
  }, [capability?.status, client, location.resourceId])

  const detail = selectedDetail && selectedDetail.resourceId === location.resourceId
    ? selectedDetail.detail
    : null
  const showList = !isNarrow || !location.resourceId
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Workspace data
        </p>
        <h2 className="text-xl font-semibold">Companies</h2>
        <p className="text-sm text-muted-foreground">
          Workspace Company identity is separate from the ordered Job lifecycle.
        </p>
      </header>
      {capabilityFailure ? (
        <p role="alert" className="text-sm text-destructive">{capabilityFailure}</p>
      ) : null}
      {!capability && !capabilityFailure ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner aria-label="Loading Company capability" className="size-4" />
          Checking Company availability…
        </p>
      ) : null}
      {capability?.status === 'migrating' ? (
        <section className="rounded-md border border-border bg-card/60 p-5" aria-live="polite">
          <h3 className="font-semibold">Preparing Workspace Companies</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {capability.completed} of {capability.total} Jobs have Company coverage.
            Company-backed actions remain unavailable until verification completes.
          </p>
        </section>
      ) : null}
      {capability?.status === 'blocked' ? (
        <section className="rounded-md border border-destructive/40 bg-destructive/5 p-5" role="alert">
          <h3 className="font-semibold">Workspace Companies are unavailable</h3>
          <p className="mt-1 text-sm text-muted-foreground">{capability.message}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {capability.issueCount} integrity {capability.issueCount === 1 ? 'issue' : 'issues'} detected.
          </p>
        </section>
      ) : null}
      {capability?.status === 'ready' ? (
      <div className={location.resourceId && !isNarrow
        ? 'grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.75fr)]'
        : 'min-w-0'}>
        {showList ? (
          <section aria-label="Companies directory" className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <label className="w-48 text-sm font-medium">
                Status
                <NativeSelect
                  className="mt-1"
                  aria-label="Company status"
                  value={filter}
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
            <CompanyTable page={page} onOpen={(companyId, anchor) => onNavigate(
              { ...location, resourceId: companyId },
              { cursorChain: entry.cursorChain, focusAnchor: anchor },
            )} />
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
            {listLoading ? (
              <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner aria-label="Loading Companies" className="size-4" />
                Loading Companies…
              </p>
            ) : null}
            {listFailure ? (
              <p role="alert" className="text-sm text-destructive">{listFailure}</p>
            ) : null}
          </section>
        ) : null}
        {location.resourceId ? (
          <ResourceDetailFrame
            backLabel="Back to Companies"
            heading={detail?.lookup.requested.displayName ?? 'Company'}
            headingId="company-detail-heading"
            isNarrow={isNarrow}
            onBack={onBack}
          >
            {detailLoading ? <Spinner aria-label="Loading Company detail" /> : null}
            {detailFailure ? (
              <p role="alert" className="text-sm text-destructive">{detailFailure}</p>
            ) : null}
            {detail ? <CompanyDetailBody detail={detail} /> : null}
          </ResourceDetailFrame>
        ) : null}
      </div>
      ) : null}
    </div>
  )
}

function CompanyTable({
  page,
  onOpen,
}: {
  page: CompanyDirectoryPage
  onOpen: (companyId: string, anchor: string) => void
}) {
  return (
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
                  <span className="block text-xs text-muted-foreground">{company.websiteHost}</span>
                ) : null}
              </TableCell>
              <TableCell>{company.assignedJobCount}</TableCell>
              <TableCell>{company.status}</TableCell>
              <TableCell>{company.openDuplicateCandidateCount}</TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

function CompanyDetailBody({ detail }: { detail: CompanyDetail }) {
  const company = detail.lookup.requested
  return (
    <div className="space-y-4 text-sm">
      {company.websiteUrl ? <p>{company.websiteUrl}</p> : null}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <dt className="text-muted-foreground">Status</dt>
        <dd>{company.status}</dd>
        <dt className="text-muted-foreground">Assigned Jobs</dt>
        <dd>{detail.assignedJobCount}</dd>
        <dt className="text-muted-foreground">Aliases</dt>
        <dd>{company.aliases.map((alias) => alias.value).join(', ') || 'None'}</dd>
      </dl>
      {company.notes ? <p className="rounded-md border border-border bg-muted/30 p-3">{company.notes}</p> : null}
      {company.status === 'merged' ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Building2 className="size-4" aria-hidden="true" />
          Canonical Company: {detail.lookup.canonical.displayName}
        </p>
      ) : null}
    </div>
  )
}
