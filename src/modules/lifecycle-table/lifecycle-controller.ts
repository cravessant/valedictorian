import type { ReactNode } from 'react'
import type {
  LifecycleActor,
  RemovalChoice,
  RemovalResult,
  RestoreResult,
} from '@sparxie/sdk'

import type {
  LifecycleAggregateExtensions,
} from './lifecycle-table'
import type { LifecycleOutcome } from './lifecycle-outcome-types'

/**
 * Phase-neutral controller surface that aggregate configs use to expose
 * modal-driven lifecycle operations. Each aggregate config builds a
 * controller bound to its workspace client facet and a stable actor; the
 * controller owns the open/close state of its modals and the outcome of the
 * last mutation. The shared workbench renders the controller's `modalLayer`
 * through the table's `modalLayer` extension slot.
 */
export interface LifecycleController {
  readonly actor: LifecycleActor
  readonly refresh: () => Promise<void> | void
  readonly lastOutcome: LifecycleOutcome | null
  readonly modalLayer: ReactNode
}

export interface LifecycleControllerContext {
  readonly includeRemoved: boolean
  readonly showRemoved: boolean
  readonly onShowRemovedChange: (next: boolean) => void
}

/**
 * Aggregate-neutral helpers shared by aggregate controllers for translating
 * sparxie mutation/removal/restore results into phase-neutral outcome
 * summaries presented by `LifecycleOutcomeView`.
 */
export function removalOutcome(
  result: RemovalResult,
  requestedChoice: RemovalChoice,
): LifecycleOutcome {
  if (result.status === 'removed') {
    return { kind: 'removed', affectedDependentIds: result.affectedDependentIds }
  }
  return {
    kind: 'removal-blocked',
    blocker: result.blocker,
    message: result.blocker.message,
    choice: {
      choice: requestedChoice,
      dependentIds: result.dependentIds,
      supportedChoices: result.supportedChoices,
    },
  }
}

export function restoreOutcome(result: RestoreResult): LifecycleOutcome {
  if (result.status === 'restored') {
    return { kind: 'restored', dependentLinks: result.dependentLinks }
  }
  return { kind: 'error', blocker: result.blocker, message: result.blocker.message }
}

export type { LifecycleAggregateExtensions }