import { describe, expect, it, vi } from 'vitest'
import { registerUpdatesIpc } from './updates.ipc'
import type { UpdateState } from './updates.preload'

describe('updates IPC', () => {
  it('registers update state, check, install, and state broadcast handlers', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const readyState: UpdateState = {
      availableVersion: '0.1.0-alpha.11',
      currentVersion: '0.1.0-alpha.10',
      status: 'ready',
    }
    const service = {
      check: vi.fn(async () => readyState),
      getState: vi.fn(() => ({ currentVersion: '0.1.0-alpha.10', status: 'idle' }) satisfies UpdateState),
      install: vi.fn(),
      onStateChanged: vi.fn((listener: (state: UpdateState) => void) => {
        listener(readyState)
        return () => undefined
      }),
    }
    const webContents = {
      send: vi.fn(),
    }

    registerUpdatesIpc(service, {
      handle(channel, handler) {
        handlers.set(channel, handler as (...args: unknown[]) => unknown)
      },
    }, () => [{ webContents }])

    await expect(handlers.get('updates:get-state')?.({})).resolves.toEqual({
      currentVersion: '0.1.0-alpha.10',
      status: 'idle',
    })
    await expect(handlers.get('updates:check')?.({})).resolves.toEqual(readyState)
    await expect(handlers.get('updates:install')?.({})).resolves.toBeUndefined()

    expect(service.install).toHaveBeenCalledTimes(1)
    expect(webContents.send).toHaveBeenCalledWith('updates:state-changed', readyState)
  })
})
