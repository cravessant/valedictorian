import type { ConnectorsPreloadApi } from '../ipc/connectors.preload'

export type ConnectorSettingsInstance = Awaited<ReturnType<ConnectorsPreloadApi['list']>>['items'][number]
export type ConnectorReconnectResult = Awaited<ReturnType<ConnectorsPreloadApi['status']['reconnect']>>
export type ConnectorSettingsRun = Awaited<ReturnType<ConnectorsPreloadApi['runs']['trigger']>>

export interface ConnectorSettingsDraft {
  discoveryCount: string
  maxDiscoveryPages: string
  maxDiscoveryRecords: string
  maxResolutionCount: string
  roleTerms: string
  usefulTarget: string
}

export interface ConnectorAuthCredentialDraft {
  email: string
  password: string
}

export type ConnectorAuthUiState =
  | { kind: 'idle' }
  | { kind: 'checking'; message: string }
  | { kind: 'result'; result: ConnectorReconnectResult }
  | { kind: 'cancelled'; message: string }
  | { kind: 'local'; message: string; status: 'action_required' | 'failed' }

export const secureStorageUnavailableMessage =
  'Secure storage is unavailable. Enable platform encryption, then try again.'
