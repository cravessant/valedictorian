export interface WindowChromeState {
  isFullScreen: boolean
}

export interface WindowChromePreloadApi {
  getState: () => Promise<WindowChromeState>
  onStateChanged: (listener: (state: WindowChromeState) => void) => () => void
}

interface WindowChromeIpcRenderer {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown
}

function createWindowChromePreloadApi(
  ipcRenderer: WindowChromeIpcRenderer,
): WindowChromePreloadApi {
  return {
    getState: () => ipcRenderer.invoke('window-chrome:get-state') as Promise<WindowChromeState>,
    onStateChanged(listener) {
      const eventListener = (_event: unknown, state: unknown) => {
        listener(normalizeWindowChromeState(state))
      }

      ipcRenderer.on('window-chrome:state-changed', eventListener)

      return () => {
        ipcRenderer.removeListener('window-chrome:state-changed', eventListener)
      }
    },
  }
}

function normalizeWindowChromeState(value: unknown): WindowChromeState {
  if (typeof value === 'object' && value !== null && 'isFullScreen' in value) {
    return { isFullScreen: Boolean(value.isFullScreen) }
  }

  return { isFullScreen: false }
}

export { createWindowChromePreloadApi }
