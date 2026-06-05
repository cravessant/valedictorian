import { describe, expect, it } from 'vitest'
import { createApplicationsPreloadApi } from './applications.preload'

describe('applications preload API', () => {
  it('invokes the applications list IPC channel with query filters', async () => {
    const invocations: unknown[][] = []
    const api = createApplicationsPreloadApi({
      invoke(...args) {
        invocations.push(args)
        return Promise.resolve({
          items: [],
          total: 0,
          limit: 50,
          offset: 0,
          hasMore: false,
        })
      },
    })
    const query = {
      status: 'needs_user_info' as const,
      createdFrom: '2026-06-04T00:00:00.000Z',
    }

    await expect(api.list(query)).resolves.toMatchObject({ total: 0 })
    expect(invocations).toEqual([['applications:list', query]])
  })
})
