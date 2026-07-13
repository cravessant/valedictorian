import { connectorStatusSummarySchema, type ConnectorStatusSummary } from 'sparxie'

export function publicConnectorStatusSummary(value: unknown): ConnectorStatusSummary {
  const status = value && typeof value === 'object'
    ? value as Partial<ConnectorStatusSummary>
    : {}
  return connectorStatusSummarySchema.parse({
    id: status.id,
    connectorId: status.connectorId,
    connectorVersion: status.connectorVersion,
    displayName: status.displayName,
    enabled: status.enabled,
    auth: status.auth,
    actionRequired: status.actionRequired,
    actions: status.actions,
    lastRunAt: status.lastRunAt,
    latestRunId: status.latestRunId,
    observationCount: status.observationCount,
    severity: status.severity,
    status: status.status,
    statusLabel: status.statusLabel,
    summary: status.summary,
    warningCount: status.warningCount,
    warnings: status.warnings,
  })
}
