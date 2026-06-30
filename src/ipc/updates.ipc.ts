import type { IpcMain, WebContents } from 'electron'
import type { UpdateState } from './updates.preload'

export interface UpdateService {
  check: () => Promise<UpdateState>
  getState: () => UpdateState
  install: () => Promise<void> | void
  onStateChanged: (listener: (state: UpdateState) => void) => () => void
}

interface UpdatesIpcMain {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void
}

type WindowLike = {
  webContents: Pick<WebContents, 'send'>
}

function registerUpdatesIpc(
  service: UpdateService,
  ipcMain: Pick<IpcMain, 'handle'> | UpdatesIpcMain,
  getWindows: () => WindowLike[],
) {
  ipcMain.handle('updates:get-state', async () => service.getState())
  ipcMain.handle('updates:check', async () => service.check())
  ipcMain.handle('updates:install', async () => service.install())

  service.onStateChanged((state) => {
    for (const window of getWindows()) {
      window.webContents.send('updates:state-changed', state)
    }
  })
}

export { registerUpdatesIpc }
