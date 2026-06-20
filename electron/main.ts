import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
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
import { registerWorkspaceIpc } from '../src/ipc/workspace.ipc'
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
import { getDefaultWorkspaceRegistryPath } from '../src/workspace/workspace.paths'
import { createFileWorkspaceRegistryStore } from '../src/workspace/workspace.registry'
import {
  createWorkspaceService,
  resolveWorkspaceLaunchState,
  type WorkspaceActivationOptions,
  type WorkspaceService,
} from '../src/workspace/workspace.service'

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
let runtimeServicesRegistered = false

async function openWorkspaceInMainWindow(
  workspace: WorkspaceSummary,
  options: WorkspaceActivationOptions,
) {
  await activateWorkspace(workspace, options)

  if (!mainWindow) {
    createMainWindow()
  }

  workspaceLauncherWindow?.close()
  workspaceLauncherWindow = null
}

async function activateWorkspace(
  workspace: WorkspaceSummary,
  options?: WorkspaceActivationOptions,
) {
  currentWorkspace = workspace

  if (runtimeServicesRegistered) {
    return
  }

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
  mainWindow = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    title: 'Valedictorian',
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
  })

  loadRenderer(mainWindow)
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
  })
  workspaceLauncherWindow.once('ready-to-show', () => {
    workspaceLauncherWindow?.show()
  })

  loadRenderer(workspaceLauncherWindow)
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
  const registryStore = createFileWorkspaceRegistryStore(
    getDefaultWorkspaceRegistryPath(app.getPath('userData')),
  )
  const canSeedSampleData = Boolean(VITE_DEV_SERVER_URL)
  let workspaceService: WorkspaceService
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
    relaunchApp() {
      setTimeout(() => {
        app.relaunch()
        app.exit(0)
      }, 0)
    },
    revealPath(workspacePath) {
      return shell.openPath(workspacePath).then(() => undefined)
    },
    showWorkspaceSwitcher: () => Boolean(workspaceLauncherWindow && currentWorkspace),
  })
  registerWorkspaceIpc(workspaceService, ipcMain)
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

async function closeRuntime() {
  await runtime?.close()
  runtime = null
  runtimeServicesRegistered = false
}

async function installWorkspaceMenu(workspaceService: WorkspaceService) {
  const launchState = await workspaceService.getLaunchState()
  const menuTemplate = createWorkspaceMenuTemplate({
    onOpenRecentWorkspace(workspaceId) {
      void workspaceService.openRecent(workspaceId).then(() => installWorkspaceMenu(workspaceService))
    },
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

async function chooseWorkspaceRoot() {
  const result = await dialog.showOpenDialog({
    buttonLabel: 'Open workspace',
    properties: ['openDirectory', 'createDirectory'],
    title: 'Choose Valedictorian workspace',
  })

  if (result.canceled) {
    return null
  }

  return result.filePaths[0] ?? null
}

async function chooseWorkspaceParentRoot() {
  const result = await dialog.showOpenDialog({
    buttonLabel: 'Create workspace here',
    properties: ['openDirectory', 'createDirectory'],
    title: 'Choose parent folder',
  })

  if (result.canceled) {
    return null
  }

  return result.filePaths[0] ?? null
}
