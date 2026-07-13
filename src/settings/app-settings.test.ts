import { describe, expect, it } from 'vitest'
import { defaultAppSettings, normalizeAppSettings } from './app-settings'

describe('normalizeAppSettings showDebugData', () => {
  it('defaults showDebugData to false', () => {
    expect(defaultAppSettings.showDebugData).toBe(false)
    expect(normalizeAppSettings(undefined).showDebugData).toBe(false)
  })

  it('normalizes legacy settings without showDebugData to false', () => {
    expect(
      normalizeAppSettings({
        apiToken: '',
        localApiHost: '127.0.0.1',
        localApiPort: 4317,
        remoteApiUrl: 'http://127.0.0.1:4317',
        runtimeMode: 'local-desktop',
        sidebarCollapsed: false,
        showAdvancedFilters: true,
      }).showDebugData,
    ).toBe(false)
  })

  it('preserves an explicit true showDebugData value', () => {
    expect(normalizeAppSettings({ showDebugData: true }).showDebugData).toBe(true)
  })
})
