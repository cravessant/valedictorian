import type {
  ConnectorRunSummary,
  ConnectorStatusState,
} from 'sparxie'

type ConnectorSynchronizationInput = Pick<
  ConnectorRunSummary,
  'historicalBackfill' | 'newestFrontier' | 'outcome' | 'pendingResolutionCount' | 'status'
>

export interface ConnectorSynchronizationCopy {
  label: string
  nextAttemptAt: string | null
  state: ConnectorStatusState
  summary: string
}

export function connectorRunSynchronizationCopy(
  run: ConnectorSynchronizationInput,
): ConnectorSynchronizationCopy {
  if (run.outcome.kind === 'action_required') {
    return {
      label: 'Authentication required',
      nextAttemptAt: null,
      state: 'authentication_required',
      summary: 'Refresh connector credentials to continue synchronization.',
    }
  }
  if (run.outcome.kind === 'cooling_down') {
    return {
      label: 'Cooling down',
      nextAttemptAt: run.outcome.operation.retryAt,
      state: 'cooling_down',
      summary: 'The provider asked this connector to pause requests.',
    }
  }
  if (run.outcome.kind === 'caught_up') {
    return {
      label: 'Caught up',
      nextAttemptAt: null,
      state: 'caught_up',
      summary: 'Newest jobs, historical backfill, and pending link resolution are caught up.',
    }
  }
  if (run.outcome.kind === 'boundary_exhausted') {
    return {
      label: 'Boundary reached',
      nextAttemptAt: null,
      state: 'boundary_exhausted',
      summary: 'Historical backfill reached the configured boundary.',
    }
  }
  if (run.outcome.kind === 'source_exhausted') {
    return {
      label: 'Provider history exhausted',
      nextAttemptAt: null,
      state: 'source_exhausted',
      summary: 'The provider has no older history available before this point.',
    }
  }
  if (run.outcome.kind === 'yielded') {
    return {
      label: 'Continuing later',
      nextAttemptAt: null,
      state: 'skipped',
      summary: 'Yielded work is safely checkpointed for the next admitted manual or scheduled work opportunity.',
    }
  }
  if (run.outcome.kind === 'failed') {
    return {
      label: 'Failed',
      nextAttemptAt: null,
      state: 'failed',
      summary: 'Synchronization stopped because the connector failed.',
    }
  }
  if (run.outcome.kind === 'cancelled') {
    if (run.outcome.reason.startsWith('user_skipped')) {
      return {
        label: 'Skipped by user',
        nextAttemptAt: null,
        state: 'skipped',
        summary: 'This synchronization work opportunity was skipped by the user.',
      }
    }
    return {
      label: 'Cancelled',
      nextAttemptAt: null,
      state: 'cancelled',
      summary: 'Synchronization was cancelled before this work opportunity finished.',
    }
  }
  if (run.newestFrontier.state === 'advancing') {
    return {
      label: 'Checking newest',
      nextAttemptAt: null,
      state: 'checking_newest',
      summary: 'Checking the provider for newly published jobs.',
    }
  }
  if (run.historicalBackfill.state === 'advancing') {
    return {
      label: 'Backfilling',
      nextAttemptAt: null,
      state: 'backfilling',
      summary: 'Checking older provider history toward the configured boundary.',
    }
  }
  if (run.pendingResolutionCount > 0) {
    return {
      label: 'Resolving links',
      nextAttemptAt: null,
      state: 'resolving',
      summary: `${run.pendingResolutionCount} captured ${run.pendingResolutionCount === 1 ? 'job still needs' : 'jobs still need'} destination resolution.`,
    }
  }
  return {
    label: 'Queued',
    nextAttemptAt: null,
    state: 'queued',
    summary: 'Waiting to advance connector synchronization.',
  }
}
