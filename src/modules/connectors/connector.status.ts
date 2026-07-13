import type {
  ConnectorStatusSummaryRecord,
  ConnectorWarning,
} from './connector.repository'
import type { RetryAdvice } from 'sparxie'

export type ConnectorStatusSeverity = 'healthy' | 'warning' | 'blocked'

export type ConnectorStatusState =
  | 'auth_required'
  | 'blocked'
  | 'cancelled'
  | 'failed'
  | 'healthy'
  | 'never_run'
  | 'no_jobs'
  | 'queued'
  | 'running'
  | 'skipped'

export interface ConnectorStatusAction {
  id: 'reconnect' | 'skip'
  label: string
}

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
  observationCount: number
  retryAdvice: RetryAdvice | null
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

type ConnectorStatusStateView = Pick<
  ConnectorStatusView,
  'actionLabel' | 'actions' | 'severity' | 'status' | 'statusLabel' | 'summary'
>

export function mapConnectorStatusSummaries(
  records: ConnectorStatusSummaryRecord[],
): ConnectorStatusListResult {
  return {
    available: true,
    items: records.map(mapConnectorStatusSummary),
  }
}

export function mapConnectorStatusSummary(
  record: ConnectorStatusSummaryRecord,
): ConnectorStatusView {
  const latestRun = record.latestRun

  if (!latestRun) {
    return {
      id: record.id,
      connectorId: record.connectorId,
      displayName: record.displayName,
      enabled: record.enabled,
      lastRunAt: null,
      latestRunId: null,
      observationCount: 0,
      retryAdvice: null,
      severity: 'warning',
      status: 'never_run',
      statusLabel: 'Never run',
      summary: 'Connector is enabled but has not run yet.',
      warningCount: 0,
      warnings: [],
      actionLabel: null,
      actions: [],
    }
  }

  const rawWarnings = readWarnings(latestRun.warnings)
  const warnings = mapConnectorWarnings(latestRun.warnings)
  const hasAuthBlocker =
    rawWarnings.some((warning) => isAuthWarningCode(warning.code))
  const hasBlockedWarning = warnings.some((warning) => warning.severity === 'blocked')
  const latestRunStatus = latestRun.status
  const completedWithWarnings = latestRun.status === 'completed' && warnings.length > 0
  const noJobs = latestRun.observationCount === 0
  const state: ConnectorStatusStateView = hasAuthBlocker
    ? {
        actionLabel: 'Reconnect',
        actions: [
          { id: 'reconnect', label: 'Reconnect' },
          { id: 'skip', label: 'Skip this run' },
        ],
        severity: 'blocked',
        status: 'auth_required',
        statusLabel: 'Auth required',
        summary: 'Reconnect the connector session to continue refreshes.',
      }
    : hasBlockedWarning
      ? {
          actionLabel: null,
          actions: [],
          severity: 'blocked',
          status: 'blocked',
          statusLabel: 'Blocked',
          summary: 'Latest run is blocked and needs review.',
        }
      : latestRunStatus === 'queued'
        ? {
            actionLabel: null,
            actions: [],
            severity: 'warning',
            status: 'queued',
            statusLabel: 'Queued',
            summary: 'Connector run is queued.',
          }
        : latestRunStatus === 'running'
          ? {
              actionLabel: null,
              actions: [],
              severity: 'warning',
              status: 'running',
              statusLabel: 'Running',
              summary: 'Connector run is in progress.',
            }
          : latestRunStatus === 'failed'
            ? {
                actionLabel: null,
                actions: [],
                severity: 'blocked',
                status: 'failed',
                statusLabel: 'Failed',
                summary: 'Latest run failed and needs review.',
              }
            : latestRunStatus === 'cancelled'
              ? {
                  actionLabel: null,
                  actions: [],
                  severity: 'warning',
                  status: 'cancelled',
                  statusLabel: 'Cancelled',
                  summary: 'Latest run was cancelled.',
                }
              : latestRunStatus === 'skipped'
                ? {
                    actionLabel: null,
                    actions: [],
                    severity: 'warning',
                    status: 'skipped',
                    statusLabel: latestRun.retryHints?.state === 'not_due'
                      ? 'Skipped / not due'
                      : 'Skipped',
                    summary: latestRun.retryHints?.state === 'not_due'
                      ? 'Latest run was skipped because retry work is not due yet.'
                      : 'Latest run was skipped.',
                  }
                : completedWithWarnings
        ? {
            actionLabel: null,
            actions: [],
            severity: 'warning',
            status: 'healthy',
            statusLabel: 'Completed with warnings',
            summary: 'Latest run completed with warnings.',
          }
        : noJobs
          ? {
              actionLabel: null,
              actions: [],
              severity: 'healthy',
              status: 'no_jobs',
              statusLabel: 'No jobs',
              summary: 'Latest run completed with no matching jobs.',
            }
          : {
              actionLabel: null,
              actions: [],
              severity: 'healthy',
              status: 'healthy',
              statusLabel: 'Healthy',
            summary: 'Latest run completed successfully.',
          }

  return {
    id: record.id,
    connectorId: record.connectorId,
    displayName: record.displayName,
    enabled: record.enabled,
    lastRunAt: latestRun.completedAt ?? latestRun.startedAt,
    latestRunId: latestRun.id,
    observationCount: latestRun.observationCount,
    retryAdvice: latestRun.retryHints,
    warningCount: latestRun.warningCount,
    warnings,
    ...state,
  }
}

export function mapConnectorWarnings(value: unknown): ConnectorStatusWarningView[] {
  return readWarnings(value).map(mapConnectorWarning)
}

function readWarnings(value: unknown): ConnectorWarning[] {
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

function mapConnectorWarning(warning: ConnectorWarning): ConnectorStatusWarningView {
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
    'connector.projection_failed': {
      code: 'connector.projection_failed',
      label: 'Projection failed',
      message: 'Connector observations could not be projected.',
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

function isAuthWarningCode(code: string): boolean {
  return code.startsWith('auth.') || code === 'jobright_auth_required'
}
