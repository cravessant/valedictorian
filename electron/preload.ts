import { ipcRenderer, contextBridge } from 'electron'
import { createApplicationsPreloadApi } from '../src/ipc/applications.preload'
import { createSettingsPreloadApi } from '../src/ipc/settings.preload'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('applications', createApplicationsPreloadApi(ipcRenderer))
contextBridge.exposeInMainWorld('settings', createSettingsPreloadApi(ipcRenderer))
