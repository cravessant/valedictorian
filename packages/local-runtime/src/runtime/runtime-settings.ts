export type RuntimePreference = 'local-desktop' | 'local-shared' | 'remote'

export interface LocalRuntimeSettings {
  apiTokenConfigured?: boolean
  localApiHost: string
  localApiPort: number
  remoteApiUrl: string
  runtimeMode: RuntimePreference
  sidebarCollapsed?: boolean
  showAdvancedFilters?: boolean
  showDebugData?: boolean
  theme?: unknown
}

/**
 * Initial persisted settings written when a workspace is first opened.
 * The UI owns theme interpretation; the local runtime owns the durable file shape.
 */
export const defaultInitialWorkspaceSettings = {
  apiTokenConfigured: false,
  localApiHost: '127.0.0.1',
  localApiPort: 4317,
  remoteApiUrl: 'http://127.0.0.1:4317',
  runtimeMode: 'local-desktop',
  sidebarCollapsed: false,
  showAdvancedFilters: false,
  showDebugData: false,
  theme: {
    presetId: 'catppuccin-blur-mocha',
    overrides: {},
  },
} as const satisfies LocalRuntimeSettings & {
  apiTokenConfigured: boolean
  sidebarCollapsed: boolean
  showAdvancedFilters: boolean
  showDebugData: boolean
  theme: unknown
}
