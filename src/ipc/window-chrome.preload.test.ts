import { describe, expect, it } from 'vitest'
import { createWindowChromePreloadApi } from './window-chrome.preload'

describe('window chrome preload API', () => {
  it('invokes window chrome IPC channels and subscribes to fullscreen changes', async () => {
    const invocations: unknown[][] = []
    const listeners = new Map<string, (...args: unknown[]) => void>()
    const api = createWindowChromePreloadApi({
      invoke(...args) {
        invocations.push(args)
        return Promise.resolve({ isFullScreen: false })
      },
      on(channel, listener) {
        listeners.set(channel, listener as (...args: unknown[]) => void)
        return this
      },
      removeListener(channel, listener) {
        if (listeners.get(channel) === listener) {
          listeners.delete(channel)
        }
        return this
      },
    })

    await expect(api.getState()).resolves.toEqual({ isFullScreen: false })

    const receivedStates: unknown[] = []
    const unsubscribe = api.onStateChanged((state) => {
      receivedStates.push(state)
    })
    listeners.get('window-chrome:state-changed')?.({}, { isFullScreen: true })
    unsubscribe()

    expect(invocations).toEqual([['window-chrome:get-state']])
    expect(receivedStates).toEqual([{ isFullScreen: true }])
    expect(listeners.has('window-chrome:state-changed')).toBe(false)
  })
})
