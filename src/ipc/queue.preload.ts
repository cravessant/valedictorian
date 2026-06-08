import type { QueueListQuery, QueueListResult } from 'sparxie'

interface IpcRendererLike {
  invoke(channel: string, query?: QueueListQuery): Promise<unknown>
}

export interface QueuePreloadApi {
  list(query?: QueueListQuery): Promise<QueueListResult>
}

export function createQueuePreloadApi(ipcRenderer: IpcRendererLike): QueuePreloadApi {
  return {
    list(query) {
      return ipcRenderer.invoke('queue:list', query) as Promise<QueueListResult>
    },
  }
}
