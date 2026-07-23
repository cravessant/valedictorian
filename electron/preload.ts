import { ipcRenderer, contextBridge } from 'electron'
import { createAppNavigationPreloadApi } from '../src/ipc/app-navigation.preload'
import { createPolicyPreloadApi } from '../src/ipc/policy.preload'
import { createProfilePreloadApi } from '../src/ipc/profile.preload'
import { createConnectorsPreloadApi } from '../src/ipc/connectors.preload'
import { createScoresPreloadApi } from '../src/ipc/scores.preload'
import { createSettingsPreloadApi } from '../src/ipc/settings.preload'
import { createUpdatesPreloadApi } from '../src/ipc/updates.preload'
import {
  createValedictorianHttpPreloadApi,
  readRendererHttpConfig,
} from '../src/ipc/valedictorian-http.preload'
import { readRendererThemeConfig } from '../src/theme/theme-bootstrap'
import { createWindowChromePreloadApi } from '../src/ipc/window-chrome.preload'
import { createWorkspacePreloadApi } from '../src/ipc/workspace.preload'

const rendererHttpConfig = readRendererHttpConfig(process.argv)
const rendererTheme = readRendererThemeConfig(process.argv)

if (rendererTheme) {
  contextBridge.exposeInMainWorld('valedictorianTheme', rendererTheme)
}

if (rendererHttpConfig) {
  contextBridge.exposeInMainWorld(
    'valedictorianHttp',
    createValedictorianHttpPreloadApi(ipcRenderer, rendererHttpConfig),
  )
}

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('policy', createPolicyPreloadApi(ipcRenderer))
contextBridge.exposeInMainWorld(
  'valedictorianNavigation',
  createAppNavigationPreloadApi(ipcRenderer),
)
contextBridge.exposeInMainWorld('profile', createProfilePreloadApi(ipcRenderer))
contextBridge.exposeInMainWorld('connectors', createConnectorsPreloadApi(ipcRenderer))
contextBridge.exposeInMainWorld('scores', createScoresPreloadApi(ipcRenderer))
contextBridge.exposeInMainWorld('settings', createSettingsPreloadApi(ipcRenderer))
contextBridge.exposeInMainWorld('valedictorianUpdates', createUpdatesPreloadApi(ipcRenderer))
contextBridge.exposeInMainWorld('valedictorianWindowChrome', createWindowChromePreloadApi(ipcRenderer))
contextBridge.exposeInMainWorld('workspace', createWorkspacePreloadApi(ipcRenderer))
