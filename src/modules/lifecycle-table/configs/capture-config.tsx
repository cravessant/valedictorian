import type {
  CaptureListPresentation,
  CaptureResolutionListInput,
  CaptureResolutionListResult,
  ValedictorianWorkspaceClient,
} from '@sparxie/sdk'
import { Button } from '@/components/ui/button'
import type { LifecycleTableConfig } from '../lifecycle-table'

export interface CaptureConfig {
  readonly table: LifecycleTableConfig<CaptureListPresentation>
  readonly list: (
    client: Pick<ValedictorianWorkspaceClient, 'captureResolution'>,
    input?: CaptureResolutionListInput,
  ) => Promise<CaptureResolutionListResult>
}

export function createCaptureConfig(options: {
  readonly onOpenJob?: (jobId: string, focusAnchor: string) => void
} = {}): CaptureConfig {
  const table: LifecycleTableConfig<CaptureListPresentation> = {
  caption: 'Captures',
  rowId: (row) => row.captureId,
  rowLabel: (row) => row.lead.fallbackLabel,
  empty: {
    title: 'No captures',
    description: 'Captured leads will appear here after intake.',
  },
  columns: [
    {
      key: 'lead',
      header: 'Lead',
      render: (row) => (
        <div className="min-w-44">
          <p className="font-medium text-foreground">
            {row.lead.roleTitle ?? row.lead.fallbackLabel}
          </p>
          {row.lead.companyName ? (
            <p className="text-xs text-muted-foreground">{row.lead.companyName}</p>
          ) : null}
        </div>
      ),
    },
    {
      key: 'source',
      header: 'Source',
      render: (row) => row.source.displayName,
    },
    {
      key: 'destination',
      header: 'Destination',
      render: (row) => destinationLabel(row),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => statusLabel(row),
    },
    {
      key: 'linked-job',
      header: 'Linked Job',
      render: (row) => {
        if (!row.linkedJob) return '—'
        if (!options.onOpenJob) return linkedJobLabel(row)
        const anchor = `capture-job-link-${row.captureId}`
        return (
          <Button
            id={anchor}
            type="button"
            variant="link"
            className="h-auto max-w-56 justify-start p-0 text-left"
            onClick={() => options.onOpenJob?.(row.linkedJob!.jobId, anchor)}
          >
            {linkedJobLabel(row)}
          </Button>
        )
      },
    },
    {
      key: 'observedAt',
      header: 'Observed',
      render: (row) => formatObservedAt(row.observedAt),
    },
    {
      key: 'next-action',
      header: 'Next action',
      render: (row) => primaryIntentLabel(row),
    },
  ],
  actions: [],
}

  return {
    table,
    list: (client, input) => client.captureResolution.list(input ?? {
      filter: 'all',
      sort: 'observed_desc',
      limit: 50,
    }),
  }
}

function destinationLabel(row: CaptureListPresentation): string {
  if (row.destination.displayHost) return row.destination.displayHost
  const labels: Record<CaptureListPresentation['destination']['state'], string> = {
    not_required: 'Not needed',
    resolving: 'Finding source',
    resolved: 'Source found',
    unavailable: 'Unavailable',
    blocked: 'Needs attention',
  }
  return labels[row.destination.state]
}

function statusLabel(row: CaptureListPresentation): string {
  if (row.readiness === 'materialization_pending') return 'Preparing'
  if (row.readiness === 'materialization_blocked') return 'Needs attention'
  if (row.readiness === 'removed') return 'Removed'
  const labels: Record<NonNullable<CaptureListPresentation['processingSummary']>, string> = {
    processing: 'Processing',
    retrying: 'Retrying',
    awaiting_destination: 'Finding source',
    awaiting_information: 'Needs information',
    needs_action: 'Needs action',
    promoted: 'Job created',
    blocked: 'Blocked',
    stopped: 'Stopped',
  }
  return row.processingSummary ? labels[row.processingSummary] : 'Preparing'
}

function linkedJobLabel(row: CaptureListPresentation): string {
  if (!row.linkedJob) return '—'
  return `${row.linkedJob.roleTitle} · ${row.linkedJob.companyName}`
}

function primaryIntentLabel(row: CaptureListPresentation): string {
  const intent = row.primaryIntent
  if (!intent) return 'No action needed'
  const labels: Record<NonNullable<CaptureListPresentation['primaryIntent']>['kind'], string> = {
    complete_job_information: 'Complete Job information',
    authenticate_provider: 'Reconnect source',
    correct_capture: 'Correct Capture',
    retry_now: 'Retry now',
    resolve_company: 'Resolve company',
    resolve_company_assignment: 'Resolve company assignment',
    resolve_duplicate_job: 'Resolve duplicate Job',
    view_job: 'View Job',
  }
  return labels[intent.kind]
}

function formatObservedAt(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export const captureConfig = createCaptureConfig()
