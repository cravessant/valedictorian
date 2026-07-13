import type {
  ConnectorAuthReference,
  ConnectorInstanceRecord,
  ConnectorRunRecord,
} from '../modules/connectors/connector.repository'
import {
  mapConnectorStatusSummary,
  type ConnectorStatusView,
} from '../modules/connectors/connector.status'
import type {
  LocalConnectorAuthSummary,
  LocalConnectorStatusSummary,
} from './local-connector-client.contract'

export function mapLocalConnectorStatusSummary(
  record: ConnectorInstanceRecord & { latestRun: ConnectorRunRecord | null },
): LocalConnectorStatusSummary {
  const status = mapConnectorStatusSummary(record)
  const auth = record.auth.map(mapConnectorAuthSummary)
  return {
    ...status,
    status: publicConnectorStatus(status.status),
    actions: status.actions.map((action) => ({ id: action.id, label: action.label })),
    warnings: status.warnings.map((warning) => ({ ...warning, label: warning.label ?? null })),
    connectorVersion: record.connectorVersion,
    auth,
    actionRequired: actionRequiredForStatus(status, auth),
  }
}

export function mapConnectorAuthSummary(reference: ConnectorAuthReference): LocalConnectorAuthSummary {
  return {
    id: reference.id,
    mode: reference.mode,
    label: reference.label ?? null,
    configured: isConnectorAuthConfigured(reference),
  }
}

function publicConnectorStatus(
  status: ConnectorStatusView['status'],
): LocalConnectorStatusSummary['status'] {
  const mappings: Record<ConnectorStatusView['status'], LocalConnectorStatusSummary['status']> = {
    auth_required: 'authentication_required',
    backfilling: 'backfilling',
    blocked: 'blocked',
    boundary_exhausted: 'boundary_exhausted',
    cancelled: 'cancelled',
    caught_up: 'caught_up',
    failed: 'failed',
    healthy: 'caught_up',
    never_run: 'never_run',
    no_jobs: 'caught_up',
    queued: 'queued',
    running: 'checking_newest',
    skipped: 'skipped',
    checking_newest: 'checking_newest',
    cooling_down: 'cooling_down',
    resolving: 'resolving',
    source_exhausted: 'source_exhausted',
  }
  return mappings[status]
}

function isConnectorAuthConfigured(reference: ConnectorAuthReference): boolean {
  if (reference.mode === 'none') {
    return true
  }
  return typeof reference.secretKey === 'string' && reference.secretKey.trim().length > 0
}

function actionRequiredForStatus(
  status: ConnectorStatusView,
  auth: LocalConnectorAuthSummary[],
): LocalConnectorStatusSummary['actionRequired'] {
  if (status.status === 'auth_required') {
    return [
      {
        id: auth[0]?.id ?? status.id,
        kind: 'auth',
        label: status.actionLabel ?? 'Reconnect',
        message: status.summary,
        severity: status.severity,
      },
    ]
  }
  const actions: LocalConnectorStatusSummary['actionRequired'] = []
  for (const warning of status.warnings) {
    if (warning.code === 'source.captcha') {
      actions.push({
        id: warning.code,
        kind: 'captcha',
        label: warning.label,
        message: warning.message,
        severity: warning.severity,
      })
      continue
    }
    if (warning.code === 'source.rate_limited') {
      actions.push({
        id: warning.code,
        kind: 'rate_limit',
        label: warning.label,
        message: warning.message,
        severity: warning.severity,
      })
      continue
    }
    if (status.status === 'blocked' && warning.severity === 'blocked') {
      actions.push({
        id: warning.code,
        kind: warning.code === 'jobright_raw_intake_unavailable'
          || warning.code === 'jobright_normalization_unavailable'
          ? 'configuration'
          : 'manual_review',
        label: warning.label,
        message: warning.message,
        severity: warning.severity,
      })
    }
  }
  return actions
}
