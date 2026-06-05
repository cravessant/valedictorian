import { describe, expect, it } from 'vitest'
import { defaultAppSettings } from '../settings/app-settings'
import { createSettingsPreloadApi } from './settings.preload'

describe('settings preload API', () => {
  it('invokes settings IPC channels with typed settings payloads', async () => {
    const invocations: unknown[][] = []
    const api = createSettingsPreloadApi({
      invoke(...args) {
        invocations.push(args)
        return Promise.resolve(defaultAppSettings)
      },
    })

    await expect(api.get()).resolves.toEqual(defaultAppSettings)
    await expect(api.update({ runtimeMode: 'remote' })).resolves.toEqual(defaultAppSettings)
    await expect(api.reset()).resolves.toEqual(defaultAppSettings)

    expect(invocations).toEqual([
      ['settings:get'],
      ['settings:update', { runtimeMode: 'remote' }],
      ['settings:reset'],
    ])
  })
})
