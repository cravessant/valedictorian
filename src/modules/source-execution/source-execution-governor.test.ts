import { describe, expect, it } from 'vitest'
import { createDrizzleDatabase, createInMemoryDatabase, migrateDatabase } from '../../db/sqlite'
import {
  createSourceExecutionGovernor,
  deriveSourceExecutionScopeId,
} from './source-execution-governor'

describe('source execution governor', () => {
  it('derives the migration-compatible stable scope and rejects untrusted oversized instance ids', () => {
    expect(deriveSourceExecutionScopeId('instance-one'))
      .toBe(`scope_${Buffer.from('instance-one').toString('hex')}`)
    expect(() => deriveSourceExecutionScopeId('x'.repeat(126)))
      .toThrow('cannot produce a valid source execution scope')
  })
  it('blocks arbitrary same-scope work while allowing unrelated due work', () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const governor = createSourceExecutionGovernor(database)
    const jobrightScope = deriveSourceExecutionScopeId('jobright-primary')
    const unrelatedScope = deriveSourceExecutionScopeId('fixture-secondary')

    governor.ensureScope(jobrightScope, '2026-07-12T12:00:00.000Z')
    governor.ensureScope(unrelatedScope, '2026-07-12T12:00:00.000Z')
    governor.blockScope(jobrightScope, {
      now: '2026-07-12T12:00:00.000Z',
      random: () => 0.5,
      retryAfter: 'Sun, 12 Jul 2026 12:05:00 GMT',
    })

    expect(governor.isAvailable(jobrightScope, '2026-07-12T12:04:59.999Z')).toBe(false)
    expect(governor.isAvailable(unrelatedScope, '2026-07-12T12:04:59.999Z')).toBe(true)
    expect(governor.isAvailable(jobrightScope, '2026-07-12T12:05:00.000Z')).toBe(true)
    sqlite.close()
  })

  it('uses one refresh generation for concurrent authentication failures', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const governor = createSourceExecutionGovernor(createDrizzleDatabase(sqlite))
    const scopeId = deriveSourceExecutionScopeId('jobright-primary')
    governor.ensureScope(scopeId, '2026-07-12T12:00:00.000Z')
    const first = governor.acquireRefreshLease(scopeId, {
      leaseMs: 60_000,
      now: '2026-07-12T12:00:00.000Z',
      token: 'refresh-first',
    })
    const concurrent = governor.acquireRefreshLease(scopeId, {
      leaseMs: 60_000,
      now: '2026-07-12T12:00:00.001Z',
      token: 'refresh-concurrent',
    })

    expect(first).toEqual({
      expiresAt: '2026-07-12T12:01:00.000Z',
      token: 'refresh-first',
    })
    expect(concurrent).toBeNull()
    expect(governor.completeRefresh(scopeId, {
      now: '2026-07-12T12:00:01.000Z',
      token: 'refresh-first',
    })).toMatchObject({ authGeneration: 1, status: 'available' })
    expect(governor.completeRefresh(scopeId, {
      now: '2026-07-12T12:00:01.001Z',
      token: 'refresh-first',
    })).toBeNull()
    sqlite.close()
  })

  it('persists failed refresh as action-required across restart without advancing generation', () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const scopeId = deriveSourceExecutionScopeId('jobright-primary')
    const first = createSourceExecutionGovernor(createDrizzleDatabase(sqlite))
    first.ensureScope(scopeId, '2026-07-12T12:00:00.000Z')
    first.acquireRefreshLease(scopeId, {
      leaseMs: 60_000,
      now: '2026-07-12T12:00:00.000Z',
      token: 'failed-refresh',
    })
    expect(first.failRefresh(scopeId, {
      now: '2026-07-12T12:00:01.000Z',
      reason: 'credentials rejected',
      token: 'failed-refresh',
    })).toMatchObject({
      actionReason: 'source_action_required',
      authGeneration: 0,
      status: 'action_required',
    })

    const restarted = createSourceExecutionGovernor(createDrizzleDatabase(sqlite))
    expect(restarted.isAvailable(scopeId, '2026-07-13T12:00:00.000Z')).toBe(false)
    expect(restarted.acquireRefreshLease(scopeId, {
      leaseMs: 60_000,
      now: '2026-07-13T12:00:00.000Z',
    })).toBeNull()
    sqlite.close()
  })

  it('recovers elapsed cooldowns but keeps action-required closed to ordinary refresh', () => {
    const sqlite = createInMemoryDatabase(); migrateDatabase(sqlite)
    const governor = createSourceExecutionGovernor(createDrizzleDatabase(sqlite))
    const cooldown = deriveSourceExecutionScopeId('cooldown-recovery')
    governor.ensureScope(cooldown, '2026-07-12T12:00:00.000Z')
    governor.blockScope(cooldown, { now: '2026-07-12T12:00:00.000Z', retryAfter: '1' })
    expect(governor.acquireRefreshLease(cooldown, { now: '2026-07-12T12:00:01.000Z', leaseMs: 1000, token: 'elapsed' }))
      .toEqual({ expiresAt: '2026-07-12T12:00:02.000Z', token: 'elapsed' })
    const action = deriveSourceExecutionScopeId('explicit-recovery')
    governor.ensureScope(action, '2026-07-12T12:00:00.000Z')
    const first = governor.acquireRefreshLease(action, { now: '2026-07-12T12:00:00.000Z', leaseMs: 1000, token: 'first' })!
    governor.failRefresh(action, { now: '2026-07-12T12:00:00.100Z', token: first.token, reason: 'credentials_missing' })
    expect(governor.acquireRefreshLease(action, { now: '2026-07-12T12:01:00.000Z', leaseMs: 1000 })).toBeNull()
    expect(governor.acquireRefreshLease(action, { now: '2026-07-12T12:01:00.000Z', leaseMs: 1000,
      token: 'explicit', allowActionRequired: true })).toMatchObject({ token: 'explicit' })
    sqlite.close()
  })

  it('fences reconnect validation without deleting the canonical session or stealing an ordinary lease', () => {
    const sqlite = createInMemoryDatabase(); migrateDatabase(sqlite)
    const governor = createSourceExecutionGovernor(createDrizzleDatabase(sqlite))
    const scope = deriveSourceExecutionScopeId('reconnect-validation')
    governor.ensureScope(scope, '2026-07-12T12:00:00.000Z')
    const ordinary = governor.acquireRefreshLease(scope, { now: '2026-07-12T12:00:01.000Z', leaseMs: 10, token: 'ordinary' })!
    expect(governor.acquireReconnectLease(scope, { now: '2026-07-12T12:00:01.001Z', leaseMs: 10, token: 'reconnect' })).toBeNull()
    expect(governor.completeRefresh(scope, { now: '2026-07-12T12:00:01.005Z', token: ordinary.token, encryptedSession: 'canonical' }))
      .toMatchObject({ authGeneration: 1 })
    const reconnect = governor.acquireReconnectLease(scope, { now: '2026-07-12T12:00:02.000Z', leaseMs: 10, token: 'reconnect' })!
    expect(governor.loadActiveSession(scope)?.encryptedSession).toBe('canonical')
    expect(governor.isAvailable(scope, '2026-07-12T12:00:02.000Z')).toBe(false)
    expect(governor.finishReconnectValidation(scope, {
      now: '2026-07-12T12:00:03.000Z', reason: 'jobright_auth_ready', status: 'available',
      token: reconnect.token,
    })).toMatchObject({ status: 'available', actionReason: null })
    expect(governor.finishReconnectValidation(scope, {
      now: '2026-07-12T12:00:04.000Z', reason: 'stale_validation', status: 'action_required',
      token: reconnect.token,
    })).toBeNull()
    expect(governor.getScope(scope)).toMatchObject({ status: 'available', actionReason: null })
    sqlite.close()
  })

  it('preserves an exact millisecond provider minimum at a fractional timestamp', () => {
    const sqlite = createInMemoryDatabase(); migrateDatabase(sqlite)
    const governor = createSourceExecutionGovernor(createDrizzleDatabase(sqlite))
    const scope = deriveSourceExecutionScopeId('exact-provider-minimum')
    governor.ensureScope(scope, '2026-07-12T12:00:00.250Z')
    const lease = governor.acquireRefreshLease(scope, {
      now: '2026-07-12T12:00:00.250Z', leaseMs: 10_000, token: 'rate-limit',
    })!
    governor.cooldownRefresh(scope, {
      now: '2026-07-12T12:00:00.250Z', random: () => 0,
      serverMinimumDelayMs: 1500, token: lease.token,
    })
    expect(Date.parse(governor.getScope(scope).blockedUntil!))
      .toBeGreaterThanOrEqual(Date.parse('2026-07-12T12:00:01.750Z'))
    sqlite.close()
  })

  it.each(['-1', '1.5', 'NaN', 'Infinity', '1e309', '999999999999999999999999999999', 'not-a-date'])(
    'falls back to bounded jitter for invalid Retry-After %s', (retryAfter) => {
      const sqlite = createInMemoryDatabase(); migrateDatabase(sqlite)
      const governor = createSourceExecutionGovernor(createDrizzleDatabase(sqlite))
      const scope = deriveSourceExecutionScopeId(`retry-${retryAfter.replace(/\W/g, '-')}`)
      governor.ensureScope(scope, '2026-07-12T12:00:00.000Z')
      expect(() => governor.blockScope(scope, { now: '2026-07-12T12:00:00.000Z', retryAfter, random: () => 0.5 })).not.toThrow()
      expect(governor.getScope(scope)).toMatchObject({ blockedUntil: '2026-07-12T12:00:15.000Z', backoffAttempt: 1 })
      sqlite.close()
    },
  )
})
