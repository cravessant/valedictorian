import { describe, expect, it } from 'vitest'
import { createUpdatesPreloadApi } from './updates.preload'

describe('updates preload API', () => {
  it('invokes update IPC channels and subscribes to update state changes', async () => {
    const invocations: unknown[][] = []
    const listeners = new Map<string, (...args: unknown[]) => void>()
    const api = createUpdatesPreloadApi({
      invoke(...args) {
        invocations.push(args)
        return Promise.resolve({ currentVersion: '0.1.0-alpha.10', status: 'idle' })
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

    await expect(api.getState()).resolves.toEqual({
      currentVersion: '0.1.0-alpha.10',
      status: 'idle',
    })
    await api.check()
    await api.install()

    const receivedStates: unknown[] = []
    const unsubscribe = api.onStateChanged((state) => {
      receivedStates.push(state)
    })
    listeners.get('updates:state-changed')?.({}, {
      availableVersion: '0.1.0-alpha.11',
      currentVersion: '0.1.0-alpha.10',
      status: 'ready',
    })
    unsubscribe()

    expect(invocations).toEqual([
      ['updates:get-state'],
      ['updates:check'],
      ['updates:install'],
    ])
    expect(receivedStates).toEqual([
      {
        availableVersion: '0.1.0-alpha.11',
        currentVersion: '0.1.0-alpha.10',
        status: 'ready',
      },
    ])
    expect(listeners.has('updates:state-changed')).toBe(false)
  })
})
