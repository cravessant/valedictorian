import {
  canonicalAlreadyConfiguredBody,
  classifyErrorPresentation,
  isCanonicalAlreadyConfigured,
} from '../app/error-presentation'
import { ValedictorianHttpError, ValedictorianTransportError } from 'sparxie'
import { JOBRIGHT_CONNECTOR_ID } from '../modules/connectors/jobright.constants'
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
  if (state.kind === 'checking' || state.kind === 'local') {
    return state.message
  }

  if (state.kind === 'result') {
    return state.result.message
  }

  return null
}

export function sanitizedConnectorAuthErrorMessage(error: unknown): string {
  if (isSecureStorageUnavailableError(error)) {
    return secureStorageUnavailableMessage
  }

  if (isConnectorServiceUnavailableError(error)) {
    return 'Jobright validation could not start because the connector service is unavailable. Restart the app, then try again.'
  }

  return 'Jobright validation could not start. Try again; if it keeps failing, restart the app.'
}

export type JobrightCredentialActionStage = 'saving' | 'attaching' | 'validating'

export function sanitizedJobrightCredentialActionErrorMessage(
  stage: JobrightCredentialActionStage,
  error: unknown,
): string {
  if (stage === 'saving') {
    return isSecureStorageUnavailableError(error)
      ? 'Credentials were not saved because secure storage is unavailable. Enable platform encryption, then try again.'
      : 'Credentials were not saved. The secure credential store did not accept the update. Restart the app, then try again.'
  }

  if (stage === 'attaching') {
    return 'Credentials were saved securely, but the connector could not be linked to them. Select Update credentials and try again.'
  }

  if (isSecureStorageUnavailableError(error)) {
    return 'Credentials were saved and linked, but validation could not read them because secure storage is unavailable. Enable platform encryption, then select Validate.'
  }

  if (isConnectorServiceUnavailableError(error)) {
    return 'Credentials were saved and linked, but validation could not start because the connector service is unavailable. Restart the app, then select Validate.'
  }

  return 'Credentials were saved and linked, but validation could not start. Select Validate to retry; if it fails again, restart the app.'
}

export function sanitizedConnectorCreateErrorMessage(error: unknown): string {
  if (isCanonicalAlreadyConfigured(error)) {
    return 'Jobright is already configured. Reload connector state and manage the existing instance.'
  }

  if (
    error instanceof ValedictorianHttpError
    && (error.status === 400 || error.status === 422 || error.kind === 'validation')
  ) {
    return 'Jobright configuration was rejected. Review the connector fields and try again.'
  }

  if (
    error instanceof ValedictorianTransportError
    || (error instanceof ValedictorianHttpError && (
      error.kind === 'unavailable'
      || error.status === 502
      || error.status === 503
      || error.status === 504
    ))
  ) {
    return 'The workspace backend is unavailable. Restore it, then retry connector loading.'
  }

  const presentation = classifyErrorPresentation(error, {
    scope: 'form',
    trigger: 'save',
  })
  return presentation.message === 'An unexpected error occurred.'
    || presentation.message === canonicalAlreadyConfiguredBody.message
    ? 'The connector action was rejected. Reload connector state before trying again.'
    : presentation.message
}

export function defaultConnectorSettingsDraft(
  instance: ConnectorSettingsInstance | undefined,
): ConnectorSettingsDraft {
  const filters = { ...recordFromUnknown(instance?.filters) }
  if (instance?.connectorId === JOBRIGHT_CONNECTOR_ID && filters.country === undefined) {
    filters.country = 'US'
  }
  return {
    config: { ...recordFromUnknown(instance?.config) },
    enabled: instance?.enabled ?? true,
    earliestBackfillDate: instance?.earliestBackfillDate ?? '',
    filters,
  }
}

export function isUnchangedConnectorDisable(
  instance: ConnectorSettingsInstance,
  draft: ConnectorSettingsDraft,
): boolean {
  const saved = defaultConnectorSettingsDraft(instance)
  return instance.enabled
    && !draft.enabled
    && JSON.stringify(draft.config) === JSON.stringify(saved.config)
    && draft.earliestBackfillDate === saved.earliestBackfillDate
    && JSON.stringify(draft.filters) === JSON.stringify(saved.filters)
}

export function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function isSecureStorageUnavailableError(error: unknown): boolean {
  if (
    error
    && typeof error === 'object'
    && 'code' in error
    && (error as { code?: unknown }).code === 'secure_storage_unavailable'
  ) {
    return true
  }

  return error instanceof Error && error.message.includes('secure_storage_unavailable')
}

function isConnectorServiceUnavailableError(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true
  }

  const candidate = error && typeof error === 'object'
    ? error as { code?: unknown; status?: unknown; statusCode?: unknown }
    : {}
  const status = typeof candidate.status === 'number'
    ? candidate.status
    : candidate.statusCode
  if (
    status === 502
    || status === 503
    || status === 504
    || candidate.code === 'backend_unavailable'
  ) {
    return true
  }

  const message = error instanceof Error ? error.message.toLowerCase() : ''
  return message.includes('workspace backend unavailable')
    || message.includes('connector status actions are unavailable')
    || message.includes('connector reconnect is unavailable')
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
