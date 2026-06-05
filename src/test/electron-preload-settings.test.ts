import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Electron preload settings wiring', () => {
  it('exposes the settings preload API to the renderer', () => {
    const preloadSource = fs.readFileSync(path.resolve('electron/preload.ts'), 'utf8')
    const envSource = fs.readFileSync(path.resolve('electron/electron-env.d.ts'), 'utf8')

    expect(preloadSource).toContain('createSettingsPreloadApi')
    expect(preloadSource).toContain(
      "contextBridge.exposeInMainWorld('settings', createSettingsPreloadApi(ipcRenderer))",
    )
    expect(envSource).toContain(
      "settings: import('../src/ipc/settings.preload').SettingsPreloadApi",
    )
  })
})
