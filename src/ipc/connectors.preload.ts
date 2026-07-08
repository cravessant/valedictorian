import type { ConnectorStatusListResult } from '../modules/connectors/connector.status'

interface IpcRendererLike {
  invoke: (channel: string, input?: unknown) => Promise<unknown>
}

export interface ConnectorsPreloadApi {
  status: {
    list: () => Promise<ConnectorStatusListResult>
  }
}

export function createConnectorsPreloadApi(ipcRenderer: IpcRendererLike): ConnectorsPreloadApi {
  return {
    status: {
      list() {
        return ipcRenderer.invoke('connectors:status:list') as Promise<ConnectorStatusListResult>
      },
    },
  }
}
