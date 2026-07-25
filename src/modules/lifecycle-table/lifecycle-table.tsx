import { useRef, useState, type ReactElement, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScopedLoadFailure } from '@/components/ui/error-primitives'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

/**
 * Phase-neutral shared lifecycle table family. Owns the read-side shell:
 * layout, toolbar slot, loading/empty/error states, responsive overflow,
 * accessible row-action presentation, confirmation integration, mutation
 * status announcements, deterministic trigger-focus restoration, and
 * refresh/invalidation integration. Aggregate configs own columns, labels,
 * capabilities, and modal/form extension points.
 */

export type LifecycleLoadState =
  | { status: 'loading' }
  | { status: 'loaded' }
  | { status: 'failure'; message: string; onRetry?: () => void }

export interface LifecycleColumn<Row> {
  readonly key: string
  readonly header: string
  readonly className?: string
  readonly render: (row: Row) => ReactNode
}

export interface LifecycleRowActionConfirm {
  readonly title: string
  readonly description: string
  readonly confirmLabel?: string
  readonly cancelLabel?: string
}

export interface LifecycleRowAction<Row> {
  readonly key: string
  readonly label: string
  readonly destructive?: boolean
  readonly confirm?: LifecycleRowActionConfirm
  readonly visible?: (row: Row) => boolean
  readonly disabled?: (row: Row) => boolean
  readonly onActivate: (row: Row) => Promise<void> | void
  /**
   * When true, the action opens a modal (or otherwise defers mutation
   * feedback to the modal). The shared table suppresses its own pending/
   * success/failure announcement so the modal submission owns mutation
   * feedback and the opener does not announce a fake mutation success.
   */
  readonly modal?: boolean
}

export interface LifecycleTableConfig<Row> {
  readonly columns: ReadonlyArray<LifecycleColumn<Row>>
  readonly actions: ReadonlyArray<LifecycleRowAction<Row>>
  readonly rowId: (row: Row) => string
  readonly rowLabel: (row: Row) => string
  readonly caption: string
  readonly empty: { readonly title: string; readonly description: string }
  readonly extensions?: LifecycleAggregateExtensions<Row>
}

export interface LifecycleAggregateExtensions<Row> {
  readonly capabilities?: (row: Row) => Readonly<Record<string, boolean>>
  readonly formActions?: ReadonlyArray<LifecycleRowAction<Row>>
  readonly historyAction?: LifecycleRowAction<Row>
  readonly promotionActions?: ReadonlyArray<LifecycleRowAction<Row>>
  readonly modalLayer?: ReactNode
}

export interface LifecycleToolbarProps {
  readonly tableCaption: string
  readonly total: number
  readonly loading: boolean
  readonly onRefresh: () => void
}

export type LifecycleToolbarSlot = (props: LifecycleToolbarProps) => ReactElement

export interface LifecycleTableProps<Row> {
  readonly config: LifecycleTableConfig<Row>
  readonly data: ReadonlyArray<Row> | null
  readonly state: LifecycleLoadState
  readonly toolbar?: ReactElement
  readonly onRefresh?: () => Promise<void> | void
  readonly focusLoadFailure?: boolean
}

type MutationStatus =
  | { kind: 'idle' }
  | { kind: 'pending'; label: string }
  | { kind: 'succeeded'; label: string }
  | { kind: 'failed'; label: string; message: string }

interface PendingAction<Row> {
  readonly row: Row
  readonly action: LifecycleRowAction<Row>
  readonly triggerElement: HTMLButtonElement | null
}

export function LifecycleTable<Row>({
  config,
  data,
  state,
  toolbar,
  onRefresh,
  focusLoadFailure = true,
}: LifecycleTableProps<Row>): ReactElement {
  const [pendingAction, setPendingAction] = useState<PendingAction<Row> | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [mutation, setMutation] = useState<MutationStatus>({ kind: 'idle' })
  const actions = configuredActions(config)
  const fallbackFocusRef = useRef<HTMLElement>(null)
  async function runAction<Row2>(row: Row2, action: LifecycleRowAction<Row2>, trigger: HTMLButtonElement | null) {
    if (action.modal) {
      await Promise.resolve(action.onActivate(row))
      return
    }
    setMutation({ kind: 'pending', label: pendingLabel(action.label) })
    try {
      await Promise.resolve(action.onActivate(row))
      await Promise.resolve(onRefresh?.())
      setMutation({ kind: 'succeeded', label: successLabel(action.label) })
      restoreFocus(trigger, fallbackFocusRef.current)
    } catch (error) {
      setMutation({
        kind: 'failed',
        label: `${action.label} failed`,
        message: error instanceof Error ? error.message : 'The action could not be completed.',
      })
      restoreFocus(trigger, fallbackFocusRef.current)
    }
  }

  function closeAndClearPending() {
    setConfirmOpen(false)
    setPendingAction(null)
  }

  return (
    <section
      ref={fallbackFocusRef}
      aria-label={config.caption}
      className="flex min-w-0 flex-col gap-3"
      tabIndex={-1}
    >
      {toolbar}
      <Table
        aria-label={config.caption}
        containerProps={{
          'aria-label': `${config.caption} viewport`,
          role: 'region',
          tabIndex: 0,
        }}
      >
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {config.columns.map((column) => (
              <TableHead key={column.key} className={column.className}>
                {column.header}
              </TableHead>
            ))}
            {actions.length > 0 ? (
              <TableHead className="w-16 text-right">Actions</TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {state.status === 'loaded' && data && data.length > 0
            ? data.map((row) => (
                <TableRow key={config.rowId(row)} data-row-id={config.rowId(row)}>
                  {config.columns.map((column) => (
                    <TableCell key={column.key} className={column.className}>
                      {column.render(row)}
                    </TableCell>
                  ))}
                  {actions.length > 0 ? (
                    <TableCell className="text-right">
                      <RowActions
                        row={row}
                        config={config}
                        onOpenConfirm={(p) => {
                          setPendingAction(p)
                          setConfirmOpen(true)
                        }}
                        onRunAction={(row2, action, trigger) => {
                          void runAction(row2, action, trigger)
                        }}
                      />
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            : null}
        </TableBody>
      </Table>

      {state.status === 'loading' ? (
        <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="lifecycle-loading">
          <Spinner aria-label={`Loading ${config.caption}`} className="size-4" />
          <span>Loading {config.caption}…</span>
        </div>
      ) : null}

      {state.status === 'loaded' && data && data.length === 0 ? (
        <Empty aria-label={`Empty ${config.caption}`}>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MoreHorizontal className="size-6" aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>{config.empty.title}</EmptyTitle>
            <EmptyDescription>{config.empty.description}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {state.status === 'failure' ? (
        <ScopedLoadFailure
          autoFocus={focusLoadFailure}
          message={state.message}
          onRetry={state.onRetry}
        />
      ) : null}

      {mutation.kind !== 'idle' ? (
        <div
          role={mutation.kind === 'failed' ? 'alert' : 'status'}
          aria-live={mutation.kind === 'failed' ? 'assertive' : 'polite'}
          className={mutation.kind === 'failed'
            ? 'rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'
            : 'rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground'}
          data-testid="lifecycle-mutation-status"
        >
          {mutation.label}
          {mutation.kind === 'failed' ? `: ${mutation.message}` : null}
        </div>
      ) : null}

      {config.extensions?.modalLayer}

      {pendingAction ? (
        <AlertDialog
          open={confirmOpen}
          onOpenChange={(open) => {
            if (!open) closeAndClearPending()
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{pendingAction.action.confirm?.title ?? pendingAction.action.label}</AlertDialogTitle>
              <AlertDialogDescription>
                {pendingAction.action.confirm?.description ?? 'Confirm this action.'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>
                {pendingAction.action.confirm?.cancelLabel ?? 'Cancel'}
              </AlertDialogCancel>
              <AlertDialogAction
                variant={pendingAction.action.destructive ? 'destructive' : 'default'}
                onClick={() => {
                  const trigger = pendingAction.triggerElement
                  const action = pendingAction.action
                  const row = pendingAction.row
                  closeAndClearPending()
                  void runAction(row, action, trigger)
                }}
              >
                {pendingAction.action.confirm?.confirmLabel ?? 'Confirm'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </section>
  )
}

interface RowActionsProps<Row> {
  readonly row: Row
  readonly config: LifecycleTableConfig<Row>
  readonly onOpenConfirm: (pending: PendingAction<Row>) => void
  readonly onRunAction: (row: Row, action: LifecycleRowAction<Row>, trigger: HTMLButtonElement | null) => void
}

function RowActions<Row>({
  row,
  config,
  onOpenConfirm,
  onRunAction,
}: RowActionsProps<Row>): ReactElement {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const rowLabel = config.rowLabel(row)
  const actions = configuredActions(config)
  return (
    <DropdownMenu>
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
        {actions.filter((action) => action.visible?.(row) ?? true).map((action) => {
          const disabled = action.disabled?.(row) ?? false
          return (
            <DropdownMenuItem
              key={action.key}
              variant={action.destructive ? 'destructive' : 'default'}
              disabled={disabled}
              onSelect={() => {
                const trigger = triggerRef.current
                if (action.confirm) {
                  onOpenConfirm({ row, action, triggerElement: trigger })
                } else {
                  onRunAction(row, action, trigger)
                }
              }}
            >
              {action.label}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function configuredActions<Row>(config: LifecycleTableConfig<Row>): ReadonlyArray<LifecycleRowAction<Row>> {
  const extensions = config.extensions
  return [
    ...config.actions,
    ...(extensions?.formActions ?? []),
    ...(extensions?.historyAction ? [extensions.historyAction] : []),
    ...(extensions?.promotionActions ?? []),
  ]
}

function pendingLabel(actionLabel: string): string {
  return `${actionLabel}…`
}

function successLabel(actionLabel: string): string {
  if (/^remove/i.test(actionLabel)) return `Removed`
  if (/^restore/i.test(actionLabel)) return `Restored`
  if (/^open/i.test(actionLabel)) return `Opened`
  return `${actionLabel} completed`
}

function restoreFocus(
  trigger: HTMLButtonElement | null,
  fallback: HTMLElement | null,
): void {
  setTimeout(() => {
    if (trigger?.isConnected) trigger.focus()
    else fallback?.focus()
  }, 0)
}
