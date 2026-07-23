import { useEffect, useState } from 'react'
import {
  companyDirectoryCursorSchema,
  type CompanyAssignedJobPage,
  type CompanyCapability,
  type CompanyDetail,
  type CompanyDirectoryFilter,
  type CompanyDirectoryPage,
  type WorkspaceCompaniesClient,
} from '@sparxie/sdk'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useMediaQuery } from '@/app/useMediaQuery'
import type {
  WorkspaceHistoryEntry,
  WorkspaceLocation,
} from '@/app/workspace-location'
import { CompanyDetailView } from './CompanyDetailView'
import { CompanyDirectoryView } from './CompanyDirectoryView'
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

const CAPABILITY_REFRESH_MS = 60_000

interface CompaniesWorkspaceProps {
  readonly client: WorkspaceCompaniesClient | null
  readonly workspaceId?: string | null
  readonly entry: WorkspaceHistoryEntry
  readonly onBack: () => void
  readonly onNavigate: (
    location: WorkspaceLocation,
    options?: { cursorChain?: readonly WorkspaceLocation[]; focusAnchor?: string },
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
  const filter = (location.filter ?? 'all') as CompanyDirectoryFilter
  const isNarrow = useMediaQuery('(max-width: 767px)')
  const [page, setPage] = useState<CompanyDirectoryPage>(emptyPage)
  const [capability, setCapability] = useState<CompanyCapability | null>(null)
  const [capabilityFailure, setCapabilityFailure] = useState<string | null>(null)
  const [selectedDetail, setSelectedDetail] = useState<{
    readonly resourceId: string
    readonly detail: CompanyDetail
    readonly assignedJobs: CompanyAssignedJobPage
  } | null>(null)
  const [listFailure, setListFailure] = useState<string | null>(null)
  const [listLoading, setListLoading] = useState(true)
  const [detailFailure, setDetailFailure] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [modalAction, setModalAction] = useState<CompanyModalAction | null>(null)

  useEffect(() => {
    let current = true
    let refreshTimer: number | undefined
    setCapability(null)
    setCapabilityFailure(null)
    if (!client) {
      setCapabilityFailure('Workspace Company data is unavailable.')
      return
    }
    const loadCapability = async () => {
      try {
        const nextCapability = await client.capability.get()
        if (!current) return
        setCapability(nextCapability)
        if (nextCapability.status === 'migrating') {
          refreshTimer = window.setTimeout(loadCapability, CAPABILITY_REFRESH_MS)
        }
      } catch {
        if (current) {
          setCapabilityFailure('Workspace Company capability could not be loaded.')
        }
      }
    }
    void loadCapability()
    return () => {
      current = false
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
    }
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
      setListFailure(message(error, 'Companies could not be loaded.'))
      setListLoading(false)
    })
    return () => { current = false }
  }, [
    capability?.status,
    client,
    filter,
    location.cursor,
    location.cursorDirection,
    reloadKey,
  ])

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
    void Promise.all([
      client.get(resourceId),
      client.assignedJobs.list(resourceId, {
        filter: 'all',
        sort: 'role_title_asc',
        limit: 50,
      }),
    ]).then(([detail, assignedJobs]) => {
      if (!current) return
      setSelectedDetail({ resourceId, detail, assignedJobs })
      setDetailLoading(false)
    }, (error: unknown) => {
      if (!current) return
      setDetailFailure(message(error, 'Company detail could not be loaded.'))
      setDetailLoading(false)
    })
    return () => { current = false }
  }, [capability?.status, client, location.resourceId, reloadKey])

  const selected = selectedDetail?.resourceId === location.resourceId
    ? selectedDetail
    : null
  const detail = selected?.detail ?? null
  const showList = !isNarrow || !location.resourceId
  const ready = capability?.status === 'ready'
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Workspace data
          </p>
          <h2 className="text-xl font-semibold">Companies</h2>
          <p className="text-sm text-muted-foreground">
            Maintain the workspace identities assigned to Jobs.
          </p>
        </div>
        <Button
          type="button"
          disabled={!ready || !workspaceId || !client}
          onClick={() => setModalAction({ kind: 'create' })}
        >
          <Plus className="size-4" aria-hidden="true" />
          New Company
        </Button>
      </header>
      <CapabilityState capability={capability} failure={capabilityFailure} />
      {ready ? (
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
                { cursorChain: entry.cursorChain, focusAnchor: anchor },
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
                  onOpenCompany={(companyId) => onNavigate({ view: 'companies', resourceId: companyId })}
                  onOpenJob={(jobId) => onNavigate({ view: 'jobs', resourceId: jobId })}
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
      ) : null}
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
    </div>
  )
}

function CapabilityState({
  capability,
  failure,
}: {
  readonly capability: CompanyCapability | null
  readonly failure: string | null
}) {
  if (failure) return <p role="alert" className="text-sm text-destructive">{failure}</p>
  if (!capability) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner aria-label="Loading Company capability" className="size-4" />
        Checking Company availability…
      </p>
    )
  }
  if (capability.status === 'migrating') {
    return (
      <section className="rounded-md border border-border bg-card/60 p-5" aria-live="polite">
        <h3 className="font-semibold">Preparing Workspace Companies</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {capability.completed} of {capability.total} Jobs have Company coverage.
          Company-backed actions remain unavailable until verification completes.
        </p>
      </section>
    )
  }
  if (capability.status === 'blocked') {
    return (
      <section className="rounded-md border border-destructive/40 bg-destructive/5 p-5" role="alert">
        <h3 className="font-semibold">Workspace Companies are unavailable</h3>
        <p className="mt-1 text-sm text-muted-foreground">{capability.message}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          {capability.issueCount} integrity {capability.issueCount === 1 ? 'issue' : 'issues'} detected.
        </p>
      </section>
    )
  }
  return null
}

function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}
