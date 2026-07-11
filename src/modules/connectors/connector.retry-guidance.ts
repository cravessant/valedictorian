import type { RetryAdvice } from 'sparxie'

export function formatRetryAdviceGuidance(advice: RetryAdvice): string {
  const state = {
    cancelled: 'Retry cancelled',
    exhausted: 'Retry exhausted',
    not_due: 'Skipped — not due',
    scheduled: 'Retry scheduled',
  }[advice.state]
  const reason = {
    network_interruption: 'Network interrupted',
    operation_timeout: 'Operation timed out',
    rate_limit: 'Rate limited',
    server_failure: 'Server unavailable',
  }[advice.reason]
  const next = advice.nextAttemptAt
    ? ` · Next attempt ${new Date(advice.nextAttemptAt).toLocaleString()}`
    : ''
  return `${state} · ${reason} · Attempt ${advice.attempt} of ${advice.maxAttempts}${next}`
}
