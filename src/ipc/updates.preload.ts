export type UpdateStatus =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'ready'
  | 'unavailable'
  | 'error'

export interface UpdateState {
  availableVersion?: string
  currentVersion: string
  message?: string
  percent?: number
  status: UpdateStatus
}

export interface UpdatesPreloadApi {
  check: () => Promise<UpdateState>
  getState: () => Promise<UpdateState>
  install: () => Promise<void>
  onStateChanged: (listener: (state: UpdateState) => void) => () => void
}

interface UpdatesIpcRenderer {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown
}

function createUpdatesPreloadApi(ipcRenderer: UpdatesIpcRenderer): UpdatesPreloadApi {
  return {
    check: () => ipcRenderer.invoke('updates:check') as Promise<UpdateState>,
    getState: () => ipcRenderer.invoke('updates:get-state') as Promise<UpdateState>,
    install: () => ipcRenderer.invoke('updates:install') as Promise<void>,
    onStateChanged(listener) {
      const eventListener = (_event: unknown, state: unknown) => {
        listener(state as UpdateState)
      }

      ipcRenderer.on('updates:state-changed', eventListener)

      return () => {
        ipcRenderer.removeListener('updates:state-changed', eventListener)
      }
    },
  }
}

export { createUpdatesPreloadApi }
