import type { WorkspaceRecord } from '../workspace/workspace.registry'
import type { WorkspaceSummary } from '../workspace/workspace.initializer'
import type { CreateWorkspaceInput, WorkspaceLaunchState } from '../workspace/workspace.service'

interface IpcRendererLike {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>
}

export interface WorkspacePreloadApi {
  chooseCreateParentFolder: () => Promise<string | null>
  chooseFolder: () => Promise<WorkspaceSummary | null>
  createWorkspace: (input: CreateWorkspaceInput) => Promise<WorkspaceLaunchState>
  getCurrent: () => Promise<WorkspaceSummary | null>
  getLaunchState: () => Promise<WorkspaceLaunchState>
  listRecent: () => Promise<WorkspaceRecord[]>
  openFolder: () => Promise<WorkspaceLaunchState>
  openRecent: (workspaceId: string) => Promise<WorkspaceLaunchState>
  removeRecent: (workspaceId: string) => Promise<WorkspaceLaunchState>
  reveal: (workspacePath: string) => Promise<void>
  revealCurrent: () => Promise<void>
}

export function createWorkspacePreloadApi(ipcRenderer: IpcRendererLike): WorkspacePreloadApi {
  return {
    chooseCreateParentFolder: () =>
      ipcRenderer.invoke('workspace:choose-create-parent-folder') as Promise<string | null>,
    chooseFolder: () =>
      ipcRenderer.invoke('workspace:choose-folder') as Promise<WorkspaceSummary | null>,
    createWorkspace: (input) =>
      ipcRenderer.invoke('workspace:create-workspace', input) as Promise<WorkspaceLaunchState>,
    getCurrent: () =>
      ipcRenderer.invoke('workspace:get-current') as Promise<WorkspaceSummary | null>,
    getLaunchState: () =>
      ipcRenderer.invoke('workspace:get-launch-state') as Promise<WorkspaceLaunchState>,
    listRecent: () => ipcRenderer.invoke('workspace:list-recent') as Promise<WorkspaceRecord[]>,
    openFolder: () =>
      ipcRenderer.invoke('workspace:open-folder') as Promise<WorkspaceLaunchState>,
    openRecent: (workspaceId) =>
      ipcRenderer.invoke('workspace:open-recent', workspaceId) as Promise<WorkspaceLaunchState>,
    removeRecent: (workspaceId) =>
      ipcRenderer.invoke('workspace:remove-recent', workspaceId) as Promise<WorkspaceLaunchState>,
    reveal: (workspacePath) => ipcRenderer.invoke('workspace:reveal', workspacePath) as Promise<void>,
    revealCurrent: () => ipcRenderer.invoke('workspace:reveal-current') as Promise<void>,
  }
}
