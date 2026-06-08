import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ExternalLinkButton } from '@/components/ExternalLinkButton'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AlertCircle, Pencil } from 'lucide-react'
import { queueBuckets, type QueueBucket, type QueueListItem, type QueueListResult } from 'sparxie'
import type { ApplicationDetailSeed } from '../../app/types'

interface QueuePageProps {
  bucket: QueueBucket | undefined
  contentColumnClass: string
  error: string | null
  isLoading: boolean
  result: QueueListResult
  onBucketChange: (bucket: QueueBucket | undefined) => void
  onEditApplication: (application: ApplicationDetailSeed) => void
  onOpenApplication: (application: ApplicationDetailSeed) => void
  onPreviousPage: () => void
  onNextPage: () => void
}

function QueuePage({
  bucket,
  contentColumnClass,
  error,
  isLoading,
  result,
  onBucketChange,
  onEditApplication,
  onOpenApplication,
  onPreviousPage,
  onNextPage,
}: QueuePageProps) {
  const pageStart = result.total === 0 ? 0 : result.offset + 1
  const pageEnd = Math.min(result.offset + result.items.length, result.total)

  return (
    <main className={`flex h-full min-w-0 flex-col overflow-hidden px-4 py-5 text-foreground md:h-[calc(100vh-3rem)] sm:px-6 lg:px-8 ${contentColumnClass}`}>
      <section className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-4">
        <header className="flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Job automation
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal text-foreground">
              Queue
            </h1>
          </div>
          <Badge variant="secondary" className="w-fit border border-border bg-card">
            {result.total} rows
          </Badge>
        </header>

        <section aria-label="Queue buckets" className="rounded-md border border-border bg-card p-4">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={bucket === undefined ? 'default' : 'outline'}
              size="sm"
              onClick={() => onBucketChange(undefined)}
            >
              All {sumQueueCounts(result)}
            </Button>
            {queueBuckets.map((queueBucket) => (
              <Button
                key={queueBucket}
                type="button"
                variant={bucket === queueBucket ? 'default' : 'outline'}
                size="sm"
                onClick={() => onBucketChange(queueBucket)}
              >
                {queueBucketLabel(queueBucket)} {result.bucketCounts[queueBucket]}
              </Button>
            ))}
          </div>
        </section>

        {isLoading ? (
          <div
            role="status"
            aria-label="Queue loading"
            className="rounded-md border border-border bg-card p-4"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-foreground">Loading queue...</p>
              <Skeleton className="h-2 w-24" />
            </div>
            <Skeleton className="h-9 w-full" />
          </div>
        ) : null}

        {error ? (
          <Alert variant="destructive" className="bg-card">
            <AlertCircle className="absolute left-4 top-4 h-4 w-4" aria-hidden="true" />
            <div className="pl-7">
              <AlertTitle>Load failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </div>
          </Alert>
        ) : null}

        <section className="flex min-h-0 flex-1 flex-col rounded-md border border-border bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <p className="text-sm font-medium text-foreground">
              {pageStart}-{pageEnd} of {result.total}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Previous queue page"
                disabled={result.offset === 0}
                onClick={onPreviousPage}
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Next queue page"
                disabled={!result.hasMore}
                onClick={onNextPage}
              >
                Next
              </Button>
            </div>
          </div>
          <Table aria-label="Queue" className="min-w-[980px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Company</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Link</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.items.map((item) => (
                <QueueRow
                  key={item.id}
                  item={item}
                  onEditApplication={onEditApplication}
                  onOpenApplication={onOpenApplication}
                />
              ))}
            </TableBody>
          </Table>
        </section>
      </section>
    </main>
  )
}


function QueueRow({
  item,
  onEditApplication,
  onOpenApplication,
}: {
  item: QueueListItem
  onEditApplication: (application: ApplicationDetailSeed) => void
  onOpenApplication: (application: ApplicationDetailSeed) => void
}) {
  return (
    <TableRow className="cursor-pointer" onClick={() => onOpenApplication(item)}>
      <TableCell>
        <span className="font-medium text-foreground">{item.companyName}</span>
      </TableCell>
      <TableCell>
        <span className="block min-w-64 text-muted-foreground">{item.roleTitle}</span>
      </TableCell>
      <TableCell>
        <Badge variant="secondary">{item.status}</Badge>
      </TableCell>
      <TableCell>
        <Badge variant={item.currentPriorityScore === null ? 'outline' : 'default'}>
          {item.currentPriorityScore === null ? 'No score' : `${item.currentPriorityScore}/10`}
        </Badge>
      </TableCell>
      <TableCell>
        <Badge>{item.nextAction}</Badge>
      </TableCell>
      <TableCell>
        <span className="block min-w-72 text-muted-foreground">{item.reason}</span>
      </TableCell>
      <TableCell>
        {item.primaryLink ? (
          <ExternalLinkButton className="px-2" href={item.primaryLink.url}>
            {item.primaryLink.label}
          </ExternalLinkButton>
        ) : (
          <span className="text-muted-foreground">None</span>
        )}
      </TableCell>
      <TableCell>
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
      </TableCell>
    </TableRow>
  )
}


function queueBucketLabel(bucket: QueueBucket) {
  const labels: Record<QueueBucket, string> = {
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

function sumQueueCounts(result: QueueListResult) {
  return queueBuckets.reduce((sum, bucket) => sum + result.bucketCounts[bucket], 0)
}


export { QueuePage }
