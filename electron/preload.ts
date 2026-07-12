import { ipcRenderer, contextBridge } from 'electron'
import { createApplicationsPreloadApi } from '../src/ipc/applications.preload'
import { createPolicyPreloadApi } from '../src/ipc/policy.preload'
import { createProfilePreloadApi } from '../src/ipc/profile.preload'
import { createActionQueuePreloadApi } from '../src/ipc/action-queue.preload'
import { createConnectorsPreloadApi } from '../src/ipc/connectors.preload'
import { createScoresPreloadApi } from '../src/ipc/scores.preload'
import { createSettingsPreloadApi } from '../src/ipc/settings.preload'
import { createSourcingPreloadApi } from '../src/ipc/sourcing.preload'
import { createUpdatesPreloadApi } from '../src/ipc/updates.preload'
import {
  createValedictorianHttpPreloadApi,
  readRendererHttpConfig,
} from '../src/ipc/valedictorian-http.preload'
import { createWindowChromePreloadApi } from '../src/ipc/window-chrome.preload'
import { createWorkspacePreloadApi } from '../src/ipc/workspace.preload'

const rendererHttpConfig = readRendererHttpConfig(process.argv)

if (rendererHttpConfig) {
  contextBridge.exposeInMainWorld(
    'valedictorianHttp',
    createValedictorianHttpPreloadApi(ipcRenderer, rendererHttpConfig),
  )
}

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('applications', createApplicationsPreloadApi(ipcRenderer))
contextBridge.exposeInMainWorld('policy', createPolicyPreloadApi(ipcRenderer))
contextBridge.exposeInMainWorld('profile', createProfilePreloadApi(ipcRenderer))
contextBridge.exposeInMainWorld('actionQueue', createActionQueuePreloadApi(ipcRenderer))
contextBridge.exposeInMainWorld('connectors', createConnectorsPreloadApi(ipcRenderer))
contextBridge.exposeInMainWorld('scores', createScoresPreloadApi(ipcRenderer))
contextBridge.exposeInMainWorld('settings', createSettingsPreloadApi(ipcRenderer))
contextBridge.exposeInMainWorld('sourcing', createSourcingPreloadApi(ipcRenderer))
contextBridge.exposeInMainWorld('valedictorianUpdates', createUpdatesPreloadApi(ipcRenderer))
contextBridge.exposeInMainWorld('valedictorianWindowChrome', createWindowChromePreloadApi(ipcRenderer))
contextBridge.exposeInMainWorld('workspace', createWorkspacePreloadApi(ipcRenderer))

ipcRenderer.on('valedictorian:open-settings', () => {
  window.dispatchEvent(new Event('valedictorian:open-settings'))
})
