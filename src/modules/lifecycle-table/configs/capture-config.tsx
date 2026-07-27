import type {
  CaptureListPresentation,
  CaptureResolutionListInput,
  CaptureResolutionListResult,
  ValedictorianWorkspaceClientV2,
} from '@sparxie/sdk'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { LifecycleTableConfig } from '../lifecycle-table'

/** Fixed layout so no value can resize a column; below the minimum the viewport scrolls. */
const captureTableClassName = 'min-w-[64rem] table-fixed'

export const captureColumnWidths = {
  lead: 'w-[20%]',
  source: 'w-[9%]',
  destination: 'w-[12%]',
  status: 'w-[10%]',
  'linked-job': 'w-[20%]',
  observedAt: 'w-[13%]',
  'next-action': 'w-[12%]',
} as const

const clampedLabel = 'line-clamp-2 break-words'

/** Hosts and identifiers have no word boundary to break on. */
const clampedIdentifier = 'line-clamp-2 [overflow-wrap:anywhere]'

const clampedControlLabel = `${clampedLabel} min-w-0 whitespace-normal`
/** `max-w-full`, not `w-full`: a short label keeps its own hit area. */
const clampedControl = 'h-auto max-w-full justify-start p-0 text-left'

/** The clamp keeps the full accessible name; the tooltip discloses it visually. */
function ClampedControl({
  className,
  id,
  label,
  onActivate,
}: {
  readonly className?: string
  readonly id?: string
  readonly label: string
  readonly onActivate: () => void
}) {
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="link"
            className={className ? `${clampedControl} ${className}` : clampedControl}
            onClick={onActivate}
          >
            <span className={clampedControlLabel}>{label}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent className="max-w-72">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

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
  tableClassName: captureTableClassName,
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
      className: captureColumnWidths.lead,
      render: (row) => (
        <div className="min-w-0">
          <p className={`${clampedLabel} font-medium text-foreground`}>
            {row.lead.roleTitle ?? row.lead.fallbackLabel}
          </p>
          {row.lead.companyName ? (
            <p className={`${clampedLabel} text-xs text-muted-foreground`}>{row.lead.companyName}</p>
          ) : null}
        </div>
      ),
    },
    {
      key: 'source',
      header: 'Source',
      className: captureColumnWidths.source,
      render: (row) => <span className={clampedLabel}>{row.source.displayName}</span>,
    },
    {
      key: 'destination',
      header: 'Destination',
      className: captureColumnWidths.destination,
      render: (row) => {
        if (!options.onViewResolution || !hasUnexplainedDestinationOutcome(row)) {
          return <span className={clampedIdentifier}>{destinationLabel(row)}</span>
        }
        return (
          <div className="min-w-0">
            <p className={clampedIdentifier}>{destinationLabel(row)}</p>
            <ClampedControl
              className="text-xs"
              label="View resolution details"
              onActivate={() => options.onViewResolution?.(row)}
            />
          </div>
        )
      },
    },
    {
      key: 'status',
      header: 'Status',
      className: captureColumnWidths.status,
      render: (row) => <span className={clampedLabel}>{statusLabel(row)}</span>,
    },
    {
      key: 'linked-job',
      header: 'Linked Job',
      className: captureColumnWidths['linked-job'],
      render: (row) => {
        if (!row.linkedJob) return '—'
        const label = linkedJobLabel(row)
        if (!options.onOpenJob) return <span className={clampedLabel}>{label}</span>
        const anchor = `capture-job-link-${row.captureId}`
        return (
          <ClampedControl
            id={anchor}
            label={label}
            onActivate={() => options.onOpenJob?.(row.linkedJob!.jobId, anchor)}
          />
        )
      },
    },
    {
      key: 'observedAt',
      header: 'Observed',
      className: captureColumnWidths.observedAt,
      render: (row) => <span className={clampedLabel}>{formatObservedAt(row.observedAt)}</span>,
    },
    {
      key: 'next-action',
      header: 'Next action',
      className: captureColumnWidths['next-action'],
      render: (row) => {
        const intent = row.primaryIntent
        if (!intent || !isCaptureCompletionIntent(intent) || !options.onComplete) {
          return <span className={clampedLabel}>{primaryIntentLabel(row)}</span>
        }
        return (
          <ClampedControl
            label={primaryIntentLabel(row)}
            onActivate={() => options.onComplete?.(row.captureId, intent, row)}
          />
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
