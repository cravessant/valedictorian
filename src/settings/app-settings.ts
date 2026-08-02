import {
  createDefaultThemeSettings,
  normalizeThemeSettings,
  type ThemeSettings,
} from '../theme/theme-registry'
import {
  defaultInitialWorkspaceSettings,
  type RuntimePreference,
} from '@sparxie/valedictorian-local-runtime/runtime-settings'

export type { RuntimePreference } from '@sparxie/valedictorian-local-runtime/runtime-settings'

/** Public settings DTO: never contains token plaintext or storage references. */
export interface AppSettings {
  apiTokenConfigured: boolean
  localApiHost: string
  localApiPort: number
  remoteApiUrl: string
  runtimeMode: RuntimePreference
  sidebarCollapsed: boolean
  showAdvancedFilters: boolean
  showDebugData: boolean
  theme: ThemeSettings
}

/** Write-only apiToken is accepted by update but never returned. */
export type AppSettingsPatch = Partial<Omit<AppSettings, 'apiTokenConfigured'>> & {
  apiToken?: string
}

export interface AppSettingsStore {
  get: () => Promise<AppSettings>
  reset: () => Promise<AppSettings>
  /** Privileged main-process only: resolves saved token plaintext. */
  resolveApiToken: () => Promise<string | null>
  update: (patch: AppSettingsPatch) => Promise<AppSettings>
}

export const defaultAppSettings: AppSettings = {
  ...defaultInitialWorkspaceSettings,
  theme: createDefaultThemeSettings(),
}

export function normalizeAppSettings(value: unknown): AppSettings {
  if (!value || typeof value !== 'object') {
    return { ...defaultAppSettings }
  }

  const candidate = value as Record<string, unknown>

  return {
    apiTokenConfigured:
      typeof candidate.apiTokenConfigured === 'boolean'
        ? candidate.apiTokenConfigured
        : defaultAppSettings.apiTokenConfigured,
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
    showDebugData:
      typeof candidate.showDebugData === 'boolean'
        ? candidate.showDebugData
        : defaultAppSettings.showDebugData,
    theme: normalizeThemeSettings(candidate.theme),
  }
}

function isRuntimePreference(value: unknown): value is RuntimePreference {
  return value === 'local-desktop' || value === 'local-shared' || value === 'remote'
}
