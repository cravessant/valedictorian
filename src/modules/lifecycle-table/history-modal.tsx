import { useEffect, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Spinner } from '@/components/ui/spinner'

import { LifecycleOutcomeView } from './lifecycle-outcome-view'
import type { LifecycleOutcome, LifecycleOutcomeActions } from './lifecycle-outcome-types'

/**
 * Read-only history modal. Loads real history entries and presents them via
 * the shared outcome view. Aggregate controllers feed the loaded outcome and
 * pending state in so this component stays presentational.
 */
export function HistoryModal({
  open,
  title,
  description = 'Read-only revision history.',
  outcome,
  pending,
  onClose,
}: {
  open: boolean
  title: string
  description?: string
  outcome: LifecycleOutcome | null
  pending: boolean
  onClose: () => void
}): ReactElement {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <ScrollArea aria-label="History entries" role="region" tabIndex={0} className="max-h-[60vh]">
          {pending && !outcome ? (
            <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="size-4" /> Loading history…
            </div>
          ) : null}
          {outcome ? <LifecycleOutcomeView outcome={outcome} /> : null}
        </ScrollArea>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Lightweight transient outcome toast anchored bottom-right. The controller
 * owns the outcome; dismissal clears it.
 */
export function OutcomeToast({
  outcome,
  onDismiss,
  onResolveDuplicate,
  onResolveRemoval,
  onOverrideWarnings,
  pending = false,
}: {
  outcome: LifecycleOutcome
  onDismiss: () => void
  pending?: boolean
} & LifecycleOutcomeActions): ReactElement {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    setVisible(true)
  }, [outcome])
  if (!visible) return <></>
  const content = (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-md border border-border bg-card p-3 shadow-lg">
      <LifecycleOutcomeView
        outcome={outcome}
        onResolveDuplicate={onResolveDuplicate}
        onResolveRemoval={onResolveRemoval}
        onOverrideWarnings={onOverrideWarnings}
        pending={pending}
      />
      <button
        type="button"
        onClick={() => { setVisible(false); onDismiss() }}
        disabled={pending}
        className="mt-2 text-xs text-muted-foreground underline"
      >
        Dismiss
      </button>
    </div>
  )
  const requiresResolution = outcome.kind === 'duplicate'
    || outcome.kind === 'warnings'
    || outcome.kind === 'removal-blocked'
  const activeDialog = requiresResolution
    ? document.querySelector<HTMLElement>('[role="dialog"]')
    : null
  return activeDialog ? createPortal(content, activeDialog) : content
}
