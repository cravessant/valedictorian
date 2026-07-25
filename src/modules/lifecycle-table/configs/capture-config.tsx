import type {
  CaptureListPresentation,
  CaptureResolutionListInput,
  CaptureResolutionListResult,
  ValedictorianWorkspaceClientV2,
} from '@sparxie/sdk'
import { Button } from '@/components/ui/button'
import type { LifecycleTableConfig } from '../lifecycle-table'

export interface CaptureConfig {
  readonly table: LifecycleTableConfig<CaptureListPresentation>
  readonly list: (
    client: Pick<ValedictorianWorkspaceClientV2, 'captureResolutionV2'>,
    input?: CaptureResolutionListInput,
  ) => Promise<CaptureResolutionListResult>
}

export type CaptureCompletionIntent =
  Extract<NonNullable<CaptureListPresentation['primaryIntent']>, {
    readonly kind:
      | 'complete_job_information'
      | 'resolve_company_assignment'
      | 'resolve_duplicate_job'
  }>

export function createCaptureConfig(options: {
  readonly onOpenJob?: (jobId: string, focusAnchor: string) => void
  readonly onComplete?: (
    captureId: string,
    intent: CaptureCompletionIntent,
    row: CaptureListPresentation,
  ) => void
  readonly onRemove?: (row: CaptureListPresentation) => void
  readonly onRestore?: (row: CaptureListPresentation) => void
  readonly onViewResolution?: (row: CaptureListPresentation) => void
  readonly onViewHistory?: (row: CaptureListPresentation) => void
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
      render: (row) => {
        if (!options.onViewResolution || !hasUnexplainedDestinationOutcome(row)) {
          return destinationLabel(row)
        }
        return (
          <div className="min-w-0">
            <p>{destinationLabel(row)}</p>
            <Button
              type="button"
              variant="link"
              className="h-auto p-0 text-xs"
              onClick={() => options.onViewResolution?.(row)}
            >
              View resolution details
            </Button>
          </div>
        )
      },
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
      render: (row) => {
        const intent = row.primaryIntent
        if (!intent || !isCaptureCompletionIntent(intent) || !options.onComplete) {
          return primaryIntentLabel(row)
        }
        return (
          <Button type="button" variant="link" className="h-auto p-0" onClick={() => options.onComplete?.(row.captureId, intent, row)}>
            {primaryIntentLabel(row)}
          </Button>
        )
      },
    },
  ],
  actions: [
    ...(options.onRemove ? [{
      key: 'remove-capture',
      label: 'Remove Capture',
      destructive: true,
      modal: true,
      visible: (row: CaptureListPresentation) => row.readiness !== 'removed',
      onActivate: options.onRemove,
    }] : []),
    ...(options.onRestore ? [{
      key: 'restore-capture',
      label: 'Restore Capture',
      modal: true,
      visible: (row: CaptureListPresentation) => row.readiness === 'removed',
      onActivate: options.onRestore,
    }] : []),
    ...(options.onViewHistory ? [{
      key: 'capture-history',
      label: 'View history',
      modal: true,
      onActivate: options.onViewHistory,
    }] : []),
  ],
}

  return {
    table,
    list: (client, input) => client.captureResolutionV2.list(input ?? {
      filter: 'all',
      sort: 'observed_desc',
      limit: 50,
    }),
  }
}

function isCaptureCompletionIntent(
  intent: NonNullable<CaptureListPresentation['primaryIntent']>,
): intent is CaptureCompletionIntent {
  return intent.kind === 'complete_job_information'
    || intent.kind === 'resolve_company_assignment'
    || intent.kind === 'resolve_duplicate_job'
}

/**
 * A destination outcome no supported completion intent already explains. The
 * affordance is read-only: it opens the Capture detail with no completion
 * intent, so no server primary intent is synthesized or replaced.
 */
function hasUnexplainedDestinationOutcome(row: CaptureListPresentation): boolean {
  if (row.readiness !== 'ready') return false
  if (row.destination.state !== 'blocked' && row.destination.state !== 'unavailable') {
    return false
  }
  const intent = row.primaryIntent
  return !intent || !isCaptureCompletionIntent(intent)
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
