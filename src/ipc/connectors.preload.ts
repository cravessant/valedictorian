import type { ConnectorStatusListResult } from '../modules/connectors/connector.status'
import type {
  ConnectorInstanceSummary,
  ConnectorInstancesListResult,
  ConnectorRunsListInput,
  ConnectorRunsListResult,
  ConnectorRunSummary,
  ConnectorStatusSummary,
  CreateConnectorInstanceInput,
  TriggerConnectorRunInput,
  UpdateConnectorInstanceInput,
} from 'sparxie'
import { connectorRunSummarySchema, connectorRunsListResultSchema } from 'sparxie'
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
  list: () => Promise<ConnectorInstancesListResult>
  create: (input: CreateConnectorInstanceInput) => Promise<ConnectorInstanceSummary>
  update: (input: UpdateConnectorInstanceInput) => Promise<ConnectorInstanceSummary>
  inspect: (connectorInstanceId: string) => Promise<ConnectorStatusSummary>
  runs: {
    list: (input: ConnectorRunsListInput) => Promise<ConnectorRunsListResult>
    trigger: (input: TriggerConnectorRunInput) => Promise<ConnectorRunSummary>
  }
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
    list() {
      return ipcRenderer.invoke('connectors:list') as Promise<ConnectorInstancesListResult>
    },
    create(input) {
      return ipcRenderer.invoke('connectors:create', input) as Promise<ConnectorInstanceSummary>
    },
    update(input) {
      return ipcRenderer.invoke('connectors:update', input) as Promise<ConnectorInstanceSummary>
    },
    inspect(connectorInstanceId) {
      return ipcRenderer.invoke('connectors:inspect', connectorInstanceId) as Promise<ConnectorStatusSummary>
    },
    runs: {
      list(input) {
        return ipcRenderer.invoke('connectors:runs:list', input)
          .then((value) => connectorRunsListResultSchema.parse(value))
      },
      trigger(input) {
        return ipcRenderer.invoke('connectors:runs:trigger', input)
          .then((value) => connectorRunSummarySchema.parse(value))
      },
    },
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
