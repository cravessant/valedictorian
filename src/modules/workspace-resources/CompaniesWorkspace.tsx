import { useEffect, useState } from 'react'
import {
  companyDirectoryCursorSchema,
  companyDuplicateCursorSchema,
  type CompanyAssignedJobPage,
  type CompanyDetail,
  type CompanyDirectoryFilter,
  type CompanyDirectoryListInput,
  type CompanyDirectoryPage,
  type CompanyDuplicateCandidateRow,
  type CompanyDuplicateFilter,
  type CompanyDuplicateListInput,
  type CompanyDuplicatePage,
} from '@sparxie/sdk'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useMediaQuery } from '@/app/useMediaQuery'
import type {
  WorkspaceHistoryEntry,
  WorkspaceLocation,
} from '@/app/workspace-location'
import type { LocalWorkspaceCompaniesClient } from '../../runtime/local-connector-client.contract'
import { CompanyDetailView } from './CompanyDetailView'
import { CompanyDirectoryView } from './CompanyDirectoryView'
import { CompanyDuplicateQueueView } from './CompanyDuplicateQueueView'
import { CompanyDuplicateReviewModal } from './CompanyDuplicateReviewModal'
import {
  CompanyMutationModal,
  type CompanyModalAction,
} from './CompanyMutationModal'
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

const emptyAssignedJobs: CompanyAssignedJobPage = {
  items: [],
  pageInfo: {
    startCursor: null,
    endCursor: null,
    hasPreviousPage: false,
    hasNextPage: false,
  },
  totalCount: 0,
}

const emptyDuplicatePage: CompanyDuplicatePage = {
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
  readonly client: LocalWorkspaceCompaniesClient | null
  readonly workspaceId?: string | null
  readonly entry: WorkspaceHistoryEntry
  readonly onBack: () => void
  readonly onNavigate: (
    location: WorkspaceLocation,
    options?: { focusAnchor?: string },
  ) => void
}

export function CompaniesWorkspace({
  client,
  workspaceId = null,
  entry,
  onBack,
  onNavigate,
}: CompaniesWorkspaceProps) {
  const location = entry.location
  const duplicateMode = location.mode === 'duplicates'
  const directoryFilter = (location.filter ?? 'all') as CompanyDirectoryFilter
  const duplicateFilter = (location.filter ?? 'open') as CompanyDuplicateFilter
  const isNarrow = useMediaQuery('(max-width: 767px)')
  const [page, setPage] = useState<CompanyDirectoryPage>(emptyPage)
  const [duplicatePage, setDuplicatePage] = useState<CompanyDuplicatePage>(emptyDuplicatePage)
  const [selectedDetail, setSelectedDetail] = useState<{
    readonly resourceId: string
    readonly detail: CompanyDetail
    readonly assignedJobs: CompanyAssignedJobPage
  } | null>(null)
  const [selectedCandidate, setSelectedCandidate] =
    useState<CompanyDuplicateCandidateRow | null>(null)
  const [listFailure, setListFailure] = useState<string | null>(null)
  const [listLoading, setListLoading] = useState(true)
  const [detailFailure, setDetailFailure] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [modalAction, setModalAction] = useState<CompanyModalAction | null>(null)

  useEffect(() => {
    let current = true
    setPage(emptyPage)
    setDuplicatePage(emptyDuplicatePage)
    setListFailure(null)
    setListLoading(true)
    if (!client) {
      setListLoading(false)
      return
    }
    const cursorSchema = duplicateMode
      ? companyDuplicateCursorSchema
      : companyDirectoryCursorSchema
    const parsedCursor = location.cursor
      ? cursorSchema.safeParse(location.cursor)
      : null
    if (parsedCursor && !parsedCursor.success) {
      setListFailure('The requested Company page address is invalid.')
      setListLoading(false)
      return
    }
    const cursor = parsedCursor?.data
    const request = duplicateMode
      ? client.duplicates.list({
        filter: duplicateFilter,
        sort: 'score_desc',
        limit: 50,
        ...(cursor && location.cursorDirection === 'before'
          ? { before: cursor }
          : cursor ? { after: cursor } : {}),
      } as CompanyDuplicateListInput)
      : client.directory.list({
        filter: directoryFilter,
        sort: 'display_name_asc',
        limit: 50,
        ...(cursor && location.cursorDirection === 'before'
          ? { before: cursor }
          : cursor ? { after: cursor } : {}),
      } as CompanyDirectoryListInput)
    void request.then((nextPage) => {
      if (!current) return
      if (duplicateMode) {
        setDuplicatePage(nextPage as CompanyDuplicatePage)
      } else {
        setPage(nextPage as CompanyDirectoryPage)
      }
      setListLoading(false)
    }, (error: unknown) => {
      if (!current) return
      setListFailure(message(error, 'Companies could not be loaded.'))
      setListLoading(false)
    })
    return () => { current = false }
  }, [
    client,
    directoryFilter,
    duplicateFilter,
    duplicateMode,
    location.cursor,
    location.cursorDirection,
    reloadKey,
  ])

  useEffect(() => {
    let current = true
    const resourceId = location.resourceId
    setSelectedDetail(null)
    setSelectedCandidate(null)
    setDetailFailure(null)
    setDetailLoading(Boolean(resourceId))
    if (!resourceId) return
    if (!client) {
      setDetailLoading(false)
      return
    }
    const request = duplicateMode
      ? client.duplicates.get(resourceId)
      : Promise.all([
        client.get(resourceId),
        client.assignedJobs.list(resourceId, {
          filter: 'all',
          sort: 'role_title_asc',
          limit: 50,
        }),
      ])
    void request.then((result) => {
      if (!current) return
      if (duplicateMode) {
        setSelectedCandidate(result as CompanyDuplicateCandidateRow)
      } else {
        const [detail, assignedJobs] = result as [CompanyDetail, CompanyAssignedJobPage]
        setSelectedDetail({ resourceId, detail, assignedJobs })
      }
      setDetailLoading(false)
    }, (error: unknown) => {
      if (!current) return
      setDetailFailure(message(error, 'Company detail could not be loaded.'))
      setDetailLoading(false)
    })
    return () => { current = false }
  }, [client, duplicateMode, location.resourceId, reloadKey])

  const selected = selectedDetail?.resourceId === location.resourceId
    ? selectedDetail
    : null
  const candidate = selectedCandidate?.candidateId === location.resourceId
    ? selectedCandidate
    : null
  const detail = selected?.detail ?? null
  const showList = duplicateMode || !isNarrow || !location.resourceId
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Workspace data
          </p>
          <h2 className="text-xl font-semibold">Companies</h2>
          <p className="text-sm text-muted-foreground">
            {duplicateMode
              ? 'Review locally detected pairs without changing either Company.'
              : 'Maintain the workspace identities assigned to Jobs.'}
          </p>
        </div>
        {!duplicateMode ? (
          <Button
            type="button"
            disabled={!workspaceId || !client}
            onClick={() => setModalAction({ kind: 'create' })}
          >
            <Plus className="size-4" aria-hidden="true" />
            New Company
          </Button>
        ) : null}
      </header>
      <nav aria-label="Company workspace mode" className="flex gap-2 border-b border-border">
        <Button
          type="button"
          variant="ghost"
          className={!duplicateMode
            ? 'rounded-none border-b-2 border-primary text-foreground'
            : 'rounded-none text-muted-foreground'}
          aria-current={!duplicateMode ? 'page' : undefined}
          onClick={() => onNavigate({ view: 'companies' })}
        >
          Directory
        </Button>
        <Button
          type="button"
          variant="ghost"
          className={duplicateMode
            ? 'rounded-none border-b-2 border-primary text-foreground'
            : 'rounded-none text-muted-foreground'}
          aria-current={duplicateMode ? 'page' : undefined}
          onClick={() => onNavigate({
            view: 'companies',
            mode: 'duplicates',
            filter: 'open',
            sort: 'score_desc',
          })}
        >
          Possible duplicates
        </Button>
      </nav>
      {duplicateMode ? (
        <div className="min-w-0">
          <CompanyDuplicateQueueView
            entry={entry}
            failure={listFailure}
            loading={listLoading}
            onNavigate={onNavigate}
            onOpen={(candidateId, anchor) => onNavigate(
              { ...location, resourceId: candidateId },
              { focusAnchor: anchor },
            )}
            page={duplicatePage}
          />
          {detailLoading ? (
            <p role="status" className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner aria-label="Loading duplicate review" className="size-4" />
              Loading duplicate review…
            </p>
          ) : null}
          {detailFailure ? (
            <p role="alert" className="mt-3 text-sm text-destructive">{detailFailure}</p>
          ) : null}
        </div>
      ) : (
        <div className={location.resourceId && !isNarrow
          ? 'grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.85fr)]'
          : 'min-w-0'}>
          {showList ? (
            <CompanyDirectoryView
              entry={entry}
              failure={listFailure}
              loading={listLoading}
              onNavigate={onNavigate}
              onOpen={(companyId, anchor) => onNavigate(
                { ...location, resourceId: companyId },
                { focusAnchor: anchor },
              )}
              page={page}
            />
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
              {detail ? (
                <CompanyDetailView
                  assignedJobs={selected?.assignedJobs ?? emptyAssignedJobs}
                  detail={detail}
                  onAddAlias={() => setModalAction({
                    kind: 'alias_add',
                    company: detail.lookup.requested,
                  })}
                  onArchive={() => setModalAction({
                    kind: 'archive',
                    company: detail.lookup.requested,
                  })}
                  onEditAlias={(alias) => setModalAction({
                    kind: 'alias_update',
                    company: detail.lookup.requested,
                    alias,
                  })}
                  onEditIdentity={() => setModalAction({
                    kind: 'identity',
                    company: detail.lookup.requested,
                  })}
                  onEditNotes={() => setModalAction({
                    kind: 'notes',
                    company: detail.lookup.requested,
                  })}
                  onOpenCompany={(companyId) => onNavigate({
                    view: 'companies',
                    resourceId: companyId,
                  })}
                  onOpenJob={(jobId) => onNavigate({
                    view: 'jobs',
                    resourceId: jobId,
                  })}
                  onRemoveAlias={(alias) => setModalAction({
                    kind: 'alias_remove',
                    company: detail.lookup.requested,
                    alias,
                  })}
                  onRestore={() => setModalAction({
                    kind: 'restore',
                    company: detail.lookup.requested,
                  })}
                />
              ) : null}
            </ResourceDetailFrame>
          ) : null}
        </div>
      )}
      {client && workspaceId ? (
        <CompanyMutationModal
          action={modalAction}
          client={client}
          workspaceId={workspaceId}
          onClose={() => setModalAction(null)}
          onChanged={(companyId) => {
            setReloadKey((value) => value + 1)
            if (modalAction?.kind === 'create') {
              onNavigate({ view: 'companies', resourceId: companyId })
            }
          }}
        />
      ) : null}
      {client && workspaceId && duplicateMode && candidate ? (
        <CompanyDuplicateReviewModal
          key={`${candidate.candidateId}:${candidate.candidateRevision}`}
          candidate={candidate}
          client={client}
          workspaceId={workspaceId}
          onClose={onBack}
          onChanged={() => setReloadKey((value) => value + 1)}
          onOpenCompany={(companyId) => onNavigate({
            view: 'companies',
            resourceId: companyId,
          })}
        />
      ) : null}
    </div>
  )
}

function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}
