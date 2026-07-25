import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type {
  Application,
  CaptureListPresentation,
  CaptureResolutionPageInfo,
  Job,
  JobCompanyAssignmentPresentation,
  Opportunity,
  ValedictorianWorkspaceClientV2,
} from '@sparxie/sdk'

import { Button } from '@/components/ui/button'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  getRendererHttpWorkspaceClient,
  onRendererBackendStateChanged,
} from '@/app/renderer-http-client'
import { createCaptureConfig, type CaptureCompletionIntent } from './configs/capture-config'
import { jobConfig } from './configs/job-config'
import { opportunityConfig } from './configs/opportunity-config'
import { applicationConfig } from './configs/application-config'
import { useCaptureController } from './configs/capture-controller'
import { useJobController } from './configs/job-controller'
import { useJobCompanyAssignmentController } from './job-company-assignment-controller'
import { useOpportunityController } from './configs/opportunity-controller'
import { useApplicationController } from './configs/application-controller'
import {
  LifecycleTable,
  type LifecycleLoadState,
  type LifecycleTableConfig,
} from './lifecycle-table'
import { useLifecycleInvalidation } from './use-lifecycle-invalidation'
import { useActionQueue } from './use-action-queue'
import { ActionQueueMode } from './action-queue-mode'
import { JobResourceDetail } from '@/modules/workspace-resources/JobResourceDetail'
import { JobCompanyCell } from '@/modules/workspace-resources/JobCompanyCell'
import { CaptureCompletionModal } from './CaptureCompletionModal'
import {
  resetWorkspaceQuery,
  type WorkspaceHistoryEntry,
  type WorkspaceLocation,
} from '@/app/workspace-location'
import {
  nextWorkspacePage,
  nextLegacyForwardCursorPage,
  previousWorkspacePage,
  previousLegacyForwardCursorPage,
} from '@/app/workspace-page'
import {
  LifecycleRail,
  RefreshToolbar,
  phaseLabel,
} from './lifecycle-workbench-presentation'

export type LifecyclePhase = 'captures' | 'jobs' | 'opportunities' | 'applications'
type ApplicationMode = 'all' | 'action-queue'
type CaptureFilter = 'all' | 'needs_attention' | 'removed'

interface PhaseState<Row> {
  readonly data: ReadonlyArray<Row> | null
  readonly load: LifecycleLoadState
}

interface WorkbenchState {
  readonly captures: PhaseState<CaptureListPresentation>
  readonly jobs: PhaseState<Job>
  readonly opportunities: PhaseState<Opportunity>
  readonly applications: PhaseState<Application>
}

interface WorkbenchProps {
  readonly client?: ValedictorianWorkspaceClientV2 | null
  readonly workspaceId?: string | null
  readonly onSelectedPhaseChange?: (phase: LifecyclePhase) => void
  readonly selectedPhase?: LifecyclePhase
  readonly selectedResourceId?: string
  readonly onOpenResource?: (resourceId: string, focusAnchor: string) => void
  readonly onBackFromResource?: () => void
  readonly workspaceEntry?: WorkspaceHistoryEntry
  readonly onWorkspaceNavigate?: (
    location: WorkspaceLocation,
    options?: { cursorChain?: readonly WorkspaceLocation[] },
  ) => void
}

const initial: WorkbenchState = {
  captures: { data: null, load: { status: 'loading' } },
  jobs: { data: null, load: { status: 'loading' } },
  opportunities: { data: null, load: { status: 'loading' } },
  applications: { data: null, load: { status: 'loading' } },
}

export function LifecycleWorkbench({
  client: suppliedClient,
  workspaceId = null,
  onSelectedPhaseChange,
  selectedPhase,
  selectedResourceId,
  onOpenResource,
  onBackFromResource,
  workspaceEntry,
  onWorkspaceNavigate,
}: WorkbenchProps): ReactElement {
  const [client, setClient] = useState<ValedictorianWorkspaceClientV2 | null>(() =>
    suppliedClient === undefined ? getRendererHttpWorkspaceClient() : suppliedClient)
  const [uncontrolledSelected, setUncontrolledSelected] = useState<LifecyclePhase>('captures')
  const selected = selectedPhase ?? uncontrolledSelected
  const [uncontrolledApplicationMode, setUncontrolledApplicationMode] =
    useState<ApplicationMode>('all')
  const [uncontrolledCaptureFilter, setUncontrolledCaptureFilter] =
    useState<CaptureFilter>('all')
  const [showRemoved, setShowRemoved] = useState(false)
  const [captures, setCaptures] =
    useState<PhaseState<CaptureListPresentation>>(initial.captures)
  const [capturePageInfo, setCapturePageInfo] = useState<CaptureResolutionPageInfo>({
    startCursor: null,
    endCursor: null,
    hasPreviousPage: false,
    hasNextPage: false,
  })
  const [captureTotalCount, setCaptureTotalCount] = useState(0)
  const [completion, setCompletion] = useState<{
    readonly row: CaptureListPresentation
    readonly intent: CaptureCompletionIntent
  } | null>(null)
  const [jobs, setJobs] = useState<PhaseState<Job>>(initial.jobs)
  const [jobAssignments, setJobAssignments] = useState<
    ReadonlyMap<string, JobCompanyAssignmentPresentation>
  >(new Map())
  const [allJobs, setAllJobs] = useState<PhaseState<Job>>(initial.jobs)
  const [jobNextCursor, setJobNextCursor] = useState<string | null>(null)
  const [opportunities, setOpportunities] = useState<PhaseState<Opportunity>>(initial.opportunities)
  const [applications, setApplications] = useState<PhaseState<Application>>(initial.applications)
  const phaseGenerations = useRef<Record<LifecyclePhase, number>>({
    captures: 0,
    jobs: 0,
    opportunities: 0,
    applications: 0,
  })
  const allJobsGeneration = useRef(0)
  const addressedApplicationMode = workspaceEntry?.location.view === 'applications'
    ? (workspaceEntry.location.mode ?? 'all') as ApplicationMode
    : undefined
  const applicationMode = addressedApplicationMode ?? uncontrolledApplicationMode
  const capturesLocation = workspaceEntry?.location.view === 'captures'
    ? workspaceEntry.location
    : { view: 'captures' as const }
  const captureFilter = workspaceEntry?.location.view === 'captures'
    ? (capturesLocation.filter ?? 'all') as CaptureFilter
    : uncontrolledCaptureFilter
  const jobsLocation = workspaceEntry?.location.view === 'jobs'
    ? workspaceEntry.location
    : { view: 'jobs' as const }
  const jobsShowRemoved = workspaceEntry?.location.view === 'jobs'
    ? jobsLocation.filter === 'include_removed'
    : showRemoved

  const selectPhase = useCallback((phase: LifecyclePhase) => {
    if (selectedPhase === undefined) {
      setUncontrolledSelected(phase)
    }
    onSelectedPhaseChange?.(phase)
  }, [onSelectedPhaseChange, selectedPhase])

  useEffect(() => {
    if (suppliedClient !== undefined) {
      setClient(suppliedClient)
      return
    }
    const resolveClient = () => setClient(getRendererHttpWorkspaceClient())
    resolveClient()
    return onRendererBackendStateChanged(resolveClient)
  }, [suppliedClient])

  const actionQueue = useActionQueue({
    client,
    active: selected === 'applications' && applicationMode === 'action-queue',
  })

  const load = useCallback(async function loadAllPhases() {
    const generations: Record<LifecyclePhase, number> = {
      captures: phaseGenerations.current.captures,
      jobs: phaseGenerations.current.jobs,
      opportunities: ++phaseGenerations.current.opportunities,
      applications: ++phaseGenerations.current.applications,
    }
    const isCurrent = (phase: LifecyclePhase) => generations[phase] === phaseGenerations.current[phase]
    if (!client) {
      const unavailable: LifecycleLoadState = {
        status: 'failure',
        message: 'Workspace HTTP client is unavailable.',
      }
      setCaptures({ data: null, load: unavailable })
      setOpportunities({ data: null, load: unavailable })
      setApplications({ data: null, load: unavailable })
      return
    }
    setOpportunities((prev) => ({ data: prev.data, load: { status: 'loading' } }))
    setApplications((prev) => ({ data: prev.data, load: { status: 'loading' } }))
    await Promise.all([
      loadAll((cursor) => opportunityConfig.list(client, {
        cursor,
        includeRemoved: showRemoved,
        limit: 100,
      })).then(
        (items) => { if (isCurrent('opportunities')) setOpportunities({ data: items, load: { status: 'loaded' } }) },
        (error: unknown) => { if (isCurrent('opportunities')) setOpportunities((prev) => ({
          data: prev.data,
          load: loadFailure(error, () => void loadAllPhases()),
        })) },
      ),
      loadAll((cursor) => applicationConfig.list(client, {
        cursor,
        includeRemoved: showRemoved,
        limit: 100,
      })).then(
        (items) => { if (isCurrent('applications')) setApplications({ data: items, load: { status: 'loaded' } }) },
        (error: unknown) => { if (isCurrent('applications')) setApplications((prev) => ({
          data: prev.data,
          load: loadFailure(error, () => void loadAllPhases()),
        })) },
      ),
    ])
  }, [client, showRemoved])

  const loadCapturesPage = useCallback(async function loadVisibleCapturesPage() {
    const generation = ++phaseGenerations.current.captures
    if (!client) {
      setCaptures({
        data: null,
        load: { status: 'failure', message: 'Workspace HTTP client is unavailable.' },
      })
      setCaptureTotalCount(0)
      setCapturePageInfo({
        startCursor: null,
        endCursor: null,
        hasPreviousPage: false,
        hasNextPage: false,
      })
      return
    }
    setCaptures((previous) => ({ data: previous.data, load: { status: 'loading' } }))
    try {
      const page = await client.captureResolutionV2.list({
        filter: captureFilter,
        sort: 'observed_desc',
        limit: 50,
        ...(capturesLocation.cursor === undefined
          ? {}
          : capturesLocation.cursorDirection === 'before'
            ? { before: capturesLocation.cursor }
            : { after: capturesLocation.cursor }),
      })
      if (generation !== phaseGenerations.current.captures) return
      setCaptures({ data: page.items, load: { status: 'loaded' } })
      setCapturePageInfo(page.pageInfo)
      setCaptureTotalCount(page.totalCount)
    } catch (error) {
      if (generation !== phaseGenerations.current.captures) return
      setCaptures((previous) => ({
        data: previous.data,
        load: loadFailure(error, () => { void loadCapturesPage().catch(() => {}) }),
      }))
      setCaptureTotalCount(0)
      throw error
    }
  }, [
    captureFilter,
    capturesLocation.cursor,
    capturesLocation.cursorDirection,
    client,
  ])

  const loadJobsPage = useCallback(async function loadVisibleJobsPage() {
    const generation = ++phaseGenerations.current.jobs
    if (!client) {
      setJobs({
        data: null,
        load: { status: 'failure', message: 'Workspace HTTP client is unavailable.' },
      })
      setJobAssignments(new Map())
      setJobNextCursor(null)
      return
    }
    setJobs((previous) => ({ data: previous.data, load: { status: 'loading' } }))
    try {
      const page = await jobConfig.list(client, {
        includeRemoved: jobsShowRemoved,
        limit: 50,
        ...(jobsLocation.cursor === undefined ? {} : { cursor: jobsLocation.cursor }),
      })
      const assignments = await Promise.all(
        page.items.map((job) => client.companyAssignments.get(job.id)),
      )
      if (generation !== phaseGenerations.current.jobs) return
      setJobs({ data: page.items, load: { status: 'loaded' } })
      setJobAssignments(new Map(assignments.map((assignment) => [
        assignment.jobId,
        assignment,
      ])))
      setJobNextCursor(page.nextCursor)
    } catch (error) {
      if (generation !== phaseGenerations.current.jobs) return
      setJobs((previous) => ({
        data: previous.data,
        load: loadFailure(error, () => void loadVisibleJobsPage()),
      }))
      setJobNextCursor(null)
    }
  }, [client, jobsLocation.cursor, jobsShowRemoved])

  const loadAllJobs = useCallback(async function loadCompleteJobsProjection() {
    const generation = ++allJobsGeneration.current
    if (!client) {
      setAllJobs({
        data: null,
        load: { status: 'failure', message: 'Workspace HTTP client is unavailable.' },
      })
      return
    }
    setAllJobs((previous) => ({ data: previous.data, load: { status: 'loading' } }))
    await loadAll((cursor) => jobConfig.list(client, {
      cursor,
      includeRemoved: jobsShowRemoved,
      limit: 100,
    })).then(
      (items) => {
        if (generation === allJobsGeneration.current) {
          setAllJobs({ data: items, load: { status: 'loaded' } })
        }
      },
      (error: unknown) => {
        if (generation === allJobsGeneration.current) {
          setAllJobs((previous) => ({
            data: previous.data,
            load: loadFailure(error, () => void loadCompleteJobsProjection()),
          }))
        }
      },
    )
  }, [client, jobsShowRemoved])

  useEffect(() => { void load() }, [load])
  useEffect(() => { void loadCapturesPage().catch(() => {}) }, [loadCapturesPage])
  useEffect(() => { void loadJobsPage() }, [loadJobsPage])
  useEffect(() => { void loadAllJobs() }, [loadAllJobs])

  const refreshPhase = useCallback(async function refreshLifecyclePhase(phase: LifecyclePhase) {
    if (!client) return
    const generation = ++phaseGenerations.current[phase]
    const isCurrent = () => generation === phaseGenerations.current[phase]
    const commit = <Row,>(items: ReadonlyArray<Row>, setter: (state: PhaseState<Row>) => void) => {
      if (!isCurrent()) throw new Error(`${phase} refresh was superseded before completion.`)
      setter({ data: items, load: { status: 'loaded' } })
    }
    if (phase === 'captures') {
      await loadCapturesPage()
    } else if (phase === 'jobs') {
      await loadJobsPage()
    } else if (phase === 'opportunities') {
      setOpportunities((prev) => ({ data: prev.data, load: { status: 'loading' } }))
      await loadAll((cursor) => opportunityConfig.list(client, {
        cursor,
        includeRemoved: showRemoved,
        limit: 100,
      })).then(
        (items) => commit(items, setOpportunities),
        (error: unknown) => {
          if (isCurrent()) setOpportunities((prev) => ({ data: prev.data, load: loadFailure(error, () => { void refreshLifecyclePhase(phase).catch(() => {}) }) }))
          throw error
        },
      )
    } else {
      setApplications((prev) => ({ data: prev.data, load: { status: 'loading' } }))
      await loadAll((cursor) => applicationConfig.list(client, {
        cursor,
        includeRemoved: showRemoved,
        limit: 100,
      })).then(
        (items) => commit(items, setApplications),
        (error: unknown) => {
          if (isCurrent()) setApplications((prev) => ({ data: prev.data, load: loadFailure(error, () => { void refreshLifecyclePhase(phase).catch(() => {}) }) }))
          throw error
        },
      )
    }
  }, [client, loadCapturesPage, loadJobsPage, showRemoved])

  const refreshCaptures = useCallback(() => refreshPhase('captures'), [refreshPhase])
  const refreshJobs = useCallback(async () => {
    await Promise.all([loadJobsPage(), loadAllJobs()])
  }, [loadAllJobs, loadJobsPage])
  const refreshOpportunities = useCallback(() => refreshPhase('opportunities'), [refreshPhase])
  const refreshApplications = useCallback(() => refreshPhase('applications'), [refreshPhase])
  const refreshSelected = useCallback(
    () => {
      if (selected === 'applications' && applicationMode === 'action-queue') {
        return actionQueue.refresh()
      }
      if (selected === 'jobs') {
        return refreshJobs()
      }
      return refreshPhase(selected)
    },
    [actionQueue, applicationMode, refreshJobs, refreshPhase, selected],
  )
  const refreshApplicationPresentations = useCallback(async () => {
    await Promise.all([refreshApplications(), actionQueue.refresh()])
  }, [actionQueue, refreshApplications])
  const refreshAll = useCallback(async () => {
    await Promise.all([
      refreshCaptures(),
      refreshJobs(),
      refreshOpportunities(),
      refreshApplications(),
      actionQueue.refresh(),
    ])
  }, [actionQueue, refreshApplications, refreshCaptures, refreshJobs, refreshOpportunities])

  const refreshSelectedFromUi = useCallback(() => {
    void refreshSelected().catch(() => {})
  }, [refreshSelected])

  useLifecycleInvalidation(refreshSelected, { enabled: Boolean(client), intervalMs: 60_000 })

  const closeCompletionForRemovedCapture = useCallback((captureId: string) => {
    setCompletion((current) => current?.row.captureId === captureId ? null : current)
  }, [])
  const captureController = useCaptureController({
    client,
    refresh: refreshCaptures,
    onRemoved: closeCompletionForRemovedCapture,
  })
  const jobController = useJobController({ client, refresh: refreshJobs, refreshDestination: refreshOpportunities, refreshAll })
  const jobCompanyAssignmentController = useJobCompanyAssignmentController({
    assignments: jobAssignments,
    client,
    refresh: refreshJobs,
    workspaceId,
  })
  const opportunityController = useOpportunityController({ client, refresh: refreshOpportunities, refreshDestination: refreshApplications, refreshAll })
  const applicationController = useApplicationController({ client, refresh: refreshApplicationPresentations, refreshAll })

  const captureTable = useMemo<LifecycleTableConfig<CaptureListPresentation>>(
    () => createCaptureConfig({
      onOpenJob: onOpenResource,
      onComplete: (_captureId, intent, row) => setCompletion({ row, intent }),
      onRemove: captureController.openRemove,
      onRestore: captureController.openRestore,
      onViewHistory: captureController.openHistory,
    }).table,
    [captureController, onOpenResource],
  )
  const openCompletionRemoval = useCallback(() => {
    if (completion) captureController.openRemove(completion.row)
  }, [captureController, completion])
  const jobTable = useMemo<LifecycleTableConfig<Job>>(
    () => ({
      ...jobConfig.table,
      columns: jobConfig.table.columns.map((column) => {
        if (column.key === 'company') {
          return {
            ...column,
            render: (row: Job) => {
              const assignment = jobAssignments.get(row.id)
              return assignment ? (
                <JobCompanyCell
                  assignment={assignment}
                  onOpenCompany={(companyId) => onWorkspaceNavigate?.({
                    view: 'companies',
                    resourceId: companyId,
                  })}
                />
              ) : null
            },
          }
        }
        return column.key === 'role' && onOpenResource
          ? {
              ...column,
              render: (row: Job) => {
                const anchor = `job-link-${row.id}`
                return (
                  <Button
                    id={anchor}
                    type="button"
                    variant="link"
                    className="h-auto justify-start p-0 text-left"
                    onClick={() => onOpenResource(row.id, anchor)}
                  >
                    {row.facts.roleTitle}
                  </Button>
                )
              },
            }
          : column
      }),
      extensions: {
        ...jobController.extensions,
        formActions: [
          ...(jobController.extensions.formActions ?? []),
          jobCompanyAssignmentController.action,
        ],
      },
    }),
    [
      jobAssignments,
      jobCompanyAssignmentController.action,
      jobController,
      onOpenResource,
      onWorkspaceNavigate,
    ],
  )
  const opportunityTable = useMemo<LifecycleTableConfig<Opportunity>>(
    () => ({ ...opportunityConfig.table, extensions: opportunityController.extensions }),
    [opportunityController],
  )
  const applicationTable = useMemo<LifecycleTableConfig<Application>>(
    () => ({ ...applicationConfig.table, extensions: applicationController.extensions }),
    [applicationController],
  )

  const counts = {
    captures: captureTotalCount,
    jobs: allJobs.data?.length ?? 0,
    opportunities: opportunities.data?.length ?? 0,
    applications: applications.data?.length ?? 0,
  }
  const jobsEntry: WorkspaceHistoryEntry = workspaceEntry?.location.view === 'jobs'
    ? workspaceEntry
    : { location: jobsLocation, cursorChain: [] }
  const capturesEntry: WorkspaceHistoryEntry = workspaceEntry?.location.view === 'captures'
    ? workspaceEntry
    : { location: capturesLocation, cursorChain: [] }
  const setCaptureFilter = (next: CaptureFilter) => {
    if (onWorkspaceNavigate && workspaceEntry?.location.view === 'captures') {
      onWorkspaceNavigate(resetWorkspaceQuery(capturesLocation, {
        filter: next,
        sort: 'observed_desc',
      }), { cursorChain: [] })
      return
    }
    setUncontrolledCaptureFilter(next)
  }
  const setJobsShowRemoved = (next: boolean) => {
    if (onWorkspaceNavigate && workspaceEntry?.location.view === 'jobs') {
      onWorkspaceNavigate(resetWorkspaceQuery(jobsLocation, {
        filter: next ? 'include_removed' : 'all',
      }), { cursorChain: [] })
      return
    }
    setShowRemoved(next)
  }
  const setAddressedApplicationMode = (next: ApplicationMode) => {
    if (onWorkspaceNavigate && workspaceEntry?.location.view === 'applications') {
      onWorkspaceNavigate({ view: 'applications', mode: next }, { cursorChain: [] })
      return
    }
    setUncontrolledApplicationMode(next)
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header aria-labelledby="lifecycle-view-title" className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Job lifecycle
        </p>
        <h2 id="lifecycle-view-title" className="text-xl font-semibold">
          {phaseLabel(selected)}
        </h2>
        <p className="text-sm text-muted-foreground">
          {selected === 'captures'
            ? 'Review incoming leads, processing outcomes, and the next useful action.'
            : `${phaseLabel(selected)} are a first-class stage of the Job lifecycle.`}
        </p>
      </header>
      <LifecycleRail selected={selected} onSelect={selectPhase} counts={counts} />
      {selected === 'captures' ? (
        <div className="flex min-w-0 flex-col gap-4">
          <ToggleGroup
            type="single"
            aria-label="Capture filter"
            variant="outline"
            size="sm"
            className="w-fit flex-wrap"
            value={captureFilter}
            onValueChange={(value) => {
              if (value) setCaptureFilter(value as CaptureFilter)
            }}
          >
            <ToggleGroupItem value="all">All</ToggleGroupItem>
            <ToggleGroupItem value="needs_attention">Needs attention</ToggleGroupItem>
            <ToggleGroupItem value="removed">Removed</ToggleGroupItem>
          </ToggleGroup>
          <LifecycleTable
            config={captureTable}
            data={captures.data}
            state={captures.load}
            onRefresh={refreshSelected}
            toolbar={(
              <CaptureToolbar
                total={captureTotalCount}
                loading={captures.load.status === 'loading'}
                onRefresh={refreshSelectedFromUi}
                onAdd={captureController.openCreate}
              />
            )}
          />
          <Pagination aria-label="Capture pages" className="justify-end">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  disabled={!onWorkspaceNavigate || !capturePageInfo.hasPreviousPage}
                  onClick={() => {
                    const transition = previousWorkspacePage(capturesEntry, capturePageInfo)
                    if (transition) onWorkspaceNavigate?.(transition.location, {
                      cursorChain: transition.cursorChain,
                    })
                  }}
                >
                  Previous
                </PaginationPrevious>
              </PaginationItem>
              <PaginationItem>
                <PaginationNext
                  disabled={!onWorkspaceNavigate || !capturePageInfo.hasNextPage}
                  onClick={() => {
                    const transition = nextWorkspacePage(capturesEntry, capturePageInfo)
                    if (transition) onWorkspaceNavigate?.(transition.location, {
                      cursorChain: transition.cursorChain,
                    })
                  }}
                >
                  Next
                </PaginationNext>
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      ) : null}
      {selected === 'jobs' ? (
        <div className={selectedResourceId
          ? 'grid min-w-0 gap-5 md:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.75fr)]'
          : 'min-w-0'}>
          <div className={selectedResourceId ? 'hidden min-w-0 md:block' : 'min-w-0'}>
            <LifecycleTable
              config={jobTable}
              data={jobs.data}
              state={jobs.load}
              focusLoadFailure={!selectedResourceId}
              onRefresh={refreshSelected}
              toolbar={<RefreshToolbar caption="Jobs" total={counts.jobs} loading={jobs.load.status === 'loading'} onRefresh={refreshSelectedFromUi} showRemoved={jobsShowRemoved} onShowRemovedChange={setJobsShowRemoved} onAdd={jobController.openCreate} addLabel="Add job" />}
            />
            <Pagination aria-label="Jobs pages" className="mt-3 justify-end">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    disabled={!onWorkspaceNavigate || jobsEntry.cursorChain.length === 0}
                    onClick={() => {
                      const transition = previousLegacyForwardCursorPage(jobsEntry)
                      if (transition) onWorkspaceNavigate?.(transition.location, {
                        cursorChain: transition.cursorChain,
                      })
                    }}
                  >
                    Previous
                  </PaginationPrevious>
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext
                    disabled={!onWorkspaceNavigate || jobNextCursor === null}
                    onClick={() => {
                      const transition = nextLegacyForwardCursorPage(
                        jobsEntry,
                        jobNextCursor,
                      )
                      if (transition) onWorkspaceNavigate?.(transition.location, {
                        cursorChain: transition.cursorChain,
                      })
                    }}
                  >
                    Next
                  </PaginationNext>
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
          {selectedResourceId ? (
            <JobResourceDetail
              client={client}
              jobId={selectedResourceId}
              onBack={onBackFromResource ?? (() => undefined)}
              onOpenCompany={(companyId) => onWorkspaceNavigate?.({
                view: 'companies',
                resourceId: companyId,
              })}
            />
          ) : null}
        </div>
      ) : null}
      {selected === 'opportunities' ? (
        <LifecycleTable
          config={opportunityTable}
          data={opportunities.data}
          state={opportunities.load}
          onRefresh={refreshSelected}
          toolbar={<RefreshToolbar caption="Opportunities" total={counts.opportunities} loading={opportunities.load.status === 'loading'} onRefresh={refreshSelectedFromUi} showRemoved={showRemoved} onShowRemovedChange={setShowRemoved} onAdd={opportunityController.openCreate} addLabel="Add opportunity" />}
        />
      ) : null}
      {selected === 'applications' ? (
        <div className="flex min-w-0 flex-col gap-4">
          <ToggleGroup
            type="single"
            aria-label="Applications view mode"
            variant="outline"
            size="sm"
            className="w-fit flex-wrap"
            value={applicationMode}
            onValueChange={(value) => {
              if (value) setAddressedApplicationMode(value as ApplicationMode)
            }}
          >
            <ToggleGroupItem value="all">All</ToggleGroupItem>
            <ToggleGroupItem value="action-queue">Action Queue</ToggleGroupItem>
          </ToggleGroup>
          {applicationMode === 'all' ? (
            <LifecycleTable
              config={applicationTable}
              data={applications.data}
              state={applications.load}
              onRefresh={refreshSelected}
              toolbar={<RefreshToolbar caption="Applications" total={counts.applications} loading={applications.load.status === 'loading'} onRefresh={refreshSelectedFromUi} showRemoved={showRemoved} onShowRemovedChange={setShowRemoved} onAdd={applicationController.openCreate} addLabel="Add application" />}
            />
          ) : (
            <ActionQueueMode
              state={actionQueue.state}
              bucket={actionQueue.bucket}
              onBucketChange={actionQueue.setBucket}
              onNextPage={actionQueue.nextPage}
              onPreviousPage={actionQueue.previousPage}
              onRefresh={refreshSelectedFromUi}
              applications={applications.data}
              client={client}
              extensions={applicationController.extensions}
            />
          )}
        </div>
      ) : null}
      {captureController.modalLayer}
      <CaptureCompletionModal
        captureId={completion?.row.captureId ?? null}
        client={client}
        intent={completion?.intent ?? null}
        workspaceId={workspaceId}
        onClose={() => setCompletion(null)}
        onCreated={async () => {
          await Promise.all([refreshCaptures(), refreshJobs()])
        }}
        onAssignmentChanged={refreshJobs}
        onViewJob={(jobId) => onOpenResource?.(jobId, `capture-job-link-${completion?.row.captureId ?? ''}`)}
        onRemoveCapture={openCompletionRemoval}
        removalPending={captureController.removalPending}
      />
      {jobController.modalLayer}
      {jobCompanyAssignmentController.modalLayer}
      {opportunityController.modalLayer}
      {applicationController.modalLayer}
    </div>
  )
}

function msg(error: unknown): string {
  return error instanceof Error ? error.message : 'Load failed.'
}

function loadFailure(error: unknown, onRetry: () => void): LifecycleLoadState {
  return { status: 'failure', message: msg(error), onRetry }
}

interface LifecyclePage<Row> {
  readonly items: ReadonlyArray<Row>
  readonly nextCursor: string | null
}

async function loadAll<Row>(
  fetchPage: (cursor?: string) => Promise<LifecyclePage<Row>>,
): Promise<ReadonlyArray<Row>> {
  const items: Row[] = []
  let cursor: string | undefined
  do {
    const page = await fetchPage(cursor)
    items.push(...page.items)
    cursor = page.nextCursor ?? undefined
  } while (cursor !== undefined)
  return items
}

function CaptureToolbar({
  total,
  loading,
  onRefresh,
  onAdd,
}: {
  readonly total: number
  readonly loading: boolean
  readonly onRefresh: () => void
  readonly onAdd: () => void
}): ReactElement {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">
        Captures · {total} record{total === 1 ? '' : 's'}
      </p>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" onClick={onAdd}>
          Add capture
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={loading}
        >
          Refresh
        </Button>
      </div>
    </div>
  )
}
