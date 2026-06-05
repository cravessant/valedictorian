import type { AppSettings, AppSettingsPatch } from '../settings/app-settings'

interface IpcRendererLike {
  invoke(channel: string, payload?: unknown): Promise<unknown>
}

export interface SettingsPreloadApi {
  get(): Promise<AppSettings>
  reset(): Promise<AppSettings>
  update(patch: AppSettingsPatch): Promise<AppSettings>
}

export function createSettingsPreloadApi(ipcRenderer: IpcRendererLike): SettingsPreloadApi {
  return {
    get: () => ipcRenderer.invoke('settings:get') as Promise<AppSettings>,
    reset: () => ipcRenderer.invoke('settings:reset') as Promise<AppSettings>,
    update: (patch) => ipcRenderer.invoke('settings:update', patch) as Promise<AppSettings>,
  }
}
