import { useCallback, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ActionQueueBucket, ActionQueueListResult } from '@sparxie/sdk'

import type { LifecycleLoadState } from './lifecycle-table'
import {
  ACTION_QUEUE_PAGE_SIZE,
  actionQueueQuery,
  lifecycleLoadState,
  type LifecycleClient,
  type LifecycleScope,
} from './lifecycle-queries'

const ACTION_QUEUE_LOAD_FAILURE = 'Action Queue could not be loaded.'

export interface ActionQueueState {
  readonly result: ActionQueueListResult | null
  readonly load: LifecycleLoadState
}

export interface UseActionQueueParams {
  readonly client: Pick<LifecycleClient, 'actionQueue'> | null
  readonly scope: LifecycleScope
  readonly active: boolean
}

/**
 * Action Queue mode. The server page is a lifecycle query; the selected bucket
 * and offset stay local UI state that addresses it.
 */
export function useActionQueue({ client, scope, active }: UseActionQueueParams) {
  const [bucket, setBucketValue] = useState<ActionQueueBucket | undefined>(undefined)
  const [offset, setOffset] = useState(0)
  const query = useQuery({
    ...actionQueueQuery(client, scope, { bucket, offset }),
    enabled: active,
  })
  const result = query.data ?? null

  // Concurrent removals can leave an addressed offset past the end of a queue
  // that still has items; return to the first page rather than an empty view.
  useEffect(() => {
    if (offset > 0 && result && result.items.length === 0 && result.total > 0) setOffset(0)
  }, [offset, result])

  const setBucket = useCallback((next: ActionQueueBucket | undefined) => {
    setBucketValue(next)
    setOffset(0)
  }, [])

  return {
    state: { result, load: lifecycleLoadState(query, ACTION_QUEUE_LOAD_FAILURE) },
    bucket,
    setBucket,
    nextPage: useCallback(() => setOffset((prev) => prev + ACTION_QUEUE_PAGE_SIZE), []),
    previousPage: useCallback(
      () => setOffset((prev) => Math.max(0, prev - ACTION_QUEUE_PAGE_SIZE)),
      [],
    ),
  }
}
