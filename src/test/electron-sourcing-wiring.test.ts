import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Electron sourcing wiring', () => {
  it('exposes profile preload APIs and registers profile IPC handlers', () => {
    const preloadSource = fs.readFileSync(path.resolve('electron/preload.ts'), 'utf8')
    const mainSource = fs.readFileSync(path.resolve('electron/main.ts'), 'utf8')
    const envSource = fs.readFileSync(path.resolve('electron/electron-env.d.ts'), 'utf8')

    expect(preloadSource).toContain('createProfilePreloadApi')
    expect(preloadSource).toContain(
      "contextBridge.exposeInMainWorld('profile', createProfilePreloadApi(ipcRenderer))",
    )
    expect(mainSource).toContain('registerProfileIpc(profileRepository, ipcMain)')
    expect(mainSource).toContain('safeStorage')
    expect(envSource).toContain("profile: import('../src/ipc/profile.preload').ProfilePreloadApi")
  })

  it('exposes sourcing preload APIs and registers sourcing IPC handlers', () => {
    const preloadSource = fs.readFileSync(path.resolve('electron/preload.ts'), 'utf8')
    const mainSource = fs.readFileSync(path.resolve('electron/main.ts'), 'utf8')
    const envSource = fs.readFileSync(path.resolve('electron/electron-env.d.ts'), 'utf8')

    expect(preloadSource).toContain('createSourcingPreloadApi')
    expect(preloadSource).toContain(
      "contextBridge.exposeInMainWorld('sourcing', createSourcingPreloadApi(ipcRenderer))",
    )
    expect(mainSource).toContain('registerSourcingIpc(runtime.client, ipcMain)')
    expect(envSource).toContain("sourcing: import('../src/ipc/sourcing.preload').SourcingPreloadApi")
  })

  it('opens external application links outside the Electron app window', () => {
    const mainSource = fs.readFileSync(path.resolve('electron/main.ts'), 'utf8')

    expect(mainSource).toContain(
      "import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron'",
    )
    expect(mainSource).toContain('setWindowOpenHandler')
    expect(mainSource).toContain('will-navigate')
    expect(mainSource).toContain('shell.openExternal')
    expect(mainSource).toContain('event.preventDefault()')
  })
})
