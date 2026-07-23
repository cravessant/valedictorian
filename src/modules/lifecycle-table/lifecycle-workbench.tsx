import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { ArrowRight } from 'lucide-react'
import type {
  Application,
  Capture,
  Job,
  Opportunity,
  ValedictorianWorkspaceClient,
} from '@sparxie/sdk'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { captureConfig } from './configs/capture-config'
import { jobConfig } from './configs/job-config'
import { opportunityConfig } from './configs/opportunity-config'
import { applicationConfig } from './configs/application-config'
import { useCaptureController } from './configs/capture-controller'
import { useJobController } from './configs/job-controller'
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
import { CaptureProcessingMode } from './capture-processing-mode'
import {
  onOpenCapturesForRun,
  type CaptureRunFilter,
  type ConnectorProvenanceTarget,
} from '@/app/capture-navigation'
import { JobResourceDetail } from '@/modules/workspace-resources/JobResourceDetail'
import {
  resetWorkspaceQuery,
  type WorkspaceHistoryEntry,
  type WorkspaceLocation,
} from '@/app/workspace-location'
import {
  nextLegacyForwardCursorPage,
  previousLegacyForwardCursorPage,
} from '@/app/workspace-page'

export type LifecyclePhase = 'captures' | 'jobs' | 'opportunities' | 'applications'
type ApplicationMode = 'all' | 'action-queue'
type CaptureMode = 'all' | 'processing'

interface PhaseState<Row> {
  readonly data: ReadonlyArray<Row> | null
  readonly load: LifecycleLoadState
}

interface WorkbenchState {
  readonly captures: PhaseState<Capture>
  readonly jobs: PhaseState<Job>
  readonly opportunities: PhaseState<Opportunity>
  readonly applications: PhaseState<Application>
}

interface WorkbenchProps {
  readonly client?: ValedictorianWorkspaceClient | null
  readonly initialConnectorRunId?: string | null
  readonly onConnectorRunFilterChange?: (filter: CaptureRunFilter | null) => void
  readonly onOpenConnectorProvenance?: (target: ConnectorProvenanceTarget) => void
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
  initialConnectorRunId = null,
  onConnectorRunFilterChange,
  onOpenConnectorProvenance,
  onSelectedPhaseChange,
  selectedPhase,
  selectedResourceId,
  onOpenResource,
  onBackFromResource,
  workspaceEntry,
  onWorkspaceNavigate,
}: WorkbenchProps): ReactElement {
  const [client, setClient] = useState<ValedictorianWorkspaceClient | null>(() =>
    suppliedClient === undefined ? getRendererHttpWorkspaceClient() : suppliedClient)
  const [uncontrolledSelected, setUncontrolledSelected] = useState<LifecyclePhase>('captures')
  const selected = selectedPhase ?? uncontrolledSelected
  const [uncontrolledApplicationMode, setUncontrolledApplicationMode] =
    useState<ApplicationMode>('all')
  const [captureMode, setCaptureMode] = useState<CaptureMode>('all')
  const [connectorRunId, setConnectorRunId] = useState<string | null>(initialConnectorRunId)
  const [showRemoved, setShowRemoved] = useState(false)
  const [captures, setCaptures] = useState<PhaseState<Capture>>(initial.captures)
  const [jobs, setJobs] = useState<PhaseState<Job>>(initial.jobs)
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

  useEffect(() => onOpenCapturesForRun((filter) => {
    setConnectorRunId(filter.connectorRunId)
    onConnectorRunFilterChange?.(filter)
    setCaptureMode('all')
    selectPhase('captures')
  }), [onConnectorRunFilterChange, selectPhase])

  const actionQueue = useActionQueue({
    client,
    active: selected === 'applications' && applicationMode === 'action-queue',
  })

  const load = useCallback(async function loadAllPhases() {
    const generations: Record<LifecyclePhase, number> = {
      captures: ++phaseGenerations.current.captures,
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
    setCaptures((prev) => ({ data: prev.data, load: { status: 'loading' } }))
    setOpportunities((prev) => ({ data: prev.data, load: { status: 'loading' } }))
    setApplications((prev) => ({ data: prev.data, load: { status: 'loading' } }))
    await Promise.all([
      loadAll((cursor) => captureConfig.list(client, {
        cursor,
        ...(connectorRunId ? { connectorRunId } : {}),
        includeRemoved: showRemoved,
        limit: 100,
      })).then(
        (items) => { if (isCurrent('captures')) setCaptures({ data: items, load: { status: 'loaded' } }) },
        (error: unknown) => { if (isCurrent('captures')) setCaptures((prev) => ({
          data: prev.data,
          load: loadFailure(error, () => void loadAllPhases()),
        })) },
      ),
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
  }, [client, connectorRunId, showRemoved])

  const loadJobsPage = useCallback(async function loadVisibleJobsPage() {
    const generation = ++phaseGenerations.current.jobs
    if (!client) {
      setJobs({
        data: null,
        load: { status: 'failure', message: 'Workspace HTTP client is unavailable.' },
      })
      setJobNextCursor(null)
      return
    }
    setJobs((previous) => ({ data: previous.data, load: { status: 'loading' } }))
    await jobConfig.list(client, {
      includeRemoved: jobsShowRemoved,
      limit: 50,
      ...(jobsLocation.cursor === undefined ? {} : { cursor: jobsLocation.cursor }),
    }).then(
      (page) => {
        if (generation !== phaseGenerations.current.jobs) return
        setJobs({ data: page.items, load: { status: 'loaded' } })
        setJobNextCursor(page.nextCursor)
      },
      (error: unknown) => {
        if (generation !== phaseGenerations.current.jobs) return
        setJobs((previous) => ({
          data: previous.data,
          load: loadFailure(error, () => void loadVisibleJobsPage()),
        }))
        setJobNextCursor(null)
      },
    )
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
      setCaptures((prev) => ({ data: prev.data, load: { status: 'loading' } }))
      await loadAll((cursor) => captureConfig.list(client, {
        cursor,
        ...(connectorRunId ? { connectorRunId } : {}),
        includeRemoved: showRemoved,
        limit: 100,
      })).then(
        (items) => commit(items, setCaptures),
        (error: unknown) => {
          if (isCurrent()) setCaptures((prev) => ({ data: prev.data, load: loadFailure(error, () => { void refreshLifecyclePhase(phase).catch(() => {}) }) }))
          throw error
        },
      )
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
  }, [client, connectorRunId, loadJobsPage, showRemoved])

  const refreshCaptures = useCallback(() => refreshPhase('captures'), [refreshPhase])
  const refreshJobs = useCallback(async () => {
    await Promise.all([loadJobsPage(), loadAllJobs()])
  }, [loadAllJobs, loadJobsPage])
  const refreshOpportunities = useCallback(() => refreshPhase('opportunities'), [refreshPhase])
  const refreshApplications = useCallback(() => refreshPhase('applications'), [refreshPhase])
  const refreshCaptureProcessing = useCallback(async () => {
    await Promise.all([refreshCaptures(), refreshJobs(), refreshOpportunities()])
  }, [refreshCaptures, refreshJobs, refreshOpportunities])
  const refreshSelected = useCallback(
    () => {
      if (selected === 'captures' && captureMode === 'processing') {
        return refreshCaptureProcessing()
      }
      if (selected === 'applications' && applicationMode === 'action-queue') {
        return actionQueue.refresh()
      }
      if (selected === 'jobs') {
        return refreshJobs()
      }
      return refreshPhase(selected)
    },
    [actionQueue, applicationMode, captureMode, refreshCaptureProcessing, refreshJobs, refreshPhase, selected],
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

  const captureProcessingState = useMemo<LifecycleLoadState>(() => {
    const phases = [captures.load, allJobs.load, opportunities.load]
    return phases.find((state) => state.status === 'failure')
      ?? (phases.some((state) => state.status === 'loading') ? { status: 'loading' } : { status: 'loaded' })
  }, [allJobs.load, captures.load, opportunities.load])

  useLifecycleInvalidation(refreshSelected, { enabled: Boolean(client), intervalMs: 60_000 })

  const captureController = useCaptureController({
    client,
    refresh: refreshCaptures,
    refreshDestination: refreshJobs,
    refreshAll,
    onOpenConnectorProvenance,
  })
  const jobController = useJobController({ client, refresh: refreshJobs, refreshDestination: refreshOpportunities, refreshAll })
  const opportunityController = useOpportunityController({ client, refresh: refreshOpportunities, refreshDestination: refreshApplications, refreshAll })
  const applicationController = useApplicationController({ client, refresh: refreshApplicationPresentations, refreshAll })

  const captureTable = useMemo<LifecycleTableConfig<Capture>>(
    () => ({ ...captureConfig.table, extensions: captureController.extensions }),
    [captureController],
  )
  const jobTable = useMemo<LifecycleTableConfig<Job>>(
    () => ({
      ...jobConfig.table,
      columns: jobConfig.table.columns.map((column) =>
        column.key === 'role' && onOpenResource
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
          : column),
      extensions: jobController.extensions,
    }),
    [jobController, onOpenResource],
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
    captures: captures.data?.length ?? 0,
    jobs: allJobs.data?.length ?? 0,
    opportunities: opportunities.data?.length ?? 0,
    applications: applications.data?.length ?? 0,
  }
  const jobsEntry: WorkspaceHistoryEntry = workspaceEntry?.location.view === 'jobs'
    ? workspaceEntry
    : { location: jobsLocation, cursorChain: [] }
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
          {selected === 'captures' && captureMode === 'processing'
            ? 'Capture processing'
            : phaseLabel(selected)}
        </h2>
        <p className="text-sm text-muted-foreground">
          {selected === 'captures' && captureMode === 'processing'
            ? 'Operational detail for Capture → Job normalization, admission, and projection.'
            : `${phaseLabel(selected)} are a first-class stage of the Job lifecycle.`}
        </p>
      </header>
      <LifecycleRail selected={selected} onSelect={selectPhase} counts={counts} />
      {selected === 'captures' ? (
        <div className="flex min-w-0 flex-col gap-4">
          <ToggleGroup
            type="single"
            aria-label="Captures view mode"
            variant="outline"
            size="sm"
            className="w-fit flex-wrap"
            value={captureMode}
            onValueChange={(value) => {
              if (value) setCaptureMode(value as CaptureMode)
            }}
          >
            <ToggleGroupItem value="all">All</ToggleGroupItem>
            <ToggleGroupItem value="processing">Processing</ToggleGroupItem>
          </ToggleGroup>
          {connectorRunId ? (
            <div role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
              <span>Filtered to connector run {connectorRunId}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => {
                setConnectorRunId(null)
                onConnectorRunFilterChange?.(null)
              }}>
                Clear run filter
              </Button>
            </div>
          ) : null}
          {captureMode === 'all' ? (
            <LifecycleTable
              config={captureTable}
              data={captures.data}
              state={captures.load}
              onRefresh={refreshSelected}
              toolbar={<RefreshToolbar caption="Captures" total={counts.captures} loading={captures.load.status === 'loading'} onRefresh={refreshSelectedFromUi} showRemoved={showRemoved} onShowRemovedChange={setShowRemoved} onAdd={captureController.openCreate} addLabel="Add capture" />}
            />
          ) : (
            <CaptureProcessingMode
              captures={captures.data}
              jobs={allJobs.data}
              opportunities={opportunities.data}
              state={captureProcessingState}
              onRefresh={refreshCaptureProcessing}
              toolbar={<RefreshToolbar caption="Capture processing" total={counts.captures} loading={captureProcessingState.status === 'loading'} onRefresh={() => { void refreshCaptureProcessing().catch(() => {}) }} showRemoved={showRemoved} onShowRemovedChange={setShowRemoved} />}
            />
          )}
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
      {jobController.modalLayer}
      {opportunityController.modalLayer}
      {applicationController.modalLayer}
    </div>
  )
}

interface LifecycleRailProps {
  readonly selected: LifecyclePhase
  readonly onSelect: (phase: LifecyclePhase) => void
  readonly counts: Readonly<Record<LifecyclePhase, number>>
}

function LifecycleRail({ selected, onSelect, counts }: LifecycleRailProps): ReactElement {
  const steps: ReadonlyArray<{ phase: LifecyclePhase; label: string }> = [
    { phase: 'captures', label: 'Captures' },
    { phase: 'jobs', label: 'Jobs' },
    { phase: 'opportunities', label: 'Opportunities' },
    { phase: 'applications', label: 'Applications' },
  ]
  return (
    <nav aria-label="Lifecycle phase" className="flex flex-wrap items-center gap-2">
      {steps.map((step, index) => {
        const active = selected === step.phase
        const count = counts[step.phase]
        return (
          <div key={step.phase} className="flex items-center gap-2">
            <Button
              type="button"
              variant={active ? 'default' : 'outline'}
              size="sm"
              aria-current={active ? 'step' : undefined}
              aria-pressed={active}
              onClick={() => onSelect(step.phase)}
            >
              {step.label}
              <span className="ml-2 rounded-full bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">
                {count}
              </span>
            </Button>
            {index < steps.length - 1 ? (
              <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" />
            ) : null}
          </div>
        )
      })}
    </nav>
  )
}

function phaseLabel(phase: LifecyclePhase): string {
  if (phase === 'captures') return 'Captures'
  if (phase === 'jobs') return 'Jobs'
  if (phase === 'opportunities') return 'Opportunities'
  return 'Applications'
}

interface RefreshToolbarProps {
  readonly caption: string
  readonly total: number
  readonly loading: boolean
  readonly onRefresh: () => void
  readonly showRemoved: boolean
  readonly onShowRemovedChange: (next: boolean) => void
  readonly onAdd?: () => void
  readonly addLabel?: string
}

function RefreshToolbar({ caption, total, loading, onRefresh, showRemoved, onShowRemovedChange, onAdd, addLabel }: RefreshToolbarProps): ReactElement {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">
        {caption} · {total} record{total === 1 ? '' : 's'}
      </p>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={showRemoved}
            onCheckedChange={(value) => onShowRemovedChange(value === true)}
            aria-label="Show removed"
          />
          Show removed
        </label>
        {onAdd ? (
          <Button type="button" variant="default" size="sm" onClick={onAdd}>
            {addLabel ?? 'Add'}
          </Button>
        ) : null}
        <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
          Refresh
        </Button>
      </div>
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
