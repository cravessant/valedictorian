import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { ArrowRight } from 'lucide-react'
import type {
  Application,
  Capture,
  Job,
  Opportunity,
  ValedictorianWorkspaceClient,
} from 'sparxie'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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

type Phase = 'captures' | 'jobs' | 'opportunities' | 'applications'

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
}

const initial: WorkbenchState = {
  captures: { data: null, load: { status: 'loading' } },
  jobs: { data: null, load: { status: 'loading' } },
  opportunities: { data: null, load: { status: 'loading' } },
  applications: { data: null, load: { status: 'loading' } },
}

export function LifecycleWorkbench({ client: suppliedClient }: WorkbenchProps): ReactElement {
  const [client, setClient] = useState<ValedictorianWorkspaceClient | null>(() =>
    suppliedClient === undefined ? getRendererHttpWorkspaceClient() : suppliedClient)
  const [selected, setSelected] = useState<Phase>('captures')
  const [showRemoved, setShowRemoved] = useState(false)
  const [captures, setCaptures] = useState<PhaseState<Capture>>(initial.captures)
  const [jobs, setJobs] = useState<PhaseState<Job>>(initial.jobs)
  const [opportunities, setOpportunities] = useState<PhaseState<Opportunity>>(initial.opportunities)
  const [applications, setApplications] = useState<PhaseState<Application>>(initial.applications)
  const phaseGenerations = useRef<Record<Phase, number>>({
    captures: 0,
    jobs: 0,
    opportunities: 0,
    applications: 0,
  })

  useEffect(() => {
    if (suppliedClient !== undefined) {
      setClient(suppliedClient)
      return
    }
    const resolveClient = () => setClient(getRendererHttpWorkspaceClient())
    resolveClient()
    return onRendererBackendStateChanged(resolveClient)
  }, [suppliedClient])

  const load = useCallback(async function loadAllPhases() {
    const generations: Record<Phase, number> = {
      captures: ++phaseGenerations.current.captures,
      jobs: ++phaseGenerations.current.jobs,
      opportunities: ++phaseGenerations.current.opportunities,
      applications: ++phaseGenerations.current.applications,
    }
    const isCurrent = (phase: Phase) => generations[phase] === phaseGenerations.current[phase]
    if (!client) {
      const unavailable: LifecycleLoadState = {
        status: 'failure',
        message: 'Workspace HTTP client is unavailable.',
      }
      setCaptures({ data: null, load: unavailable })
      setJobs({ data: null, load: unavailable })
      setOpportunities({ data: null, load: unavailable })
      setApplications({ data: null, load: unavailable })
      return
    }
    setCaptures((prev) => ({ data: prev.data, load: { status: 'loading' } }))
    setJobs((prev) => ({ data: prev.data, load: { status: 'loading' } }))
    setOpportunities((prev) => ({ data: prev.data, load: { status: 'loading' } }))
    setApplications((prev) => ({ data: prev.data, load: { status: 'loading' } }))
    await Promise.all([
      loadAll((cursor) => captureConfig.list(client, {
        cursor,
        includeRemoved: showRemoved,
        limit: 100,
      })).then(
        (items) => { if (isCurrent('captures')) setCaptures({ data: items, load: { status: 'loaded' } }) },
        (error: unknown) => { if (isCurrent('captures')) setCaptures((prev) => ({
          data: prev.data,
          load: loadFailure(error, () => void loadAllPhases()),
        })) },
      ),
      loadAll((cursor) => jobConfig.list(client, {
        cursor,
        includeRemoved: showRemoved,
        limit: 100,
      })).then(
        (items) => { if (isCurrent('jobs')) setJobs({ data: items, load: { status: 'loaded' } }) },
        (error: unknown) => { if (isCurrent('jobs')) setJobs((prev) => ({
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
  }, [client, showRemoved])

  useEffect(() => { void load() }, [load])

  const refreshPhase = useCallback(async function refreshLifecyclePhase(phase: Phase) {
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
      setJobs((prev) => ({ data: prev.data, load: { status: 'loading' } }))
      await loadAll((cursor) => jobConfig.list(client, {
        cursor,
        includeRemoved: showRemoved,
        limit: 100,
      })).then(
        (items) => commit(items, setJobs),
        (error: unknown) => {
          if (isCurrent()) setJobs((prev) => ({ data: prev.data, load: loadFailure(error, () => { void refreshLifecyclePhase(phase).catch(() => {}) }) }))
          throw error
        },
      )
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
  }, [client, showRemoved])

  const refreshSelected = useCallback(
    () => refreshPhase(selected),
    [refreshPhase, selected],
  )
  const refreshCaptures = useCallback(() => refreshPhase('captures'), [refreshPhase])
  const refreshJobs = useCallback(() => refreshPhase('jobs'), [refreshPhase])
  const refreshOpportunities = useCallback(() => refreshPhase('opportunities'), [refreshPhase])
  const refreshApplications = useCallback(() => refreshPhase('applications'), [refreshPhase])
  const refreshAll = useCallback(async () => {
    await Promise.all([
      refreshCaptures(),
      refreshJobs(),
      refreshOpportunities(),
      refreshApplications(),
    ])
  }, [refreshApplications, refreshCaptures, refreshJobs, refreshOpportunities])

  const refreshSelectedFromUi = useCallback(() => {
    void refreshSelected().catch(() => {})
  }, [refreshSelected])

  useLifecycleInvalidation(refreshSelected, { enabled: Boolean(client), intervalMs: 60_000 })

  const captureController = useCaptureController({ client, refresh: refreshCaptures, refreshDestination: refreshJobs, refreshAll })
  const jobController = useJobController({ client, refresh: refreshJobs, refreshDestination: refreshOpportunities, refreshAll })
  const opportunityController = useOpportunityController({ client, refresh: refreshOpportunities, refreshDestination: refreshApplications, refreshAll })
  const applicationController = useApplicationController({ client, refresh: refreshApplications, refreshAll })

  const captureTable = useMemo<LifecycleTableConfig<Capture>>(
    () => ({ ...captureConfig.table, extensions: captureController.extensions }),
    [captureController],
  )
  const jobTable = useMemo<LifecycleTableConfig<Job>>(
    () => ({ ...jobConfig.table, extensions: jobController.extensions }),
    [jobController],
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
    jobs: jobs.data?.length ?? 0,
    opportunities: opportunities.data?.length ?? 0,
    applications: applications.data?.length ?? 0,
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <LifecycleRail selected={selected} onSelect={setSelected} counts={counts} />
      {selected === 'captures' ? (
        <LifecycleTable
          config={captureTable}
          data={captures.data}
          state={captures.load}
          onRefresh={refreshSelected}
          toolbar={<RefreshToolbar caption="Captures" total={counts.captures} loading={captures.load.status === 'loading'} onRefresh={refreshSelectedFromUi} showRemoved={showRemoved} onShowRemovedChange={setShowRemoved} onAdd={captureController.openCreate} addLabel="Add capture" />}
        />
      ) : null}
      {selected === 'jobs' ? (
        <LifecycleTable
          config={jobTable}
          data={jobs.data}
          state={jobs.load}
          onRefresh={refreshSelected}
          toolbar={<RefreshToolbar caption="Jobs" total={counts.jobs} loading={jobs.load.status === 'loading'} onRefresh={refreshSelectedFromUi} showRemoved={showRemoved} onShowRemovedChange={setShowRemoved} onAdd={jobController.openCreate} addLabel="Add job" />}
        />
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
        <LifecycleTable
          config={applicationTable}
          data={applications.data}
          state={applications.load}
          onRefresh={refreshSelected}
          toolbar={<RefreshToolbar caption="Applications" total={counts.applications} loading={applications.load.status === 'loading'} onRefresh={refreshSelectedFromUi} showRemoved={showRemoved} onShowRemovedChange={setShowRemoved} onAdd={applicationController.openCreate} addLabel="Add application" />}
        />
      ) : null}
      {captureController.modalLayer}
      {jobController.modalLayer}
      {opportunityController.modalLayer}
      {applicationController.modalLayer}
    </div>
  )
}

interface LifecycleRailProps {
  readonly selected: Phase
  readonly onSelect: (phase: Phase) => void
  readonly counts: Readonly<Record<Phase, number>>
}

function LifecycleRail({ selected, onSelect, counts }: LifecycleRailProps): ReactElement {
  const steps: ReadonlyArray<{ phase: Phase; label: string }> = [
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
