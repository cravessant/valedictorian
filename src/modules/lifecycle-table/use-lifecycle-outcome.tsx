import { useRef, useState, type ReactElement } from 'react'
import type { LifecycleBlocker } from '@sparxie/sdk'

import { OutcomeToast } from './history-modal'
import type { DuplicateChoice, LifecycleOutcome, LifecycleOutcomeActions } from './lifecycle-outcome-types'
import { duplicateRecovery, outcomeForBlocker } from './lifecycle-result'
import { useLifecycleCommand, type LifecycleCommandRun } from './use-lifecycle-command'

export interface LifecycleOutcomeChannel {
  /** True while a command is in flight; drives every form's pending presentation. */
  readonly pending: boolean
  readonly run: (command: LifecycleCommandRun, failureMessage?: string) => void
  readonly show: (outcome: LifecycleOutcome, actions?: LifecycleOutcomeActions) => void
  /** Present a server blocker, offering duplicate recovery when the server named choices. */
  readonly showBlocker: (blocker: LifecycleBlocker, resubmit?: (choice: DuplicateChoice) => void) => void
  readonly clear: () => void
  readonly toast: ReactElement | null
}

/**
 * The single outcome surface an aggregate controller presents, bound to the one
 * command channel that writes it. Recovery actions live in a ref rather than
 * state because a retry replaces them as part of the same commit that sets the
 * outcome they belong to.
 */
export function useLifecycleOutcome(): LifecycleOutcomeChannel {
  const [outcome, setOutcome] = useState<LifecycleOutcome | null>(null)
  const actions = useRef<LifecycleOutcomeActions>({})

  function show(next: LifecycleOutcome, nextActions: LifecycleOutcomeActions = {}) {
    actions.current = nextActions
    setOutcome(next)
  }

  const command = useLifecycleCommand((message) => {
    show({ kind: 'error', blocker: { code: 'impossible_state', message }, message })
  })
  const clear = () => setOutcome(null)

  return {
    pending: command.pending,
    run: command.run,
    show,
    showBlocker: (blocker, resubmit) => {
      const blocked = outcomeForBlocker(blocker)
      show(blocked, resubmit ? duplicateRecovery(blocked, resubmit) : {})
    },
    clear,
    toast: outcome
      ? <OutcomeToast outcome={outcome} pending={command.pending} onDismiss={clear} {...actions.current} />
      : null,
  }
}
