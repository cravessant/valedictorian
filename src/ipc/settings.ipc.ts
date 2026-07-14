import type { AppSettingsPatch, AppSettingsStore } from '../settings/app-settings'
import type { AppSettings } from '../settings/app-settings'

interface IpcMainLike {
  handle(
    channel: string,
    handler: (event: unknown, payload?: unknown) => unknown,
  ): void
}

export interface SettingsIpcOptions {
  onSettingsUpdated?: (settings: AppSettings) => void
}

export function registerSettingsIpc(
  store: AppSettingsStore,
  ipcMain: IpcMainLike,
  options: SettingsIpcOptions = {},
) {
  ipcMain.handle('settings:get', () => store.get())
  ipcMain.handle('settings:update', async (_event, patch) => {
    const settings = await store.update(patch as AppSettingsPatch)
    options.onSettingsUpdated?.(settings)
    return settings
  })
  ipcMain.handle('settings:reset', async () => {
    const settings = await store.reset()
    options.onSettingsUpdated?.(settings)
    return settings
  })
}
