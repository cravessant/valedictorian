import { describe, expect, it, vi } from 'vitest'
import {
  createAppNavigationPreloadApi,
  OPEN_SETTINGS_CHANNEL,
} from './app-navigation.preload'

describe('app navigation preload API', () => {
  it('delivers settings requests and supports unsubscribe', () => {
    let ipcListener: ((event: unknown) => void) | undefined
    const api = createAppNavigationPreloadApi({
      on: vi.fn((channel, listener) => {
        expect(channel).toBe(OPEN_SETTINGS_CHANNEL)
        ipcListener = listener
      }),
    })
    const listener = vi.fn()
    const unsubscribe = api.onOpenSettings(listener)

    ipcListener?.({})
    expect(listener).toHaveBeenCalledOnce()

    unsubscribe()
    ipcListener?.({})
    expect(listener).toHaveBeenCalledOnce()
  })

  it('replays a request received before the renderer subscribes', () => {
    let ipcListener: ((event: unknown) => void) | undefined
    const api = createAppNavigationPreloadApi({
      on: vi.fn((_channel, listener) => {
        ipcListener = listener
      }),
    })
    const listener = vi.fn()

    ipcListener?.({})
    api.onOpenSettings(listener)

    expect(listener).toHaveBeenCalledOnce()
  })
})
