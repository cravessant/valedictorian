import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import type {
  Application,
  CaptureListPresentation,
  Job,
  JobCompanyAssignmentPresentation,
  Opportunity,
  ValedictorianWorkspaceClientV2,
} from '@sparxie/sdk'

import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  getRendererHttpWorkspaceClient,
  onRendererBackendStateChanged,
  workspaceConnectionId,
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
import { LifecycleTable, type LifecycleTableConfig } from './lifecycle-table'
import {
  applicationProjectionQuery,
  capturePageQuery,
  jobPageQuery,
  jobProjectionQuery,
  lifecycleLoadState,
  opportunityProjectionQuery,
  type LifecycleScope,
} from './lifecycle-queries'
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
import { WorkspaceCursorPagination } from '@/app/WorkspaceCursorPagination'
import type { WorkspacePageInfo } from '@/app/workspace-page'
import {
  LifecycleRail,
  RefreshToolbar,
  phaseLabel,
} from './lifecycle-workbench-presentation'

export type LifecyclePhase = 'captures' | 'jobs' | 'opportunities' | 'applications'
type ApplicationMode = 'all' | 'action-queue'
type CaptureFilter = 'all' | 'needs_attention' | 'removed'

/** The view address the workbench owns when no workspace location controls it. */
interface WorkbenchView {
  readonly phase: LifecyclePhase
  readonly applicationMode: ApplicationMode
  readonly captureFilter: CaptureFilter
  readonly showRemoved: boolean
}

const initialView: WorkbenchView = {
  phase: 'captures',
  applicationMode: 'all',
  captureFilter: 'all',
  showRemoved: false,
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
  readonly onWorkspaceNavigate?: (location: WorkspaceLocation) => void
}

/**
 * Resolves the workspace connection and owns the view address, then hands both to
 * a session keyed by workspace and connection.
 *
 * Everything a command can still be holding when the workspace or the backend
 * changes — modal targets, drafts, the stored blocker/duplicate/warning
 * resolution callbacks, an in-flight mutation, the Action Queue page — lives
 * inside that session. Re-keying unmounts it, so a delayed completion from the
 * previous session has nothing left to publish into and cannot address the new
 * one. The view address survives, because it is navigation state rather than
 * anything the previous workspace owned.
 */
export function LifecycleWorkbench({
  client: suppliedClient,
  workspaceId = null,
  ...props
}: WorkbenchProps): ReactElement {
  // A supplied client is the client for this very render, so a replacement moves
  // the scope in the commit that delivers it rather than in a later effect. Only
  // the renderer-managed client needs state, and it resolves once in the
  // initializer: resolving again below would hand back a fresh client object,
  // bump the scope, and make every lifecycle list fetch twice on startup.
  const [rendererClient, setRendererClient] = useState<ValedictorianWorkspaceClientV2 | null>(
    () => suppliedClient === undefined ? getRendererHttpWorkspaceClient() : null)
  const [view, setView] = useState<WorkbenchView>(initialView)
  const client = suppliedClient === undefined ? rendererClient : suppliedClient

  useEffect(() => {
    if (suppliedClient !== undefined) return
    return onRendererBackendStateChanged(
      () => setRendererClient(getRendererHttpWorkspaceClient()),
    )
  }, [suppliedClient])

  const scope = useMemo<LifecycleScope>(
    () => ({ workspaceId, connectionId: workspaceConnectionId(client) }),
    [client, workspaceId],
  )
  return (
    <LifecycleWorkbenchSession
      key={`${scope.workspaceId ?? 'unscoped'}#${scope.connectionId}`}
      {...props}
      client={client}
      scope={scope}
      view={view}
      workspaceId={workspaceId}
      onViewChange={(patch) => setView((current) => ({ ...current, ...patch }))}
    />
  )
}

interface SessionProps extends Omit<WorkbenchProps, 'client' | 'workspaceId'> {
  readonly client: ValedictorianWorkspaceClientV2 | null
  readonly scope: LifecycleScope
  readonly view: WorkbenchView
  readonly workspaceId: string | null
  readonly onViewChange: (patch: Partial<WorkbenchView>) => void
}

function LifecycleWorkbenchSession({
  client,
  scope,
  view,
  workspaceId,
  onViewChange,
  onSelectedPhaseChange,
  selectedPhase,
  selectedResourceId,
  onOpenResource,
  onBackFromResource,
  workspaceEntry,
  onWorkspaceNavigate,
}: SessionProps): ReactElement {
  const selected = selectedPhase ?? view.phase
  const showRemoved = view.showRemoved
  // A null intent opens the Capture detail read-only for destination outcomes
  // the server exposes no supported completion intent for.
  const [completion, setCompletion] = useState<{
    readonly row: CaptureListPresentation
    readonly intent: CaptureCompletionIntent | null
  } | null>(null)
  const addressedApplicationMode = workspaceEntry?.location.view === 'applications'
    ? (workspaceEntry.location.mode ?? 'all') as ApplicationMode
    : undefined
  const applicationMode = addressedApplicationMode ?? view.applicationMode
  const capturesLocation = workspaceEntry?.location.view === 'captures'
    ? workspaceEntry.location
    : { view: 'captures' as const }
  const captureFilter = workspaceEntry?.location.view === 'captures'
    ? (capturesLocation.filter ?? 'all') as CaptureFilter
    : view.captureFilter
  const jobsLocation = workspaceEntry?.location.view === 'jobs'
    ? workspaceEntry.location
    : { view: 'jobs' as const }
  const jobsShowRemoved = workspaceEntry?.location.view === 'jobs'
    ? jobsLocation.filter === 'include_removed'
    : showRemoved

  const selectPhase = (phase: LifecyclePhase) => {
    if (selectedPhase === undefined) onViewChange({ phase })
    onSelectedPhaseChange?.(phase)
  }
  const invalidate = useLifecycleInvalidation(scope)

  const captures = useQuery(capturePageQuery(client, scope, {
    filter: captureFilter,
    sort: 'observed_desc',
    cursor: capturesLocation.cursor,
    cursorDirection: capturesLocation.cursorDirection,
  }))
  const jobsPage = useQuery(jobPageQuery(client, scope, {
    includeRemoved: jobsShowRemoved,
    cursor: jobsLocation.cursor,
    cursorDirection: jobsLocation.cursorDirection,
  }))
  const allJobs = useQuery(jobProjectionQuery(client, scope, { includeRemoved: jobsShowRemoved }))
  const opportunities = useQuery(
    opportunityProjectionQuery(client, scope, { includeRemoved: showRemoved }),
  )
  const applications = useQuery(
    applicationProjectionQuery(client, scope, { includeRemoved: showRemoved }),
  )
  const actionQueue = useActionQueue({
    client,
    scope,
    active: selected === 'applications' && applicationMode === 'action-queue',
  })

  const jobAssignments = jobsPage.data?.assignments ?? emptyAssignments
  const captureTotalCount = captures.data?.totalCount ?? 0
  const capturesLoad = lifecycleLoadState(captures, 'Captures could not be loaded.')
  const jobsLoad = lifecycleLoadState(jobsPage, 'Jobs could not be loaded.')
  const opportunitiesLoad = lifecycleLoadState(opportunities, 'Opportunities could not be loaded.')
  const applicationsLoad = lifecycleLoadState(applications, 'Applications could not be loaded.')

  const refreshSelected = useCallback(() => {
    if (selected === 'applications' && applicationMode === 'action-queue') {
      return invalidate.actionQueue()
    }
    return invalidate[selected]()
  }, [applicationMode, invalidate, selected])
  const refreshSelectedFromUi = useCallback(() => {
    void refreshSelected().catch(() => {})
  }, [refreshSelected])

  const closeCompletionForRemovedCapture = useCallback((captureId: string) => {
    setCompletion((current) => current?.row.captureId === captureId ? null : current)
  }, [])
  const captureController = useCaptureController({
    client,
    scope,
    refresh: invalidate.captures,
    onRemoved: closeCompletionForRemovedCapture,
  })
  const jobController = useJobController({
    client,
    scope,
    refresh: invalidate.jobs,
    refreshDestination: invalidate.opportunities,
    refreshAll: invalidate.workspace,
  })
  const jobCompanyAssignmentController = useJobCompanyAssignmentController({
    assignments: jobAssignments,
    client,
    refresh: invalidate.jobs,
    workspaceId,
  })
  const opportunityController = useOpportunityController({
    client,
    scope,
    refresh: invalidate.opportunities,
    refreshDestination: invalidate.applications,
    refreshAll: invalidate.workspace,
  })
  const applicationController = useApplicationController({
    client,
    scope,
    refresh: invalidate.applicationPresentations,
    refreshAll: invalidate.workspace,
  })

  const captureTable = useMemo<LifecycleTableConfig<CaptureListPresentation>>(
    () => createCaptureConfig({
      onOpenJob: onOpenResource,
      onComplete: (_captureId, intent, row) => setCompletion({ row, intent }),
      onViewResolution: (row) => setCompletion({ row, intent: null }),
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
  const setCaptureFilter = (next: CaptureFilter) => {
    if (onWorkspaceNavigate && workspaceEntry?.location.view === 'captures') {
      onWorkspaceNavigate(resetWorkspaceQuery(capturesLocation, {
        filter: next,
        sort: 'observed_desc',
      }))
      return
    }
    onViewChange({ captureFilter: next })
  }
  const setJobsShowRemoved = (next: boolean) => {
    if (onWorkspaceNavigate && workspaceEntry?.location.view === 'jobs') {
      onWorkspaceNavigate(resetWorkspaceQuery(jobsLocation, {
        filter: next ? 'include_removed' : 'all',
      }))
      return
    }
    onViewChange({ showRemoved: next })
  }
  const setAddressedApplicationMode = (next: ApplicationMode) => {
    if (onWorkspaceNavigate && workspaceEntry?.location.view === 'applications') {
      onWorkspaceNavigate({ view: 'applications', mode: next })
      return
    }
    onViewChange({ applicationMode: next })
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
            data={captures.data?.items ?? null}
            state={capturesLoad}
            onRefresh={refreshSelected}
            toolbar={<RefreshToolbar caption="Captures" total={captureTotalCount} loading={capturesLoad.status === 'loading'} onRefresh={refreshSelectedFromUi} onAdd={captureController.openCreate} addLabel="Add capture" />}
          />
          <WorkspaceCursorPagination
            label="Capture pages"
            location={capturesLocation}
            onNavigate={onWorkspaceNavigate}
            pageInfo={captures.data?.pageInfo ?? emptyPageInfo}
          />
        </div>
      ) : null}
      {selected === 'jobs' ? (
        <div className={selectedResourceId
          ? 'grid min-w-0 gap-5 md:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.75fr)]'
          : 'min-w-0'}>
          <div className={selectedResourceId ? 'hidden min-w-0 md:block' : 'min-w-0'}>
            <LifecycleTable
              config={jobTable}
              data={jobsPage.data?.items ?? null}
              state={jobsLoad}
              focusLoadFailure={!selectedResourceId}
              onRefresh={refreshSelected}
              toolbar={<RefreshToolbar caption="Jobs" total={counts.jobs} loading={jobsLoad.status === 'loading'} onRefresh={refreshSelectedFromUi} showRemoved={jobsShowRemoved} onShowRemovedChange={setJobsShowRemoved} onAdd={jobController.openCreate} addLabel="Add job" />}
            />
            <WorkspaceCursorPagination
              className="mt-3 justify-end"
              label="Jobs pages"
              location={jobsLocation}
              onNavigate={onWorkspaceNavigate}
              pageInfo={jobsPage.data?.pageInfo ?? emptyPageInfo}
            />
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
          data={opportunities.data ?? null}
          state={opportunitiesLoad}
          onRefresh={refreshSelected}
          toolbar={<RefreshToolbar caption="Opportunities" total={counts.opportunities} loading={opportunitiesLoad.status === 'loading'} onRefresh={refreshSelectedFromUi} showRemoved={showRemoved} onShowRemovedChange={(next) => onViewChange({ showRemoved: next })} onAdd={opportunityController.openCreate} addLabel="Add opportunity" />}
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
              data={applications.data ?? null}
              state={applicationsLoad}
              onRefresh={refreshSelected}
              toolbar={<RefreshToolbar caption="Applications" total={counts.applications} loading={applicationsLoad.status === 'loading'} onRefresh={refreshSelectedFromUi} showRemoved={showRemoved} onShowRemovedChange={(next) => onViewChange({ showRemoved: next })} onAdd={applicationController.openCreate} addLabel="Add application" />}
            />
          ) : (
            <ActionQueueMode
              state={actionQueue.state}
              bucket={actionQueue.bucket}
              onBucketChange={actionQueue.setBucket}
              onNextPage={actionQueue.nextPage}
              onPreviousPage={actionQueue.previousPage}
              onRefresh={refreshSelectedFromUi}
              applications={applications.data ?? null}
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
          await Promise.all([invalidate.captures(), invalidate.jobs()])
        }}
        onAssignmentChanged={invalidate.jobs}
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

const emptyPageInfo: WorkspacePageInfo = {
  startCursor: null,
  endCursor: null,
  hasPreviousPage: false,
  hasNextPage: false,
}

const emptyAssignments: ReadonlyMap<string, JobCompanyAssignmentPresentation> = new Map()
