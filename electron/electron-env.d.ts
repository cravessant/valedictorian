/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string
    /** /dist/ or /public/ */
    VITE_PUBLIC: string
  }
}

// Used in Renderer process, exposed in `preload.ts`.
interface Window {
  valedictorianTheme?: import('../src/theme/theme-registry').ResolvedTheme
  applications: import('../src/ipc/applications.preload').ApplicationsPreloadApi
  profile: import('../src/ipc/profile.preload').ProfilePreloadApi
  actionQueue: import('../src/ipc/action-queue.preload').ActionQueuePreloadApi
  connectors: import('../src/ipc/connectors.preload').ConnectorsPreloadApi
  scores: import('../src/ipc/scores.preload').ScoresPreloadApi
  settings: import('../src/ipc/settings.preload').SettingsPreloadApi
  sourcing: import('../src/ipc/sourcing.preload').SourcingPreloadApi
  valedictorianUpdates: import('../src/ipc/updates.preload').UpdatesPreloadApi
  valedictorianWindowChrome: import('../src/ipc/window-chrome.preload').WindowChromePreloadApi
  valedictorianHttp?: {
    apiBaseUrl: string
    workspaceId: string
    request?: typeof fetch
  }
  workspace: import('../src/ipc/workspace.preload').WorkspacePreloadApi
}
