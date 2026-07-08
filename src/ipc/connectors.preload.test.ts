import { describe, expect, it } from 'vitest'
import { createConnectorsPreloadApi } from './connectors.preload'

describe('connectors preload API', () => {
  it('invokes the connector status IPC channel', async () => {
    const invocations: unknown[][] = []
    const api = createConnectorsPreloadApi({
      invoke(...args) {
        invocations.push(args)
        return Promise.resolve({
          items: [],
        })
      },
    })

    await expect(api.status.list()).resolves.toEqual({ items: [] })
    expect(invocations).toEqual([['connectors:status:list']])
  })
})
