import {
  connectorOverviewRecordSchema,
  type ConnectorOverviewRecord,
} from '@sparxie/sdk'
import type { ConnectorStatusSummaryRecord } from '../ports/connector.repository.port'
import {
  pendingResolutionCount,
  runFrontiers,
  runOutcome,
} from './connector.run-record.projection'
import { mapLocalConnectorStatusSummary } from './connector.instance-projection'

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
