import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AlertCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import type {
  ConnectorStatusAction,
  ConnectorStatusListResult,
  ConnectorStatusSeverity,
  ConnectorStatusView,
} from './connector.status'
import { formatRetryAdviceGuidance } from './connector.retry-guidance'

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
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Job automation
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal text-foreground">
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
          <Alert variant="destructive" className="bg-card">
            <AlertCircle className="absolute left-4 top-4 h-4 w-4" aria-hidden="true" />
            <div className="pl-7">
              <AlertTitle>Load failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </div>
          </Alert>
        ) : null}

        {!isLoading && !result.available && !error ? (
          <section className="rounded-md border border-border bg-card p-6 text-sm text-muted-foreground">
            Connector status is unavailable for this runtime.
          </section>
        ) : showTable ? (
          <section className="flex min-h-72 flex-col rounded-md border border-border bg-card">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <p className="text-sm font-medium text-foreground">
                {result.items.length} connector{result.items.length === 1 ? '' : 's'}
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <Table aria-label="Connector status" className="min-w-[1050px] table-fixed">
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
              </Table>
            </div>
          </section>
        ) : !isLoading && !error ? (
          <section className="rounded-md border border-border bg-card p-6 text-sm text-muted-foreground">
            No enabled connectors.
          </section>
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
      <TableCell>
        <span className="block truncate font-medium text-foreground" title={item.displayName}>
          {item.displayName}
        </span>
        <span className="block truncate text-xs text-muted-foreground" title={item.connectorId}>
          {item.connectorId}
        </span>
      </TableCell>
      <TableCell>
        <Badge
          className={`max-w-36 truncate whitespace-nowrap ${badgeClass(item.severity)}`}
          variant={badgeVariant(item.severity)}
        >
          {item.statusLabel}
        </Badge>
      </TableCell>
      <TableCell>
        <span className="block truncate text-sm text-muted-foreground" title={item.summary}>
          {item.summary}
        </span>
        {item.retryAdvice ? (
          <span className="block text-xs text-muted-foreground">
            {formatRetryAdviceGuidance(item.retryAdvice)}
          </span>
        ) : null}
        <span className="block text-xs text-muted-foreground">
          {item.observationCount} observations
        </span>
      </TableCell>
      <TableCell>
        {item.warnings.length > 0 ? (
          <div className="flex max-w-full flex-wrap gap-1">
            {item.warnings.slice(0, 3).map((warning) => (
              <Badge
                key={`${item.id}:${warning.code}`}
                className={`max-w-40 truncate whitespace-nowrap ${badgeClass(warning.severity)}`}
                title={warning.message}
                variant={badgeVariant(warning.severity)}
              >
                {warning.label}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">None</span>
        )}
      </TableCell>
      <TableCell>
        <span className="block truncate text-sm text-muted-foreground" title={item.lastRunAt ?? 'Never'}>
          {formatRunTime(item.lastRunAt)}
        </span>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          {item.actions.length > 0 ? item.actions.map((action) => (
            <Button
              key={action.id}
              type="button"
              size="sm"
              variant={action.id === 'reconnect' ? 'default' : 'outline'}
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
