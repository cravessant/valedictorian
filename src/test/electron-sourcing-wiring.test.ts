import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Electron sourcing wiring', () => {
  it('passes the active workspace theme through first paint and preload bootstrap', () => {
    const preloadSource = fs.readFileSync(path.resolve('electron/preload.ts'), 'utf8')
    const mainSource = fs.readFileSync(path.resolve('electron/main.ts'), 'utf8')
    const envSource = fs.readFileSync(path.resolve('electron/electron-env.d.ts'), 'utf8')

    expect(mainSource).toContain('activeResolvedTheme')
    expect(mainSource).toContain('serializeResolvedTheme(activeResolvedTheme)')
    expect(mainSource).toContain('createMainWindowFirstPaintOptions(activeResolvedTheme)')
    expect(preloadSource).toContain('readRendererThemeConfig(process.argv)')
    expect(preloadSource).toContain("'valedictorianTheme'")
    expect(envSource).toContain('valedictorianTheme?')
  })

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

  it('exposes connector preload APIs and registers connector IPC handlers', () => {
    const preloadSource = fs.readFileSync(path.resolve('electron/preload.ts'), 'utf8')
    const mainSource = fs.readFileSync(path.resolve('electron/main.ts'), 'utf8')
    const runtimeIpcSource = fs.readFileSync(path.resolve('electron/runtime-ipc.ts'), 'utf8')
    const envSource = fs.readFileSync(path.resolve('electron/electron-env.d.ts'), 'utf8')

    expect(preloadSource).toContain('createConnectorsPreloadApi')
    expect(preloadSource).toContain(
      "contextBridge.exposeInMainWorld('connectors', createConnectorsPreloadApi(ipcRenderer))",
    )
    expect(mainSource).toContain('registerConnectorsIpc(runtime.connectors, ipcMain)')
    expect(mainSource).not.toContain('createElectronConnectorPorts')
    expect(mainSource).not.toContain('createConnectorPorts')
    expect(mainSource).not.toContain('connector-ports')
    expect(mainSource).not.toContain('createBrowserWindow(options)')
    expect(mainSource).not.toContain('jobright-link-resolver')
    expect(mainSource).not.toContain('resolveJobrightLink')
    expect(fs.existsSync(path.resolve('electron/connector-ports.ts'))).toBe(false)
    expect(fs.existsSync(path.resolve('electron/connector-ports.test.ts'))).toBe(false)
    expect(runtimeIpcSource).toContain("'connectors:list'")
    expect(runtimeIpcSource).toContain("'connectors:create'")
    expect(runtimeIpcSource).toContain("'connectors:update'")
    expect(runtimeIpcSource).toContain("'connectors:inspect'")
    expect(runtimeIpcSource).not.toContain("'connectors:overview:list'")
    expect(runtimeIpcSource).toContain("'connectors:runs:list'")
    expect(runtimeIpcSource).toContain("'connectors:runs:trigger'")
    expect(runtimeIpcSource).not.toContain("'connectors:status:list'")
    expect(runtimeIpcSource).toContain("'connectors:status:reconnect'")
    expect(runtimeIpcSource).toContain("'connectors:status:skip'")
    expect(envSource).toContain("connectors: import('../src/ipc/connectors.preload').ConnectorsPreloadApi")
  })

  it('keeps Connector Overview on the workspace-scoped HTTP boundary', () => {
    const runtimeIpcSource = fs.readFileSync(path.resolve('electron/runtime-ipc.ts'), 'utf8')
    const connectorsIpcSource = fs.readFileSync(path.resolve('src/ipc/connectors.ipc.ts'), 'utf8')
    const connectorsPreloadSource = fs.readFileSync(
      path.resolve('src/ipc/connectors.preload.ts'),
      'utf8',
    )
    const loadersSource = fs.readFileSync(path.resolve('src/app/loaders.ts'), 'utf8')

    for (const source of [runtimeIpcSource, connectorsIpcSource, connectorsPreloadSource]) {
      expect(source).not.toContain("'connectors:overview:list'")
    }

    expect(connectorsPreloadSource).not.toContain('ConnectorOverviewList')
    expect(connectorsPreloadSource).not.toMatch(/\boverview:\s*\{/)
    expect(loadersSource).not.toContain('defaultConnectorsApi.overview')
    expect(loadersSource).not.toContain('connectorsWindow.connectors?.overview')
    expect(loadersSource).toContain('httpClient.connectors.overview.list')
  })

  it('exposes workspace preload APIs and registers workspace IPC handlers', () => {
    const preloadSource = fs.readFileSync(path.resolve('electron/preload.ts'), 'utf8')
    const mainSource = fs.readFileSync(path.resolve('electron/main.ts'), 'utf8')
    const envSource = fs.readFileSync(path.resolve('electron/electron-env.d.ts'), 'utf8')

    expect(preloadSource).toContain('createWorkspacePreloadApi')
    expect(preloadSource).toContain(
      "contextBridge.exposeInMainWorld('workspace', createWorkspacePreloadApi(ipcRenderer))",
    )
    expect(mainSource).toContain('registerWorkspaceIpc(workspaceService, ipcMain')
    expect(envSource).toContain("workspace: import('../src/ipc/workspace.preload').WorkspacePreloadApi")
  })

  it('exposes update preload APIs and registers app update IPC handlers', () => {
    const preloadSource = fs.readFileSync(path.resolve('electron/preload.ts'), 'utf8')
    const mainSource = fs.readFileSync(path.resolve('electron/main.ts'), 'utf8')
    const envSource = fs.readFileSync(path.resolve('electron/electron-env.d.ts'), 'utf8')

    expect(preloadSource).toContain('createUpdatesPreloadApi')
    expect(preloadSource).toContain(
      "contextBridge.exposeInMainWorld('valedictorianUpdates', createUpdatesPreloadApi(ipcRenderer))",
    )
    expect(mainSource).toContain('createElectronUpdateService')
    expect(mainSource).toContain('registerUpdatesIpc(updateService, ipcMain')
    expect(mainSource).toContain('scheduleUpdatePolling()')
    expect(mainSource).toContain('const updatePollIntervalMs = 30 * 60 * 1000')
    expect(mainSource).toContain("state.status === 'ready'")
    expect(envSource).toContain("valedictorianUpdates: import('../src/ipc/updates.preload').UpdatesPreloadApi")
  })

  it('exposes window chrome preload APIs for fullscreen-aware layout', () => {
    const preloadSource = fs.readFileSync(path.resolve('electron/preload.ts'), 'utf8')
    const mainSource = fs.readFileSync(path.resolve('electron/main.ts'), 'utf8')
    const envSource = fs.readFileSync(path.resolve('electron/electron-env.d.ts'), 'utf8')

    expect(preloadSource).toContain('createWindowChromePreloadApi')
    expect(preloadSource).toContain(
      "contextBridge.exposeInMainWorld('valedictorianWindowChrome', createWindowChromePreloadApi(ipcRenderer))",
    )
    expect(mainSource).toContain("ipcMain.handle('window-chrome:get-state'")
    expect(mainSource).toContain("'enter-full-screen'")
    expect(mainSource).toContain("'leave-full-screen'")
    expect(mainSource).toContain("webContents.send('window-chrome:state-changed'")
    expect(envSource).toContain("valedictorianWindowChrome: import('../src/ipc/window-chrome.preload').WindowChromePreloadApi")
  })

  it('keeps connector schedule UI free of client timers and schedule domain dispatch/history calls', () => {
    const panelSource = fs.readFileSync(path.resolve('src/settings/ConnectorSettingsPanel.tsx'), 'utf8')
    const controlsSource = fs.readFileSync(path.resolve('src/settings/ConnectorScheduleControls.tsx'), 'utf8')
    const hookSource = fs.readFileSync(path.resolve('src/settings/useConnectorInstanceSchedules.ts'), 'utf8')
    const loadersSource = fs.readFileSync(path.resolve('src/app/loaders.ts'), 'utf8')
    const connectorsIpc = fs.readFileSync(path.resolve('src/ipc/connectors.ipc.ts'), 'utf8')
    const connectorsPreload = fs.readFileSync(path.resolve('src/ipc/connectors.preload.ts'), 'utf8')

    for (const source of [panelSource, controlsSource, hookSource, loadersSource]) {
      expect(source).not.toContain('dispatchDue')
      expect(source).not.toContain('listAudit')
      expect(source).not.toContain('listOccurrences')
      expect(source).not.toMatch(/setInterval\s*\(/)
    }

    expect(connectorsIpc).not.toContain('schedule')
    expect(connectorsPreload).not.toContain('schedule')
    expect(loadersSource).toContain('connectors.schedules')
    expect(loadersSource).toContain('capabilities.get')
  })

  it('passes the selected local backend and active workspace id to the renderer', () => {
    const preloadSource = fs.readFileSync(path.resolve('electron/preload.ts'), 'utf8')
    const mainSource = fs.readFileSync(path.resolve('electron/main.ts'), 'utf8')

    expect(mainSource).toContain('createRendererHttpArguments()')
    expect(mainSource).toContain('--valedictorian-api-url=')
    expect(mainSource).toContain('--valedictorian-workspace-id=')
    expect(mainSource).toContain('--valedictorian-http-transport=privileged')
    expect(mainSource).toContain('registerValedictorianHttpIpc')
    expect(mainSource).toContain('createBoundValedictorianHttpTransport')
    expect(mainSource).toContain('workspaceId: workspace.id')
    expect(mainSource).not.toContain('--valedictorian-api-token=')
    expect(preloadSource).toContain("contextBridge.exposeInMainWorld(")
    expect(preloadSource).toContain("'valedictorianHttp'")
    expect(preloadSource).toContain('readRendererHttpConfig(process.argv)')
    expect(preloadSource).toContain('createValedictorianHttpPreloadApi')

    const transportSource = fs.readFileSync(
      path.resolve('src/ipc/valedictorian-http.transport.ts'),
      'utf8',
    )
    expect(transportSource).toContain("redirect: 'error'")
    expect(transportSource).toContain('VALEDICTORIAN_HTTP_REQUEST_HEADER_ALLOWLIST')
    expect(transportSource).toContain('VALEDICTORIAN_HTTP_RESPONSE_HEADER_ALLOWLIST')
    expect(transportSource).toContain('/v1/capabilities')
    expect(transportSource).toContain("only allows GET for capabilities")
    expect(transportSource).toContain('assertAllowedConnectorScheduleRoute')
    expect(transportSource).toContain('schedule subroute is not allowed')
    expect(transportSource).toContain('utf8ByteLength')
    expect(transportSource).not.toContain('set-cookie')
  })

  it('uses launch-state workspace startup instead of opening Finder before the window exists', () => {
    const mainSource = fs.readFileSync(path.resolve('electron/main.ts'), 'utf8')
    const rendererEntrySource = fs.readFileSync(path.resolve('src/main.tsx'), 'utf8')

    expect(rendererEntrySource).toContain("import AppRoot from './AppRoot.tsx'")
    expect(rendererEntrySource).toContain('<AppRoot />')
    expect(mainSource).toContain('resolveWorkspaceLaunchState')
    expect(mainSource).not.toContain('resolveInitialWorkspace')
    expect(mainSource).toContain('registerWorkspaceIpc(workspaceService, ipcMain')
    expect(mainSource).toContain('createMainWindow()')
  })

  it('configures the main window with persisted state and graceful first show', () => {
    const mainSource = fs.readFileSync(path.resolve('electron/main.ts'), 'utf8')
    const windowStateSource = fs.readFileSync(path.resolve('electron/window-state.ts'), 'utf8')

    expect(mainSource).toContain('createFileMainWindowStateStore')
    expect(mainSource).toContain('resolveMainWindowStateOptions')
    expect(mainSource).toContain('screen.getAllDisplays()')
    expect(windowStateSource).toContain('width: 1280')
    expect(windowStateSource).toContain('height: 840')
    expect(windowStateSource).toContain('minWidth: 1024')
    expect(windowStateSource).toContain('minHeight: 680')
    expect(windowStateSource).toContain("backgroundColor: '#181825'")
    expect(windowStateSource).toContain('show: false')
    expect(mainSource).toContain("mainWindow.once('ready-to-show'")
    expect(mainSource).toContain('mainWindow.show()')
    expect(mainSource).toContain("mainWindow.on('close'")
    expect(mainSource).toContain('saveMainWindowState')
  })

  it('configures native app identity and workspace menu actions', () => {
    const mainSource = fs.readFileSync(path.resolve('electron/main.ts'), 'utf8')
    const preloadSource = fs.readFileSync(path.resolve('electron/preload.ts'), 'utf8')
    const indexSource = fs.readFileSync(path.resolve('index.html'), 'utf8')

    expect(mainSource).toContain("from 'electron'")
    expect(mainSource).toContain("app.setName('Valedictorian')")
    expect(mainSource).toContain("app.setAppUserModelId('com.valedictorian.app')")
    expect(mainSource).toContain("import { createWorkspaceWindowTitle } from '../src/workspace/workspace.window'")
    expect(mainSource).toContain('title: createWorkspaceWindowTitle(currentWorkspace)')
    expect(mainSource).toContain('--valedictorian-workspace-id=${currentWorkspace.id}')
    expect(indexSource).toContain('<title>Valedictorian</title>')
    expect(mainSource).toContain('createWorkspaceMenuTemplate')
    expect(mainSource).toContain('Menu.setApplicationMenu')
    expect(mainSource).toContain('showWorkspaceLauncherWindow')
    expect(mainSource).toContain("webContents.send('valedictorian:open-settings')")
    expect(mainSource).toContain("webContents.once('did-finish-load', sendOpenSettingsWhenReady)")
    expect(preloadSource).toContain("ipcRenderer.on('valedictorian:open-settings'")
    expect(preloadSource).toContain("window.dispatchEvent(new Event('valedictorian:open-settings'))")
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

  it('switches workspaces in-process instead of relaunching the app', () => {
    const mainSource = fs.readFileSync(path.resolve('electron/main.ts'), 'utf8')

    expect(mainSource).toContain('replaceMainWindowForWorkspace')
    expect(mainSource).toContain('removeRuntimeIpcHandlers(ipcMain)')
    expect(mainSource).not.toContain('app.relaunch()')
    expect(mainSource).not.toContain('app.exit(0)')
  })

  it('parents workspace launcher folder pickers to the invoking Electron window', () => {
    const mainSource = fs.readFileSync(path.resolve('electron/main.ts'), 'utf8')

    expect(mainSource).toContain('createWorkspaceFolderPicker')
    expect(mainSource).toContain('registerWorkspaceIpc(workspaceService, ipcMain, {')
    expect(mainSource).toContain('BrowserWindow.fromWebContents(event.sender)')
    expect(mainSource).toContain('dialog.showOpenDialog(parentWindow, dialogOptions)')
    expect(mainSource).toContain('dialog.showOpenDialog(dialogOptions)')
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
