import type { ConnectorsPreloadApi } from '../ipc/connectors.preload'
import type { ValedictorianWorkspaceClient } from 'sparxie'

export type ConnectorSettingsUiApi = ConnectorsPreloadApi & Partial<Pick<
  ValedictorianWorkspaceClient['connectors'],
  'descriptors' | 'options'
>>

export type ConnectorSettingsInstance = Awaited<ReturnType<ConnectorsPreloadApi['list']>>['items'][number]
export type ConnectorReconnectResult = Awaited<ReturnType<ConnectorsPreloadApi['status']['reconnect']>>
export type ConnectorSettingsRun = Awaited<ReturnType<ConnectorsPreloadApi['runs']['trigger']>>

export interface ConnectorSettingsDraft {
  config: Record<string, unknown>
  enabled: boolean
  earliestBackfillDate: string
  filters: Record<string, unknown>
}

export interface ConnectorAuthCredentialDraft {
  email: string
  password: string
}

export type ConnectorAuthUiState =
  | { kind: 'idle' }
  | { kind: 'checking'; message: string }
  | { kind: 'result'; result: ConnectorReconnectResult }
  | { kind: 'local'; message: string; status: 'action_required' | 'failed' }

export const secureStorageUnavailableMessage =
  'Secure storage is unavailable. Enable platform encryption, then try again.'
