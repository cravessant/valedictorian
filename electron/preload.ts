import { ipcRenderer, contextBridge } from 'electron'
import { createApplicationsPreloadApi } from '../src/ipc/applications.preload'
import { createPolicyPreloadApi } from '../src/ipc/policy.preload'
import { createProfilePreloadApi } from '../src/ipc/profile.preload'
import { createQueuePreloadApi } from '../src/ipc/queue.preload'
import { createScoresPreloadApi } from '../src/ipc/scores.preload'
import { createSettingsPreloadApi } from '../src/ipc/settings.preload'
import { createSourcingPreloadApi } from '../src/ipc/sourcing.preload'
import { createWorkspacePreloadApi } from '../src/ipc/workspace.preload'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('applications', createApplicationsPreloadApi(ipcRenderer))
contextBridge.exposeInMainWorld('policy', createPolicyPreloadApi(ipcRenderer))
contextBridge.exposeInMainWorld('profile', createProfilePreloadApi(ipcRenderer))
contextBridge.exposeInMainWorld('queue', createQueuePreloadApi(ipcRenderer))
contextBridge.exposeInMainWorld('scores', createScoresPreloadApi(ipcRenderer))
contextBridge.exposeInMainWorld('settings', createSettingsPreloadApi(ipcRenderer))
contextBridge.exposeInMainWorld('sourcing', createSourcingPreloadApi(ipcRenderer))
contextBridge.exposeInMainWorld('workspace', createWorkspacePreloadApi(ipcRenderer))
