import type { LifecycleActor } from '@sparxie/sdk'

/**
 * Stable attributable desktop user actor used by lifecycle-table mutation
 * flows. The id is a stable, machine-local identifier so audit trails stay
 * attributable across renderer sessions without requiring auth context.
 */
export const DESKTOP_USER_ACTOR: LifecycleActor = Object.freeze({
  id: 'valedictorian-desktop-user',
  type: 'user',
  displayName: 'Desktop user',
}) as LifecycleActor

let idempotencyCounter = 0

/**
 * Generates a fresh idempotency key for lifecycle mutations. Uses a monotonic
 * counter plus a random UUID when available so that re-submits are intentional
 * but distinct keys are unique per attempt.
 */
export function newIdempotencyKey(prefix = 'desktop'): string {
  idempotencyCounter += 1
  const uuid = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)
  return `${prefix}-${idempotencyCounter}-${uuid}`
}

/**
 * Resets the idempotency counter. Test-only seam so red/green tests can
 * assert deterministic prefixes without leaking counter state across files.
 */
export function __resetLifecycleActorCounterForTests(): void {
  idempotencyCounter = 0
}