import type { ConnectorStatusAction as PublicConnectorStatusAction } from '@sparxie/sdk'

export interface ConnectorWarningRecord {
  code: string
  message: string
}

export type ConnectorStatusSeverity = 'healthy' | 'warning' | 'blocked'

export type ConnectorStatusState =
  | 'auth_required'
  | 'backfilling'
  | 'blocked'
  | 'boundary_exhausted'
  | 'cancelled'
  | 'checking_newest'
  | 'cooling_down'
  | 'caught_up'
  | 'failed'
  | 'healthy'
  | 'never_run'
  | 'no_jobs'
  | 'queued'
  | 'resolving'
  | 'running'
  | 'skipped'
  | 'source_exhausted'

export type ConnectorStatusAction = PublicConnectorStatusAction

export interface ConnectorStatusWarningView {
  code: string
  label: string
  message: string
  severity: ConnectorStatusSeverity
}

export interface ConnectorStatusView {
  id: string
  connectorId: string
  displayName: string
  enabled: boolean
  lastRunAt: string | null
  latestRunId: string | null
  nextAttemptAt: string | null
  observationCount: number
  severity: ConnectorStatusSeverity
  status: ConnectorStatusState
  statusLabel: string
  summary: string
  warningCount: number
  warnings: ConnectorStatusWarningView[]
  actionLabel: string | null
  actions: ConnectorStatusAction[]
}

export interface ConnectorStatusListResult {
  available: boolean
  items: ConnectorStatusView[]
}

export function mapConnectorWarnings(value: unknown): ConnectorStatusWarningView[] {
  return readConnectorWarningRecords(value).map(mapConnectorWarning)
}

export function readConnectorWarningRecords(value: unknown): ConnectorWarningRecord[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return []
    }

    const record = item as Record<string, unknown>

    if (typeof record.code !== 'string' || typeof record.message !== 'string') {
      return []
    }

    return [
      {
        code: record.code,
        message: record.message,
      },
    ]
  })
}

function mapConnectorWarning(warning: ConnectorWarningRecord): ConnectorStatusWarningView {
  const safeWarning = safeWarningForCode(warning.code)

  return {
    code: safeWarning.code,
    label: safeWarning.label,
    message: safeWarning.message,
    severity: safeWarning.severity,
  }
}

function safeWarningForCode(code: string): ConnectorStatusWarningView {
  const warnings: Record<string, ConnectorStatusWarningView> = {
    'auth.expired_session': {
      code: 'auth.expired_session',
      label: 'Expired session',
      message: 'Connector auth expired.',
      severity: 'blocked',
    },
    'auth.required': {
      code: 'auth.required',
      label: 'Auth required',
      message: 'Connector auth needs attention.',
      severity: 'blocked',
    },
    'connector.execution_failed': {
      code: 'connector.execution_failed',
      label: 'Execution failed',
      message: 'Connector execution failed before completion.',
      severity: 'warning',
    },
    'connector.interrupted': {
      code: 'connector.interrupted',
      label: 'Run interrupted',
      message: 'The app closed before this connector run finished.',
      severity: 'warning',
    },
    'connector.finalize_failed': {
      code: 'connector.finalize_failed',
      label: 'Run finalization failed',
      message: 'The connector captured durable intake but could not finalize its checkpoint.',
      severity: 'warning',
    },
    'source.rate_limited': {
      code: 'source.rate_limited',
      label: 'Rate limited',
      message: 'Connector source rate-limited the latest run.',
      severity: 'warning',
    },
    'source.captcha': {
      code: 'source.captcha',
      label: 'Captcha required',
      message: 'Connector source requires manual verification.',
      severity: 'blocked',
    },
    'parser.changed': {
      code: 'parser.changed',
      label: 'Parser changed',
      message: 'Connector parser may need review.',
      severity: 'warning',
    },
    'result.no_jobs': {
      code: 'result.no_jobs',
      label: 'No jobs',
      message: 'Connector found no matching jobs.',
      severity: 'warning',
    },
    jobright_auth_required: {
      code: 'jobright_auth_required',
      label: 'Jobright auth required',
      message: 'Update and validate Jobright credentials, then run again.',
      severity: 'blocked',
    },
    jobright_auth_failed: {
      code: 'jobright_auth_failed',
      label: 'Jobright auth failed',
      message: 'Jobright authentication failed. Validate credentials and retry this run.',
      severity: 'blocked',
    },
    jobright_auth_retryable: {
      code: 'jobright_auth_retryable',
      label: 'Jobright auth unavailable',
      message: 'Jobright authentication is temporarily unavailable. Retry later.',
      severity: 'warning',
    },
    jobright_challenge_blocked: {
      code: 'jobright_challenge_blocked',
      label: 'Jobright challenge',
      message: 'Jobright returned an API challenge. Refresh credentials or retry later.',
      severity: 'blocked',
    },
    jobright_discovery_rate_limited: {
      code: 'jobright_discovery_rate_limited',
      label: 'Jobright discovery rate limited',
      message: 'Jobright rate-limited discovery. Retry later.',
      severity: 'warning',
    },
    jobright_discovery_failed: {
      code: 'jobright_discovery_failed',
      label: 'Jobright discovery failed',
      message: 'Jobright discovery failed. Review API availability and retry this run.',
      severity: 'warning',
    },
    jobright_discovery_forbidden: {
      code: 'jobright_discovery_forbidden',
      label: 'Jobright discovery forbidden',
      message:
        'Jobright denied discovery access. Review provider access policy, then retry this run.',
      severity: 'warning',
    },
    jobright_discovery_http_client_error: {
      code: 'jobright_discovery_http_client_error',
      label: 'Jobright discovery request error',
      message:
        'Jobright rejected the discovery request. Check the request contract, then retry this run.',
      severity: 'warning',
    },
    jobright_discovery_http_non_success: {
      code: 'jobright_discovery_http_non_success',
      label: 'Jobright discovery non-success',
      message:
        'Jobright discovery returned a non-success response. Check provider availability and the request contract, then retry this run.',
      severity: 'warning',
    },
    jobright_discovery_non_success: {
      code: 'jobright_discovery_non_success',
      label: 'Jobright discovery rejected',
      message:
        'Jobright discovery returned a provider non-success result. Check provider availability and access policy, then retry this run.',
      severity: 'warning',
    },
    jobright_discovery_retryable: {
      code: 'jobright_discovery_retryable',
      label: 'Jobright discovery unavailable',
      message: 'Jobright discovery failed temporarily. Retry later.',
      severity: 'warning',
    },
    jobright_parser_changed: {
      code: 'jobright_parser_changed',
      label: 'Jobright API changed',
      message: 'Update the Jobright API parser before retrying this run.',
      severity: 'warning',
    },
    jobright_raw_intake_unavailable: {
      code: 'jobright_raw_intake_unavailable',
      label: 'Jobright raw intake unavailable',
      message: 'Raw-first Jobright intake is unavailable. Detail resolution was not started.',
      severity: 'blocked',
    },
    jobright_normalization_unavailable: {
      code: 'jobright_normalization_unavailable',
      label: 'Jobright normalization unavailable',
      message: 'Trusted Jobright normalization is unavailable. Detail resolution was not started.',
      severity: 'blocked',
    },
    jobright_rate_limited: {
      code: 'jobright_rate_limited',
      label: 'Jobright rate limited',
      message: 'Jobright rate-limited one or more requests. Retry later.',
      severity: 'warning',
    },
    jobright_retryable_failure: {
      code: 'jobright_retryable_failure',
      label: 'Jobright temporarily unavailable',
      message: 'Jobright returned a retryable server failure. Retry later.',
      severity: 'warning',
    },
    jobright_zero_useful_results: {
      code: 'jobright_zero_useful_results',
      label: 'No usable Jobright URLs',
      message: 'Review unresolved Jobright results before retrying this run.',
      severity: 'warning',
    },
  }

  if (warnings[code]) {
    return warnings[code]
  }

  if (isAuthWarningCode(code)) {
    return warnings['auth.required']
  }

  return {
    code: 'connector.warning',
    label: 'Connector warning',
    message: 'Connector reported a warning.',
    severity: 'warning',
  }
}

export function isAuthWarningCode(code: string): boolean {
  return code.startsWith('auth.') || code === 'jobright_auth_required'
}
