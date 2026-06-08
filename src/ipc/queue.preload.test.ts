import { describe, expect, it } from 'vitest'
import { createQueuePreloadApi } from './queue.preload'

describe('queue preload API', () => {
  it('invokes the queue list IPC channel with query filters', async () => {
    const invocations: unknown[][] = []
    const api = createQueuePreloadApi({
      invoke(...args) {
        invocations.push(args)
        return Promise.resolve({
          items: [],
          total: 0,
          limit: 50,
          offset: 0,
          hasMore: false,
          bucketCounts: {
            apply_now: 0,
            manual_review_pickup: 0,
            needs_user_info: 0,
            stale_lock_recovery: 0,
            user_review_required: 0,
            blocked: 0,
            skip_below_cutoff: 0,
          },
        })
      },
    })
    const query = {
      bucket: 'apply_now' as const,
      limit: 25,
    }

    await expect(api.list(query)).resolves.toMatchObject({ total: 0 })
    expect(invocations).toEqual([['queue:list', query]])
  })
})
