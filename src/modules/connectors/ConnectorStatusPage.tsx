import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { typography, typographyClass } from '@/components/ui/typography'
import { cn } from '@/lib/utils'
import { AlertCircle, Cable } from 'lucide-react'
import type { ReactNode } from 'react'
import type {
  ConnectorStatusAction,
  ConnectorStatusListResult,
  ConnectorStatusSeverity,
  ConnectorStatusView,
} from './connector.status'

const CONNECTOR_STATUS_SCROLL_HINT_ID = 'connector-status-scroll-hint'

interface ConnectorStatusPageProps {
  contentColumnClass: string
  error: string | null
  isLoading: boolean
  operations?: ReactNode
  result: ConnectorStatusListResult
  onAction: (connector: ConnectorStatusView, action: ConnectorStatusAction) => void
}

function ConnectorStatusPage({
  contentColumnClass,
  error,
  isLoading,
  operations,
  result,
  onAction,
}: ConnectorStatusPageProps) {
  const showTable = result.available && !error && result.items.length > 0

  return (
    <main className={`h-full min-w-0 overflow-auto px-4 py-5 text-foreground md:h-[calc(100vh-3rem)] sm:px-6 lg:px-8 ${contentColumnClass}`}>
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-5 pb-6">
        <header className="flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className={typography.pageEyebrow}>
              Job automation
            </p>
            <h1 className={typographyClass('pageTitle', 'mt-1')}>
              Connectors
            </h1>
          </div>
          <Badge variant="secondary" className="w-fit border border-border bg-card">
            {result.available ? `${result.items.length} enabled` : 'Unavailable'}
          </Badge>
        </header>

        {operations ? (
          <section aria-label="Connector operations">
            {operations}
          </section>
        ) : null}

        {isLoading ? (
          <div
            role="status"
            aria-label="Connector status loading"
            className="rounded-md border border-border bg-card p-4"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-foreground">Loading connectors...</p>
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

        {!isLoading && !result.available && !error ? (
          <section className="rounded-md border border-border bg-card p-6 text-sm text-muted-foreground">
            Connector status is unavailable for this runtime.
          </section>
        ) : showTable ? (
          <section
            aria-label="Connector status"
            className="flex min-h-72 min-w-0 max-w-full flex-col rounded-md border border-border bg-card"
          >
            <div className="flex min-w-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
              <p className="text-sm font-medium text-foreground">
                {result.items.length} connector{result.items.length === 1 ? '' : 's'}
              </p>
            </div>
            <p
              className="border-b border-border px-4 py-2 text-xs text-muted-foreground"
              id={CONNECTOR_STATUS_SCROLL_HINT_ID}
            >
              Narrow layout: focus this status table and scroll horizontally to review every column.
            </p>
            <div
              aria-describedby={CONNECTOR_STATUS_SCROLL_HINT_ID}
              aria-label="Connector status table"
              className="min-h-0 min-w-0 max-w-full flex-1 overflow-x-auto outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              role="region"
              tabIndex={0}
            >
              <table
                aria-label="Connector status"
                className="w-full min-w-[1050px] table-fixed caption-bottom text-sm"
                data-slot="table"
              >
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-48">Connector</TableHead>
                    <TableHead className="w-40">Status</TableHead>
                    <TableHead>Summary</TableHead>
                    <TableHead className="w-48">Warnings</TableHead>
                    <TableHead className="w-36">Latest run</TableHead>
                    <TableHead className="w-44">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.items.map((item) => (
                    <ConnectorStatusRow key={item.id} item={item} onAction={onAction} />
                  ))}
                </TableBody>
              </table>
            </div>
          </section>
        ) : !isLoading && !error ? (
          <Empty
            aria-label="Empty connector status"
            className="min-h-[11.25rem] flex-none gap-4 rounded-md border border-solid border-border bg-card p-6 md:min-h-[13.5rem] md:max-h-60 md:p-8"
          >
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Cable aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>
                <h2>No enabled connectors</h2>
              </EmptyTitle>
              <EmptyDescription>
                Enable a connector to monitor refresh health here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
      </section>
    </main>
  )
}

function ConnectorStatusRow({
  item,
  onAction,
}: {
  item: ConnectorStatusView
  onAction: (connector: ConnectorStatusView, action: ConnectorStatusAction) => void
}) {
  return (
    <TableRow>
      <TableCell className="min-w-0 align-top">
        <span className="block min-w-0 break-words font-medium text-foreground">
          {item.displayName}
        </span>
        <span className="block min-w-0 break-words text-xs text-muted-foreground">
          {item.connectorId}
        </span>
      </TableCell>
      <TableCell className="min-w-0 align-top">
        <Badge
          aria-label={item.statusLabel}
          className={cn(
            'max-w-full whitespace-normal break-words',
            badgeClass(item.severity),
          )}
          variant={badgeVariant(item.severity)}
        >
          {item.statusLabel}
        </Badge>
      </TableCell>
      <TableCell className="min-w-0 align-top">
        <span className="block min-w-0 break-words text-sm text-muted-foreground">
          {item.summary}
        </span>
        {item.nextAttemptAt ? (
          <span className="block min-w-0 break-words text-xs text-muted-foreground">
            Next attempt {new Date(item.nextAttemptAt).toLocaleString()}
          </span>
        ) : null}
        <span className="block text-xs text-muted-foreground">
          {item.observationCount} observations
        </span>
      </TableCell>
      <TableCell className="min-w-0 align-top">
        {item.warnings.length > 0 ? (
          <div className="flex min-w-0 max-w-full flex-wrap gap-1">
            {item.warnings.map((warning) => (
              <Badge
                key={`${item.id}:${warning.code}`}
                className={cn(
                  'max-w-full whitespace-normal break-words',
                  badgeClass(warning.severity),
                )}
                variant={badgeVariant(warning.severity)}
              >
                {warning.label}: {warning.message}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">None</span>
        )}
      </TableCell>
      <TableCell className="min-w-0 align-top">
        <span className="block min-w-0 break-words text-sm text-muted-foreground">
          {formatRunTime(item.lastRunAt)}
        </span>
      </TableCell>
      <TableCell className="min-w-0 align-top">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {item.actions.length > 0 ? item.actions.map((action) => (
            <Button
              key={action.id}
              type="button"
              size="sm"
              variant={action.id === 'reconnect' ? 'default' : 'outline'}
              className="max-w-full min-w-0 whitespace-normal"
              aria-label={`${action.label} ${action.id === 'skip' ? 'for ' : ''}${item.displayName}`}
              onClick={() => onAction(item, action)}
            >
              {action.label}
            </Button>
          )) : (
            <span className="text-sm text-muted-foreground">None</span>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}

function badgeVariant(severity: ConnectorStatusSeverity) {
  if (severity === 'blocked') {
    return 'warning'
  }

  return severity === 'warning' ? 'outline' : 'secondary'
}

function badgeClass(severity: ConnectorStatusSeverity) {
  return severity === 'blocked'
    ? 'border-destructive/30 bg-destructive/15 text-destructive'
    : ''
}

function formatRunTime(value: string | null): string {
  return value ?? 'Never'
}

export { ConnectorStatusPage }
