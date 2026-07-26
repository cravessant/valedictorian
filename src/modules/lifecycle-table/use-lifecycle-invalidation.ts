import { useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { lifecycleKeys, type LifecycleScope } from './lifecycle-queries'

/**
 * Invalidation ownership for the lifecycle workbench.
 *
 * Every reason to re-read — a committed command, the manual Refresh control,
 * window focus, the bounded fallback interval, and the future workspace
 * invalidation stream — converges here on the smallest owning key family. There
 * is no second refresh graph, and `throwOnError` keeps a failed post-command
 * re-read reportable so a command never claims a refreshed view it did not get.
 */
export function useLifecycleInvalidation(scope: LifecycleScope) {
  const queryClient = useQueryClient()
  const { workspaceId, connectionId } = scope
  return useMemo(() => {
    const owning = { workspaceId, connectionId }
    const commit = (queryKey: readonly unknown[]) => async (): Promise<void> => {
      await queryClient.invalidateQueries({ queryKey }, { throwOnError: true })
    }
    const applications = commit(lifecycleKeys.applications(owning))
    const actionQueue = commit(lifecycleKeys.actionQueue(owning))
    return {
      captures: commit(lifecycleKeys.captures(owning)),
      jobs: commit(lifecycleKeys.jobs(owning)),
      opportunities: commit(lifecycleKeys.opportunities(owning)),
      applications,
      actionQueue,
      /** Applications own two presentations of the same records: All and Action Queue. */
      applicationPresentations: () => Promise.all([applications(), actionQueue()]).then(() => {}),
      /** The whole chain, for a command whose outcome can tombstone downstream aggregates. */
      workspace: commit(lifecycleKeys.workspace(owning)),
    }
  }, [connectionId, queryClient, workspaceId])
}
