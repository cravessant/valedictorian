import {
  canonicalDateOnlySchema,
  sourceOperationOutcomeSchema,
  type ConnectorHistoricalBackfillState,
  type ConnectorNewestFrontierState,
  type SourceOperationOutcome,
} from "@sparxie/sdk"

/**
 * Closed warning codes and copy that are safe to persist or expose to an app.
 * Provider bodies, host grant reasons, and caught exception messages are
 * diagnostic evidence and must never be interpolated into these warnings.
 */
export const connectorRefreshWarningMessages = {
  "auth.required":
    "Connector authentication is required before capture can continue.",
  "auth.runtime_failed":
    "Connector authentication could not be checked. Retry later.",
  "connector.configuration_invalid":
    "Connector configuration is invalid.",
  "connector.execution_failed":
    "Connector execution failed before completion.",
  "connector.operation_timed_out":
    "A bounded connector operation timed out. The checkpoint was preserved.",
  "connector.progress_reporting_failed":
    "Connector progress reporting failed. Capture continued.",
  "source.capture_failed":
    "The connector could not durably acknowledge every captured source row.",
  "source.capture_retry_deferred":
    "Connector capture retry is deferred by bounded backoff.",
  "source.capture_retry_exhausted":
    "Connector capture reached its bounded retry limit.",
  "source.capture_unavailable":
    "Durable connector source intake is unavailable.",
  "source.captcha":
    "The connector source requires manual verification.",
  "source.cursor_not_advancing":
    "The connector source cursor did not advance. The checkpoint was preserved.",
  "source.failed":
    "The connector source request failed.",
  "source.rate_limited":
    "The connector source rate limited capture. Retry after the supplied delay.",
  "source.retryable":
    "The connector source is temporarily unavailable. Retry later.",
  "parser.changed":
    "The connector source schema changed and the parser needs review.",
  "source.synchronization_not_advancing":
    "Connector synchronization did not advance. The checkpoint was preserved.",
} as const

export type ConnectorRefreshWarningCode =
  keyof typeof connectorRefreshWarningMessages

export type ConnectorRefreshWarning = {
  [Code in ConnectorRefreshWarningCode]: {
    code: Code
    message: (typeof connectorRefreshWarningMessages)[Code]
  }
}[ConnectorRefreshWarningCode]

export function connectorRefreshWarning(
  code: ConnectorRefreshWarningCode,
): ConnectorRefreshWarning {
  return {
    code,
    message: connectorRefreshWarningMessages[code],
  } as ConnectorRefreshWarning
}

/** Runtime validation for warning data crossing an adapter boundary. */
export function sanitizeConnectorRefreshWarnings(
  value: unknown,
): ConnectorRefreshWarning[] {
  if (!Array.isArray(value)) {
    return [connectorRefreshWarning("connector.execution_failed")]
  }
  const codes = new Set<ConnectorRefreshWarningCode>()
  for (const item of value) {
    const code = warningCode(item)
    codes.add(code ?? "connector.execution_failed")
  }
  return [...codes].map(connectorRefreshWarning)
}

function warningCode(value: unknown): ConnectorRefreshWarningCode | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const code = (value as { code?: unknown }).code
  return typeof code === "string" &&
    Object.hasOwn(connectorRefreshWarningMessages, code)
    ? code as ConnectorRefreshWarningCode
    : null
}

/** Closed, app-safe reason facts for connector authentication outcomes. */
export type ConnectorAuthOutcomeReason =
  | "auth_validation_failed"
  | "jobright_auth_ready"
  | "jobright_auth_request_failed"
  | "jobright_auth_required"
  | "jobright_login_rejected"
  | "jobright_login_retryable"
  | "jobright_login_schema_invalid"
  | "jobright_newinfo_logined_missing"
  | "jobright_newinfo_retryable"
  | "jobright_newinfo_schema_invalid"
  | "jobright_not_logged_in"
  | "jobright_rate_limited"
  | "jobright_session_cookie_missing"
  | "secret_missing"
  | "secret_reference_missing"
  | "username_password_malformed"
  | "username_password_missing"
  | "validate_auth_failed"

export type ConnectorAuthValidationStatus =
  | "action_required"
  | "cancelled"
  | "expired"
  | "failed"
  | "invocation_timeout"
  | "missing"
  | "rate_limited"
  | "ready"
  | "retryable"

export type SanitizedConnectorAuthValidationResult = {
  status: ConnectorAuthValidationStatus
  reason: ConnectorAuthOutcomeReason
}

/** Runtime validation for auth data crossing an adapter boundary. */
export function sanitizeConnectorAuthValidationResult(
  value: unknown,
): SanitizedConnectorAuthValidationResult {
  const status = authValidationStatus(value)
  const reason = authValidationReason(value, status)
  return { status, reason }
}

function authValidationStatus(value: unknown): ConnectorAuthValidationStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "failed"
  }
  const status = (value as { status?: unknown }).status
  const statuses = new Set<ConnectorAuthValidationStatus>([
    "action_required",
    "cancelled",
    "expired",
    "failed",
    "invocation_timeout",
    "missing",
    "rate_limited",
    "ready",
    "retryable",
  ])
  return statuses.has(status as ConnectorAuthValidationStatus)
    ? status as ConnectorAuthValidationStatus
    : "failed"
}

const authReasonsByStatus = {
  ready: new Set<ConnectorAuthOutcomeReason>(["jobright_auth_ready"]),
  missing: new Set<ConnectorAuthOutcomeReason>([
    "secret_missing",
    "secret_reference_missing",
    "username_password_missing",
  ]),
  expired: new Set<ConnectorAuthOutcomeReason>(["jobright_not_logged_in"]),
  action_required: new Set<ConnectorAuthOutcomeReason>([
    "jobright_auth_required",
    "jobright_login_rejected",
    "jobright_newinfo_logined_missing",
    "jobright_session_cookie_missing",
    "username_password_malformed",
  ]),
  rate_limited: new Set<ConnectorAuthOutcomeReason>(["jobright_rate_limited"]),
  retryable: new Set<ConnectorAuthOutcomeReason>([
    "jobright_auth_request_failed",
    "jobright_login_retryable",
    "jobright_newinfo_retryable",
  ]),
  failed: new Set<ConnectorAuthOutcomeReason>([
    "auth_validation_failed",
    "jobright_login_schema_invalid",
    "jobright_newinfo_schema_invalid",
    "validate_auth_failed",
  ]),
  cancelled: new Set<ConnectorAuthOutcomeReason>(["jobright_auth_request_failed"]),
  invocation_timeout: new Set<ConnectorAuthOutcomeReason>([
    "jobright_auth_request_failed",
  ]),
} satisfies Record<ConnectorAuthValidationStatus, Set<ConnectorAuthOutcomeReason>>

const fallbackAuthReasonByStatus = {
  ready: "jobright_auth_ready",
  missing: "username_password_missing",
  expired: "jobright_not_logged_in",
  action_required: "jobright_auth_required",
  rate_limited: "jobright_rate_limited",
  retryable: "jobright_auth_request_failed",
  failed: "auth_validation_failed",
  cancelled: "jobright_auth_request_failed",
  invocation_timeout: "jobright_auth_request_failed",
} as const satisfies Record<ConnectorAuthValidationStatus, ConnectorAuthOutcomeReason>

function authValidationReason(
  value: unknown,
  status: ConnectorAuthValidationStatus,
): ConnectorAuthOutcomeReason {
  const reason = value && typeof value === "object" && !Array.isArray(value)
    ? (value as { reason?: unknown }).reason
    : null
  return typeof reason === "string" &&
      authReasonsByStatus[status].has(reason as ConnectorAuthOutcomeReason)
    ? reason as ConnectorAuthOutcomeReason
    : fallbackAuthReasonByStatus[status]
}

/** Closed, app-safe reason facts for provider URL resolver outcomes. */
export type ConnectorProviderUrlResolverReason =
  | "authentication_failed"
  | "authentication_required"
  | "destination_unavailable"
  | "operation_timeout"
  | "provider_record_invalid"
  | "provider_internal_destination"
  | "provider_request_failed"
  | "provider_schema_changed"
  | "provider_status_terminal"
  | "rate_limited"
  | "retryable_failure"

/** Closed terminal/resumable reason projected into refresh statistics. */
export type ConnectorRefreshStopReason =
  | "authentication_required"
  | "cancelled"
  | "challenge_required"
  | "continuing"
  | "coverage_exhausted"
  | "failed"
  | "rate_limited"
  | "retryable_failure"
  | "runtime_limit"
  | "source_exhausted"

const connectorRefreshStopReasons = new Set<ConnectorRefreshStopReason>([
  "authentication_required",
  "cancelled",
  "challenge_required",
  "continuing",
  "coverage_exhausted",
  "failed",
  "rate_limited",
  "retryable_failure",
  "runtime_limit",
  "source_exhausted",
])

export function sanitizeConnectorRefreshStopReason(
  value: unknown,
): ConnectorRefreshStopReason {
  return connectorRefreshStopReasons.has(value as ConnectorRefreshStopReason)
    ? value as ConnectorRefreshStopReason
    : "failed"
}

export type ConnectorSynchronizationFailedReason =
  | "connector_execution_failed"
  | "source_challenge_required"
  | "source_cursor_not_advancing"

export type ConnectorSynchronizationCancelledReason = "cancelled"

/** Closed connector-side refinement of Sparxie's synchronization shape. */
export type ConnectorSynchronizationOutcome =
  | { kind: "in_progress" }
  | { kind: "failed"; reason: ConnectorSynchronizationFailedReason }
  | { kind: "cancelled"; reason: ConnectorSynchronizationCancelledReason }
  | { kind: "yielded"; reason: "invocation_budget" | "operation_timeout" }
  | { kind: "caught_up" }
  | {
      kind: "cooling_down"
      operation: Extract<SourceOperationOutcome, { kind: "scope_rate_limited" }>
    }
  | {
      kind: "action_required"
      operation: Extract<SourceOperationOutcome, { kind: "authentication_expired" }>
    }
  | { kind: "boundary_exhausted" }
  | { kind: "source_exhausted" }

export type ConnectorSynchronization = {
  newestFrontier: ConnectorNewestFrontierState
  historicalBackfill: ConnectorHistoricalBackfillState
  pendingResolutionCount: number
  outcome: ConnectorSynchronizationOutcome
}

export function sanitizeConnectorSynchronization(
  value: unknown,
): ConnectorSynchronization {
  const record = isRecord(value) ? value : {}
  return reconcileConnectorSynchronization({
    newestFrontier: sanitizeNewestFrontier(record.newestFrontier),
    historicalBackfill: sanitizeHistoricalBackfill(record.historicalBackfill),
    pendingResolutionCount: nonNegativeInteger(record.pendingResolutionCount),
    outcome: sanitizeConnectorSynchronizationOutcome(record.outcome),
  })
}

export function sanitizeConnectorBoundaryDate(value: unknown): string {
  const candidate = typeof value === "string" ? value.slice(0, 10) : null
  const parsed = canonicalDateOnlySchema.safeParse(candidate)
  return parsed.success ? parsed.data : "1970-01-01"
}

export function sanitizeConnectorSynchronizationOutcome(
  value: unknown,
): ConnectorSynchronizationOutcome {
  if (!isRecord(value)) {
    return { kind: "failed", reason: "connector_execution_failed" }
  }
  if (value.kind === "failed") {
    const reasons = new Set<ConnectorSynchronizationFailedReason>([
      "connector_execution_failed",
      "source_challenge_required",
      "source_cursor_not_advancing",
    ])
    return {
      kind: "failed",
      reason: reasons.has(value.reason as ConnectorSynchronizationFailedReason)
        ? value.reason as ConnectorSynchronizationFailedReason
        : "connector_execution_failed",
    }
  }
  if (value.kind === "cancelled") return { kind: "cancelled", reason: "cancelled" }
  if (value.kind === "yielded") {
    return {
      kind: "yielded",
      reason: value.reason === "operation_timeout"
        ? "operation_timeout"
        : "invocation_budget",
    }
  }
  if (
    value.kind === "in_progress" || value.kind === "caught_up" ||
    value.kind === "boundary_exhausted" || value.kind === "source_exhausted"
  ) {
    return { kind: value.kind }
  }
  const operation = sourceOperationOutcomeSchema.safeParse(value.operation)
  if (
    value.kind === "cooling_down" && operation.success &&
    operation.data.kind === "scope_rate_limited"
  ) {
    return { kind: "cooling_down", operation: operation.data }
  }
  if (
    value.kind === "action_required" && operation.success &&
    operation.data.kind === "authentication_expired"
  ) {
    return { kind: "action_required", operation: operation.data }
  }
  return { kind: "failed", reason: "connector_execution_failed" }
}

function sanitizeNewestFrontier(value: unknown): ConnectorNewestFrontierState {
  if (!isRecord(value)) return { state: "not_started" }
  return value.state === "advancing" || value.state === "caught_up"
    ? { state: value.state }
    : { state: "not_started" }
}

function sanitizeHistoricalBackfill(
  value: unknown,
): ConnectorHistoricalBackfillState {
  const record = isRecord(value) ? value : {}
  const boundary = {
    earliestDate: sanitizeConnectorBoundaryDate(
      isRecord(record.boundary) ? record.boundary.earliestDate : null,
    ),
  }
  if (
    record.state === "advancing" || record.state === "caught_up" ||
    record.state === "boundary_reached" || record.state === "source_exhausted"
  ) {
    return { state: record.state, boundary }
  }
  return { state: "not_started", boundary }
}

function reconcileConnectorSynchronization(
  value: ConnectorSynchronization,
): ConnectorSynchronization {
  if (value.outcome.kind === "caught_up") {
    return {
      ...value,
      newestFrontier: { state: "caught_up" },
      historicalBackfill: {
        ...value.historicalBackfill,
        state: "caught_up",
      },
      pendingResolutionCount: 0,
    }
  }
  if (value.outcome.kind === "boundary_exhausted") {
    return {
      ...value,
      historicalBackfill: {
        ...value.historicalBackfill,
        state: "boundary_reached",
      },
    }
  }
  if (value.outcome.kind === "source_exhausted") {
    return {
      ...value,
      historicalBackfill: {
        ...value.historicalBackfill,
        state: "source_exhausted",
      },
    }
  }
  const fullyCaughtUp = value.newestFrontier.state === "caught_up" &&
    value.historicalBackfill.state === "caught_up" &&
    value.pendingResolutionCount === 0
  if (!fullyCaughtUp) return value
  return {
    ...value,
    newestFrontier: { state: "advancing" },
    historicalBackfill: {
      ...value.historicalBackfill,
      state: "advancing",
    },
  }
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export const connectorExecutionErrorCode = "connector_execution_failed" as const
export const connectorExecutionErrorMessage =
  "Connector execution failed before completion." as const

/** Fixed nominal exception for unexpected adapter failures. */
export class ConnectorExecutionError extends Error {
  readonly code = connectorExecutionErrorCode

  constructor() {
    super(connectorExecutionErrorMessage)
    this.name = "ConnectorExecutionError"
  }
}
