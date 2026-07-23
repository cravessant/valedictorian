import crypto from 'node:crypto'
import type http from 'node:http'
import {
  connectorCreateErrorBodies,
  connectorCreateErrorCodes,
  connectorCreateErrorStatusByCode,
  connectorOptionQueryErrorBodies,
  connectorOptionQueryErrorCodes,
  connectorOptionQueryErrorStatusByCode,
  connectorScheduleErrorBodies,
  connectorScheduleErrorCodes,
  connectorScheduleErrorStatusByCode,
  connectorRetirementActiveWorkConflictMessage,
  connectorRetirementActiveWorkConflictSchema,
  connectorRetirementActiveWorkConflictStatus,
  createValedictorianInternalErrorBody,
  parseValedictorianRequestId,
  profileDocumentErrorBodySchema,
  profileDocumentErrorStatusByCode,
} from '@sparxie/sdk'
import { ConnectorExecutionError } from '../modules/connectors/connector-execution.errors'
import { LifecycleHttpError } from '../runtime/local-lifecycle-methods'
import { toLocalSecretResolutionHttpFailure } from '../modules/secrets/local-secret-resolution'
import {
  LocalHttpBodyTooLargeError,
  LocalHttpValidationError,
  writeJson,
  writeNoStoreJson,
} from './local-server.http'
import { LocalWorkspaceConflictError } from './local-workspaces'

const invalidConnectorOverviewCursorBody = Object.freeze({
  code: 'invalid_connector_overview_cursor',
  message: 'Invalid connector overview cursor.',
})

const workspaceConflictBody = Object.freeze({
  message: 'Workspace registration conflicts with an existing workspace.',
})

const validationErrorBody = Object.freeze({ message: 'The request is invalid.' })
const notFoundErrorBody = Object.freeze({ message: 'The requested resource was not found.' })
const conflictErrorBody = Object.freeze({
  message: 'The request conflicts with the current state.',
})
const bodyTooLargeErrorBody = Object.freeze({ message: 'The request body is too large.' })

export interface ValedictorianHttpRequestErrorEvent {
  error: unknown
  method: string
  pathname: string
  requestId: string
}

export type ValedictorianHttpRequestErrorLogger = (
  event: ValedictorianHttpRequestErrorEvent,
) => void

export function defaultValedictorianHttpRequestErrorLogger(
  event: ValedictorianHttpRequestErrorEvent,
) {
  const { error, ...metadata } = event
  console.error('Valedictorian HTTP request failed', metadata, error)
}

export function handleHttpRequestError({
  error,
  isLocalSecretResolveRoute,
  onRequestError,
  pathname,
  request,
  response,
}: {
  error: unknown
  isLocalSecretResolveRoute: boolean
  onRequestError: ValedictorianHttpRequestErrorLogger
  pathname: string
  request: http.IncomingMessage
  response: http.ServerResponse
}) {
  if (isLocalSecretResolveRoute) {
    try {
      if (error instanceof LocalHttpValidationError) {
        writeNoStoreJson(response, 400, validationErrorBody)
        return
      }

      const failure = toLocalSecretResolutionHttpFailure(error)
      if (failure.statusCode === 500) {
        const requestId = logUnexpectedRequestError({ error, onRequestError, pathname, request })
        writeNoStoreJson(response, 500, createValedictorianInternalErrorBody(requestId))
        return
      }
      writeNoStoreJson(response, failure.statusCode, failure.body)
      return
    } catch {
      // Mapping inspection must not escape; do not re-inspect the hostile object.
      const requestId = logUnexpectedRequestError({ error, onRequestError, pathname, request })
      writeNoStoreJson(response, 500, createValedictorianInternalErrorBody(requestId))
      return
    }
  }

  let knownFailure: { body: unknown; statusCode: number } | undefined
  try {
    knownFailure = mapKnownHttpFailure(error, {
      method: request.method ?? 'UNKNOWN',
      pathname,
    })
  } catch {
    // Mapping inspection must not escape; fall through to the fixed safe 500.
    knownFailure = undefined
  }
  if (knownFailure) {
    if (knownFailure.statusCode === 500) {
      const requestId = logUnexpectedRequestError({ error, onRequestError, pathname, request })
      writeJson(
        response,
        500,
        knownFailure.body ?? createValedictorianInternalErrorBody(requestId),
      )
      return
    }
    writeJson(response, knownFailure.statusCode, knownFailure.body)
    return
  }

  const requestId = logUnexpectedRequestError({ error, onRequestError, pathname, request })
  writeJson(response, 500, createValedictorianInternalErrorBody(requestId))
}

function logUnexpectedRequestError({
  error,
  onRequestError,
  pathname,
  request,
}: {
  error: unknown
  onRequestError: ValedictorianHttpRequestErrorLogger
  pathname: string
  request: http.IncomingMessage
}) {
  const requestId = parseValedictorianRequestId(request.headers['x-request-id'])
    ?? crypto.randomUUID()
  try {
    onRequestError({
      error,
      method: request.method ?? 'UNKNOWN',
      pathname,
      requestId,
    })
  } catch {
    // A failing diagnostic sink must never replace or prevent the safe response.
  }
  return requestId
}

function mapKnownHttpFailure(
  error: unknown,
  context: { method: string; pathname: string },
): {
  body: unknown
  statusCode: number
} | undefined {
  const pathname = normalizeWorkspaceScopedPath(context.pathname)
  const code = readStringProperty(error, 'code')

  // The lifecycle facade renders its own fixed, non-leaking `{status, body}` at the composition
  // boundary (404/409/400/500); surface it verbatim.
  if (error instanceof LifecycleHttpError) {
    return { body: error.body, statusCode: error.status }
  }

  if (error instanceof LocalHttpValidationError) {
    return { body: validationErrorBody, statusCode: 400 }
  }

  if (error instanceof LocalHttpBodyTooLargeError) {
    return { body: bodyTooLargeErrorBody, statusCode: 413 }
  }

  const profileBody = profileDocumentErrorBodySchema.safeParse(readProperty(error, 'body'))
  if (isProfileDocumentRoute(pathname) && profileBody.success) {
    return {
      body: profileBody.data,
      statusCode: profileDocumentErrorStatusByCode[profileBody.data.code],
    }
  }

  if (isWorkspaceRegistrationRoute(context.method, context.pathname)
    && error instanceof LocalWorkspaceConflictError) {
    return { body: workspaceConflictBody, statusCode: 409 }
  }

  if (context.method === 'GET'
    && pathname === '/v1/connectors/overview'
    && code === invalidConnectorOverviewCursorBody.code) {
    return { body: invalidConnectorOverviewCursorBody, statusCode: 400 }
  }

  if (context.method === 'POST'
    && pathname === '/v1/connectors'
    && code
    && (connectorCreateErrorCodes as readonly string[]).includes(code)) {
    const createCode = code as keyof typeof connectorCreateErrorBodies
    return {
      body: connectorCreateErrorBodies[createCode],
      statusCode: connectorCreateErrorStatusByCode[createCode],
    }
  }

  if (isConnectorRetirementRoute(context.method, pathname)
    && code === 'connector_retirement_active_work_conflict') {
    const retirementConflict = connectorRetirementActiveWorkConflictSchema.safeParse({
      activeRuns: readProperty(error, 'activeRuns'),
      cancellationRequired: readProperty(error, 'cancellationRequired'),
      code,
      connectorInstanceId: readProperty(error, 'connectorInstanceId'),
      message: connectorRetirementActiveWorkConflictMessage,
    })
    if (!retirementConflict.success) return undefined
    return {
      body: retirementConflict.data,
      statusCode: connectorRetirementActiveWorkConflictStatus,
    }
  }

  if (
    isConnectorOptionRoute(context.method, pathname)
    && code
    && (connectorOptionQueryErrorCodes as readonly string[]).includes(code)
  ) {
    const optionCode = code as keyof typeof connectorOptionQueryErrorBodies
    return {
      body: connectorOptionQueryErrorBodies[optionCode],
      statusCode: connectorOptionQueryErrorStatusByCode[optionCode],
    }
  }

  if (
    isConnectorScheduleRoute(pathname)
    && code
    && (connectorScheduleErrorCodes as readonly string[]).includes(code)
  ) {
    const scheduleCode = code as keyof typeof connectorScheduleErrorBodies
    return {
      body: connectorScheduleErrorBodies[scheduleCode],
      statusCode: connectorScheduleErrorStatusByCode[scheduleCode],
    }
  }

  if (isConnectorRunTriggerRoute(context.method, pathname)
    && error instanceof ConnectorExecutionError
    && error.statusCode === 409) {
    return { body: conflictErrorBody, statusCode: 409 }
  }

  if (isConnectorRunTriggerRoute(context.method, pathname)
    && error instanceof ConnectorExecutionError
    && error.statusCode === 500) {
    return { body: null, statusCode: 500 }
  }

  const statusCode = readNumberProperty(error, 'statusCode')
  if (pathname.startsWith('/v1/companies/') || pathname === '/v1/companies') {
    if (statusCode === 404) return { body: notFoundErrorBody, statusCode }
    if (statusCode === 409) return { body: conflictErrorBody, statusCode }
    if (statusCode === 400) return { body: validationErrorBody, statusCode }
  }
  if (pathname.startsWith('/v1/connectors/') && statusCode === 404) {
    return { body: notFoundErrorBody, statusCode }
  }
}

function normalizeWorkspaceScopedPath(pathname: string) {
  const match = pathname.match(/^\/v1\/workspaces\/[^/]+(\/.*)$/)
  return match?.[1] ? `/v1${match[1]}` : pathname
}

function isWorkspaceRegistrationRoute(method: string, pathname: string) {
  return method === 'POST'
    && (pathname === '/v1/workspaces/open' || pathname === '/v1/workspaces/create')
}

function isProfileDocumentRoute(pathname: string) {
  return /^\/v1\/profile\/document(?:\/|$)/.test(pathname)
}

function isConnectorRetirementRoute(method: string, pathname: string) {
  return method === 'DELETE' && /^\/v1\/connectors\/[^/]+$/.test(pathname)
}

function isConnectorOptionRoute(method: string, pathname: string) {
  return method === 'POST' && /^\/v1\/connectors\/[^/]+\/options\/query$/.test(pathname)
}

function isConnectorScheduleRoute(pathname: string) {
  return /^\/v1\/connectors\/[^/]+\/schedule(?:\/|$)/.test(pathname)
}

function isConnectorRunTriggerRoute(method: string, pathname: string) {
  return method === 'POST' && /^\/v1\/connectors\/[^/]+\/runs$/.test(pathname)
}

function readProperty(value: unknown, property: string): unknown {
  if (!value || typeof value !== 'object' || !(property in value)) return undefined
  return (value as Record<string, unknown>)[property]
}

function readStringProperty(value: unknown, property: string): string | undefined {
  const propertyValue = readProperty(value, property)
  return typeof propertyValue === 'string' ? propertyValue : undefined
}

function readNumberProperty(value: unknown, property: string): number | undefined {
  const propertyValue = readProperty(value, property)
  return typeof propertyValue === 'number' ? propertyValue : undefined
}
