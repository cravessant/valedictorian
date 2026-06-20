import type { ActionQueueListQuery, ActionQueueListResult } from 'sparxie'

interface IpcRendererLike {
  invoke: (channel: string, query?: ActionQueueListQuery) => Promise<unknown>
}

export interface ActionQueuePreloadApi {
  list: (query?: ActionQueueListQuery) => Promise<ActionQueueListResult>
}

export function createActionQueuePreloadApi(ipcRenderer: IpcRendererLike): ActionQueuePreloadApi {
  return {
    list(query) {
      return ipcRenderer.invoke('action-queue:list', query) as Promise<ActionQueueListResult>
    },
  }
}
