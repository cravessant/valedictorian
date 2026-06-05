import type {
  ApplicationListQuery,
  ApplicationListResult,
} from '../modules/applications/application.types'

interface IpcRendererLike {
  invoke(channel: string, query?: ApplicationListQuery): Promise<unknown>
}

export interface ApplicationsPreloadApi {
  list(query?: ApplicationListQuery): Promise<ApplicationListResult>
}

export function createApplicationsPreloadApi(
  ipcRenderer: IpcRendererLike,
): ApplicationsPreloadApi {
  return {
    list(query) {
      return ipcRenderer.invoke('applications:list', query) as Promise<ApplicationListResult>
    },
  }
}
