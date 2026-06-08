import type { WorkspaceRecord } from '../workspace/workspace.registry'
import type { WorkspaceSummary } from '../workspace/workspace.initializer'

interface IpcRendererLike {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>
}

export interface WorkspacePreloadApi {
  chooseFolder: () => Promise<WorkspaceSummary | null>
  getCurrent: () => Promise<WorkspaceSummary | null>
  listRecent: () => Promise<WorkspaceRecord[]>
  revealCurrent: () => Promise<void>
}

export function createWorkspacePreloadApi(ipcRenderer: IpcRendererLike): WorkspacePreloadApi {
  return {
    chooseFolder: () =>
      ipcRenderer.invoke('workspace:choose-folder') as Promise<WorkspaceSummary | null>,
    getCurrent: () =>
      ipcRenderer.invoke('workspace:get-current') as Promise<WorkspaceSummary | null>,
    listRecent: () => ipcRenderer.invoke('workspace:list-recent') as Promise<WorkspaceRecord[]>,
    revealCurrent: () => ipcRenderer.invoke('workspace:reveal-current') as Promise<void>,
  }
}
