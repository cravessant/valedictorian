import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { ArrowRight } from 'lucide-react'
import type {
  Application,
  Capture,
  Job,
  Opportunity,
  ValedictorianWorkspaceClient,
} from 'sparxie'

import { Button } from '@/components/ui/button'
import {
  getRendererHttpWorkspaceClient,
  onRendererBackendStateChanged,
} from '@/app/renderer-http-client'
import { captureConfig } from './configs/capture-config'
import { jobConfig } from './configs/job-config'
import { opportunityConfig } from './configs/opportunity-config'
import { applicationConfig } from './configs/application-config'
import {
  LifecycleTable,
  type LifecycleLoadState,
} from './lifecycle-table'

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
  const [captures, setCaptures] = useState<PhaseState<Capture>>(initial.captures)
  const [jobs, setJobs] = useState<PhaseState<Job>>(initial.jobs)
  const [opportunities, setOpportunities] = useState<PhaseState<Opportunity>>(initial.opportunities)
  const [applications, setApplications] = useState<PhaseState<Application>>(initial.applications)

  useEffect(() => {
    if (suppliedClient !== undefined) {
      setClient(suppliedClient)
      return
    }
    const resolveClient = () => setClient(getRendererHttpWorkspaceClient())
    resolveClient()
    return onRendererBackendStateChanged(resolveClient)
  }, [suppliedClient])

  const load = useCallback(async () => {
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
        includeRemoved: false,
        limit: 100,
      })).then(
        (items) => setCaptures({ data: items, load: { status: 'loaded' } }),
        (error: unknown) => setCaptures((prev) => ({
          data: prev.data,
          load: loadFailure(error, () => void load()),
        })),
      ),
      loadAll((cursor) => jobConfig.list(client, {
        cursor,
        includeRemoved: false,
        limit: 100,
      })).then(
        (items) => setJobs({ data: items, load: { status: 'loaded' } }),
        (error: unknown) => setJobs((prev) => ({
          data: prev.data,
          load: loadFailure(error, () => void load()),
        })),
      ),
      loadAll((cursor) => opportunityConfig.list(client, {
        cursor,
        includeRemoved: false,
        limit: 100,
      })).then(
        (items) => setOpportunities({ data: items, load: { status: 'loaded' } }),
        (error: unknown) => setOpportunities((prev) => ({
          data: prev.data,
          load: loadFailure(error, () => void load()),
        })),
      ),
      loadAll((cursor) => applicationConfig.list(client, {
        cursor,
        includeRemoved: false,
        limit: 100,
      })).then(
        (items) => setApplications({ data: items, load: { status: 'loaded' } }),
        (error: unknown) => setApplications((prev) => ({
          data: prev.data,
          load: loadFailure(error, () => void load()),
        })),
      ),
    ])
  }, [client])

  useEffect(() => { void load() }, [load])

  const refreshSelected = useCallback(async function refreshSelectedPhase() {
    if (!client) return
    if (selected === 'captures') {
      setCaptures((prev) => ({ data: prev.data, load: { status: 'loading' } }))
      await loadAll((cursor) => captureConfig.list(client, {
        cursor,
        includeRemoved: false,
        limit: 100,
      })).then(
        (items) => setCaptures({ data: items, load: { status: 'loaded' } }),
        (error: unknown) => setCaptures((prev) => ({
          data: prev.data,
          load: loadFailure(error, refreshSelectedPhase),
        })),
      )
    } else if (selected === 'jobs') {
      setJobs((prev) => ({ data: prev.data, load: { status: 'loading' } }))
      await loadAll((cursor) => jobConfig.list(client, {
        cursor,
        includeRemoved: false,
        limit: 100,
      })).then(
        (items) => setJobs({ data: items, load: { status: 'loaded' } }),
        (error: unknown) => setJobs((prev) => ({
          data: prev.data,
          load: loadFailure(error, refreshSelectedPhase),
        })),
      )
    } else if (selected === 'opportunities') {
      setOpportunities((prev) => ({ data: prev.data, load: { status: 'loading' } }))
      await loadAll((cursor) => opportunityConfig.list(client, {
        cursor,
        includeRemoved: false,
        limit: 100,
      })).then(
        (items) => setOpportunities({ data: items, load: { status: 'loaded' } }),
        (error: unknown) => setOpportunities((prev) => ({
          data: prev.data,
          load: loadFailure(error, refreshSelectedPhase),
        })),
      )
    } else {
      setApplications((prev) => ({ data: prev.data, load: { status: 'loading' } }))
      await loadAll((cursor) => applicationConfig.list(client, {
        cursor,
        includeRemoved: false,
        limit: 100,
      })).then(
        (items) => setApplications({ data: items, load: { status: 'loaded' } }),
        (error: unknown) => setApplications((prev) => ({
          data: prev.data,
          load: loadFailure(error, refreshSelectedPhase),
        })),
      )
    }
  }, [client, selected])

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
          config={captureConfig.table}
          data={captures.data}
          state={captures.load}
          onRefresh={refreshSelected}
          toolbar={<RefreshToolbar caption="Captures" total={counts.captures} loading={captures.load.status === 'loading'} onRefresh={refreshSelected} />}
        />
      ) : null}
      {selected === 'jobs' ? (
        <LifecycleTable
          config={jobConfig.table}
          data={jobs.data}
          state={jobs.load}
          onRefresh={refreshSelected}
          toolbar={<RefreshToolbar caption="Jobs" total={counts.jobs} loading={jobs.load.status === 'loading'} onRefresh={refreshSelected} />}
        />
      ) : null}
      {selected === 'opportunities' ? (
        <LifecycleTable
          config={opportunityConfig.table}
          data={opportunities.data}
          state={opportunities.load}
          onRefresh={refreshSelected}
          toolbar={<RefreshToolbar caption="Opportunities" total={counts.opportunities} loading={opportunities.load.status === 'loading'} onRefresh={refreshSelected} />}
        />
      ) : null}
      {selected === 'applications' ? (
        <LifecycleTable
          config={applicationConfig.table}
          data={applications.data}
          state={applications.load}
          onRefresh={refreshSelected}
          toolbar={<RefreshToolbar caption="Applications" total={counts.applications} loading={applications.load.status === 'loading'} onRefresh={refreshSelected} />}
        />
      ) : null}
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
}

function RefreshToolbar({ caption, total, loading, onRefresh }: RefreshToolbarProps): ReactElement {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">
        {caption} · {total} record{total === 1 ? '' : 's'}
      </p>
      <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
        Refresh
      </Button>
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
