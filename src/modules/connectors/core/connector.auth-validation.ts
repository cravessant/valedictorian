import type { ConnectorAuthValidationResult, ConnectorAuthValidationStatus } from '@sparxie/valedictorian-connectors-core'
import type {
  AppConnectorAuthHost,
  AppConnectorAuthValidationResult,
  AppConnectorAuthValidationStatus,
  AppConnectorRuntimePorts,
  AppJobConnector,
  ValidateConnectorAuthInput,
} from '../ports/connector.runner-contracts'
import type { ConnectorRepository } from '../ports/connector.repository.port'
import type {
  ConnectorSourceExecutionGovernor,
  ConnectorSourceSession,
} from '../ports/connector.source-execution.port'
import { createRunRuntime, redactSensitiveString } from './connector.run-runtime'
import { finalizeReconnectValidation } from './connector.auth-validation-finalization'

export async function validateConnectorAuth(
  {
    auth,
    now,
    repository,
    runtime,
    sessionExecutor,
    sourceExecutionGovernor,
    workspaceId,
  }: {
    auth: AppConnectorAuthHost | undefined
    now: () => Date
    repository: ConnectorRepository
    runtime: AppConnectorRuntimePorts
    sessionExecutor: ConnectorSourceSession | null
    sourceExecutionGovernor: ConnectorSourceExecutionGovernor | undefined
    workspaceId: string
  },
  connector: AppJobConnector,
  input: ValidateConnectorAuthInput,
): Promise<AppConnectorAuthValidationResult> {
  const connectorInstance = await repository.getInstance(input.connectorInstanceId)
  if (!connectorInstance) {
    throw new Error(`Connector instance not found: ${input.connectorInstanceId}`)
  }
  if (typeof connector.validateAuth !== 'function') {
    return {
      connectorInstanceId: input.connectorInstanceId,
      message: 'Connector auth validation is not supported.',
      reason: 'validate_auth_unsupported',
      status: 'unsupported',
    }
  }
  const sensitiveValues = new Set<string>()
  const authRequirements = connector.definition.auth?.requirements ?? []
  const initialGeneration = sourceExecutionGovernor
    ? (await sourceExecutionGovernor.getScope(connectorInstance.executionScopeId)).authGeneration : 0
  let reconnectRefreshInvoked = false
  const reconnectLease = sourceExecutionGovernor
    ? await sourceExecutionGovernor.acquireReconnectLease(connectorInstance.executionScopeId, {
        leaseMs: 60_000, now: now().toISOString(), })
    : undefined
  if (sourceExecutionGovernor && !reconnectLease) {
    return {
      connectorInstanceId: input.connectorInstanceId,
      message: authValidationMessage('retryable', 'jobright_auth_request_failed'),
      reason: 'jobright_auth_request_failed',
      status: 'retryable',
    }
  }
  const runRuntime = createRunRuntime(runtime, connectorInstance.auth, authRequirements, auth,
    sensitiveValues, connectorInstance.executionScopeId, sessionExecutor, true, runtime.progress,
    undefined, reconnectLease?.token, () => { reconnectRefreshInvoked = true })
  let result: ConnectorAuthValidationResult
  try {
    result = await connector.validateAuth(
      {
        connectorInstanceId: input.connectorInstanceId,
        executionScopeId: connectorInstance.executionScopeId,
        workspaceId,
      },
      runRuntime,
    )
  } catch (error) {
    if (isSecureStorageUnavailableError(error)) {
      await sourceExecutionGovernor?.finishReconnectValidation(connectorInstance.executionScopeId, {
        now: now().toISOString(), reason: 'secure_storage_unavailable', status: 'action_required',
        token: reconnectLease!.token,
      })
      return {
        connectorInstanceId: input.connectorInstanceId,
        message: authValidationMessage('failed', 'secure_storage_unavailable'),
        reason: 'secure_storage_unavailable',
        status: 'failed',
      }
    }
    await sourceExecutionGovernor?.finishReconnectValidation(connectorInstance.executionScopeId, {
      now: now().toISOString(), reason: 'validate_auth_failed', status: 'action_required',
      token: reconnectLease!.token,
    })
    return {
      connectorInstanceId: input.connectorInstanceId,
      message: 'Connector auth validation failed.',
      reason: 'validate_auth_failed',
      status: 'failed',
    }
  }
  const sanitized = sanitizeAuthValidationResult(input.connectorInstanceId, result, sensitiveValues)
  return finalizeReconnectValidation({
    governor: sourceExecutionGovernor, initialGeneration, now: now().toISOString(),
    refreshInvoked: reconnectRefreshInvoked, result: sanitized,
    scopeId: connectorInstance.executionScopeId, token: reconnectLease?.token,
  })
}

const allowedAuthValidationStatuses = new Set<ConnectorAuthValidationStatus>([
  'ready',
  'missing',
  'expired',
  'action_required',
  'rate_limited',
  'retryable',
  'failed',
  'cancelled',
  'invocation_timeout',
])
const allowedAuthValidationReasons = new Set([
  'auth_validation_failed',
  'jobright_auth_ready',
  'jobright_auth_request_failed',
  'jobright_auth_required',
  'jobright_login_rejected',
  'jobright_login_retryable',
  'jobright_login_schema_invalid',
  'jobright_newinfo_logined_missing',
  'jobright_newinfo_retryable',
  'jobright_newinfo_schema_invalid',
  'jobright_not_logged_in',
  'jobright_rate_limited',
  'jobright_session_cookie_missing',
  'secret_missing',
  'secret_reference_missing',
  'secure_storage_unavailable',
  'username_password_malformed',
  'username_password_missing',
  'validate_auth_failed',
  'validate_auth_unsupported',
])
function sanitizeAuthValidationResult(
  connectorInstanceId: string,
  result: ConnectorAuthValidationResult,
  sensitiveValues: Set<string>,
): AppConnectorAuthValidationResult {
  const status = allowedAuthValidationStatuses.has(result.status)
    ? result.status
    : 'failed'
  const rawReason = typeof result.reason === 'string' ? result.reason : undefined
  const redactedReason = rawReason === undefined
    ? undefined
    : redactSensitiveString(rawReason, sensitiveValues)
  const reason = redactedReason && allowedAuthValidationReasons.has(redactedReason)
    ? redactedReason
    : status === 'ready'
      ? 'jobright_auth_ready'
      : 'auth_validation_failed'
  return {
    connectorInstanceId,
    message: authValidationMessage(status, reason),
    reason,
    status,
  }
}
function isSecureStorageUnavailableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  if ('code' in error && (error as { code?: unknown }).code === 'secure_storage_unavailable') {
    return true
  }
  return error instanceof Error && error.message.includes('secure_storage_unavailable')
}
function authValidationMessage(
  status: AppConnectorAuthValidationStatus,
  reason: string,
): string {
  if (status === 'ready') {
    return 'Connector credentials are verified and ready.'
  }
  if (reason === 'secure_storage_unavailable') {
    return 'Secure storage is unavailable. Enable platform encryption, then try again.'
  }
  if (status === 'missing' || reason === 'secret_missing' || reason === 'secret_reference_missing' || reason === 'username_password_missing') {
    return 'Connector credentials are missing. Save email and password, then validate again.'
  }
  if (status === 'expired' || reason === 'jobright_not_logged_in') {
    return 'Connector session expired. Update credentials and validate again.'
  }
  if (status === 'rate_limited' || reason === 'jobright_rate_limited') {
    return 'Jobright rate limited the auth request. Retry later.'
  }
  if (status === 'retryable' || reason === 'jobright_login_retryable' || reason === 'jobright_newinfo_retryable' || reason === 'jobright_auth_request_failed') {
    return 'Temporary Jobright request failure. Retry validation.'
  }
  if (status === 'cancelled') return 'Connector auth validation was cancelled.'
  if (status === 'invocation_timeout') return 'Connector auth validation timed out.'
  if (
    status === 'action_required'
    || reason === 'jobright_login_rejected'
    || reason === 'username_password_malformed'
    || reason === 'jobright_auth_required'
  ) {
    return 'Connector credentials were rejected. Update email and password, then validate again.'
  }
  if (status === 'unsupported') {
    return 'Connector auth validation is not supported.'
  }
  return 'Connector auth validation failed.'
}
