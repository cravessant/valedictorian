import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createDrizzleDatabase, createFileDatabase, migrateDatabase } from '../src/db/sqlite'
import { registerApplicationIpc } from '../src/ipc/applications.ipc'
import { registerPolicyIpc } from '../src/ipc/policy.ipc'
import { registerProfileIpc } from '../src/ipc/profile.ipc'
import { registerQueueIpc } from '../src/ipc/queue.ipc'
import { registerScoresIpc } from '../src/ipc/scores.ipc'
import { registerSettingsIpc } from '../src/ipc/settings.ipc'
import { registerSourcingIpc } from '../src/ipc/sourcing.ipc'
import {
  createSqliteProfileRepository,
  type ProfileSecretCodec,
} from '../src/modules/profile/profile.repository'
import {
  createJobAppRuntime,
  resolveJobAppRuntimeConfig,
  type JobAppRuntime,
} from '../src/runtime/job-app-runtime'
import { createFileAppSettingsStore } from '../src/settings/app-settings.store'

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

let win: BrowserWindow | null
let runtime: JobAppRuntime | null = null

async function registerRuntimeServices() {
  const settingsStore = createFileAppSettingsStore(
    path.join(app.getPath('userData'), 'settings.json'),
  )
  const config = resolveJobAppRuntimeConfig({
    settings: await settingsStore.get(),
    userDataPath: app.getPath('userData'),
  })

  runtime = await createJobAppRuntime({
    config,
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
  registerQueueIpc(runtime.client, ipcMain)
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

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
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
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalHttpUrl(url)) {
      void shell.openExternal(url)
      return { action: 'deny' }
    }

    return { action: 'allow' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (isExternalHttpUrl(url)) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    void win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    void win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    void closeRuntime()
    app.quit()
    win = null
  }
})

app.on('before-quit', () => {
  void closeRuntime()
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(async () => {
  await registerRuntimeServices()
  createWindow()
}).catch((error: unknown) => {
  console.error(error)
  app.quit()
})

async function closeRuntime() {
  await runtime?.close()
  runtime = null
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
