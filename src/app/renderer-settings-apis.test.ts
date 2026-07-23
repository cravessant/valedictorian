import { describe, expect, it, vi } from 'vitest'
import type { ValedictorianWorkspaceClient } from '@sparxie/sdk'
import { createConnectorsApi } from '../App.test-helpers'
import { createRendererConnectorsApi } from './renderer-settings-apis'

describe('renderer connector settings API', () => {
  it('combines legacy connector actions with HTTP descriptors and option queries', async () => {
    const preloadApi = createConnectorsApi()
    const descriptors = {
      list: vi.fn(async () => ({ items: [] })),
      get: vi.fn(async () => {
        throw new Error('fixture descriptor unavailable')
      }),
    }
    const queryFailure = new Error('fixture option query')
    const options = {
      query: vi.fn(async () => {
        throw queryFailure
      }),
    }
    const workspaceClient = {
      connectors: { descriptors, options },
    } as unknown as ValedictorianWorkspaceClient

    const api = createRendererConnectorsApi(preloadApi, () => workspaceClient)

    expect(api.list).toBe(preloadApi.list)
    await expect(api.descriptors?.list()).resolves.toEqual({ items: [] })
    await expect(api.options?.query({} as never)).rejects.toBe(queryFailure)
    expect(descriptors.list).toHaveBeenCalledOnce()
    expect(options.query).toHaveBeenCalledOnce()
  })
})
