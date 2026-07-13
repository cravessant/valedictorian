import type {
  ConnectorInstanceSummary,
  ConnectorInstancesListResult,
  ConnectorRetirementResult,
  ConnectorRunsListInput,
  ConnectorRunsListResult,
  ConnectorRunSummary,
  ConnectorStatusSummary,
  CreateConnectorInstanceInput,
  RemoveConnectorInstanceInput,
  UpdateConnectorInstanceInput,
} from 'sparxie'
import {
  ConnectorRetirementConflictError,
  connectorRunSummarySchema,
  connectorRunsListResultSchema,
} from 'sparxie'
import type {
  LocalConnectorReconnectActionResult,
  LocalConnectorRunTriggerInput,
  LocalConnectorSkipActionInput,
  LocalConnectorStatusActionInput,
} from '../runtime/local-valedictorian-client'
import {
  publicConnectorSkipActionResult,
  parseConnectorRetirementIpcEnvelope,
  type ConnectorSkipActionResult,
} from './connectors.public'

interface IpcRendererLike {
  invoke: (channel: string, input?: unknown) => Promise<unknown>
}

export interface ConnectorsPreloadApi {
  list: () => Promise<ConnectorInstancesListResult>
  create: (input: CreateConnectorInstanceInput) => Promise<ConnectorInstanceSummary>
  update: (input: UpdateConnectorInstanceInput) => Promise<ConnectorInstanceSummary>
  remove: (input: RemoveConnectorInstanceInput) => Promise<ConnectorRetirementResult>
  inspect: (connectorInstanceId: string) => Promise<ConnectorStatusSummary>
  runs: {
    list: (input: ConnectorRunsListInput) => Promise<ConnectorRunsListResult>
    trigger: (input: LocalConnectorRunTriggerInput) => Promise<ConnectorRunSummary>
  }
  status: {
    reconnect: (
      input: LocalConnectorStatusActionInput
    ) => Promise<LocalConnectorReconnectActionResult>
    skip: (input: LocalConnectorSkipActionInput) => Promise<ConnectorSkipActionResult>
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
    remove(input) {
      return ipcRenderer.invoke('connectors:remove', input)
        .then(parseConnectorRetirementIpcEnvelope)
        .then((envelope) => {
          if (envelope.kind === 'conflict') {
            throw new ConnectorRetirementConflictError(envelope.conflict)
          }
          return envelope.result
        })
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
        ).then(publicConnectorSkipActionResult)
      },
    },
  }
}
