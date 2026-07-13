import {
  connectorOverviewRecordSchema,
  type ConnectorOverviewRecord,
} from 'sparxie'
import type { ConnectorStatusSummaryRecord } from '../modules/connectors/connector.repository'
import {
  pendingResolutionCount,
  runFrontiers,
  runOutcome,
} from './local-connector-run-summary'
import { mapLocalConnectorStatusSummary } from './local-connector-status-mapping'

export function mapLocalConnectorOverviewRecord(
  record: ConnectorStatusSummaryRecord,
): ConnectorOverviewRecord {
  const status = mapLocalConnectorStatusSummary(record)
  const run = record.latestRun
  const outcome = run ? runOutcome(run) : null
  return connectorOverviewRecordSchema.parse({
    id: record.id,
    connectorId: record.connectorId,
    connectorVersion: record.connectorVersion,
    displayName: record.displayName,
    enabled: record.enabled,
    health: {
      severity: status.severity,
      status: status.status,
      statusLabel: status.statusLabel,
      summary: status.summary,
      warningCount: status.warningCount,
      warnings: status.warnings,
    },
    actionRequired: status.actionRequired,
    actions: status.actions,
    latestRun: run && outcome ? {
      id: run.id,
      mode: run.mode,
      status: run.status,
      outcome: outcome.kind,
      cancellationKind: outcome.kind === 'cancelled' && outcome.reason.startsWith('user_skipped')
        ? 'user_skipped'
        : null,
      observationCount: run.observationCount,
      warningCount: run.warningCount,
      ...runFrontiers(run),
      pendingResolutionCount: pendingResolutionCount(run),
      startedAt: run.startedAt,
      completedAt: run.completedAt,
    } : null,
    cooldown: outcome?.kind === 'cooling_down'
      ? { retryAt: outcome.operation.retryAt }
      : null,
  })
}
