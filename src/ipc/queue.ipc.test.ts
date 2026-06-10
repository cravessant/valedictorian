import { describe, expect, it } from 'vitest'
import type { ValedictorianClient, QueueListQuery } from 'sparxie'
import { registerQueueIpc } from './queue.ipc'

describe('queue IPC registration', () => {
  it('registers a queue:list handler that delegates query filters to the selected client', async () => {
    const queries: QueueListQuery[] = []
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
      queue: {
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
            bucketCounts: {
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
    } as unknown as ValedictorianClient
    const handlers = new Map<string, (_event: unknown, query?: QueueListQuery) => Promise<unknown>>()

    registerQueueIpc(client, {
      handle(channel, handler) {
        handlers.set(channel, handler)
      },
    })

    const query: QueueListQuery = { bucket: 'apply_now', limit: 25 }

    await expect(handlers.get('queue:list')?.({}, query)).resolves.toMatchObject({
      total: 0,
    })
    expect(queries).toEqual([query])
  })
})
