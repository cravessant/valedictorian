import { describe, expect, it } from 'vitest'
import { connectorRunSynchronizationCopy } from './connector.run-presentation'

describe('connector synchronization presentation', () => {
  it('presents an advancing newest frontier as checking newest', () => {
    expect(connectorRunSynchronizationCopy(synchronizationFixture({
      newestFrontier: { state: 'advancing' },
    }))).toMatchObject({
      state: 'checking_newest',
      label: 'Checking newest',
      summary: 'Checking the provider for newly published jobs.',
    })
  })

  it('presents historical progress as backfilling after newest is caught up', () => {
    expect(connectorRunSynchronizationCopy(synchronizationFixture({
      newestFrontier: { state: 'caught_up' },
      historicalBackfill: {
        state: 'advancing',
        boundary: { earliestDate: '2026-07-01' },
      },
    }))).toMatchObject({
      state: 'backfilling',
      label: 'Backfilling',
      summary: 'Checking older provider history toward the configured boundary.',
    })
  })

  it('presents pending destination work as resolving after both frontiers advance', () => {
    expect(connectorRunSynchronizationCopy(synchronizationFixture({
      newestFrontier: { state: 'caught_up' },
      historicalBackfill: {
        state: 'caught_up',
        boundary: { earliestDate: '2026-07-01' },
      },
      pendingResolutionCount: 4,
    }))).toMatchObject({
      state: 'resolving',
      label: 'Resolving links',
      summary: '4 captured jobs still need destination resolution.',
    })
  })

  it('presents provider cooldown ahead of unfinished frontier work', () => {
    const retryAt = '2026-07-12T12:02:00.000Z'
    expect(connectorRunSynchronizationCopy(synchronizationFixture({
      newestFrontier: { state: 'advancing' },
      outcome: {
        kind: 'cooling_down',
        operation: {
          kind: 'scope_rate_limited',
          executionScopeId: 'scope_fixture_run_presentation',
          retryAt,
          serverMinimumDelayMs: 120_000,
        },
      },
      status: 'completed',
    }))).toMatchObject({
      state: 'cooling_down',
      label: 'Cooling down',
      nextAttemptAt: retryAt,
      summary: 'The provider asked this connector to pause requests.',
    })
  })

  it('presents authentication action ahead of unfinished frontier work', () => {
    expect(connectorRunSynchronizationCopy(synchronizationFixture({
      newestFrontier: { state: 'advancing' },
      outcome: {
        kind: 'action_required',
        operation: {
          kind: 'authentication_expired',
          executionScopeId: 'scope_fixture_run_presentation',
          requestRefresh: true,
        },
      },
      status: 'completed',
    }))).toMatchObject({
      state: 'authentication_required',
      label: 'Authentication required',
      summary: 'Refresh connector credentials to continue synchronization.',
    })
  })

  it('presents fully synchronized work as caught up', () => {
    expect(connectorRunSynchronizationCopy(synchronizationFixture({
      historicalBackfill: {
        state: 'caught_up',
        boundary: { earliestDate: '2026-07-01' },
      },
      newestFrontier: { state: 'caught_up' },
      outcome: { kind: 'caught_up' },
      status: 'completed',
    }))).toMatchObject({
      state: 'caught_up',
      label: 'Caught up',
      summary: 'Newest jobs, historical backfill, and pending link resolution are caught up.',
    })
  })

  it('presents the configured backfill boundary distinctly', () => {
    expect(connectorRunSynchronizationCopy(synchronizationFixture({
      historicalBackfill: {
        state: 'boundary_reached',
        boundary: { earliestDate: '2026-07-01' },
      },
      newestFrontier: { state: 'caught_up' },
      outcome: { kind: 'boundary_exhausted' },
      status: 'completed',
    }))).toMatchObject({
      state: 'boundary_exhausted',
      label: 'Boundary reached',
      summary: 'Historical backfill reached the configured boundary.',
    })
  })

  it('presents provider history exhaustion separately from the configured boundary', () => {
    expect(connectorRunSynchronizationCopy(synchronizationFixture({
      historicalBackfill: {
        state: 'source_exhausted',
        boundary: { earliestDate: '2026-07-01' },
      },
      newestFrontier: { state: 'caught_up' },
      outcome: { kind: 'source_exhausted' },
      status: 'completed',
    }))).toMatchObject({
      state: 'source_exhausted',
      label: 'Provider history exhausted',
      summary: 'The provider has no older history available before this point.',
    })
  })

  it('explains a worker-lease yield without promising an app-owned runner', () => {
    expect(connectorRunSynchronizationCopy(synchronizationFixture({
      historicalBackfill: {
        state: 'advancing',
        boundary: { earliestDate: '2026-07-01' },
      },
      newestFrontier: { state: 'caught_up' },
      outcome: { kind: 'yielded', reason: 'invocation_budget' },
      pendingResolutionCount: 2,
      status: 'skipped',
    }))).toMatchObject({
      state: 'skipped',
      label: 'Continuing later',
      summary: 'Yielded work is safely checkpointed for the next admitted manual or scheduled work opportunity.',
    })
  })

  it('presents an explicit failed synchronization outcome', () => {
    expect(connectorRunSynchronizationCopy(synchronizationFixture({
      outcome: { kind: 'failed', reason: 'provider_schema_changed' },
      status: 'failed',
    }))).toMatchObject({
      state: 'failed',
      label: 'Failed',
      summary: 'Synchronization stopped because the connector failed.',
    })
  })

  it('presents an explicit cancelled synchronization outcome', () => {
    expect(connectorRunSynchronizationCopy(synchronizationFixture({
      outcome: { kind: 'cancelled', reason: 'user_cancelled' },
      status: 'cancelled',
    }))).toMatchObject({
      state: 'cancelled',
      label: 'Cancelled',
      summary: 'Synchronization was cancelled before this work opportunity finished.',
    })
  })
})

function synchronizationFixture(overrides: Record<string, unknown> = {}) {
  return {
    status: 'running',
    newestFrontier: { state: 'not_started' },
    historicalBackfill: {
      state: 'not_started',
      boundary: { earliestDate: '2026-07-01' },
    },
    pendingResolutionCount: 0,
    outcome: { kind: 'in_progress' },
    ...overrides,
  }
}
