import { useCallback, useRef, useState, type ReactElement } from 'react'
import { Inbox, MoreHorizontal } from 'lucide-react'
import {
  actionQueueBuckets,
  type ActionQueueBucket,
  type ActionQueueListItem,
  type Application,
  type ValedictorianWorkspaceClient,
} from 'sparxie'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { ScopedLoadFailure } from '@/components/ui/error-primitives'
import {
  Pagination,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { formatEnumLabel } from '../../app/labels'
import { applicationDetailMissingFailure } from '../../app/app-load-failure'
import { presentLoadFailure, type ErrorPresentation } from '../../app/error-presentation'
import type { ActionQueueState } from './use-action-queue'
import type { LifecycleAggregateExtensions, LifecycleRowAction } from './lifecycle-table'

const ACTION_BUCKET_ALL = 'all'
const applicationNotFoundSentinel = Symbol('application-not-found')

interface ActionQueueModeProps {
  readonly state: ActionQueueState
  readonly bucket: ActionQueueBucket | undefined
  readonly onBucketChange: (bucket: ActionQueueBucket | undefined) => void
  readonly onNextPage: () => void
  readonly onPreviousPage: () => void
  readonly onRefresh: () => void
  readonly applications: ReadonlyArray<Application> | null
  readonly client: Pick<ValedictorianWorkspaceClient, 'applications'> | null
  readonly extensions: LifecycleAggregateExtensions<Application>
}

export function ActionQueueMode({
  state,
  bucket,
  onBucketChange,
  onNextPage,
  onPreviousPage,
  onRefresh,
  applications,
  client,
  extensions,
}: ActionQueueModeProps): ReactElement {
  const { result, load, error } = state
  const items = result?.items ?? []
  const showTable = load.status === 'loaded' && items.length > 0

  return (
    <section aria-label="Action Queue" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card p-3">
        <ToggleGroup
          type="single"
          aria-label="Action queue buckets"
          variant="outline"
          size="sm"
          spacing={2}
          className="w-fit max-w-full flex-wrap justify-start"
          value={bucket ?? ACTION_BUCKET_ALL}
          onValueChange={(value) => {
            if (!value) return
            onBucketChange(
              value === ACTION_BUCKET_ALL ? undefined : (value as ActionQueueBucket),
            )
          }}
        >
          <ToggleGroupItem value={ACTION_BUCKET_ALL}>
            All {result ? sumBucketCounts(result.actionBucketCounts) : 0}
          </ToggleGroupItem>
          {actionQueueBuckets.map((availableBucket) => (
            <ToggleGroupItem key={availableBucket} value={availableBucket}>
              {bucketLabel(availableBucket)} {result?.actionBucketCounts[availableBucket] ?? 0}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={load.status === 'loading'}
        >
          Refresh
        </Button>
      </div>

      {load.status === 'loading' ? (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 text-sm text-muted-foreground"
          data-testid="action-queue-loading"
        >
          <Spinner aria-label="Loading Action Queue" className="size-4" />
          <span>Loading Action Queue…</span>
        </div>
      ) : null}

      {load.status === 'failure' ? (
        <ScopedLoadFailure
          message={error?.message ?? load.message}
          title={error?.title ?? 'Load failed'}
          onRetry={load.onRetry}
        />
      ) : null}

      {showTable && result ? (
        <section className="flex min-h-0 flex-col rounded-md border border-border bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <p className="text-sm font-medium text-foreground">
              {result.total === 0 ? 0 : result.offset + 1}
              {'-'}
              {Math.min(result.offset + result.items.length, result.total)} of {result.total}
            </p>
            <Pagination aria-label="Action Queue pagination" className="mx-0 w-auto">
              <ButtonGroup>
                <PaginationPrevious
                  aria-label="Previous action queue page"
                  disabled={result.offset === 0}
                  onClick={onPreviousPage}
                >
                  Previous
                </PaginationPrevious>
                <PaginationNext
                  aria-label="Next action queue page"
                  disabled={!result.hasMore}
                  onClick={onNextPage}
                >
                  Next
                </PaginationNext>
              </ButtonGroup>
            </Pagination>
          </div>
          <Table aria-label="Action Queue" containerProps={{ role: 'region', tabIndex: 0 }}>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-44">Company</TableHead>
                <TableHead className="w-56">Role</TableHead>
                <TableHead className="w-32">Status</TableHead>
                <TableHead className="w-20">Score</TableHead>
                <TableHead className="w-32">Next action</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <QueueRow
                  key={item.id}
                  item={item}
                  applications={applications}
                  client={client}
                  extensions={extensions}
                />
              ))}
            </TableBody>
          </Table>
        </section>
      ) : null}

      {load.status === 'loaded' && items.length === 0 ? (
        <Empty aria-label="Empty action queue">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Inbox aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No action queue items</EmptyTitle>
            <EmptyDescription>No items match the current bucket.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
    </section>
  )
}

interface QueueRowProps {
  readonly item: ActionQueueListItem
  readonly applications: ReadonlyArray<Application> | null
  readonly client: Pick<ValedictorianWorkspaceClient, 'applications'> | null
  readonly extensions: LifecycleAggregateExtensions<Application>
}

function QueueRow({ item, applications, client, extensions }: QueueRowProps): ReactElement {
  return (
    <TableRow data-row-id={item.id}>
      <TableCell>
        <span className="block truncate font-medium text-foreground" title={item.companyName}>
          {item.companyName}
        </span>
      </TableCell>
      <TableCell>
        <span className="block truncate text-muted-foreground" title={item.roleTitle}>
          {item.roleTitle}
        </span>
      </TableCell>
      <TableCell>
        <Badge className="max-w-28 truncate whitespace-nowrap" variant="secondary">
          {formatEnumLabel(item.status)}
        </Badge>
      </TableCell>
      <TableCell>
        <Badge
          className="whitespace-nowrap"
          variant={item.currentPriorityScore === null ? 'outline' : 'default'}
        >
          {item.currentPriorityScore === null ? 'Unscored' : `${item.currentPriorityScore}/10`}
        </Badge>
      </TableCell>
      <TableCell>
        <Badge className="max-w-28 truncate whitespace-nowrap">
          {bucketLabel(item.nextAction)}
        </Badge>
      </TableCell>
      <TableCell>
        <span className="block truncate text-muted-foreground" title={item.reason}>
          {item.reason}
        </span>
      </TableCell>
      <TableCell className="text-right">
        <QueueRowActions
          item={item}
          applications={applications}
          client={client}
          extensions={extensions}
        />
      </TableCell>
    </TableRow>
  )
}

interface QueueRowActionsProps {
  readonly item: ActionQueueListItem
  readonly applications: ReadonlyArray<Application> | null
  readonly client: Pick<ValedictorianWorkspaceClient, 'applications'> | null
  readonly extensions: LifecycleAggregateExtensions<Application>
}

function QueueRowActions({
  item,
  applications,
  client,
  extensions,
}: QueueRowActionsProps): ReactElement {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [resolved, setResolved] = useState<Application | null>(null)
  const [resolving, setResolving] = useState(false)
  const [resolutionError, setResolutionError] = useState<ErrorPresentation | null>(null)
  const rowLabel = `${item.companyName} — ${item.roleTitle}`
  const formActions = (extensions.formActions ?? []).filter((action) => action.key !== 'add')
  const historyAction = extensions.historyAction

  const resolveApplication = useCallback(async (): Promise<Application> => {
    const existing = applications?.find((app) => app.id === item.id)
    if (existing) return existing
    if (!client) throw new Error('Workspace HTTP client is unavailable.')
    const fetched = await client.applications.get(item.id)
    if (!fetched) throw applicationNotFoundSentinel
    return fetched
  }, [applications, client, item.id])

  const handleMenuOpen = useCallback((open: boolean) => {
    if (!open) {
      setResolved(null)
      setResolutionError(null)
      return
    }
    setResolving(true)
    setResolutionError(null)
    void resolveApplication().then(
      (app) => { setResolved(app); setResolving(false) },
      (error: unknown) => {
        setResolving(false)
        setResolutionError(
          error === applicationNotFoundSentinel
            ? applicationDetailMissingFailure()
            : presentLoadFailure(error, {
                fallbackMessage: 'Application could not be loaded.',
                trigger: 'load',
              }),
        )
      },
    )
  }, [resolveApplication])

  const activateAction = useCallback(
    async (action: LifecycleRowAction<Application>) => {
      if (!resolved) return
      await action.onActivate(resolved)
    },
    [resolved],
  )

  return (
    <>
      <DropdownMenu onOpenChange={handleMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            ref={triggerRef}
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Actions for row ${rowLabel}`}
            aria-haspopup="menu"
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" aria-label={`Row actions for ${rowLabel}`}>
          {resolutionError ? (
            <div
              role="alert"
              className="px-3 py-2 text-sm text-destructive"
              data-testid="queue-resolution-error"
            >
              <p className="font-medium">{resolutionError.title}</p>
              <p>{resolutionError.message}</p>
            </div>
          ) : resolving ? (
            <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
              <Spinner className="size-3" aria-label="Resolving application" />
              <span>Loading…</span>
            </div>
          ) : resolved ? (
            <>
              {formActions.map((action) => {
                const disabled = action.disabled?.(resolved) ?? false
                return (
                  <DropdownMenuItem
                    key={action.key}
                    variant={action.destructive ? 'destructive' : 'default'}
                    disabled={disabled}
                    onSelect={() => { void activateAction(action) }}
                  >
                    {action.label}
                  </DropdownMenuItem>
                )
              })}
              {historyAction ? (
                <DropdownMenuItem
                  key={historyAction.key}
                  disabled={historyAction.disabled?.(resolved) ?? false}
                  onSelect={() => { void activateAction(historyAction) }}
                >
                  {historyAction.label}
                </DropdownMenuItem>
              ) : null}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}

function bucketLabel(bucket: ActionQueueBucket): string {
  const labels: Record<ActionQueueBucket, string> = {
    apply_now: 'Apply now',
    manual_review_pickup: 'Manual review',
    needs_user_info: 'Needs info',
    stale_lock_recovery: 'Stale locks',
    user_review_required: 'User review',
    blocked: 'Blocked',
    skip_below_cutoff: 'Below cutoff',
  }
  return labels[bucket]
}

function sumBucketCounts(counts: Record<ActionQueueBucket, number>): number {
  return actionQueueBuckets.reduce((sum, bucket) => sum + counts[bucket], 0)
}
