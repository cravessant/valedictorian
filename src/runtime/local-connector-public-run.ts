import {
  connectorRunLifecycleCountsSchema,
  connectorRunSummarySchema,
  connectorRunsListResultSchema,
  type ConnectorRunLifecycleCounts,
  type ConnectorRunSummary,
  type ConnectorRunsListResult,
  type SourceExecutionScopeId,
} from 'sparxie'
import { mapConnectorWarnings } from '../modules/connectors/connector.status'
import type { ConnectorRunRecord } from '../modules/connectors/connector.repository'
import type { LocalConnectorRunSummary } from './local-connector-client.contract'
import {
  parseConnectorRetryAdvice,
  pendingResolutionCount,
  publicRunStatus,
  runFrontiers,
  runOutcome,
} from './local-connector-run-summary'

export function mapConnectorRunSummary(
  record: ConnectorRunRecord,
  scheduleOccurrence: ConnectorRunSummary['scheduleOccurrence'] = null,
): LocalConnectorRunSummary {
  const lifecycleCounts = publicConnectorRunLifecycleCounts(
    record.stats,
    record.id,
    record.executionScopeId,
  )
  const lifecycleSummary = lifecycleCounts ? { lifecycleCounts } : {}
  const shared = {
    id: record.id,
    connectorInstanceId: record.connectorInstanceId,
    executionScopeId: record.executionScopeId,
    status: publicRunStatus(record.status),
    coverage: {
      start: record.coverageStartedAt,
      end: record.coverageEndedAt,
    },
    filterSignature: record.filterSignature,
    observationCount: record.observationCount,
    warningCount: record.warningCount,
    ...runFrontiers(record),
    pendingResolutionCount: pendingResolutionCount(record),
    ...lifecycleSummary,
    outcome: runOutcome(record),
    stats: record.stats,
    warnings: mapConnectorWarnings(record.warnings),
    retryHints: parseConnectorRetryAdvice(record.retryHints),
    startedAt: record.startedAt,
    completedAt: record.completedAt,
  } as const
  if (
    scheduleOccurrence
    && record.mode === 'scheduled'
    && scheduleOccurrence.admittedMode === 'scheduled'
  ) {
    return {
      ...shared,
      mode: 'scheduled',
      scheduleOccurrence,
    }
  }
  if (
    scheduleOccurrence
    && record.mode === 'catch_up'
    && scheduleOccurrence.admittedMode === 'catch_up'
  ) {
    return {
      ...shared,
      mode: 'catch_up',
      scheduleOccurrence,
    }
  }
  return {
    ...shared,
    mode: 'manual',
    scheduleOccurrence: null,
  }
}

export function publicConnectorRunSummary(value: unknown): ConnectorRunSummary {
  const run = value && typeof value === 'object'
    ? value as Partial<ConnectorRunSummary>
    : {}
  return connectorRunSummarySchema.parse({
    id: run.id,
    connectorInstanceId: run.connectorInstanceId,
    executionScopeId: run.executionScopeId,
    mode: run.mode,
    scheduleOccurrence: run.scheduleOccurrence,
    status: run.status,
    filterSignature: run.filterSignature,
    observationCount: run.observationCount,
    warningCount: run.warningCount,
    warnings: run.warnings,
    newestFrontier: run.newestFrontier,
    historicalBackfill: run.historicalBackfill,
    pendingResolutionCount: run.pendingResolutionCount,
    ...(run.lifecycleCounts === undefined
      ? {}
      : { lifecycleCounts: run.lifecycleCounts }),
    outcome: publicConnectorRunOutcome(run.outcome),
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  })
}

function publicConnectorRunOutcome(
  outcome: Partial<ConnectorRunSummary>['outcome'],
): Partial<ConnectorRunSummary>['outcome'] {
  if (
    outcome?.kind === 'cancelled'
    && typeof outcome.reason === 'string'
    && outcome.reason.startsWith('user_skipped')
  ) {
    return { kind: 'cancelled', reason: 'user_skipped' }
  }
  return outcome
}

export function publicConnectorRunsListResult(value: unknown): ConnectorRunsListResult {
  const result = recordFromUnknown(value)
  const items = Array.isArray(result.items) ? result.items : []
  return connectorRunsListResultSchema.parse({
    items: items.map(publicConnectorRunSummary),
    total: result.total,
    limit: result.limit,
    offset: result.offset,
    hasMore: result.hasMore,
  })
}

export function publicConnectorRunLifecycleCounts(
  stats: unknown,
  connectorRunId: string,
  executionScopeId: SourceExecutionScopeId,
): ConnectorRunLifecycleCounts | undefined {
  const lifecycle = recordFromUnknown(recordFromUnknown(stats).lifecycleCounts)
  const scope = recordFromUnknown(lifecycle.scope)
  const provider = recordFromUnknown(lifecycle.provider)
  const providerGaps = Array.isArray(provider.gaps) ? provider.gaps : []
  const returnedRowsUnknown = providerGaps.includes('missing_provider_returned')
    || providerGaps.includes('invalid_provider_returned')
  const destination = recordFromUnknown(lifecycle.destination)
  const sourcing = recordFromUnknown(lifecycle.sourcing)
  if (
    !['live_current', 'frozen_terminal'].includes(String(lifecycle.source))
    || scope.connectorRunId !== connectorRunId
    || scope.executionScopeId !== executionScopeId
  ) {
    return undefined
  }
  const parsed = connectorRunLifecycleCountsSchema.safeParse({
    version: lifecycle.version,
    source: lifecycle.source,
    scope: {
      kind: scope.kind,
      connectorRunId: scope.connectorRunId,
      executionScopeId: scope.executionScopeId,
    },
    provider: {
      returnedRows: returnedRowsUnknown ? 0 : provider.returnedRows,
      validRecords: provider.validRecords,
      invalidRecords: provider.invalidRecords,
      sourceDuplicates: provider.sourceDuplicates,
      capturedRecords: provider.capturedRecords,
      occurrenceCount: provider.occurrenceCount,
      captureShortfall: returnedRowsUnknown ? 0 : provider.captureShortfall,
      unclassifiedRows: returnedRowsUnknown ? 0 : provider.unclassifiedRows,
      invariant: provider.invariant,
      gaps: provider.gaps,
    },
    destination: {
      normalized: destination.normalized,
      resolvedEmployerOrAts: destination.resolvedEmployerOrAts,
      resolvedThirdParty: destination.resolvedThirdParty,
      unresolved: destination.unresolved,
      pending: destination.pending,
      gateRejected: destination.gateRejected,
      unclassified: destination.unclassified,
      invariant: destination.invariant,
    },
    sourcing: {
      findingsAdded: sourcing.added,
      canonicalDuplicates: sourcing.queueDuplicate,
      notFit: sourcing.notFit,
      rejected: sourcing.rejected,
      actionableReview: sourcing.actionableReview,
      unclassified: sourcing.unclassified,
      invariant: sourcing.invariant,
    },
  })
  return parsed.success ? parsed.data : undefined
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
