import type { ConnectorStatusSummaryRecord } from '../ports/connector.repository.port'
import {
  isAuthWarningCode,
  mapConnectorWarnings,
  readConnectorWarningRecords,
  type ConnectorStatusListResult,
  type ConnectorStatusView,
} from '../public/connector.status-view'
import {
  pendingResolutionCount,
  runFrontiers,
  runOutcome,
} from './connector.run-record.projection'

export type {
  ConnectorStatusAction,
  ConnectorStatusListResult,
  ConnectorStatusSeverity,
  ConnectorStatusState,
  ConnectorStatusView,
  ConnectorStatusWarningView,
} from '../public/connector.status-view'
export { mapConnectorWarnings } from '../public/connector.status-view'


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
      nextAttemptAt: null,
      observationCount: 0,
      severity: 'warning',
      status: 'never_run',
      statusLabel: 'Never run',
      summary: record.enabled
        ? 'Connector is enabled but has not run yet.'
        : 'Connector is disabled and has not run yet.',
      warningCount: 0,
      warnings: [],
      actionLabel: null,
      actions: [],
    }
  }

  const rawWarnings = readConnectorWarningRecords(latestRun.warnings)
  const warnings = mapConnectorWarnings(latestRun.warnings)
  const hasAuthBlocker =
    rawWarnings.some((warning) => isAuthWarningCode(warning.code))
  const hasBlockedWarning = warnings.some((warning) => warning.severity === 'blocked')
  const latestRunStatus = latestRun.status
  const frontiers = runFrontiers(latestRun)
  const pendingResolutions = pendingResolutionCount(latestRun)
  const outcome = runOutcome(latestRun)
  const completedWithWarnings = latestRun.status === 'completed' && warnings.length > 0
  const noJobs = latestRun.observationCount === 0
  const state: ConnectorStatusStateView = outcome.kind === 'action_required'
    ? {
        actionLabel: 'Reconnect',
        actions: [
          { id: 'reconnect', label: 'Reconnect' },
          { id: 'skip', label: 'Skip this run' },
        ],
        severity: 'blocked',
        status: 'auth_required',
        statusLabel: 'Authentication required',
        summary: 'Refresh connector credentials to continue synchronization.',
      }
    : outcome.kind === 'cooling_down'
    ? {
        actionLabel: null,
        actions: [],
        severity: 'warning',
        status: 'cooling_down',
        statusLabel: 'Cooling down',
        summary: 'The provider asked this connector to pause requests.',
      }
    : outcome.kind === 'source_exhausted'
      ? {
          actionLabel: null,
          actions: [],
          severity: 'healthy',
          status: 'source_exhausted',
          statusLabel: 'Provider history exhausted',
          summary: 'The provider has no older history available before this point.',
        }
    : outcome.kind === 'boundary_exhausted'
      ? {
          actionLabel: null,
          actions: [],
          severity: 'healthy',
          status: 'boundary_exhausted',
          statusLabel: 'Boundary reached',
          summary: `Historical backfill reached the configured ${formatDateOnly(frontiers.historicalBackfill.boundary.earliestDate)} boundary.`,
        }
    : outcome.kind === 'caught_up'
      ? {
          actionLabel: null,
          actions: [],
          severity: 'healthy',
          status: 'caught_up',
          statusLabel: 'Caught up',
          summary: 'Newest jobs, historical backfill, and pending link resolution are caught up.',
        }
    : outcome.kind === 'yielded' && latestRun.synchronization
      ? {
          actionLabel: null,
          actions: [],
          severity: 'warning',
          status: 'skipped',
          statusLabel: 'Continuing later',
          summary:
            'Yielded work is safely checkpointed for the next admitted manual or scheduled work opportunity.',
        }
    : outcome.kind === 'cancelled' && outcome.reason.startsWith('user_skipped')
      ? {
          actionLabel: null,
          actions: [],
          severity: 'warning',
          status: 'skipped',
          statusLabel: 'Skipped by user',
          summary: 'This synchronization work opportunity was skipped by the user.',
        }
    : hasAuthBlocker
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
          ? activeSynchronizationState(frontiers, pendingResolutions)
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
    nextAttemptAt: outcome.kind === 'cooling_down' ? outcome.operation.retryAt : null,
    observationCount: latestRun.observationCount,
    warningCount: latestRun.warningCount,
    warnings,
    ...state,
  }
}

function activeSynchronizationState(
  frontiers: ReturnType<typeof runFrontiers>,
  pendingResolutions: number,
): ConnectorStatusStateView {
  if (frontiers.newestFrontier.state === 'advancing') {
    return {
      actionLabel: null,
      actions: [],
      severity: 'warning',
      status: 'checking_newest',
      statusLabel: 'Checking newest',
      summary: 'Checking the provider for newly published jobs.',
    }
  }
  if (frontiers.historicalBackfill.state === 'advancing') {
    return {
      actionLabel: null,
      actions: [],
      severity: 'warning',
      status: 'backfilling',
      statusLabel: 'Backfilling',
      summary: `Checking older provider history back to ${formatDateOnly(frontiers.historicalBackfill.boundary.earliestDate)}.`,
    }
  }
  if (pendingResolutions > 0) {
    return {
      actionLabel: null,
      actions: [],
      severity: 'warning',
      status: 'resolving',
      statusLabel: 'Resolving links',
      summary: `Resolving destinations for ${pendingResolutions} captured ${pendingResolutions === 1 ? 'job' : 'jobs'}.`,
    }
  }
  return {
    actionLabel: null,
    actions: [],
    severity: 'warning',
    status: 'running',
    statusLabel: 'Running',
    summary: 'Connector run is in progress.',
  }
}

function formatDateOnly(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00.000Z`))
}
