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

  it('exposes workspace preload APIs and registers workspace IPC handlers', () => {
    const preloadSource = fs.readFileSync(path.resolve('electron/preload.ts'), 'utf8')
    const mainSource = fs.readFileSync(path.resolve('electron/main.ts'), 'utf8')
    const envSource = fs.readFileSync(path.resolve('electron/electron-env.d.ts'), 'utf8')

    expect(preloadSource).toContain('createWorkspacePreloadApi')
    expect(preloadSource).toContain(
      "contextBridge.exposeInMainWorld('workspace', createWorkspacePreloadApi(ipcRenderer))",
    )
    expect(mainSource).toContain('registerWorkspaceIpc(workspaceService, ipcMain)')
    expect(envSource).toContain("workspace: import('../src/ipc/workspace.preload').WorkspacePreloadApi")
  })

  it('uses launch-state workspace startup instead of opening Finder before the window exists', () => {
    const mainSource = fs.readFileSync(path.resolve('electron/main.ts'), 'utf8')
    const rendererEntrySource = fs.readFileSync(path.resolve('src/main.tsx'), 'utf8')

    expect(rendererEntrySource).toContain("import AppRoot from './AppRoot.tsx'")
    expect(rendererEntrySource).toContain('<AppRoot />')
    expect(mainSource).toContain('resolveWorkspaceLaunchState')
    expect(mainSource).not.toContain('resolveInitialWorkspace')
    expect(mainSource).toContain('registerWorkspaceIpc(workspaceService, ipcMain)')
    expect(mainSource).toContain('createMainWindow()')
  })

  it('configures native app identity and workspace menu actions', () => {
    const mainSource = fs.readFileSync(path.resolve('electron/main.ts'), 'utf8')
    const indexSource = fs.readFileSync(path.resolve('index.html'), 'utf8')

    expect(mainSource).toContain("import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell } from 'electron'")
    expect(mainSource).toContain("app.setName('Valedictorian')")
    expect(mainSource).toContain("app.setAppUserModelId('com.valedictorian.app')")
    expect(mainSource).toContain("title: 'Valedictorian'")
    expect(indexSource).toContain('<title>Valedictorian</title>')
    expect(mainSource).toContain('createWorkspaceMenuTemplate')
    expect(mainSource).toContain('Menu.setApplicationMenu')
    expect(mainSource).toContain('showWorkspaceLauncherWindow')
    expect(mainSource).toContain('workspaceService.openRecent(workspaceId)')
  })

  it('uses a fixed launcher window instead of the normal app window when a workspace is needed', () => {
    const mainSource = fs.readFileSync(path.resolve('electron/main.ts'), 'utf8')

    expect(mainSource).toContain('function createWorkspaceLauncherWindow()')
    expect(mainSource).toContain('createWorkspaceLauncherWindow()')
    expect(mainSource).toContain("title: 'Valedictorian - Workspace Launcher'")
    expect(mainSource).toContain('width: 820')
    expect(mainSource).toContain('height: 560')
    expect(mainSource).toContain('useContentSize: true')
    expect(mainSource).toContain('resizable: false')
    expect(mainSource).toContain('maximizable: false')
    expect(mainSource).toContain('fullscreenable: false')
    expect(mainSource).toContain('openWorkspaceInMainWindow')
  })

  it('opens external application links outside the Electron app window', () => {
    const mainSource = fs.readFileSync(path.resolve('electron/main.ts'), 'utf8')

    expect(mainSource).toContain("from 'electron'")
    expect(mainSource).toContain('BrowserWindow')
    expect(mainSource).toContain('shell')
    expect(mainSource).toContain('setWindowOpenHandler')
    expect(mainSource).toContain('will-navigate')
    expect(mainSource).toContain('shell.openExternal')
    expect(mainSource).toContain('event.preventDefault()')
  })
})
