import type { AppSettingsPatch, AppSettingsStore } from '../settings/app-settings'

interface IpcMainLike {
  handle(
    channel: string,
    handler: (event: unknown, payload?: unknown) => unknown,
  ): void
}

export function registerSettingsIpc(store: AppSettingsStore, ipcMain: IpcMainLike) {
  ipcMain.handle('settings:get', () => store.get())
  ipcMain.handle('settings:update', (_event, patch) => store.update(patch as AppSettingsPatch))
  ipcMain.handle('settings:reset', () => store.reset())
}
