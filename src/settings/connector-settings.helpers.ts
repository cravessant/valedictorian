import {
  JOBRIGHT_CONNECTOR_ID,
  JOBRIGHT_DEFAULT_DISCOVERY_COUNT,
} from '../modules/connectors/jobright.constants'
import type {
  ConnectorAuthUiState,
  ConnectorSettingsDraft,
  ConnectorSettingsInstance,
} from './connector-settings.types'
import { secureStorageUnavailableMessage } from './connector-settings.types'

export function jobrightSecretKeyForInstance(instanceId: string): string {
  const normalizedInstanceId = instanceId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

  return `connector_jobright_credentials_${normalizedInstanceId || 'default'}`
}

export function isJobrightCredentialsConfigured(instance: ConnectorSettingsInstance): boolean {
  if (instance.connectorId === JOBRIGHT_CONNECTOR_ID) {
    return instance.auth.some((auth) =>
      auth.mode === 'username_password' && auth.configured)
  }

  return instance.auth.some((auth) => auth.configured)
}

export function shouldAutoValidateJobrightAuth(instance: ConnectorSettingsInstance): boolean {
  return instance.connectorId === JOBRIGHT_CONNECTOR_ID
    && isJobrightCredentialsConfigured(instance)
}

export function isConnectorAuthReady(state: ConnectorAuthUiState): boolean {
  return state.kind === 'result' && state.result.status === 'ready'
}

export function connectorAuthStatusLabel(
  state: ConnectorAuthUiState,
  authConfigured: boolean,
): string {
  if (state.kind === 'checking') {
    return 'Checking auth...'
  }

  if (state.kind === 'cancelled') {
    return 'Auth cancelled'
  }

  if (state.kind === 'result') {
    if (state.result.status === 'ready') {
      return 'Auth verified'
    }

    if (state.result.status === 'missing') {
      return 'Auth missing'
    }

    if (state.result.status === 'expired') {
      return 'Auth expired'
    }

    if (state.result.reason === 'secure_storage_unavailable') {
      return 'Auth failed'
    }

    return 'Auth required'
  }

  if (state.kind === 'local') {
    return state.status === 'failed' ? 'Auth failed' : 'Auth required'
  }

  return authConfigured ? 'Credentials stored' : 'Auth required'
}

export function connectorAuthStatusMessage(state: ConnectorAuthUiState): string | null {
  if (state.kind === 'checking' || state.kind === 'cancelled' || state.kind === 'local') {
    return state.message
  }

  if (state.kind === 'result') {
    return state.result.message
  }

  return null
}

export function sanitizedConnectorAuthErrorMessage(error: unknown): string {
  if (
    error
    && typeof error === 'object'
    && 'code' in error
    && (error as { code?: unknown }).code === 'secure_storage_unavailable'
  ) {
    return secureStorageUnavailableMessage
  }

  if (error instanceof Error && error.message.includes('secure_storage_unavailable')) {
    return secureStorageUnavailableMessage
  }

  return 'Jobright credentials could not be validated.'
}

export function defaultConnectorSettingsDraft(
  instance: ConnectorSettingsInstance | undefined,
): ConnectorSettingsDraft {
  const config = recordFromUnknown(instance?.config)

  return {
    discoveryCount: String(numberFromUnknown(config.discoveryCount, JOBRIGHT_DEFAULT_DISCOVERY_COUNT)),
    earliestBackfillDate: instance?.earliestBackfillDate ?? '',
  }
}

export function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function stringFromUnknown(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function numberFromUnknown(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}


export function parseBoundedInteger(value: string, minimum: number, maximum: number): number | null {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) {
    return null
  }

  const parsed = Number(trimmed)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    return null
  }

  return parsed
}
