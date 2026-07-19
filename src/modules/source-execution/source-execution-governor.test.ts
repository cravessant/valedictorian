import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createPgliteClient, migratePgliteDatabase } from '../../db/pglite'
import { useResettablePgliteTestDatabase } from '../../test/pglite-test-owner'
import {
  createSourceExecutionGovernor,
  deriveSourceExecutionScopeId,
} from './source-execution-governor'

const resettableDatabase = useResettablePgliteTestDatabase()

async function createTestDatabase() {
  return resettableDatabase()
}

describe.sequential('source execution governor', () => {
  it('derives the migration-compatible stable scope and rejects untrusted oversized instance ids', async () => {
    expect(deriveSourceExecutionScopeId('instance-one'))
      .toBe(`scope_${Buffer.from('instance-one').toString('hex')}`)
    expect(() => deriveSourceExecutionScopeId('x'.repeat(126)))
      .toThrow('cannot produce a valid source execution scope')
  })
  it('blocks arbitrary same-scope work while allowing unrelated due work', async () => {
    const database = await createTestDatabase()
    const governor = createSourceExecutionGovernor(database)
    const jobrightScope = deriveSourceExecutionScopeId('jobright-primary')
    const unrelatedScope = deriveSourceExecutionScopeId('fixture-secondary')

    await governor.ensureScope(jobrightScope, '2026-07-12T12:00:00.000Z')
    await governor.ensureScope(unrelatedScope, '2026-07-12T12:00:00.000Z')
    await governor.blockScope(jobrightScope, {
      now: '2026-07-12T12:00:00.000Z',
      random: () => 0.5,
      retryAfter: 'Sun, 12 Jul 2026 12:05:00 GMT',
    })

    await expect(governor.isAvailable(jobrightScope, '2026-07-12T12:04:59.999Z')).resolves.toBe(false)
    await expect(governor.isAvailable(unrelatedScope, '2026-07-12T12:04:59.999Z')).resolves.toBe(true)
    await expect(governor.isAvailable(jobrightScope, '2026-07-12T12:05:00.000Z')).resolves.toBe(true)
  })

  it('uses one refresh generation for concurrent authentication failures', async () => {
    const governor = createSourceExecutionGovernor(await createTestDatabase())
    const scopeId = deriveSourceExecutionScopeId('jobright-primary')
    await governor.ensureScope(scopeId, '2026-07-12T12:00:00.000Z')
    const first = await governor.acquireRefreshLease(scopeId, {
      leaseMs: 60_000,
      now: '2026-07-12T12:00:00.000Z',
      token: 'refresh-first',
    })
    const concurrent = await governor.acquireRefreshLease(scopeId, {
      leaseMs: 60_000,
      now: '2026-07-12T12:00:00.001Z',
      token: 'refresh-concurrent',
    })

    expect(first).toEqual({
      expiresAt: '2026-07-12T12:01:00.000Z',
      token: 'refresh-first',
    })
    expect(concurrent).toBeNull()
    expect(await governor.completeRefresh(scopeId, {
      now: '2026-07-12T12:00:01.000Z',
      token: 'refresh-first',
    })).toMatchObject({ authGeneration: 1, status: 'available' })
    expect(await governor.completeRefresh(scopeId, {
      now: '2026-07-12T12:00:01.001Z',
      token: 'refresh-first',
    })).toBeNull()
  })

  it('admits exactly one refresh lease across concurrent governor instances', async () => {
    const database = await createTestDatabase()
    const first = createSourceExecutionGovernor(database)
    const second = createSourceExecutionGovernor(database)
    const scopeId = deriveSourceExecutionScopeId('concurrent-governors')
    await first.ensureScope(scopeId, '2026-07-12T12:00:00.000Z')

    const results = await Promise.all([
      first.acquireRefreshLease(scopeId, {
        leaseMs: 60_000, now: '2026-07-12T12:00:00.000Z', token: 'first-token',
      }),
      second.acquireRefreshLease(scopeId, {
        leaseMs: 60_000, now: '2026-07-12T12:00:00.000Z', token: 'second-token',
      }),
    ])

    expect(results.filter((result) => result !== null)).toHaveLength(1)
    expect((await first.getScope(scopeId)).refreshLeaseToken)
      .toBe(results.find((result) => result !== null)?.token)
  })

  it('rolls back generation advancement when canonical session encryption fails', async () => {
    const database = await createTestDatabase()
    const governor = createSourceExecutionGovernor(database, {
      decrypt: (value) => value,
      encrypt() { throw new Error('encryption unavailable') },
    })
    const scopeId = deriveSourceExecutionScopeId('rollback-encryption')
    await governor.ensureScope(scopeId, '2026-07-12T12:00:00.000Z')
    const lease = await governor.acquireRefreshLease(scopeId, {
      leaseMs: 60_000, now: '2026-07-12T12:00:00.000Z', token: 'rollback-token',
    })

    await expect(governor.completeRefresh(scopeId, {
      encryptedSession: 'plaintext', now: '2026-07-12T12:00:01.000Z', token: lease!.token,
    })).rejects.toThrow('encryption unavailable')
    expect(await governor.getScope(scopeId)).toMatchObject({
      authGeneration: 0,
      refreshLeaseToken: 'rollback-token',
      status: 'refreshing',
    })
    await expect(governor.loadActiveSession(scopeId)).resolves.toBeNull()
  })

  it('persists failed refresh as action-required across restart without advancing generation', async () => {
    const database = await createTestDatabase()
    const scopeId = deriveSourceExecutionScopeId('jobright-primary')
    const first = createSourceExecutionGovernor(database)
    await first.ensureScope(scopeId, '2026-07-12T12:00:00.000Z')
    await first.acquireRefreshLease(scopeId, {
      leaseMs: 60_000,
      now: '2026-07-12T12:00:00.000Z',
      token: 'failed-refresh',
    })
    expect(await first.failRefresh(scopeId, {
      now: '2026-07-12T12:00:01.000Z',
      reason: 'credentials rejected',
      token: 'failed-refresh',
    })).toMatchObject({
      actionReason: 'source_action_required',
      authGeneration: 0,
      status: 'action_required',
    })

    const restarted = createSourceExecutionGovernor(database)
    expect(await restarted.isAvailable(scopeId, '2026-07-13T12:00:00.000Z')).toBe(false)
    expect(await restarted.acquireRefreshLease(scopeId, {
      leaseMs: 60_000,
      now: '2026-07-13T12:00:00.000Z',
    })).toBeNull()
  })

  it('recovers elapsed cooldowns but keeps action-required closed to ordinary refresh', async () => {
    const governor = createSourceExecutionGovernor(await createTestDatabase())
    const cooldown = deriveSourceExecutionScopeId('cooldown-recovery')
    await governor.ensureScope(cooldown, '2026-07-12T12:00:00.000Z')
    await governor.blockScope(cooldown, { now: '2026-07-12T12:00:00.000Z', retryAfter: '1' })
    expect(await governor.acquireRefreshLease(cooldown, { now: '2026-07-12T12:00:01.000Z', leaseMs: 1000, token: 'elapsed' }))
      .toEqual({ expiresAt: '2026-07-12T12:00:02.000Z', token: 'elapsed' })
    const action = deriveSourceExecutionScopeId('explicit-recovery')
    await governor.ensureScope(action, '2026-07-12T12:00:00.000Z')
    const first = await governor.acquireRefreshLease(action, { now: '2026-07-12T12:00:00.000Z', leaseMs: 1000, token: 'first' })!
    await governor.failRefresh(action, { now: '2026-07-12T12:00:00.100Z', token: first.token, reason: 'credentials_missing' })
    expect(await governor.acquireRefreshLease(action, { now: '2026-07-12T12:01:00.000Z', leaseMs: 1000 })).toBeNull()
    expect(await governor.acquireRefreshLease(action, { now: '2026-07-12T12:01:00.000Z', leaseMs: 1000,
      token: 'explicit', allowActionRequired: true })).toMatchObject({ token: 'explicit' })
  })

  it('fences reconnect validation without deleting the canonical session or stealing an ordinary lease', async () => {
    const governor = createSourceExecutionGovernor(await createTestDatabase())
    const scope = deriveSourceExecutionScopeId('reconnect-validation')
    await governor.ensureScope(scope, '2026-07-12T12:00:00.000Z')
    const ordinary = await governor.acquireRefreshLease(scope, { now: '2026-07-12T12:00:01.000Z', leaseMs: 10, token: 'ordinary' })!
    expect(await governor.acquireReconnectLease(scope, { now: '2026-07-12T12:00:01.001Z', leaseMs: 10, token: 'reconnect' })).toBeNull()
    expect(await governor.completeRefresh(scope, { now: '2026-07-12T12:00:01.005Z', token: ordinary.token, encryptedSession: 'canonical' }))
      .toMatchObject({ authGeneration: 1 })
    const reconnect = await governor.acquireReconnectLease(scope, { now: '2026-07-12T12:00:02.000Z', leaseMs: 10, token: 'reconnect' })!
    expect((await governor.loadActiveSession(scope))?.encryptedSession).toBe('canonical')
    expect(await governor.isAvailable(scope, '2026-07-12T12:00:02.000Z')).toBe(false)
    expect(await governor.finishReconnectValidation(scope, {
      now: '2026-07-12T12:00:03.000Z', reason: 'jobright_auth_ready', status: 'available',
      token: reconnect.token,
    })).toMatchObject({ status: 'available', actionReason: null })
    expect(await governor.finishReconnectValidation(scope, {
      now: '2026-07-12T12:00:04.000Z', reason: 'stale_validation', status: 'action_required',
      token: reconnect.token,
    })).toBeNull()
    expect(await governor.getScope(scope)).toMatchObject({ status: 'available', actionReason: null })
  })

  it('preserves an exact millisecond provider minimum at a fractional timestamp', async () => {
    const governor = createSourceExecutionGovernor(await createTestDatabase())
    const scope = deriveSourceExecutionScopeId('exact-provider-minimum')
    await governor.ensureScope(scope, '2026-07-12T12:00:00.250Z')
    const lease = await governor.acquireRefreshLease(scope, {
      now: '2026-07-12T12:00:00.250Z', leaseMs: 10_000, token: 'rate-limit',
    })!
    await governor.cooldownRefresh(scope, {
      now: '2026-07-12T12:00:00.250Z', random: () => 0,
      serverMinimumDelayMs: 1500, token: lease.token,
    })
    expect(Date.parse((await governor.getScope(scope)).blockedUntil!))
      .toBeGreaterThanOrEqual(Date.parse('2026-07-12T12:00:01.750Z'))
  })

  it('derives deterministic cooldown state from identical persisted inputs', async () => {
    const governor = createSourceExecutionGovernor(await createTestDatabase())
    const scopes = ['deterministic-a', 'deterministic-b']
      .map((id) => deriveSourceExecutionScopeId(id))
    for (const scope of scopes) {
      await governor.ensureScope(scope, '2026-07-12T12:00:00.250Z')
      await governor.blockScope(scope, {
        now: '2026-07-12T12:00:00.250Z', random: () => 0.25,
      })
    }

    const states = await Promise.all(scopes.map((scope) => governor.getScope(scope)))
    expect(states.map(({ backoffAttempt, blockedUntil }) => ({ backoffAttempt, blockedUntil })))
      .toEqual([
        { backoffAttempt: 1, blockedUntil: '2026-07-12T12:00:07.750Z' },
        { backoffAttempt: 1, blockedUntil: '2026-07-12T12:00:07.750Z' },
      ])
  })

  it('preserves action-required fencing after an on-disk PGlite restart', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-governor-restart-'))
    let client = await createPgliteClient({ dataDir })
    try {
      let database = await migratePgliteDatabase(client)
      const scopeId = deriveSourceExecutionScopeId('disk-restart')
      let governor = createSourceExecutionGovernor(database)
      await governor.ensureScope(scopeId, '2026-07-12T12:00:00.000Z')
      const lease = await governor.acquireRefreshLease(scopeId, {
        leaseMs: 60_000, now: '2026-07-12T12:00:00.000Z', token: 'restart-token',
      })
      await governor.failRefresh(scopeId, {
        now: '2026-07-12T12:00:01.000Z', reason: 'credentials_rejected', token: lease!.token,
      })
      await client.close()

      client = await createPgliteClient({ dataDir })
      database = await migratePgliteDatabase(client)
      governor = createSourceExecutionGovernor(database)
      expect(await governor.getScope(scopeId)).toMatchObject({
        actionReason: 'credentials_rejected', authGeneration: 0, status: 'action_required',
      })
      await expect(governor.acquireRefreshLease(scopeId, {
        leaseMs: 60_000, now: '2026-07-13T12:00:00.000Z', token: 'ordinary-after-restart',
      })).resolves.toBeNull()
    } finally {
      await client.close()
      fs.rmSync(dataDir, { force: true, recursive: true })
    }
  })

  it.each(['-1', '1.5', 'NaN', 'Infinity', '1e309', '999999999999999999999999999999', 'not-a-date'])(
    'falls back to bounded jitter for invalid Retry-After %s', async (retryAfter) => {
      const governor = createSourceExecutionGovernor(await createTestDatabase())
      const scope = deriveSourceExecutionScopeId(`retry-${retryAfter.replace(/\W/g, '-')}`)
      await governor.ensureScope(scope, '2026-07-12T12:00:00.000Z')
      await expect(governor.blockScope(scope, {
        now: '2026-07-12T12:00:00.000Z', retryAfter, random: () => 0.5,
      })).resolves.toBeDefined()
      expect(await governor.getScope(scope))
        .toMatchObject({ blockedUntil: '2026-07-12T12:00:15.000Z', backoffAttempt: 1 })
    },
  )
})
