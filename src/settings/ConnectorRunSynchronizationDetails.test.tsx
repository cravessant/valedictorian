import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ConnectorSettingsRun } from './connector-settings.types'
import {
  ConnectorRunLifecycleDetails,
  ConnectorRunSynchronizationDetails,
} from './ConnectorRunDetails'

afterEach(cleanup)

describe('ConnectorRunSynchronizationDetails', () => {
  it('explains newest-frontier progress with explicit accessible stage labels', () => {
    render(<ConnectorRunSynchronizationDetails run={runFixture({
      newestFrontier: { state: 'advancing' },
    })} />)

    const status = screen.getByRole('status', { name: 'Connector synchronization state' })
    expect(status).toHaveTextContent('Checking newest')
    expect(status).toHaveTextContent('Checking the provider for newly published jobs.')
    expect(status).toHaveTextContent('Newest frontier: Checking newest')
    expect(status).toHaveTextContent('Historical backfill: Not started')
    expect(status).toHaveTextContent('Pending link resolution: 0')
  })

  it('discloses how continuous synchronization progresses', () => {
    render(<ConnectorRunSynchronizationDetails run={runFixture()} />)

    const disclosure = screen.getByRole('button', { name: 'How synchronization works' })
    expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/Each work opportunity checks the newest frontier first/)).not.toBeInTheDocument()

    fireEvent.click(disclosure)

    expect(disclosure).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/Each work opportunity checks the newest frontier first/)).toBeInTheDocument()
    expect(screen.getByText(
      /Yielded work is safely checkpointed for the next admitted manual or scheduled work opportunity/,
    )).toBeInTheDocument()
  })

  it.each([
    ['checking newest', { newestFrontier: { state: 'advancing' } }, 'Checking newest'],
    ['backfilling', {
      newestFrontier: { state: 'caught_up' },
      historicalBackfill: {
        state: 'advancing', boundary: { earliestDate: '2026-07-01' },
      },
    }, 'Backfilling'],
    ['resolving links', { pendingResolutionCount: 3 }, 'Resolving links'],
    ['cooling down', {
      outcome: {
        kind: 'cooling_down',
        operation: {
          kind: 'scope_rate_limited', executionScopeId: 'scope_fixture_run_details',
          retryAt: '2026-07-12T12:01:00.000Z', serverMinimumDelayMs: null,
        },
      },
    }, 'Cooling down'],
    ['authentication required', {
      outcome: {
        kind: 'action_required',
        operation: {
          kind: 'authentication_expired', executionScopeId: 'scope_fixture_run_details',
          requestRefresh: true,
        },
      },
    }, 'Authentication required'],
    ['caught up', { outcome: { kind: 'caught_up' } }, 'Caught up'],
    ['boundary reached', { outcome: { kind: 'boundary_exhausted' } }, 'Boundary reached'],
    ['provider history exhausted', {
      outcome: { kind: 'source_exhausted' },
    }, 'Provider history exhausted'],
    ['continuing later', {
      outcome: { kind: 'yielded', reason: 'invocation_budget' }, status: 'skipped',
    }, 'Continuing later'],
    ['failed', {
      outcome: { kind: 'failed', reason: 'provider_schema_changed' }, status: 'failed',
    }, 'Failed'],
    ['cancelled', {
      outcome: { kind: 'cancelled', reason: 'user_cancelled' }, status: 'cancelled',
    }, 'Cancelled'],
    ['queued', {}, 'Queued'],
  ] as const)('renders the %s state deterministically', (_name, overrides, label) => {
    render(<ConnectorRunSynchronizationDetails run={runFixture(
      overrides as Partial<ConnectorSettingsRun>,
    )} />)

    expect(screen.getByRole('status', { name: 'Connector synchronization state' }))
      .toHaveTextContent(label)
  })

  it('localizes the next attempt time for cooldown without calling it failed or stuck', () => {
    const retryAt = '2026-07-12T12:01:00.000Z'
    render(<ConnectorRunSynchronizationDetails run={runFixture({
      outcome: {
        kind: 'cooling_down',
        operation: {
          kind: 'scope_rate_limited', executionScopeId: 'scope_fixture_run_details',
          retryAt, serverMinimumDelayMs: null,
        },
      },
    })} />)

    const status = screen.getByRole('status', { name: 'Connector synchronization state' })
    expect(status).toHaveTextContent(`Next attempt ${new Date(retryAt).toLocaleString()}`)
    expect(status).not.toHaveTextContent(/failed|stuck/i)
  })

  it.each([
    ['missing', 'reported_stats_missing', 'missing_provider_returned'],
    ['invalid', 'reported_stats_invalid', 'invalid_provider_returned'],
  ] as const)(
    'shows %s provider rows separately from exact capture occurrences',
    (_name, invariant, gap) => {
      render(<ConnectorRunLifecycleDetails run={runFixture({
        lifecycleCounts: lifecycleFixture(invariant, gap),
      })} />)

      expect(screen.getByText('Provider returned rows: Unknown')).toBeInTheDocument()
      expect(screen.queryByText('Provider returned rows: 5')).not.toBeInTheDocument()
      expect(screen.getByText('Captures: 5')).toBeInTheDocument()
      expect(screen.getByText('Provider did not report a valid returned-row count.'))
        .toBeInTheDocument()
    },
  )

  it('renders the installed reconciled destination shape without a false shortfall warning', () => {
    render(<ConnectorRunLifecycleDetails
      showDebugData
      run={runFixture({
        lifecycleCounts: installedReconciledLifecycleFixture(),
      })}
    />)

    const counts = screen.getByLabelText('Run lifecycle counts')
    expect(counts).toHaveTextContent('Normalized: 5')
    expect(counts).toHaveTextContent('Pending: 13')
    expect(counts).toHaveTextContent('Unresolved: 6')
    expect(counts).toHaveTextContent('Gate rejected: 16')
    expect(counts).toHaveTextContent('Capture lineages: 40')
    expect(counts).not.toHaveTextContent('Unclassified:')
    expect(screen.queryByText(/do not reconcile/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/explicitly unclassified/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'How these counts work' }))
    expect(screen.getByText(
      /Capture lineages equal normalized plus pending, unresolved, gate-rejected, and explicitly unclassified records/,
    )).toBeInTheDocument()
    expect(screen.getByText(
      'Visible exceptions: capture shortfall 0; provider unclassified 0; destination unclassified 0; Opportunity unclassified 0.',
    )).toBeInTheDocument()
  })

  it('keeps lineage failure copy separate from explicit unclassified-state copy', () => {
    render(<ConnectorRunLifecycleDetails
      showDebugData
      run={runFixture({
        lifecycleCounts: {
          ...installedReconciledLifecycleFixture(),
          destination: {
            normalized: 5,
            resolvedEmployerOrAts: 4,
            resolvedThirdParty: 1,
            unresolved: 6,
            pending: 11,
            gateRejected: 16,
            unclassified: 2,
            invariant: 'reconciled',
          },
        },
      })}
    />)

    expect(screen.getByLabelText('Run lifecycle counts')).toHaveTextContent('Unclassified: 2')
    expect(screen.getByText(
      /Some persisted rows are explicitly unclassified; they are included in the primary stage totals/,
    )).toBeInTheDocument()
    expect(screen.queryByText(/do not reconcile/i)).not.toBeInTheDocument()
  })

  it('reserves reconcile wording for genuine invariant or capture shortfall failures', () => {
    render(<ConnectorRunLifecycleDetails
      showDebugData
      run={runFixture({
        lifecycleCounts: {
          ...installedReconciledLifecycleFixture(),
          provider: {
            ...installedReconciledLifecycleFixture().provider,
            captureShortfall: 2,
            invariant: 'reconciled',
            gaps: [],
          },
          destination: {
            ...installedReconciledLifecycleFixture().destination,
            invariant: 'lineage_incomplete',
          },
        },
      })}
    />)

    expect(screen.getByText(
      /Some persisted rows do not reconcile; shortfalls remain visible in the count explanation/,
    )).toBeInTheDocument()
    expect(screen.queryByText(/explicitly unclassified/i)).not.toBeInTheDocument()
  })

  it('reconciles released lifecycle counts without opaque carried cycle stats', () => {
    const run = runFixture({
      status: 'failed',
      newestFrontier: { state: 'caught_up' },
      historicalBackfill: {
        state: 'advancing',
        boundary: { earliestDate: '2026-07-01' },
      },
      outcome: { kind: 'failed', reason: 'provider_schema_changed' },
      lifecycleCounts: {
        version: 'connector-run-lifecycle-counts/v1',
        source: 'frozen_terminal',
        scope: {
          kind: 'connector_run',
          connectorRunId: 'pancake-carried-50',
          executionScopeId: 'scope_fixture_run_details',
        },
        provider: {
          returnedRows: 0,
          validRecords: 0,
          invalidRecords: 0,
          sourceDuplicates: 0,
          capturedRecords: 0,
          occurrenceCount: 0,
          captureShortfall: 0,
          unclassifiedRows: 0,
          invariant: 'reported_stats_missing',
          gaps: ['missing_provider_valid'],
        },
        destination: {
          normalized: 0,
          resolvedEmployerOrAts: 0,
          resolvedThirdParty: 0,
          unresolved: 0,
          pending: 0,
          gateRejected: 0,
          unclassified: 0,
          invariant: 'reconciled',
        },
        opportunity: {
          opportunitiesCreated: 0,
          existingJobMatches: 0,
          notFit: 0,
          rejected: 0,
          actionableReview: 0,
          unclassified: 0,
          invariant: 'reconciled',
        },
      },
      warnings: [{
        code: 'jobright_raw_intake_unavailable',
        label: 'raw label',
        message: 'raw message',
        severity: 'blocked',
      }],
      completedAt: '2026-07-11T14:00:01.000Z',
    })

    render(
      <>
        <ConnectorRunSynchronizationDetails run={run} />
        <ConnectorRunLifecycleDetails showDebugData run={run} />
      </>,
    )

    expect(screen.getByText('Stage-specific synchronization counts')).toBeInTheDocument()
    expect(screen.getByText('Provider returned rows: 0')).toBeInTheDocument()
    expect(screen.getByText('Capture lineages: 0')).toBeInTheDocument()
    expect(screen.getByText('Existing Job matches: 0')).toBeInTheDocument()
    expect(screen.getByText('Opportunities added: 0')).toBeInTheDocument()
    expect(screen.queryByText('Carried connector cycle')).not.toBeInTheDocument()
    expect(screen.queryByText('Discovered jobs: 50')).not.toBeInTheDocument()
    expect(screen.queryByText('Discovery page requests: 3')).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Connector synchronization state' }))
      .toHaveTextContent('Failed')
    expect(screen.queryByText(/Technical status:/)).not.toBeInTheDocument()
    expect(screen.getByText('Provider stats gaps: missing provider valid.')).toBeInTheDocument()
    expect(screen.queryByText('Discovered: 50')).not.toBeInTheDocument()

    const explanation = screen.getByRole('button', { name: 'How these counts work' })
    expect(explanation).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(explanation)
    expect(explanation).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/Provider returned rows are response rows, not a unique-job total/))
      .toBeInTheDocument()
    expect(screen.getByText(
      /Captures are intake events; Capture lineages are unique persisted provider-record histories/,
    )).toBeInTheDocument()
  })

  it('omits stale request-budget metrics while preserving provider progress', () => {
    const run = runFixture({
      status: 'skipped',
      newestFrontier: { state: 'caught_up' },
      historicalBackfill: {
        state: 'advancing',
        boundary: { earliestDate: '2026-07-01' },
      },
      pendingResolutionCount: 4,
      outcome: { kind: 'yielded', reason: 'invocation_budget' },
      lifecycleCounts: {
        version: 'connector-run-lifecycle-counts/v1',
        source: 'frozen_terminal',
        scope: {
          kind: 'connector_run',
          connectorRunId: 'budget-stop-reason-run',
          executionScopeId: 'scope_fixture_run_details',
        },
        provider: {
          returnedRows: 0,
          validRecords: 0,
          invalidRecords: 0,
          sourceDuplicates: 0,
          capturedRecords: 0,
          occurrenceCount: 0,
          captureShortfall: 0,
          unclassifiedRows: 0,
          invariant: 'reconciled',
          gaps: [],
        },
        destination: {
          normalized: 0,
          resolvedEmployerOrAts: 0,
          resolvedThirdParty: 0,
          unresolved: 0,
          pending: 4,
          gateRejected: 0,
          unclassified: 0,
          invariant: 'reconciled',
        },
        opportunity: {
          opportunitiesCreated: 0,
          existingJobMatches: 0,
          notFit: 0,
          rejected: 0,
          actionableReview: 0,
          unclassified: 0,
          invariant: 'reconciled',
        },
      },
      completedAt: '2026-07-11T14:00:01.000Z',
    })

    render(
      <>
        <ConnectorRunSynchronizationDetails run={run} />
        <ConnectorRunLifecycleDetails showDebugData run={run} />
      </>,
    )

    expect(screen.getByText('Provider returned rows: 0')).toBeInTheDocument()
    expect(screen.getByText('Capture lineages: 0')).toBeInTheDocument()
    expect(screen.getByText('Pending: 4')).toBeInTheDocument()
    expect(screen.queryByText('Carried connector cycle')).not.toBeInTheDocument()
    expect(screen.queryByText('Discovered jobs: 50')).not.toBeInTheDocument()
    expect(screen.queryByText('Detail attempts: 50')).not.toBeInTheDocument()
    expect(screen.queryByText('Request budget per run: 10')).not.toBeInTheDocument()
    expect(screen.queryByText('Request budget: 50 / 10')).not.toBeInTheDocument()
    expect(screen.queryByText(/Request budget: 50\s*\/\s*10/)).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Connector synchronization state' }))
      .toHaveTextContent('Continuing later')
    expect(screen.queryByText(/Stop reason:/)).not.toBeInTheDocument()
    expect(screen.queryByText('Discovered: 50')).not.toBeInTheDocument()
  })

  it('omits request budget label when run stats lack budget provenance', () => {
    const run = runFixture({
      status: 'failed',
      newestFrontier: { state: 'caught_up' },
      historicalBackfill: {
        state: 'advancing',
        boundary: { earliestDate: '2026-07-01' },
      },
      outcome: { kind: 'failed', reason: 'provider_schema_changed' },
      lifecycleCounts: {
        version: 'connector-run-lifecycle-counts/v1',
        source: 'frozen_terminal',
        scope: {
          kind: 'connector_run',
          connectorRunId: 'missing-budget-run',
          executionScopeId: 'scope_fixture_run_details',
        },
        provider: {
          returnedRows: 0,
          validRecords: 0,
          invalidRecords: 0,
          sourceDuplicates: 0,
          capturedRecords: 0,
          occurrenceCount: 0,
          captureShortfall: 0,
          unclassifiedRows: 0,
          invariant: 'reconciled',
          gaps: [],
        },
        destination: {
          normalized: 0,
          resolvedEmployerOrAts: 0,
          resolvedThirdParty: 0,
          unresolved: 0,
          pending: 0,
          gateRejected: 0,
          unclassified: 0,
          invariant: 'reconciled',
        },
        opportunity: {
          opportunitiesCreated: 0,
          existingJobMatches: 0,
          notFit: 0,
          rejected: 0,
          actionableReview: 0,
          unclassified: 0,
          invariant: 'reconciled',
        },
      },
      completedAt: '2026-07-11T14:00:01.000Z',
    })

    render(
      <>
        <ConnectorRunSynchronizationDetails run={run} />
        <ConnectorRunLifecycleDetails showDebugData run={run} />
      </>,
    )

    expect(screen.getByText('Provider returned rows: 0')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Connector synchronization state' }))
      .toHaveTextContent('Failed')
    expect(screen.queryByText('Detail attempts: 50')).not.toBeInTheDocument()
    expect(screen.queryByText(/Stop reason:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Request budget per run:/i)).not.toBeInTheDocument()
  })

  it('hides connector run advanced diagnostics by default and reveals them when enabled', () => {
    const run = {
      ...runFixture({
        status: 'failed',
        newestFrontier: { state: 'caught_up' },
        historicalBackfill: {
          state: 'advancing',
          boundary: { earliestDate: '2026-07-01' },
        },
        outcome: { kind: 'failed', reason: 'provider_schema_changed' },
        warningCount: 1,
        lifecycleCounts: {
          version: 'connector-run-lifecycle-counts/v1',
          source: 'frozen_terminal',
          scope: {
            kind: 'connector_run',
            connectorRunId: 'debug-carried-run',
            executionScopeId: 'scope_fixture_run_details',
          },
          provider: {
            returnedRows: 0,
            validRecords: 0,
            invalidRecords: 0,
            sourceDuplicates: 0,
            capturedRecords: 0,
            occurrenceCount: 0,
            captureShortfall: 0,
            unclassifiedRows: 0,
            invariant: 'reported_stats_missing',
            gaps: ['missing_provider_valid'],
          },
          destination: {
            normalized: 0,
            resolvedEmployerOrAts: 0,
            resolvedThirdParty: 0,
            unresolved: 0,
            pending: 0,
            gateRejected: 0,
            unclassified: 0,
            invariant: 'reconciled',
          },
          opportunity: {
            opportunitiesCreated: 0,
            existingJobMatches: 0,
            notFit: 0,
            rejected: 0,
            actionableReview: 0,
            unclassified: 0,
            invariant: 'reconciled',
          },
        },
        warnings: [{
          code: 'jobright_raw_intake_unavailable',
          label: 'raw label',
          message: 'raw message',
          severity: 'blocked',
        }],
        completedAt: '2026-07-11T14:00:01.000Z',
      }),
      stats: {
        discovered: 50,
        discoveryPages: 3,
        providerReturned: 0,
        stopReason: 'failed',
      },
    }

    render(
      <>
        <ConnectorRunSynchronizationDetails run={run} />
        <ConnectorRunLifecycleDetails run={run} />
      </>,
    )

    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('Stage-specific synchronization counts')).toBeInTheDocument()
    expect(screen.getByText('Provider returned rows: 0')).toBeInTheDocument()
    expect(screen.queryByText('Frozen at terminal completion.')).not.toBeInTheDocument()
    expect(screen.queryByText('Carried connector cycle')).not.toBeInTheDocument()
    expect(screen.queryByText('Discovered jobs: 50')).not.toBeInTheDocument()
    expect(screen.queryByText('Provider stats gaps: missing provider valid.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'How these counts work' })).not.toBeInTheDocument()

    cleanup()
    render(
      <>
        <ConnectorRunSynchronizationDetails run={run} />
        <ConnectorRunLifecycleDetails showDebugData run={run} />
      </>,
    )

    expect(screen.getByText('Frozen at terminal completion.')).toBeInTheDocument()
    expect(screen.getByText('Carried connector cycle')).toBeInTheDocument()
    expect(screen.getByText('Discovered jobs: 50')).toBeInTheDocument()
    expect(screen.getByText('Provider stats gaps: missing provider valid.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'How these counts work' })).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('Stage-specific synchronization counts')).toBeInTheDocument()
  })
})

function lifecycleFixture(
  invariant: 'reported_stats_missing' | 'reported_stats_invalid',
  gap: 'missing_provider_returned' | 'invalid_provider_returned',
): NonNullable<ConnectorSettingsRun['lifecycleCounts']> {
  return {
    version: 'connector-run-lifecycle-counts/v1',
    source: 'frozen_terminal',
    scope: {
      kind: 'connector_run',
      connectorRunId: 'connector-run-sync-fixture',
      executionScopeId: 'scope_fixture_run_details',
    },
    provider: {
      returnedRows: 5,
      validRecords: 3,
      invalidRecords: 0,
      sourceDuplicates: 0,
      capturedRecords: 3,
      occurrenceCount: 5,
      captureShortfall: 0,
      unclassifiedRows: 2,
      invariant,
      gaps: [gap],
    },
    destination: {
      normalized: 0,
      resolvedEmployerOrAts: 0,
      resolvedThirdParty: 0,
      unresolved: 0,
      pending: 3,
      gateRejected: 0,
      unclassified: 0,
      invariant: 'reconciled',
    },
    opportunity: {
      opportunitiesCreated: 0,
      existingJobMatches: 0,
      notFit: 0,
      rejected: 0,
      actionableReview: 0,
      unclassified: 0,
      invariant: 'reconciled',
    },
  }
}

function installedReconciledLifecycleFixture(): NonNullable<ConnectorSettingsRun['lifecycleCounts']> {
  return {
    version: 'connector-run-lifecycle-counts/v1',
    source: 'frozen_terminal',
    scope: {
      kind: 'connector_run',
      connectorRunId: 'connector-run-sync-fixture',
      executionScopeId: 'scope_fixture_run_details',
    },
    provider: {
      returnedRows: 40,
      validRecords: 40,
      invalidRecords: 0,
      sourceDuplicates: 0,
      capturedRecords: 40,
      occurrenceCount: 40,
      captureShortfall: 0,
      unclassifiedRows: 0,
      invariant: 'reconciled',
      gaps: [],
    },
    destination: {
      normalized: 5,
      resolvedEmployerOrAts: 4,
      resolvedThirdParty: 1,
      unresolved: 6,
      pending: 13,
      gateRejected: 16,
      unclassified: 0,
      invariant: 'reconciled',
    },
    opportunity: {
      opportunitiesCreated: 0,
      existingJobMatches: 2,
      notFit: 0,
      rejected: 0,
      actionableReview: 3,
      unclassified: 0,
      invariant: 'reconciled',
    },
  }
}

function runFixture(overrides: Partial<ConnectorSettingsRun> = {}): ConnectorSettingsRun {
  return {
    id: 'connector-run-sync-fixture',
    connectorInstanceId: 'connector-instance-fixture',
    executionScopeId: 'scope_fixture_run_details',
    mode: 'manual',
    scheduleOccurrence: null,
    status: 'running',
    filterSignature: 'filters:{}',
    observationCount: 0,
    warningCount: 0,
    warnings: [],
    newestFrontier: { state: 'not_started' },
    historicalBackfill: {
      state: 'not_started',
      boundary: { earliestDate: '2026-07-01' },
    },
    pendingResolutionCount: 0,
    outcome: { kind: 'in_progress' },
    startedAt: '2026-07-12T12:00:00.000Z',
    completedAt: null,
    ...overrides,
  }
}
