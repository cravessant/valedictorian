import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, screen, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { runPackagedManualWorkflowProof } from './packaged-manual-workflow-proof'
import { runPackagedPgliteSmoke } from './pglite-packaged-smoke'
import {
  captureRendererConsole,
  createElectronNativeUiDriver,
  runElectronNativeUiProof,
} from './native-ui-proof'
import { createElectronSecretCodec } from './profile-secret-codec'
import { removeRuntimeIpcHandlers } from './runtime-ipc'
import { createRuntimeQuitBarrier, stopRuntimeLifecycle } from './runtime-lifecycle'
import { registerPolicyIpc } from '../src/ipc/policy.ipc'
import { registerProfileIpc } from '../src/ipc/profile.ipc'
import { registerConnectorsIpc } from '../src/ipc/connectors.ipc'
import { registerScoresIpc } from '../src/ipc/scores.ipc'
import { registerSettingsIpc } from '../src/ipc/settings.ipc'
import { registerUpdatesIpc } from '../src/ipc/updates.ipc'
import {
  createBoundValedictorianHttpTransport,
  registerValedictorianHttpIpc,
} from '../src/ipc/valedictorian-http.ipc'
import {
  VALEDICTORIAN_BACKEND_RETRY_CHANNEL,
  VALEDICTORIAN_BACKEND_STATE_CHANGED_CHANNEL,
} from '../src/ipc/valedictorian-http.preload'
import { registerWorkspaceIpc } from '../src/ipc/workspace.ipc'
import { createLocalWorkspaceManager, type LocalWorkspaceManager } from '../src/server/local-workspaces'
import {
  createValedictorianRuntime,
  resolveValedictorianRuntimeConfig,
  type ValedictorianRuntime,
} from '../src/runtime/valedictorian-runtime'
import { resolveStartupSettingsAndApiToken } from '../src/runtime/startup-settings-resolution'
import {
  createLocalBackendSupervisor,
  type LocalBackendState,
  type LocalBackendSupervisor,
  type SupervisedBackendListener,
} from '../src/runtime/local-backend-supervisor'
import { createFileAppSettingsStore } from '../src/settings/app-settings.store'
import { createApplicationFileSecretStore } from '../src/settings/app-secret.composition'
import { defaultAppSettings } from '../src/settings/app-settings'
import { serializeResolvedTheme } from '../src/theme/theme-bootstrap'
import { resolveTheme, type ResolvedTheme } from '../src/theme/theme-registry'
import { type WorkspaceSummary } from '../src/workspace/workspace.initializer'
import { createWorkspaceMenuTemplate } from '../src/workspace/workspace.menu'
import { createWorkspaceWindowTitle } from '../src/workspace/workspace.window'
import {
  getDefaultWorkspaceRegistryPath,
  workspaceAppSecretsFileName,
} from '../src/workspace/workspace.paths'
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
import { isolatedValidationFixture } from '../src/runtime/isolated-validation.fixture-contract'
import {
  publishIsolatedValidationReadiness,
  readIsolatedValidationEnvironment,
  type IsolatedValidationManifest,
  writeIsolatedValidationTerminalState,
} from '../src/runtime/isolated-validation'
import { createIsolatedValidationReadinessGate } from './isolated-validation-readiness'
import {
  createFileMainWindowStateStore,
  createMainWindowStateSnapshot,
  createMainWindowFirstPaintOptions,
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

if (process.env.VALEDICTORIAN_USER_DATA_PATH) {
  app.setPath('userData', path.resolve(process.env.VALEDICTORIAN_USER_DATA_PATH))
}

if (process.platform === 'win32') {
  app.setAppUserModelId('com.valedictorian.app')
}

let mainWindow: BrowserWindow | null = null
let workspaceLauncherWindow: BrowserWindow | null = null
let runtime: ValedictorianRuntime | null = null
let backendSupervisor: LocalBackendSupervisor | null = null
let rendererBackendState: LocalBackendState = { status: 'stopped' }
let rendererHttpBinding: {
  apiUrl: string
  apiToken?: string
  usePrivilegedTransport: boolean
} | null = null
let currentWorkspace: WorkspaceSummary | null = null
let workspaceManager: LocalWorkspaceManager | null = null
let activeWorkspaceService: WorkspaceService<BrowserWindow> | null = null
let activeResolvedTheme: ResolvedTheme = resolveTheme(defaultAppSettings.theme)
let runtimeServicesRegistered = false
let updatePollingScheduled = false
const updatePollInitialDelayMs = 3000
const updatePollIntervalMs = 30 * 60 * 1000
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
    removeRuntimeIpcHandlers(ipcMain)
  }

  currentWorkspace = workspace
  await registerRuntimeServices(workspace, options)
  runtimeServicesRegistered = true
}

async function registerRuntimeServices(
  workspace: WorkspaceSummary,
  options?: WorkspaceActivationOptions,
) {
  const secretCodec = createElectronSecretCodec(safeStorage)
  // Secret-backed store remains for IPC/UI; startup may bypass it when env token wins.
  const settingsStore = createFileAppSettingsStore(workspace.appSettingsPath, {
    secretStore: createApplicationFileSecretStore(
      path.join(workspace.dataPath, workspaceAppSecretsFileName),
      secretCodec,
    ),
  })
  const { settings, apiToken } = await resolveStartupSettingsAndApiToken({
    env: process.env,
    readPublicSettings: () => createFileAppSettingsStore(workspace.appSettingsPath).get(),
    readSecretBackedSettingsAndToken: async () => ({
      settings: await settingsStore.get(),
      apiToken: await settingsStore.resolveApiToken(),
    }),
  })
  activeResolvedTheme = resolveTheme(settings.theme)
  const config = resolveValedictorianRuntimeConfig({
    apiToken,
    settings,
    userDataPath: app.getPath('userData'),
    workspaceDataPath: workspace.dataPath,
    workspaceId: workspace.id,
  })

  runtime = await createValedictorianRuntime({
    config: {
      ...config,
      seedDataMode: options?.seedData ?? config.seedDataMode,
    },
    deferServerStart: config.mode !== 'remote',
    secretCodec,
    workspaceManager: workspaceManager ?? undefined,
  })
  if (config.mode !== 'remote') {
    backendSupervisor = createLocalBackendSupervisor({
      liveness: { failureThreshold: 2, intervalMs: 5_000, timeoutMs: 2_000 },
      restart: { baseDelayMs: 100, maxAttempts: 5, maxDelayMs: 2_000 },
      async startListener() {
        const server = await runtime?.restartServer?.()
        if (!server || !('onClosed' in server) || !('onError' in server)) {
          throw new Error('Local backend listener is unavailable.')
        }
        const supervisedServer = server as typeof server & {
          onClosed(listener: () => void): () => void
          onError(listener: () => void): () => void
        }
        return {
          close: () => supervisedServer.close(),
          onClosed: (listener) => supervisedServer.onClosed(listener),
          onError: (listener) => supervisedServer.onError(listener),
          origin: supervisedServer.url,
        } satisfies SupervisedBackendListener
      },
      verifyOrigin: verifyLocalBackendOrigin,
    })
    backendSupervisor.subscribe((state) => {
      rendererBackendState = state
      if (state.status === 'available') {
        rendererHttpBinding = {
          apiUrl: state.origin,
          ...(config.apiToken === undefined ? {} : { apiToken: config.apiToken }),
          usePrivilegedTransport: Boolean(config.apiToken),
        }
      }
      publishBackendState(state)
    })
    await backendSupervisor.start()
  } else {
    const origin = runtime.server?.url ?? config.apiUrl
    rendererBackendState = { origin, status: 'available' }
    rendererHttpBinding = {
      apiUrl: origin,
      ...(config.apiToken === undefined ? {} : { apiToken: config.apiToken }),
      usePrivilegedTransport: config.mode === 'remote' || Boolean(config.apiToken),
    }
  }
  registerPolicyIpc(runtime.client, ipcMain)
  if (runtime.profileService && runtime.secretService) {
    registerProfileIpc(runtime.profileService, runtime.secretService, ipcMain)
  }
  registerConnectorsIpc(runtime.connectors, ipcMain)
  registerScoresIpc(runtime.client, ipcMain)
  registerSettingsIpc(settingsStore, ipcMain, {
    onSettingsUpdated: (nextSettings) => {
      activeResolvedTheme = resolveTheme(nextSettings.theme)
      applyNativeThemeToWindow(mainWindow, activeResolvedTheme)
    },
  })
  registerValedictorianHttpIpc(
    (config.mode === 'remote' || Boolean(config.apiToken))
      ? { request: (input) => createCurrentBoundTransport(workspace.id).request(input) }
      : null,
    ipcMain,
  )
}

function createMainWindow() {
  const mainWindowStateStore = createFileMainWindowStateStore(getMainWindowStatePath())
  const savedMainWindowState = mainWindowStateStore.read()

  const validationWorkspace = process.env.VALEDICTORIAN_ISOLATED_VALIDATION === '1'
    ? currentWorkspace
    : null
  let validationTerminalState: 'child_failure' | 'completed' | null = null
  const reportValidationTerminalState = (outcome: 'child_failure' | 'completed') => {
    if (!validationWorkspace || validationTerminalState) return
    validationTerminalState = outcome
    writeIsolatedValidationTerminalState(outcome)
  }
  const validationReadiness = validationWorkspace
    ? createIsolatedValidationReadinessGate({
        delayMs: isolatedValidationReadinessDelayMs(),
        onReady() {
          if (!mainWindow || mainWindow.isDestroyed()) return
          try {
            const validationManifest = publishValidationReadiness(validationWorkspace)
            if (process.env.VALEDICTORIAN_ISOLATED_VALIDATION_FAIL_ELECTRON === '1') {
              reportValidationTerminalState('child_failure')
              app.exit(1)
              return
            }
            if (process.env.VALEDICTORIAN_ISOLATED_VALIDATION_ELECTRON_PROOF === '1') {
              void runIsolatedElectronNativeUiProof(
                mainWindow,
                validationManifest,
                validationWorkspace,
                reportValidationTerminalState,
              )
              return
            }
            if (process.env.VALEDICTORIAN_ISOLATED_VALIDATION_CLOSE_AFTER_READY === '1') {
              mainWindow.close()
            }
          } catch {
            reportValidationTerminalState('child_failure')
            app.exit(1)
          }
        },
      })
    : null

  mainWindow = new BrowserWindow({
    ...resolveMainWindowStateOptions(savedMainWindowState, screen.getAllDisplays()),
    ...minimumMainWindowBounds,
    ...createMainWindowFirstPaintOptions(activeResolvedTheme),
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    title: createWorkspaceWindowTitle(currentWorkspace),
    titleBarOverlay: {
      color: activeResolvedTheme.titleBarBackground,
      symbolColor: activeResolvedTheme.titleBarSymbolColor,
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
    reportValidationTerminalState('completed')
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
    validationReadiness?.windowReady()
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
    mainWindow?.webContents.send(
      VALEDICTORIAN_BACKEND_STATE_CHANGED_CHANNEL,
      rendererBackendState,
    )
    validationReadiness?.rendererLoaded()
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

function applyNativeThemeToWindow(window: BrowserWindow | null, theme: ResolvedTheme) {
  if (!window || window.isDestroyed()) {
    return
  }

  window.setBackgroundColor(theme.firstPaintBackground)
  if (typeof window.setTitleBarOverlay === 'function') {
    window.setTitleBarOverlay({
      color: theme.titleBarBackground,
      symbolColor: theme.titleBarSymbolColor,
    })
  }
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
    backgroundColor: resolveTheme(defaultAppSettings.theme).firstPaintBackground,
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
  if (!currentWorkspace) {
    return []
  }

  const argumentsForRenderer = [
    `--valedictorian-workspace-id=${currentWorkspace.id}`,
    `--valedictorian-theme=${serializeResolvedTheme(activeResolvedTheme)}`,
  ]

  if (!rendererHttpBinding || rendererBackendState.status !== 'available') {
    argumentsForRenderer.push('--valedictorian-backend-status=unavailable')
    return argumentsForRenderer
  }

  argumentsForRenderer.push(`--valedictorian-api-url=${rendererHttpBinding.apiUrl}`)

  if (rendererHttpBinding.usePrivilegedTransport) {
    argumentsForRenderer.push('--valedictorian-http-transport=privileged')
  }

  return argumentsForRenderer
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
const runtimeQuitBarrier = createRuntimeQuitBarrier({
  closeRuntime,
  quit: () => app.quit(),
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || process.env.VALEDICTORIAN_ISOLATED_VALIDATION === '1') {
    app.quit()
    mainWindow = null
    workspaceLauncherWindow = null
  }
})

app.on('before-quit', (event) => {
  runtimeQuitBarrier.requestQuit(event)
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
  const packagedManualWorkflowProofPath = process.env.VALEDICTORIAN_PACKAGE_MANUAL_WORKFLOW_PROOF_PATH
  if (packagedManualWorkflowProofPath) {
    try {
      const packagedManualWorkflowProofPhase = process.env.VALEDICTORIAN_PACKAGE_MANUAL_WORKFLOW_PROOF_PHASE
      if (packagedManualWorkflowProofPhase !== 'write' && packagedManualWorkflowProofPhase !== 'verify') {
        throw new Error('Packaged manual workflow proof phase must be write or verify')
      }
      fs.mkdirSync(packagedManualWorkflowProofPath, { recursive: true })
      const result = await runPackagedManualWorkflowProof({
        dataDirectory: path.join(packagedManualWorkflowProofPath, 'pglite'),
        phase: packagedManualWorkflowProofPhase,
      })
      fs.writeFileSync(
        path.join(packagedManualWorkflowProofPath, `${packagedManualWorkflowProofPhase}.json`),
        `${JSON.stringify(result)}\n`,
        { mode: 0o600 },
      )
      app.exit(0)
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
    return
  }

  const packagedSmokePath = process.env.VALEDICTORIAN_PGLITE_PACKAGE_SMOKE_PATH
  if (packagedSmokePath) {
    try {
      const packagedSmokePhase = process.env.VALEDICTORIAN_PGLITE_PACKAGE_SMOKE_PHASE
      if (packagedSmokePhase !== 'write' && packagedSmokePhase !== 'verify') {
        throw new Error('Packaged PGlite smoke phase must be write or verify')
      }
      fs.mkdirSync(packagedSmokePath, { recursive: true })
      const result = await runPackagedPgliteSmoke({
        dataDirectory: path.join(packagedSmokePath, 'pglite'),
        phase: packagedSmokePhase,
      })
      fs.writeFileSync(
        path.join(packagedSmokePath, `${packagedSmokePhase}.json`),
        `${JSON.stringify(result)}\n`,
        { mode: 0o600 },
      )
      const successfulPackagedSmokeExitCode = 0
      app.exit(successfulPackagedSmokeExitCode)
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
    return
  }

  ipcMain.handle('window-chrome:get-state', (event) =>
    getWindowChromeState(BrowserWindow.fromWebContents(event.sender)),
  )
  ipcMain.handle(VALEDICTORIAN_BACKEND_RETRY_CHANNEL, () => backendSupervisor?.retry())
  registerUpdatesIpc(updateService, ipcMain, () => BrowserWindow.getAllWindows())
  if (process.env.VALEDICTORIAN_ISOLATED_VALIDATION !== '1') {
    scheduleUpdatePolling()
  }

  const registryStore = createFileWorkspaceRegistryStore(
    getDefaultWorkspaceRegistryPath(app.getPath('userData')),
  )
  workspaceManager = createLocalWorkspaceManager({
    referenceTrackerPath: process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH,
    registryStore,
    secretCodec: createElectronSecretCodec(safeStorage),
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

function publishValidationReadiness(workspace: WorkspaceSummary) {
  if (process.env.VALEDICTORIAN_ISOLATED_VALIDATION !== '1') return null
  if (!VITE_DEV_SERVER_URL || !rendererHttpBinding || rendererBackendState.status !== 'available') {
    throw new Error('Isolated validation readiness requires local renderer and backend URLs.')
  }
  return publishIsolatedValidationReadiness({
    apiUrl: rendererHttpBinding.apiUrl,
    rendererUrl: VITE_DEV_SERVER_URL,
    workspace: { id: workspace.id, path: workspace.rootPath },
    fixture: isolatedValidationFixture,
  })
}

async function runIsolatedElectronNativeUiProof(
  window: BrowserWindow,
  manifest: IsolatedValidationManifest | null,
  workspace: WorkspaceSummary,
  reportTerminalState: (outcome: 'child_failure' | 'completed') => void,
) {
  try {
    const session = readIsolatedValidationEnvironment()
    if (!session || !manifest) throw new Error('Electron proof requires an isolated validation session.')
    if (
      window.isDestroyed()
      || window.webContents.isDestroyed()
      || manifest.build.branch !== session.branch
      || manifest.build.commit !== session.commit
      || JSON.stringify(manifest.build.worktree) !== JSON.stringify(session.worktree)
      || manifest.workspace.id !== workspace.id
      || manifest.workspace.path !== workspace.rootPath
      || manifest.fixture.version !== isolatedValidationFixture.version
    ) {
      throw new Error('Electron proof identity does not match the ready isolated session.')
    }
    const proof = await runElectronNativeUiProof({
      build: manifest.build,
      driver: createElectronNativeUiDriver(window.webContents),
      evidenceDirectory: session.evidenceDirectory,
      fixture: manifest.fixture,
      rendererConsole: captureRendererConsole(window.webContents),
      workspace: manifest.workspace,
    })
    if (proof.outcome === 'completed') {
      reportTerminalState('completed')
      window.close()
      return
    }
    reportTerminalState('child_failure')
    app.exit(1)
  } catch (error) {
    console.error('Electron native UI proof failed.', error)
    reportTerminalState('child_failure')
    app.exit(1)
  }
}

function isolatedValidationReadinessDelayMs() {
  const value = Number(process.env.VALEDICTORIAN_ISOLATED_VALIDATION_READINESS_DELAY_MS ?? '0')
  return Number.isSafeInteger(value) && value >= 0 && value <= 10_000 ? value : 0
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
  await stopRuntimeLifecycle({
    backendSupervisor,
    runtime,
  })
  backendSupervisor = null
  runtime = null
  rendererHttpBinding = null
  rendererBackendState = { status: 'stopped' }
  runtimeServicesRegistered = false
}

async function verifyLocalBackendOrigin(origin: string) {
  try {
    const response = await fetch(`${origin}/v1/health`, {
      signal: AbortSignal.timeout(2_000),
    })
    return response.ok && (await response.json() as { ok?: unknown }).ok === true
  } catch {
    return false
  }
}

function publishBackendState(state: LocalBackendState) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(VALEDICTORIAN_BACKEND_STATE_CHANGED_CHANNEL, state)
    }
  }
}

function createCurrentBoundTransport(workspaceId: string) {
  if (!rendererHttpBinding || rendererBackendState.status !== 'available') {
    throw new Error('Workspace backend unavailable.')
  }
  return createBoundValedictorianHttpTransport({
    apiBaseUrl: rendererHttpBinding.apiUrl,
    apiToken: rendererHttpBinding.apiToken,
    workspaceId,
  })
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
