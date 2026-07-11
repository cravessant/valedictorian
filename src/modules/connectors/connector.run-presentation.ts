export interface ConnectorRunTerminalCopy {
  summary: string
  detail: string | null
  technical: string | null
}

export function connectorRunTerminalCopy(run: {
  status: string
  stats: unknown
  retryHints: unknown
  warnings?: unknown
}): ConnectorRunTerminalCopy {
  const stats = recordFromUnknown(run.stats)
  const retryHints = recordFromUnknown(run.retryHints)
  const lifecycle = recordFromUnknown(stats.lifecycleCounts)
  const destination = recordFromUnknown(lifecycle.destination)
  const sourcing = recordFromUnknown(lifecycle.sourcing)
  const pending = nonNegativeInteger(destination.pending)
  const stopReason = stringFromUnknown(stats.stopReason)
    || stringFromUnknown(retryHints.stopReason)
  const warningCodes = Array.isArray(run.warnings)
    ? run.warnings.map((warning) => stringFromUnknown(recordFromUnknown(warning).code))
    : []
  const summary = terminalSummary(run.status, stopReason, sourcing, warningCodes)
  const resumes = new Set([
    'auth_required',
    'challenge',
    'rate_limited',
    'retryable_failure',
    'runtime_limit',
    'soft_batch_boundary',
  ]).has(stopReason)
  const detail = pending > 0
    ? `${pending} unique ${pending === 1 ? 'job remains' : 'jobs remain'} pending.${resumes ? ' The next run resumes from the persisted checkpoint.' : ''}`
    : null

  return {
    summary,
    detail,
    technical: run.status === 'partial_success'
      ? 'Technical status: partial success.'
      : null,
  }
}

function terminalSummary(
  status: string,
  stopReason: string,
  sourcing: Record<string, unknown>,
  warningCodes: string[],
): string {
  if (status === 'cancelled' || stopReason === 'cancelled') return 'Cancelled'
  if (stopReason === 'target_met') return 'Target reached'
  if (stopReason === 'source_exhausted') return 'Provider exhausted'
  if (stopReason === 'backfill_horizon') return 'Backfill horizon reached'
  if (stopReason === 'cycle_attempt_limit') return 'Cycle attempt limit reached'
  if (stopReason === 'discovery_page_limit') return 'Finite discovery page limit reached'
  if (stopReason === 'discovery_record_limit') return 'Finite discovery record limit reached'
  if (stopReason === 'soft_batch_boundary') return 'Paused at a finite batch boundary'
  if (stopReason === 'runtime_limit') return 'Paused at the run time limit'
  if (stopReason === 'rate_limited' || stopReason === 'retryable_failure') {
    return 'Paused until retry'
  }
  if (
    stopReason === 'auth_required'
    || stopReason === 'challenge'
    || stopReason === 'failed'
    || stopReason === 'invalid_discovery_position'
  ) {
    return 'Needs action'
  }
  if (warningCodes.some((code) =>
    code.includes('rate_limited') || code.includes('retryable'))) {
    return 'Paused until retry'
  }
  if (warningCodes.some((code) =>
    code.includes('auth')
    || code.includes('captcha')
    || code.includes('challenge')
    || code.includes('parser')
    || code.includes('raw_intake')
    || code.includes('normalization')
    || code.includes('execution_failed'))) {
    return 'Needs action'
  }

  const added = nonNegativeInteger(sourcing.added)
  const duplicates = nonNegativeInteger(sourcing.queueDuplicate)
  const rejected = nonNegativeInteger(sourcing.notFit) + nonNegativeInteger(sourcing.rejected)
  if (added === 0 && duplicates > 0 && rejected === 0) {
    return 'Completed with queue duplicates'
  }
  if (added === 0 && rejected > 0) {
    return 'Completed with sourcing rejections'
  }
  if (status === 'failed') return 'Needs action'
  if (status === 'skipped') return 'Skipped'
  if (status === 'queued') return 'Queued'
  if (status === 'running') return 'Running'
  return 'Completed'
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringFromUnknown(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0
}
