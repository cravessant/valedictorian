import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import {
  Pagination,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { AlertCircle, ExternalLink, Inbox, Pencil } from 'lucide-react'
import { actionQueueBuckets, type ActionQueueBucket, type ActionQueueListItem, type ActionQueueListResult } from 'sparxie'
import type { ApplicationDetailSeed } from '../../app/types'
import { formatEnumLabel } from '../../app/labels'

const ACTION_BUCKET_ALL = 'all'

interface ActionQueuePageProps {
  actionBucket: ActionQueueBucket | undefined
  contentColumnClass: string
  error: string | null
  isLoading: boolean
  result: ActionQueueListResult
  onActionBucketChange: (actionBucket: ActionQueueBucket | undefined) => void
  onEditApplication: (application: ApplicationDetailSeed) => void
  onOpenApplication: (application: ApplicationDetailSeed) => void
  onPreviousPage: () => void
  onNextPage: () => void
}

function ActionQueuePage({
  actionBucket,
  contentColumnClass,
  error,
  isLoading,
  result,
  onActionBucketChange,
  onEditApplication,
  onOpenApplication,
  onPreviousPage,
  onNextPage,
}: ActionQueuePageProps) {
  const pageStart = result.total === 0 ? 0 : result.offset + 1
  const pageEnd = Math.min(result.offset + result.items.length, result.total)
  const showResultTable = !error && result.items.length > 0

  return (
    <main className={`flex h-full min-w-0 flex-col overflow-hidden px-4 py-5 text-foreground md:h-[calc(100vh-3rem)] sm:px-6 lg:px-8 ${contentColumnClass}`}>
      <section className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-4">
        <header className="flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Job automation
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal text-foreground">
              Action Queue
            </h1>
          </div>
          <Badge variant="secondary" className="w-fit border border-border bg-card">
            {result.total} rows
          </Badge>
        </header>

        <section className="rounded-md border border-border bg-card p-4">
          <ToggleGroup
            type="single"
            aria-label="Action Buckets"
            variant="outline"
            size="sm"
            spacing={2}
            className="w-full max-w-full flex-wrap justify-start"
            value={actionBucket ?? ACTION_BUCKET_ALL}
            onValueChange={(value) => {
              if (!value) return
              onActionBucketChange(
                value === ACTION_BUCKET_ALL ? undefined : (value as ActionQueueBucket),
              )
            }}
          >
            <ToggleGroupItem value={ACTION_BUCKET_ALL}>
              All {sumActionBucketCounts(result)}
            </ToggleGroupItem>
            {actionQueueBuckets.map((availableActionBucket) => (
              <ToggleGroupItem key={availableActionBucket} value={availableActionBucket}>
                {actionBucketLabel(availableActionBucket)} {result.actionBucketCounts[availableActionBucket]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </section>

        {isLoading ? (
          <div
            role="status"
            aria-label="Action Queue loading"
            className="rounded-md border border-border bg-card p-4"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-foreground">Loading Action Queue...</p>
              <Skeleton className="h-2 w-24" />
            </div>
            <Skeleton className="h-9 w-full" />
          </div>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertTitle>Load failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {showResultTable ? (
          <section className="flex min-h-0 flex-1 flex-col rounded-md border border-border bg-card">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <p className="text-sm font-medium text-foreground">
                {pageStart}-{pageEnd} of {result.total}
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
            <Table aria-label="Action Queue" className="min-w-[960px] table-fixed">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-44">Company</TableHead>
                  <TableHead className="w-56">Role</TableHead>
                  <TableHead className="w-32">Status</TableHead>
                  <TableHead className="w-20">Score</TableHead>
                  <TableHead className="w-32">Next action</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.items.map((item) => (
                  <ActionQueueRow
                    key={item.id}
                    item={item}
                    onEditApplication={onEditApplication}
                    onOpenApplication={onOpenApplication}
                  />
                ))}
              </TableBody>
            </Table>
          </section>
        ) : !isLoading && !error ? (
          <Empty
            aria-label="Empty action queue"
            className="min-h-[11.25rem] flex-none gap-4 rounded-md border border-solid border-border bg-card p-6 md:min-h-[13.5rem] md:max-h-60 md:p-8"
          >
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Inbox aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>
                <h2>No action queue items</h2>
              </EmptyTitle>
              <EmptyDescription>No items match the current bucket.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
      </section>
    </main>
  )
}


function ActionQueueRow({
  item,
  onEditApplication,
  onOpenApplication,
}: {
  item: ActionQueueListItem
  onEditApplication: (application: ApplicationDetailSeed) => void
  onOpenApplication: (application: ApplicationDetailSeed) => void
}) {
  return (
    <TableRow className="cursor-pointer" onClick={() => onOpenApplication(item)}>
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
        <Badge className="whitespace-nowrap" variant={item.currentPriorityScore === null ? 'outline' : 'default'}>
          {item.currentPriorityScore === null ? 'Unscored' : `${item.currentPriorityScore}/10`}
        </Badge>
      </TableCell>
      <TableCell>
        <Badge className="max-w-28 truncate whitespace-nowrap">
          {actionBucketLabel(item.nextAction)}
        </Badge>
      </TableCell>
      <TableCell>
        <span className="block truncate text-muted-foreground" title={item.reason}>
          {item.reason}
        </span>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          {item.primaryLink ? (
            <Button asChild variant="ghost" size="icon">
              <a
                aria-label={`Open ${item.primaryLink.label} for ${item.companyName}`}
                href={item.primaryLink.url}
                rel="noreferrer"
                target="_blank"
                onClick={(event) => event.stopPropagation()}
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </a>
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Edit ${item.companyName}`}
            onClick={(event) => {
              event.stopPropagation()
              onEditApplication(item)
            }}
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}


function actionBucketLabel(bucket: ActionQueueBucket) {
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

function sumActionBucketCounts(result: ActionQueueListResult) {
  return actionQueueBuckets.reduce((sum, bucket) => sum + result.actionBucketCounts[bucket], 0)
}


export { ActionQueuePage }
