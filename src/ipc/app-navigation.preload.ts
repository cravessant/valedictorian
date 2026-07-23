const OPEN_SETTINGS_CHANNEL = 'valedictorian:open-settings'

export interface AppNavigationPreloadApi {
  onOpenSettings: (listener: () => void) => () => void
}

interface AppNavigationIpcRenderer {
  on(channel: string, listener: (event: unknown) => void): unknown
}

function createAppNavigationPreloadApi(
  ipcRenderer: AppNavigationIpcRenderer,
): AppNavigationPreloadApi {
  const listeners = new Set<() => void>()
  let pendingOpenSettings = false

  ipcRenderer.on(OPEN_SETTINGS_CHANNEL, () => {
    if (listeners.size === 0) {
      pendingOpenSettings = true
      return
    }

    for (const listener of listeners) listener()
  })

  return {
    onOpenSettings(listener) {
      listeners.add(listener)

      if (pendingOpenSettings) {
        pendingOpenSettings = false
        listener()
      }

      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export { createAppNavigationPreloadApi, OPEN_SETTINGS_CHANNEL }
