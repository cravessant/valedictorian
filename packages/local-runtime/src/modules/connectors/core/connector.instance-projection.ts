/**
 * Connector instance projections (issue #327).
 *
 * Turns persisted connector instance, auth, and run rows into the consumer-shaped
 * results the desktop client speaks, and parses caller-supplied auth references
 * back into the persisted shape. Persistence rows never leave this module.
 */
import type { ConnectorAuthReferenceInput } from '@sparxie/sdk'
import type { ConnectorAuthReference, ConnectorInstanceRecord, ConnectorRunRecord } from '../ports/connector.repository.port.js'
import { mapConnectorStatusSummary, type ConnectorStatusView } from './connector.status.js'
import type {
  LocalConnectorAuthSummary,
  LocalConnectorInstanceSummary,
  LocalConnectorStatusSummary,
} from './connector.consumer-contract.js'

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

export function mapConnectorInstanceSummary(
  record: ConnectorInstanceRecord,
): LocalConnectorInstanceSummary {
  return {
    id: record.id,
    connectorId: record.connectorId,
    connectorVersion: record.connectorVersion,
    displayName: record.displayName,
    enabled: record.enabled,
    lifecycle: record.enabled ? 'enabled' : 'disabled',
    auth: record.auth.map(mapConnectorAuthSummary),
    config: record.config,
    filters: record.filters,
    earliestBackfillDate: record.earliestBackfillDate,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

export function parseConnectorAuthReferenceInputs(
  references: ConnectorAuthReferenceInput[] | undefined,
): ConnectorAuthReference[] | undefined {
  return references?.map((reference) => {
    if (!isLocalConnectorAuthMode(reference.mode)) {
      throw new Error(`Invalid connector auth mode: ${String(reference.mode)}`)
    }
    return {
      id: reference.id,
      mode: reference.mode,
      ...(reference.label === undefined || reference.label === null ? {} : { label: reference.label }),
      ...(reference.secretKey === undefined ? {} : { secretKey: reference.secretKey }),
    }
  })
}

const localConnectorAuthModes = new Set<ConnectorAuthReference['mode']>([
  'none', 'api_key', 'bearer_token', 'oauth', 'cookie_jar', 'username_password',
])

function isLocalConnectorAuthMode(value: string): value is ConnectorAuthReference['mode'] {
  return localConnectorAuthModes.has(value as ConnectorAuthReference['mode'])
}
