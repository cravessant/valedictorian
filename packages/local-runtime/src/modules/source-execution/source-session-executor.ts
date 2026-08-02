import type {
  ConnectorAuthEstablish,
  ConnectorAuthEstablishmentResult,
} from '@sparxie/valedictorian-connectors-core'
import type { SourceExecutionScopeId } from '@sparxie/sdk'
import type { createSourceExecutionGovernor } from './source-execution-governor.js'

export function createSourceSessionExecutor(options: {
  governor: ReturnType<typeof createSourceExecutionGovernor>
  now?: () => Date
  refreshLeaseMs?: number
  refreshWaitMs?: number
}) {
  const now = options.now ?? (() => new Date())
  const refreshLeaseMs = options.refreshLeaseMs ?? 60_000
  const refreshWaitMs = options.refreshWaitMs ?? 25
  const inFlightRefreshes = new Map<SourceExecutionScopeId, Promise<ConnectorAuthEstablishmentResult>>()

  return {
    async resolve(scopeId: SourceExecutionScopeId) {
      return readyFromActiveSession(scopeId)
    },
    async refresh(scopeId: SourceExecutionScopeId, establish: ConnectorAuthEstablish, input: { allowActionRequired?: boolean } = {}) {
      const observedGeneration = (await options.governor.getScope(scopeId)).authGeneration
      let refresh = inFlightRefreshes.get(scopeId)
      if (!refresh) {
        refresh = refreshOrWait(scopeId, observedGeneration, establish, input.allowActionRequired === true)
        inFlightRefreshes.set(scopeId, refresh)
        void refresh.finally(() => inFlightRefreshes.delete(scopeId)).catch(() => undefined)
      }
      return refresh
    },
    async reconnect(scopeId: SourceExecutionScopeId, establish: ConnectorAuthEstablish, token: string) {
      if (!await ownsActiveRefreshLease(scopeId, token)) return canonicalOutcome(scopeId)
      return performRefresh(scopeId, establish, token, true)
    },
  }

  async function refreshOrWait(
    scopeId: SourceExecutionScopeId,
    initialGeneration: number,
    establish: ConnectorAuthEstablish,
    allowActionRequired: boolean,
  ): Promise<ConnectorAuthEstablishmentResult> {
    const current = await readyFromNewGeneration(scopeId, initialGeneration)
    if (current) return current
    const lease = await options.governor.acquireRefreshLease(scopeId, {
      allowActionRequired, leaseMs: refreshLeaseMs, now: now().toISOString(),
    })
    if (lease) return performRefresh(scopeId, establish, lease.token, false)

    for (;;) {
      const ready = await readyFromNewGeneration(scopeId, initialGeneration)
      if (ready) return ready
      const scope = await options.governor.getScope(scopeId)
      if (scope.status === 'action_required') {
        return { status: 'action_required', reason: scope.actionReason ?? 'source_action_required' }
      }
      if (scope.status === 'cooldown') {
        return { status: 'rate_limited', reason: 'source_scope_cooldown' }
      }
      if (scope.status !== 'refreshing' || (scope.refreshLeaseExpiresAt && scope.refreshLeaseExpiresAt <= now().toISOString())) {
        const recovered = await options.governor.acquireRefreshLease(scopeId, {
          allowActionRequired, leaseMs: refreshLeaseMs, now: now().toISOString(),
        })
        if (recovered) return performRefresh(scopeId, establish, recovered.token, false)
      }
      await new Promise((resolve) => setTimeout(resolve, refreshWaitMs))
    }
  }

  async function performRefresh(
    scopeId: SourceExecutionScopeId,
    establish: ConnectorAuthEstablish,
    token: string,
    explicitValidation: boolean,
  ): Promise<ConnectorAuthEstablishmentResult> {
    let result: ConnectorAuthEstablishmentResult
    try {
      result = await establish()
    } catch {
      result = { status: 'failed', reason: 'session_refresh_failed' }
    }
    const timestamp = now().toISOString()
    if (result.status === 'ready') {
      const completed = await options.governor.completeRefresh(scopeId, {
        encryptedSession: result.sessionId, now: timestamp, token,
      })
      return completed ? result : await canonicalOutcome(scopeId)
    }
    if (result.status === 'action_required' || result.status === 'failed') {
      const failed = await options.governor.failRefresh(scopeId, { now: timestamp, reason: result.reason, token })
      return failed ? result : await canonicalOutcome(scopeId)
    } else {
      if (result.status === 'rate_limited') {
        const cooled = await options.governor.cooldownRefresh(scopeId, {
          now: timestamp,
          serverMinimumDelayMs: result.serverMinimumDelayMs,
          token,
        })
        return cooled ? result : await canonicalOutcome(scopeId)
      }
      if (explicitValidation) {
        const failed = await options.governor.failRefresh(scopeId, {
          now: timestamp, reason: `source_validation_${result.status}`, token,
        })
        return failed ? result : await canonicalOutcome(scopeId)
      }
      const released = await options.governor.releaseRefreshLease(scopeId, { now: timestamp, token })
      return released ? result : await canonicalOutcome(scopeId)
    }
  }

  async function readyFromNewGeneration(scopeId: SourceExecutionScopeId, generation: number) {
    return (await options.governor.getScope(scopeId)).authGeneration > generation
      ? readyFromActiveSession(scopeId)
      : null
  }

  async function ownsActiveRefreshLease(scopeId: SourceExecutionScopeId, token: string) {
    const scope = await options.governor.getScope(scopeId)
    return scope.status === 'refreshing'
      && scope.refreshLeaseToken === token
      && scope.refreshLeaseExpiresAt !== null
      && scope.refreshLeaseExpiresAt > now().toISOString()
  }

  async function readyFromActiveSession(scopeId: SourceExecutionScopeId): Promise<ConnectorAuthEstablishmentResult> {
    const active = await options.governor.loadActiveSession(scopeId)
    return active
      ? { status: 'ready', sessionId: active.encryptedSession }
      : { status: 'failed', reason: 'source_session_generation_missing' }
  }

  async function canonicalOutcome(scopeId: SourceExecutionScopeId): Promise<ConnectorAuthEstablishmentResult> {
    const [scope, session] = await Promise.all([
      options.governor.getScope(scopeId),
      options.governor.loadActiveSession(scopeId),
    ])
    if (session && session.authGeneration === scope.authGeneration) {
      return { status: 'ready', sessionId: session.encryptedSession }
    }
    if (scope.status === 'action_required') {
      return { status: 'action_required', reason: scope.actionReason ?? 'source_action_required' }
    }
    if (scope.status === 'cooldown') {
      const delay = scope.blockedUntil ? Math.max(0, Date.parse(scope.blockedUntil) - now().getTime()) : undefined
      return { status: 'rate_limited', reason: 'source_scope_cooldown',
        ...(delay === undefined ? {} : { serverMinimumDelayMs: delay }) }
    }
    if (scope.status === 'refreshing') {
      return { status: 'retryable', reason: 'source_refresh_in_progress', retryReason: 'server_failure' }
    }
    return { status: 'failed', reason: 'source_session_generation_missing' }
  }
}
