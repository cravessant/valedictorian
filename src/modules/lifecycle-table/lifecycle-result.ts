import type { LifecycleBlocker, RemovalChoice } from '@sparxie/sdk'

import type { DuplicateChoice, LifecycleOutcome, LifecycleOutcomeActions } from './lifecycle-outcome-types'

/** Preserve the server's typed duplicate recovery contract when one exists. */
export function outcomeForBlocker(blocker: LifecycleBlocker): LifecycleOutcome {
  const targetResourceId = blocker.conflictingResourceId
  const allowed = blocker.allowedDuplicateResolutions
  if (blocker.code === 'deterministic_duplicate' && targetResourceId && allowed?.length) {
    return {
      kind: 'duplicate',
      blocker,
      message: blocker.message,
      choices: allowed.map((action) => ({ action, targetResourceId })),
    }
  }
  return { kind: 'error', blocker, message: blocker.message }
}

/** The recovery a duplicate blocker offers, or none when the server named no choice. */
export function duplicateRecovery(
  blocked: LifecycleOutcome,
  resubmit: (choice: DuplicateChoice) => void,
): LifecycleOutcomeActions {
  return blocked.kind === 'duplicate' ? { onResolveDuplicate: resubmit } : {}
}

interface BlockedRemoval {
  readonly blocker: LifecycleBlocker
  readonly dependentIds: ReadonlyArray<string>
  readonly supportedChoices: ReadonlyArray<RemovalChoice>
}

/** The outcome a dependency-blocked removal presents, with the choices it may retry. */
export function removalBlockedOutcome(
  choice: RemovalChoice,
  { blocker, dependentIds, supportedChoices }: BlockedRemoval,
): LifecycleOutcome {
  return {
    kind: 'removal-blocked',
    blocker,
    message: blocker.message,
    choice: { choice, dependentIds, supportedChoices },
  }
}
