import { describe, expect, it } from 'vitest'
import type { ValedictorianWorkspaceClient, ActionQueueListQuery } from 'sparxie'
import { registerActionQueueIpc } from './action-queue.ipc'

describe('action queue IPC registration', () => {
  it('registers an action-queue:list handler that delegates query filters to the selected client', async () => {
    const queries: ActionQueueListQuery[] = []
    const client = {
      applications: {
        async list() {
          throw new Error('not used')
        },
        async get() {
          return null
        },
        async updateStatus() {
          throw new Error('not used')
        },
      },
      scores: {
        async record() {
          throw new Error('not used')
        },
      },
      actionQueue: {
        async list(query) {
          if (query) {
            queries.push(query)
          }

          return {
            items: [],
            total: 0,
            limit: 50,
            offset: 0,
            hasMore: false,
            actionBucketCounts: {
              apply_now: 0,
              manual_review_pickup: 0,
              needs_user_info: 0,
              stale_lock_recovery: 0,
              user_review_required: 0,
              blocked: 0,
              skip_below_cutoff: 0,
            },
          }
        },
      },
    } as unknown as ValedictorianWorkspaceClient
    const handlers = new Map<string, (_event: unknown, query?: ActionQueueListQuery) => Promise<unknown>>()

    registerActionQueueIpc(client, {
      handle(channel, handler) {
        handlers.set(channel, handler)
      },
    })

    const query: ActionQueueListQuery = { actionBucket: 'apply_now', limit: 25 }

    await expect(handlers.get('action-queue:list')?.({}, query)).resolves.toMatchObject({
      total: 0,
    })
    expect(queries).toEqual([query])
  })
})
