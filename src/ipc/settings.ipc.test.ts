import { describe, expect, it, vi } from 'vitest'
import type { AppSettingsStore } from '../settings/app-settings'
import { defaultAppSettings } from '../settings/app-settings'
import { registerSettingsIpc } from './settings.ipc'

describe('settings IPC registration', () => {
  it('registers get, update, and reset handlers for app settings', async () => {
    const store: AppSettingsStore = {
      get: vi.fn(async () => defaultAppSettings),
      reset: vi.fn(async () => defaultAppSettings),
      update: vi.fn(async (patch) => ({ ...defaultAppSettings, ...patch })),
    }
    const handlers = new Map<string, (_event: unknown, payload?: unknown) => Promise<unknown>>()

    registerSettingsIpc(store, {
      handle(channel, handler) {
        handlers.set(channel, handler)
      },
    })

    await expect(handlers.get('settings:get')?.({})).resolves.toEqual(defaultAppSettings)
    await expect(
      handlers.get('settings:update')?.({}, { runtimeMode: 'remote' }),
    ).resolves.toMatchObject({
      runtimeMode: 'remote',
    })
    await expect(handlers.get('settings:reset')?.({})).resolves.toEqual(defaultAppSettings)

    expect(store.get).toHaveBeenCalled()
    expect(store.update).toHaveBeenCalledWith({ runtimeMode: 'remote' })
    expect(store.reset).toHaveBeenCalled()
  })
})
