import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, screen, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createDrizzleDatabase, createFileDatabase, migrateDatabase } from '../src/db/sqlite'
import { registerApplicationIpc } from '../src/ipc/applications.ipc'
import { registerPolicyIpc } from '../src/ipc/policy.ipc'
import { registerProfileIpc } from '../src/ipc/profile.ipc'
import { registerActionQueueIpc } from '../src/ipc/action-queue.ipc'
import { registerScoresIpc } from '../src/ipc/scores.ipc'
import { registerSettingsIpc } from '../src/ipc/settings.ipc'
import { registerSourcingIpc } from '../src/ipc/sourcing.ipc'
import { registerUpdatesIpc } from '../src/ipc/updates.ipc'
import { registerWorkspaceIpc } from '../src/ipc/workspace.ipc'
import { createLocalWorkspaceManager, type LocalWorkspaceManager } from '../src/server/local-workspaces'
import {
  createSqliteProfileRepository,
  type ProfileSecretCodec,
} from '../src/modules/profile/profile.repository'
import {
  createValedictorianRuntime,
  resolveValedictorianRuntimeConfig,
  type ValedictorianRuntime,
} from '../src/runtime/valedictorian-runtime'
import { createFileAppSettingsStore } from '../src/settings/app-settings.store'
import { type WorkspaceSummary } from '../src/workspace/workspace.initializer'
import { createWorkspaceMenuTemplate } from '../src/workspace/workspace.menu'
import { createWorkspaceWindowTitle } from '../src/workspace/workspace.window'
import { getDefaultWorkspaceRegistryPath } from '../src/workspace/workspace.paths'
import { createFileWorkspaceRegistryStore } from '../src/workspace/workspace.registry'
import {
  createWorkspaceService,
  resolveWorkspaceLaunchState,
  type WorkspaceActivationOptions,
  type WorkspaceService,
} from '../src/workspace/workspace.service'
import {
  createWorkspaceFolderPicker,
  type WorkspaceFolderDialogOptions,
} from '../src/workspace/workspace.dialog'
import { createElectronUpdateService } from '../src/updates/update.service'
import {
  createFileMainWindowStateStore,
  createMainWindowStateSnapshot,
  mainWindowFirstPaintOptions,
  minimumMainWindowBounds,
  resolveMainWindowStateOptions,
  type MainWindowStateStore,
} from './window-state'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

app.setName('Valedictorian')

if (process.platform === 'win32') {
  app.setAppUserModelId('com.valedictorian.app')
}

let mainWindow: BrowserWindow | null = null
let workspaceLauncherWindow: BrowserWindow | null = null
let runtime: ValedictorianRuntime | null = null
let currentWorkspace: WorkspaceSummary | null = null
let workspaceManager: LocalWorkspaceManager | null = null
let activeWorkspaceService: WorkspaceService<BrowserWindow> | null = null
let runtimeServicesRegistered = false
let updatePollingScheduled = false
const updatePollInitialDelayMs = 3000
const updatePollIntervalMs = 30 * 60 * 1000
const runtimeIpcChannels = [
  'action-queue:list',
  'applications:list',
  'applications:get',
  'applications:create',
  'applications:update',
  'applications:update-status',
  'applications:archive',
  'applications:workflow:update',
  'applications:notes:append',
  'applications:events:list',
  'applications:links:list',
  'applications:links:create',
  'applications:links:update',
  'applications:attempts:list',
  'policy:config:get',
  'policy:config:update',
  'policy:config:reset',
  'policy:evidence:list',
  'policy:evidence:record',
  'policy:evaluate:application',
  'policy:evaluate:sourcing-candidate',
  'policy:evaluate:run-window',
  'profile:get',
  'profile:update',
  'profile:agent-context:get',
  'profile:sensitive:get',
  'profile:sensitive:update',
  'profile:secrets:list',
  'profile:secrets:upsert',
  'profile:secrets:reveal',
  'profile:secrets:delete',
  'scores:record',
  'settings:get',
  'settings:update',
  'settings:reset',
  'sourcing:findings:list',
  'sourcing:findings:create',
  'sourcing:findings:update',
  'sourcing:findings:decide',
  'sourcing:findings:promote',
]
const updateService = createElectronUpdateService(app, {
  get autoDownload() {
    return autoUpdater.autoDownload
  },
  set autoDownload(autoDownload: boolean) {
    autoUpdater.autoDownload = autoDownload
  },
  checkForUpdates: () => autoUpdater.checkForUpdates(),
  on: (event, listener) => autoUpdater.on(event as never, listener as never),
  quitAndInstall: () => autoUpdater.quitAndInstall(),
}, {
  beforeInstall: closeRuntime,
})

async function openWorkspaceInMainWindow(
  workspace: WorkspaceSummary,
  options: WorkspaceActivationOptions,
) {
  const shouldReplaceMainWindow = Boolean(
    mainWindow
      && !mainWindow.isDestroyed()
      && currentWorkspace?.id !== workspace.id,
  )

  await activateWorkspace(workspace, options)
  workspaceLauncherWindow?.close()
  workspaceLauncherWindow = null

  if (shouldReplaceMainWindow) {
    replaceMainWindowForWorkspace()
    return
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow()
    return
  }

  focusAppWindow(mainWindow)
}

async function activateWorkspace(
  workspace: WorkspaceSummary,
  options?: WorkspaceActivationOptions,
) {
  const isSameWorkspace = currentWorkspace?.id === workspace.id

  if (runtimeServicesRegistered && isSameWorkspace) {
    currentWorkspace = workspace
    return
  }

  if (runtimeServicesRegistered) {
    await closeRuntime()
    removeRuntimeIpcHandlers()
  }

  currentWorkspace = workspace
  await registerRuntimeServices(workspace, options)
  runtimeServicesRegistered = true
}

async function registerRuntimeServices(
  workspace: WorkspaceSummary,
  options?: WorkspaceActivationOptions,
) {
  const settingsStore = createFileAppSettingsStore(workspace.appSettingsPath)
  const config = resolveValedictorianRuntimeConfig({
    settings: await settingsStore.get(),
    userDataPath: app.getPath('userData'),
    workspaceDataPath: workspace.dataPath,
    workspaceId: workspace.id,
  })

  runtime = await createValedictorianRuntime({
    config: {
      ...config,
      seedDataMode: options?.seedData ?? config.seedDataMode,
    },
    workspaceManager: workspaceManager ?? undefined,
  })
  const profileSqlite = createFileDatabase(config.sqlitePath)
  migrateDatabase(profileSqlite)
  const profileRepository = createSqliteProfileRepository(
    createDrizzleDatabase(profileSqlite),
    createElectronSecretCodec(),
  )

  registerApplicationIpc(runtime.client, ipcMain)
  registerPolicyIpc(runtime.client, ipcMain)
  registerProfileIpc(profileRepository, ipcMain)
  registerActionQueueIpc(runtime.client, ipcMain)
  registerScoresIpc(runtime.client, ipcMain)
  registerSourcingIpc(runtime.client, ipcMain)
  registerSettingsIpc(settingsStore, ipcMain)
}

function createElectronSecretCodec(): ProfileSecretCodec {
  return {
    decrypt(value) {
      if (safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(Buffer.from(value, 'base64'))
      }

      return Buffer.from(value, 'base64').toString('utf8')
    },
    encrypt(value) {
      const encrypted = safeStorage.isEncryptionAvailable()
        ? safeStorage.encryptString(value)
        : Buffer.from(value, 'utf8')

      return encrypted.toString('base64')
    },
  }
}

function createMainWindow() {
  const mainWindowStateStore = createFileMainWindowStateStore(getMainWindowStatePath())
  const savedMainWindowState = mainWindowStateStore.read()

  mainWindow = new BrowserWindow({
    ...resolveMainWindowStateOptions(savedMainWindowState, screen.getAllDisplays()),
    ...minimumMainWindowBounds,
    ...mainWindowFirstPaintOptions,
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    title: createWorkspaceWindowTitle(currentWorkspace),
    titleBarOverlay: {
      color: '#181825',
      symbolColor: '#cdd6f4',
    },
    titleBarStyle: 'hidden',
    trafficLightPosition: {
      x: 14,
      y: 17,
    },
    webPreferences: {
      additionalArguments: createRendererHttpArguments(),
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    refreshWorkspaceMenu()
  })
  mainWindow.on('close', () => saveMainWindowState(mainWindow, mainWindowStateStore))
  mainWindow.on('enter-full-screen', () => sendWindowChromeState(mainWindow))
  mainWindow.on('leave-full-screen', () => sendWindowChromeState(mainWindow))
  mainWindow.once('ready-to-show', () => {
    if (!mainWindow) {
      return
    }

    if (savedMainWindowState?.isMaximized) {
      mainWindow.maximize()
    }

    if (savedMainWindowState?.isFullScreen) {
      mainWindow.setFullScreen(true)
    }

    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalHttpUrl(url)) {
      void shell.openExternal(url)
      return { action: 'deny' }
    }

    return { action: 'allow' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isExternalHttpUrl(url)) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })

  // Test active push message to Renderer-process.
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.send('main-process-message', (new Date).toLocaleString())
    sendWindowChromeState(mainWindow)
  })

  loadRenderer(mainWindow)
  refreshWorkspaceMenu()
}

function replaceMainWindowForWorkspace() {
  const previousMainWindow = mainWindow

  if (!previousMainWindow || previousMainWindow.isDestroyed()) {
    createMainWindow()
    return
  }

  previousMainWindow.once('closed', () => {
    if (!mainWindow && currentWorkspace) {
      createMainWindow()
    }
  })
  previousMainWindow.close()
}

function getMainWindowStatePath() {
  return path.join(app.getPath('userData'), 'main-window-state.json')
}

function saveMainWindowState(
  window: BrowserWindow | null,
  mainWindowStateStore: MainWindowStateStore,
) {
  if (!window || window.isDestroyed()) {
    return
  }

  try {
    mainWindowStateStore.write(createMainWindowStateSnapshot(window))
  } catch (error) {
    console.warn('Failed to save main window state.', error)
  }
}

function getWindowChromeState(window: BrowserWindow | null) {
  return {
    isFullScreen: window?.isFullScreen() ?? false,
  }
}

function sendWindowChromeState(window: BrowserWindow | null) {
  if (!window || window.isDestroyed()) {
    return
  }

  window.webContents.send('window-chrome:state-changed', getWindowChromeState(window))
}

function createWorkspaceLauncherWindow() {
  workspaceLauncherWindow = new BrowserWindow({
    autoHideMenuBar: true,
    center: true,
    fullscreenable: false,
    height: 560,
    maximizable: false,
    minimizable: true,
    resizable: false,
    show: false,
    title: 'Valedictorian - Workspace Launcher',
    titleBarOverlay: {
      color: '#181825',
      symbolColor: '#cdd6f4',
    },
    titleBarStyle: 'hidden',
    trafficLightPosition: {
      x: 14,
      y: 15,
    },
    useContentSize: true,
    webPreferences: {
      additionalArguments: createRendererHttpArguments(),
      preload: path.join(__dirname, 'preload.mjs'),
    },
    width: 820,
  })

  workspaceLauncherWindow.on('closed', () => {
    workspaceLauncherWindow = null
    refreshWorkspaceMenu()
  })
  workspaceLauncherWindow.once('ready-to-show', () => {
    workspaceLauncherWindow?.show()
  })

  loadRenderer(workspaceLauncherWindow)
  refreshWorkspaceMenu()
}

function showWorkspaceLauncherWindow() {
  if (workspaceLauncherWindow) {
    if (workspaceLauncherWindow.isMinimized()) {
      workspaceLauncherWindow.restore()
    }

    workspaceLauncherWindow.show()
    workspaceLauncherWindow.focus()
    return
  }

  createWorkspaceLauncherWindow()
}

function openSettings() {
  if (!mainWindow && currentWorkspace) {
    createMainWindow()
  }

  focusAppWindow(mainWindow)
  sendOpenSettingsWhenReady()
}

function sendOpenSettingsWhenReady() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }

  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', sendOpenSettingsWhenReady)
    return
  }

  mainWindow.webContents.send('valedictorian:open-settings')
}

function focusAppWindow(window: BrowserWindow | null) {
  if (!window || window.isDestroyed()) {
    return
  }

  if (window.isMinimized()) {
    window.restore()
  }

  window.show()
  window.focus()
}

function createFocusableWindowMenuItems() {
  return [
    ...(mainWindow && !mainWindow.isDestroyed()
      ? [{
          label: currentWorkspace?.name ?? 'Workspace Window',
          onFocus: () => focusAppWindow(mainWindow),
        }]
      : []),
    ...(workspaceLauncherWindow && !workspaceLauncherWindow.isDestroyed()
      ? [{
          label: 'Workspace Launcher',
          onFocus: () => focusAppWindow(workspaceLauncherWindow),
        }]
      : []),
  ]
}

function refreshWorkspaceMenu() {
  if (!activeWorkspaceService) {
    return
  }

  void installWorkspaceMenu(activeWorkspaceService)
}

function loadRenderer(window: BrowserWindow) {
  if (VITE_DEV_SERVER_URL) {
    void window.loadURL(VITE_DEV_SERVER_URL)
  } else {
    void window.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

function createRendererHttpArguments() {
  if (!runtime?.server || !currentWorkspace) {
    return []
  }

  return [
    `--valedictorian-api-url=${runtime.server.url}`,
    `--valedictorian-workspace-id=${currentWorkspace.id}`,
  ]
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    void closeRuntime()
    app.quit()
    mainWindow = null
    workspaceLauncherWindow = null
  }
})

app.on('before-quit', () => {
  void closeRuntime()
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length > 0) {
    return
  }

  if (currentWorkspace) {
    createMainWindow()
    return
  }

  showWorkspaceLauncherWindow()
})

app.whenReady().then(async () => {
  ipcMain.handle('window-chrome:get-state', (event) =>
    getWindowChromeState(BrowserWindow.fromWebContents(event.sender)),
  )
  registerUpdatesIpc(updateService, ipcMain, () => BrowserWindow.getAllWindows())
  scheduleUpdatePolling()

  const registryStore = createFileWorkspaceRegistryStore(
    getDefaultWorkspaceRegistryPath(app.getPath('userData')),
  )
  workspaceManager = createLocalWorkspaceManager({
    referenceTrackerPath: process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH,
    registryStore,
    secretCodec: createElectronSecretCodec(),
  })
  const canSeedSampleData = Boolean(VITE_DEV_SERVER_URL)
  let workspaceService: WorkspaceService<BrowserWindow>
  workspaceService = createWorkspaceService({
    activateWorkspace: openWorkspaceInMainWindow,
    canSeedSampleData,
    chooseWorkspaceParentRoot,
    chooseWorkspaceRoot,
    currentWorkspace: () => currentWorkspace,
    onWorkspaceRegistryChanged() {
      void installWorkspaceMenu(workspaceService)
    },
    registryStore,
    revealPath(workspacePath) {
      return shell.openPath(workspacePath).then(() => undefined)
    },
    showWorkspaceSwitcher: () => Boolean(workspaceLauncherWindow && currentWorkspace),
  })
  activeWorkspaceService = workspaceService
  registerWorkspaceIpc(workspaceService, ipcMain, {
    getParentWindow(event) {
      return getWorkspacePickerParentWindow(event as IpcMainInvokeEvent)
    },
  })
  await installWorkspaceMenu(workspaceService)

  const launchState = await resolveWorkspaceLaunchState({
    canSeedSampleData,
    registryStore,
  })

  if (launchState.status === 'active') {
    await activateWorkspace(launchState.workspace)
    createMainWindow()
    return
  }

  createWorkspaceLauncherWindow()
}).catch((error: unknown) => {
  console.error(error)
  app.quit()
})

function scheduleUpdatePolling() {
  if (updatePollingScheduled) {
    return
  }

  updatePollingScheduled = true
  setTimeout(() => {
    void pollForUpdates()
    setInterval(() => {
      void pollForUpdates()
    }, updatePollIntervalMs)
  }, updatePollInitialDelayMs)
}

async function pollForUpdates() {
  const state = updateService.getState()

  if (
    state.status === 'checking'
    || state.status === 'disabled'
    || state.status === 'downloading'
    || state.status === 'ready'
  ) {
    return
  }

  await updateService.check()
}

async function closeRuntime() {
  await runtime?.close()
  runtime = null
  runtimeServicesRegistered = false
}

function removeRuntimeIpcHandlers() {
  for (const channel of runtimeIpcChannels) {
    ipcMain.removeHandler(channel)
  }
}

async function installWorkspaceMenu(workspaceService: WorkspaceService<BrowserWindow>) {
  const launchState = await workspaceService.getLaunchState()
  const menuTemplate = createWorkspaceMenuTemplate({
    focusableWindows: createFocusableWindowMenuItems(),
    isDevelopment: Boolean(VITE_DEV_SERVER_URL),
    onOpenRecentWorkspace(workspaceId) {
      void workspaceService.openRecent(workspaceId).then(() => installWorkspaceMenu(workspaceService))
    },
    onOpenSettings: openSettings,
    onOpenWorkspace: showWorkspaceLauncherWindow,
    platform: process.platform,
    recentWorkspaces: launchState.recentWorkspaces,
  })

  Menu.setApplicationMenu(
    Menu.buildFromTemplate(menuTemplate as MenuItemConstructorOptions[]),
  )
}

function isExternalHttpUrl(value: string) {
  try {
    const url = new URL(value)

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false
    }

    if (!VITE_DEV_SERVER_URL) {
      return true
    }

    return url.origin !== new URL(VITE_DEV_SERVER_URL).origin
  } catch {
    return false
  }
}

function getWorkspacePickerParentWindow(event: IpcMainInvokeEvent) {
  const parentWindow = BrowserWindow.fromWebContents(event.sender)

  if (!parentWindow || parentWindow.isDestroyed()) {
    return null
  }

  return parentWindow
}

function showWorkspaceFolderDialog(
  ...args:
    | [dialogOptions: WorkspaceFolderDialogOptions]
    | [parentWindow: BrowserWindow, dialogOptions: WorkspaceFolderDialogOptions]
) {
  if (args.length === 2) {
    const [parentWindow, dialogOptions] = args
    return dialog.showOpenDialog(parentWindow, dialogOptions)
  }

  const [dialogOptions] = args
  return dialog.showOpenDialog(dialogOptions)
}

const chooseWorkspaceRoot = createWorkspaceFolderPicker<BrowserWindow>({
  buttonLabel: 'Open workspace',
  showOpenDialog: showWorkspaceFolderDialog,
  title: 'Choose Valedictorian workspace',
})

const chooseWorkspaceParentRoot = createWorkspaceFolderPicker<BrowserWindow>({
  buttonLabel: 'Create workspace here',
  showOpenDialog: showWorkspaceFolderDialog,
  title: 'Choose parent folder',
})
