import type { UpdateService } from '../ipc/updates.ipc'
import type { UpdateState } from '../ipc/updates.preload'

interface UpdateAppInfo {
  getVersion: () => string
  isPackaged: boolean
  platform: NodeJS.Platform
}

export interface UpdateBoundary {
  checkForUpdates: () => Promise<unknown>
  on: (event: string, listener: (...args: unknown[]) => void) => unknown
  quitAndInstall: () => void
  setAutoDownload: (autoDownload: boolean) => void
}

interface UpdateServiceDependencies {
  app: UpdateAppInfo
  beforeInstall?: () => Promise<void>
  updater: UpdateBoundary
}

const disabledMessage = 'Updates are only available in signed packaged Mac builds.'

interface ElectronAppInfo {
  getVersion: () => string
  isPackaged: boolean
}

interface ElectronUpdaterBoundary {
  autoDownload: boolean
  checkForUpdates: () => Promise<unknown>
  on: (event: string, listener: (...args: unknown[]) => void) => unknown
  quitAndInstall: () => void
}

function createElectronUpdateService(
  app: ElectronAppInfo,
  updater: ElectronUpdaterBoundary,
  options: Pick<UpdateServiceDependencies, 'beforeInstall'> = {},
): UpdateService {
  return createUpdateService({
    app: {
      getVersion: () => app.getVersion(),
      isPackaged: app.isPackaged,
      platform: process.platform,
    },
    beforeInstall: options.beforeInstall,
    updater: {
      checkForUpdates: () => updater.checkForUpdates(),
      on: (event, listener) => updater.on(event, listener),
      quitAndInstall: () => updater.quitAndInstall(),
      setAutoDownload(autoDownload) {
        updater.autoDownload = autoDownload
      },
    },
  })
}

function createUpdateService({ app, beforeInstall, updater }: UpdateServiceDependencies): UpdateService {
  const enabled = app.isPackaged && app.platform === 'darwin'
  const listeners = new Set<(state: UpdateState) => void>()
  let state: UpdateState = enabled
    ? { currentVersion: app.getVersion(), status: 'idle' }
    : {
        currentVersion: app.getVersion(),
        message: disabledMessage,
        status: 'disabled',
      }

  function setState(nextState: UpdateState) {
    state = nextState

    for (const listener of listeners) {
      listener(state)
    }
  }

  if (enabled) {
    updater.setAutoDownload(true)
    updater.on('update-available', (info) => {
      setState({
        availableVersion: readVersion(info),
        currentVersion: app.getVersion(),
        percent: 0,
        status: 'downloading',
      })
    })
    updater.on('update-not-available', () => {
      setState({
        currentVersion: app.getVersion(),
        status: 'unavailable',
      })
    })
    updater.on('download-progress', (progress) => {
      setState({
        availableVersion: state.availableVersion,
        currentVersion: app.getVersion(),
        percent: Math.round(readPercent(progress)),
        status: 'downloading',
      })
    })
    updater.on('update-downloaded', (info) => {
      setState({
        availableVersion: readVersion(info) ?? state.availableVersion,
        currentVersion: app.getVersion(),
        status: 'ready',
      })
    })
    updater.on('error', () => {
      setState({
        currentVersion: app.getVersion(),
        message: 'Update check failed',
        status: 'error',
      })
    })
  }

  return {
    async check() {
      if (!enabled) {
        return state
      }

      setState({
        currentVersion: app.getVersion(),
        status: 'checking',
      })
      try {
        await updater.checkForUpdates()
      } catch {
        setState({
          currentVersion: app.getVersion(),
          message: 'Update check failed',
          status: 'error',
        })
      }

      return state
    },
    getState() {
      return state
    },
    async install() {
      if (state.status === 'ready') {
        await beforeInstall?.()
        updater.quitAndInstall()
      }
    },
    onStateChanged(listener) {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
  }
}

function readVersion(value: unknown) {
  if (value && typeof value === 'object' && 'version' in value && typeof value.version === 'string') {
    return value.version
  }

  return undefined
}

function readPercent(value: unknown) {
  if (value && typeof value === 'object' && 'percent' in value && typeof value.percent === 'number') {
    return value.percent
  }

  return 0
}

export { createElectronUpdateService, createUpdateService }
