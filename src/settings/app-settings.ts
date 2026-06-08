export type RuntimePreference = 'local-desktop' | 'local-shared' | 'remote'

export interface AppSettings {
  apiToken: string
  localApiHost: string
  localApiPort: number
  remoteApiUrl: string
  runtimeMode: RuntimePreference
  sidebarCollapsed: boolean
  showAdvancedFilters: boolean
}

export type AppSettingsPatch = Partial<AppSettings>

export interface AppSettingsStore {
  get: () => Promise<AppSettings>
  reset: () => Promise<AppSettings>
  update: (patch: AppSettingsPatch) => Promise<AppSettings>
}

export const defaultAppSettings: AppSettings = {
  apiToken: '',
  localApiHost: '127.0.0.1',
  localApiPort: 4317,
  remoteApiUrl: 'http://127.0.0.1:4317',
  runtimeMode: 'local-desktop',
  sidebarCollapsed: false,
  showAdvancedFilters: false,
}

export function normalizeAppSettings(value: unknown): AppSettings {
  if (!value || typeof value !== 'object') {
    return { ...defaultAppSettings }
  }

  const candidate = value as Record<string, unknown>

  return {
    apiToken:
      typeof candidate.apiToken === 'string' ? candidate.apiToken : defaultAppSettings.apiToken,
    localApiHost:
      typeof candidate.localApiHost === 'string'
        ? candidate.localApiHost
        : defaultAppSettings.localApiHost,
    localApiPort:
      typeof candidate.localApiPort === 'number' && Number.isInteger(candidate.localApiPort)
        ? candidate.localApiPort
        : defaultAppSettings.localApiPort,
    remoteApiUrl:
      typeof candidate.remoteApiUrl === 'string'
        ? candidate.remoteApiUrl
        : defaultAppSettings.remoteApiUrl,
    runtimeMode: isRuntimePreference(candidate.runtimeMode)
      ? candidate.runtimeMode
      : defaultAppSettings.runtimeMode,
    sidebarCollapsed:
      typeof candidate.sidebarCollapsed === 'boolean'
        ? candidate.sidebarCollapsed
        : defaultAppSettings.sidebarCollapsed,
    showAdvancedFilters:
      typeof candidate.showAdvancedFilters === 'boolean'
        ? candidate.showAdvancedFilters
        : defaultAppSettings.showAdvancedFilters,
  }
}

function isRuntimePreference(value: unknown): value is RuntimePreference {
  return value === 'local-desktop' || value === 'local-shared' || value === 'remote'
}
