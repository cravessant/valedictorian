import { describe, expect, it } from 'vitest'
import {
  publicConnectorRunLifecycleCounts,
  publicConnectorRunSummary,
} from '@sparxie/valedictorian-local-runtime/testing/modules/connectors/public/connector.run-projection'

describe('public connector run projection', () => {
  it('translates internal sourcing totals into released opportunity counts', () => {
    expect(publicConnectorRunLifecycleCounts({
      lifecycleCounts: {
        version: 'connector-run-lifecycle-counts/v1',
        source: 'live_current',
        scope: {
          kind: 'connector_run',
          connectorRunId: 'run-1',
          executionScopeId: 'scope_connector_1',
        },
        provider: {
          returnedRows: 4,
          validRecords: 4,
          invalidRecords: 0,
          sourceDuplicates: 0,
          capturedRecords: 4,
          occurrenceCount: 4,
          captureShortfall: 0,
          unclassifiedRows: 0,
          invariant: 'reconciled',
          gaps: [],
        },
        destination: {
          normalized: 3,
          resolvedEmployerOrAts: 2,
          resolvedThirdParty: 1,
          unresolved: 0,
          pending: 0,
          gateRejected: 1,
          unclassified: 0,
          invariant: 'reconciled',
        },
        sourcing: {
          added: 2,
          queueDuplicate: 1,
          notFit: 0,
          rejected: 0,
          actionableReview: 0,
          unclassified: 0,
          invariant: 'reconciled',
        },
      },
    }, 'run-1', 'scope_connector_1')).toMatchObject({
      source: 'live_current',
      opportunity: {
        opportunitiesCreated: 2,
        existingJobMatches: 1,
      },
    })
  })

  it('omits obsolete derived_pre_feature provenance from public lifecycle counts', () => {
    expect(publicConnectorRunLifecycleCounts({
      lifecycleCounts: {
        ...lifecycleCounts(),
        source: 'derived_pre_feature',
      },
    }, 'run-1', 'scope_connector_1')).toBeUndefined()
  })

  it.each([
    ['missing', 'reported_stats_missing', 'missing_provider_returned'],
    ['invalid', 'reported_stats_invalid', 'invalid_provider_returned'],
  ] as const)(
    'does not expose a legacy %s occurrence fallback as exact provider returned rows',
    (_name, invariant, gap) => {
      const lifecycle = lifecycleCounts()

      expect(publicConnectorRunLifecycleCounts({
        lifecycleCounts: {
          ...lifecycle,
          provider: {
            ...lifecycle.provider,
            returnedRows: 4,
            occurrenceCount: 4,
            invariant,
            gaps: [gap],
          },
          sourcing: {
            added: lifecycle.opportunity.opportunitiesCreated,
            queueDuplicate: lifecycle.opportunity.existingJobMatches,
            notFit: lifecycle.opportunity.notFit,
            rejected: lifecycle.opportunity.rejected,
            actionableReview: lifecycle.opportunity.actionableReview,
            unclassified: lifecycle.opportunity.unclassified,
            invariant: lifecycle.opportunity.invariant,
          },
        },
      }, 'run-1', 'scope_connector_1')).toMatchObject({
        provider: {
          returnedRows: 0,
          occurrenceCount: 4,
          invariant,
          gaps: [gap],
        },
      })
    },
  )

  it('preserves lifecycle counts while removing local and secret-bearing fields', () => {
    const run = {
      id: 'run-1',
      connectorInstanceId: 'connector-1',
      executionScopeId: 'scope_connector_1',
      mode: 'manual',
      scheduleOccurrence: null,
      status: 'skipped',
      filterSignature: 'all',
      observationCount: 4,
      warningCount: 0,
      warnings: [],
      newestFrontier: { state: 'advancing' },
      historicalBackfill: {
        state: 'advancing',
        boundary: { earliestDate: '2026-07-01' },
      },
      pendingResolutionCount: 0,
      lifecycleCounts: lifecycleCounts(),
      outcome: { kind: 'yielded', reason: 'invocation_budget' },
      startedAt: '2026-07-13T04:00:00.000Z',
      completedAt: '2026-07-13T04:00:01.000Z',
      coverage: { start: null, end: null },
      retryHints: { token: 'must-not-cross-the-boundary' },
      stats: { session: 'must-not-cross-the-boundary' },
      secretSession: 'must-not-cross-the-boundary',
    }

    expect(publicConnectorRunSummary(run)).toEqual({
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
      lifecycleCounts: run.lifecycleCounts,
      outcome: run.outcome,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
    })
  })
})

function lifecycleCounts() {
  return {
    version: 'connector-run-lifecycle-counts/v1',
    source: 'frozen_terminal',
    scope: {
      kind: 'connector_run',
      connectorRunId: 'run-1',
      executionScopeId: 'scope_connector_1',
    },
    provider: {
      returnedRows: 4,
      validRecords: 4,
      invalidRecords: 0,
      sourceDuplicates: 0,
      capturedRecords: 4,
      occurrenceCount: 4,
      captureShortfall: 0,
      unclassifiedRows: 0,
      invariant: 'reconciled',
      gaps: [],
    },
    destination: {
      normalized: 3,
      resolvedEmployerOrAts: 2,
      resolvedThirdParty: 1,
      unresolved: 0,
      pending: 0,
      gateRejected: 1,
      unclassified: 0,
      invariant: 'reconciled',
    },
    opportunity: {
      opportunitiesCreated: 2,
      existingJobMatches: 1,
      notFit: 0,
      rejected: 0,
      actionableReview: 0,
      unclassified: 0,
      invariant: 'reconciled',
    },
  } as const
}
