import type { ConnectorStatusListResult } from '../modules/connectors/connector.status'
import type {
  LocalConnectorReconnectActionResult,
  LocalConnectorSkipActionInput,
  LocalConnectorSkipActionResult,
  LocalConnectorStatusActionInput,
} from '../runtime/local-valedictorian-client'

interface IpcRendererLike {
  invoke: (channel: string, input?: unknown) => Promise<unknown>
}

export interface ConnectorsPreloadApi {
  status: {
    list: () => Promise<ConnectorStatusListResult>
    reconnect: (
      input: LocalConnectorStatusActionInput
    ) => Promise<LocalConnectorReconnectActionResult>
    skip: (input: LocalConnectorSkipActionInput) => Promise<LocalConnectorSkipActionResult>
  }
}

export function createConnectorsPreloadApi(ipcRenderer: IpcRendererLike): ConnectorsPreloadApi {
  return {
    status: {
      list() {
        return ipcRenderer.invoke('connectors:status:list') as Promise<ConnectorStatusListResult>
      },
      reconnect(input) {
        return ipcRenderer.invoke(
          'connectors:status:reconnect',
          input,
        ) as Promise<LocalConnectorReconnectActionResult>
      },
      skip(input) {
        return ipcRenderer.invoke(
          'connectors:status:skip',
          input,
        ) as Promise<LocalConnectorSkipActionResult>
      },
    },
  }
}
