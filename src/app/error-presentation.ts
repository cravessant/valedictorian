import {
  ConnectorScheduleHttpError,
  ValedictorianHttpError,
  ValedictorianProtocolError,
  ValedictorianTransportError,
  valedictorianFailureKindMessages,
  type ValedictorianFailureKind,
} from '@sparxie/sdk'

export type ErrorPresentationSurface =
  | 'field'
  | 'form'
  | 'action_toast'
  | 'scoped_load'
  | 'stale_refresh'
  | 'global'
  | 'authentication'
  | 'background'
  | 'none'

export type ErrorPresentationScope =
  | 'field'
  | 'form'
  | 'section'
  | 'page'
  | 'global'
  | 'background'

export type ErrorPresentationTrigger =
  | 'client_validation'
  | 'save'
  | 'load'
  | 'refresh'
  | 'action'
  | 'auth'
  | 'cancel'
  | 'background'

export interface ErrorPresentationContext {
  hasStaleData?: boolean
  operationId?: string
  scope: ErrorPresentationScope
  trigger: ErrorPresentationTrigger
}

export interface ErrorPresentation {
  message: string
  operationId?: string
  retryable: boolean
  surface: ErrorPresentationSurface
  title: string
}

const safeFallbackMessage = valedictorianFailureKindMessages.internal
const alreadyConfiguredMessage = 'This connector is already configured.'
/** Canonical closed already_configured body from the local error boundary. */
export const canonicalAlreadyConfiguredBody = Object.freeze({
  code: 'already_configured' as const,
  message: 'This connector is already configured. Manage the existing instance.',
})
const fieldValidationMessage = 'This field is invalid.'

const surfaceTitles: Record<ErrorPresentationSurface, string> = {
  action_toast: 'Action failed',
  authentication: 'Authentication required',
  background: 'Background update',
  field: 'Invalid field',
  form: 'Could not save',
  global: 'Service unavailable',
  none: '',
  scoped_load: 'Load failed',
  stale_refresh: 'Refresh failed',
}

export function classifyErrorPresentation(
  error: unknown,
  context: ErrorPresentationContext,
): ErrorPresentation {
  if (context.trigger === 'cancel' || isAbortError(error)) {
    return presentation('none', '', false, context.operationId)
  }

  const message = safePublicMessage(error, context)
  const retryable = isRetryableFailure(error, context)

  if (context.trigger === 'client_validation' || context.scope === 'field') {
    return presentation('field', message === safeFallbackMessage ? fieldValidationMessage : message, false, context.operationId)
  }

  if (isAuthenticationFailure(error) || context.trigger === 'auth') {
    const retryable = context.trigger === 'load' || context.trigger === 'refresh'
    return presentation('authentication', message, retryable, context.operationId)
  }

  if (context.trigger === 'background' || context.scope === 'background') {
    return presentation('background', message, retryable, context.operationId)
  }

  if (context.trigger === 'action') {
    return presentation('action_toast', message, retryable, context.operationId)
  }

  if (context.trigger === 'save' || context.scope === 'form') {
    return presentation('form', message, retryable, context.operationId)
  }

  if (
    context.scope === 'global'
    || error instanceof ValedictorianTransportError
  ) {
    return presentation('global', message, retryable, context.operationId)
  }

  if (context.trigger === 'refresh' && context.hasStaleData) {
    return presentation('stale_refresh', message, retryable, context.operationId)
  }

  if (isGlobalUnavailability(error, context)) {
    return presentation('global', message, retryable, context.operationId)
  }

  return presentation('scoped_load', message, retryable, context.operationId)
}

export function safePublicErrorMessage(
  error: unknown,
): string {
  return safePublicMessage(error, {
    scope: 'page',
    trigger: 'action',
  })
}

export function actionFailureToastInput(
  error: unknown,
  {
    fallbackMessage,
    operationId,
  }: {
    fallbackMessage: string
    operationId: string
  },
) {
  const presentation = classifyErrorPresentation(error, {
    operationId,
    scope: 'page',
    trigger: 'action',
  })
  return {
    description: presentation.message === safeFallbackMessage
      ? fallbackMessage
      : presentation.message,
    operationId: presentation.operationId,
    title: presentation.title,
    variant: 'destructive' as const,
  }
}

function presentation(
  surface: ErrorPresentationSurface,
  message: string,
  retryable: boolean,
  operationId?: string,
): ErrorPresentation {
  return {
    message,
    ...(operationId !== undefined ? { operationId } : {}),
    retryable,
    surface,
    title: surfaceTitles[surface],
  }
}

function safePublicMessage(error: unknown, _context: ErrorPresentationContext): string {
  if (isCanonicalAlreadyConfigured(error)) {
    return alreadyConfiguredMessage
  }

  if (error instanceof ConnectorScheduleHttpError) {
    return error.body.message
  }

  if (error instanceof ValedictorianHttpError) {
    if (error.kind) {
      return valedictorianFailureKindMessages[error.kind]
    }
    return safeFallbackMessage
  }

  if (error instanceof ValedictorianTransportError) {
    return valedictorianFailureKindMessages.unavailable
  }

  if (error instanceof ValedictorianProtocolError) {
    return valedictorianFailureKindMessages.internal
  }

  return safeFallbackMessage
}

function isAuthenticationFailure(error: unknown): boolean {
  return error instanceof ValedictorianHttpError
    && (error.kind === 'authentication' || error.status === 401)
}

function isGlobalUnavailability(error: unknown, context: ErrorPresentationContext): boolean {
  if (
    context.scope === 'field'
    || context.scope === 'form'
    || context.scope === 'background'
  ) {
    return false
  }
  return error instanceof ValedictorianTransportError
    || (error instanceof ValedictorianHttpError && (
      error.kind === 'unavailable'
      || error.status === 503
      || error.status === 502
      || error.status === 504
    ))
}

function isRetryableFailure(error: unknown, context: ErrorPresentationContext): boolean {
  if (isCanonicalAlreadyConfigured(error)) {
    return false
  }

  if (error instanceof ConnectorScheduleHttpError) {
    return error.code === 'stale_schedule_revision'
      || error.code === 'connector_scheduling_unavailable'
      || error.code === 'schedule_dispatch_conflict'
  }

  if (error instanceof TypeError) {
    return context.trigger === 'load' || context.trigger === 'refresh'
  }

  if (error instanceof ValedictorianTransportError) return true
  if (error instanceof ValedictorianProtocolError) {
    return context.trigger === 'load' || context.trigger === 'refresh'
  }

  if (error instanceof ValedictorianHttpError) {
    if (error.status === 409 && !error.kind) return false
    const kind: ValedictorianFailureKind | undefined = error.kind
    if (kind === 'unavailable' || kind === 'rate_limit' || kind === 'conflict') return true
    if (error.status >= 500 || error.status === 429) return true
  }

  return false
}

/**
 * Fail-closed already_configured recognition: only a schema-validated closed
 * payload on ValedictorianHttpError with status 409.
 */
export function isCanonicalAlreadyConfigured(error: unknown): boolean {
  if (!(error instanceof ValedictorianHttpError)) return false
  if (error.status !== 409) return false
  return isCanonicalAlreadyConfiguredBody(error.body)
}

export function isCanonicalAlreadyConfiguredBody(body: unknown): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false
  const keys = Object.keys(body)
  if (keys.length !== 2) return false
  const candidate = body as { code?: unknown; message?: unknown }
  return candidate.code === canonicalAlreadyConfiguredBody.code
    && candidate.message === canonicalAlreadyConfiguredBody.message
}

/** Present a page/section load failure with classifier surfaces intact. */
export function presentLoadFailure(
  error: unknown,
  context: Omit<ErrorPresentationContext, 'scope'> & {
    fallbackMessage?: string
    scope?: ErrorPresentationScope
  },
): ErrorPresentation {
  const presentation = classifyErrorPresentation(error, {
    ...context,
    scope: context.scope ?? 'page',
    trigger: context.trigger,
  })
  if (
    context.fallbackMessage
    && presentation.message === safeFallbackMessage
    && presentation.surface !== 'authentication'
    && presentation.surface !== 'global'
  ) {
    return { ...presentation, message: context.fallbackMessage }
  }
  return presentation
}

/** Drop cancellation/`none` presentations so owners never store them as truthy load failures. */
export function ownedLoadFailure(
  failure: ErrorPresentation | null | undefined,
): ErrorPresentation | null {
  if (!failure || failure.surface === 'none' || !failure.message) {
    return null
  }
  return failure
}

function isAbortError(error: unknown): boolean {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return error.name === 'AbortError'
  }
  return error instanceof Error && error.name === 'AbortError'
}
