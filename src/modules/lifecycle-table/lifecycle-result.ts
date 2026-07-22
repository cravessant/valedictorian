import type { LifecycleBlocker } from 'sparxie'

import type { LifecycleOutcome } from './lifecycle-outcome-types'

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
