import { useRef } from 'react'
import { useMutation } from '@tanstack/react-query'

import {
  WorkspaceClientUnavailableError,
  workspaceClientUnavailableMessage,
} from '../../app/app-load-failure'
import { presentLoadFailure } from '../../app/error-presentation'

/** A remote lifecycle command: send the input, interpret the result, invalidate. */
export type LifecycleCommandRun = () => Promise<void>

/**
 * A blocker message the lifecycle contract defines as safe to show. Only a
 * message the command already read out of a typed server blocker may be raised
 * this way; anything else is classified before it reaches a surface.
 */
export class LifecycleBlockerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LifecycleBlockerError'
  }
}

export interface LifecycleCommandChannel {
  /** True while a command is in flight; drives every form's pending presentation. */
  readonly pending: boolean
  readonly run: (command: LifecycleCommandRun, failureMessage?: string) => void
}

/**
 * The single remote-command channel an aggregate controller owns.
 *
 * A controller presents one command at a time — one pending state, one outcome
 * surface — so one mutation models it. TanStack owns in-flight state and
 * rejection reporting; the command itself owns the aggregate's blocker,
 * duplicate, warning, and invalidation semantics. A rejected command reports the
 * safe failure outcome and commits nothing.
 *
 * The in-flight ref refuses a second submit within the same commit, before the
 * pending state has been rendered, so a double-clicked submit sends once.
 */
export function useLifecycleCommand(
  onFailure: (message: string) => void,
): LifecycleCommandChannel {
  const inFlight = useRef(false)
  const mutation = useMutation({
    mutationFn: (command: { run: LifecycleCommandRun; failureMessage: string }) => command.run(),
    onError: (error: unknown, command) => onFailure(commandFailureMessage(error, command.failureMessage)),
    onSettled: () => { inFlight.current = false },
  })
  return {
    pending: mutation.isPending,
    run: (run, failureMessage = 'Operation failed.') => {
      if (inFlight.current) return
      inFlight.current = true
      mutation.mutate({ run, failureMessage })
    },
  }
}

/**
 * The safe public message for a failed command. Canonical server blockers and
 * the renderer's own connection message pass through; every other rejection is
 * classified, so arbitrary `Error.message` text never reaches an outcome.
 */
export function commandFailureMessage(error: unknown, fallback = 'Operation failed.'): string {
  if (error instanceof LifecycleBlockerError) return error.message
  if (error instanceof WorkspaceClientUnavailableError) return workspaceClientUnavailableMessage
  return presentLoadFailure(error, {
    fallbackMessage: fallback,
    scope: 'page',
    trigger: 'action',
  }).message
}
