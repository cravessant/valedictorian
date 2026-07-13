import { describe, expect, it, vi } from 'vitest'
import { createDrizzleDatabase, createInMemoryDatabase, migrateDatabase } from '../../db/sqlite'
import { createSourceExecutionGovernor, deriveSourceExecutionScopeId } from './source-execution-governor'
import { createSourceSessionExecutor } from './source-session-executor'

function fixture() {
  const sqlite = createInMemoryDatabase(); migrateDatabase(sqlite)
  const scopeId = deriveSourceExecutionScopeId(crypto.randomUUID())
  const governor = createSourceExecutionGovernor(createDrizzleDatabase(sqlite))
  governor.ensureScope(scopeId, '2026-07-12T12:00:00.000Z')
  return { sqlite, scopeId, governor }
}

describe('source session executor', () => {
  it('singleflights connector-owned establishment and returns one canonical generation', async () => {
    const { sqlite, scopeId, governor } = fixture()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const establish = vi.fn(async () => { await gate; return { status: 'ready' as const, sessionId: 'fresh' } })
    const executor = createSourceSessionExecutor({ governor })
    const first = executor.refresh(scopeId, establish)
    const second = executor.refresh(scopeId, establish)
    release()
    await expect(Promise.all([first, second])).resolves.toEqual([
      { status: 'ready', sessionId: 'fresh' }, { status: 'ready', sessionId: 'fresh' },
    ])
    expect(establish).toHaveBeenCalledTimes(1)
    expect(governor.getScope(scopeId).authGeneration).toBe(1)
    sqlite.close()
  })

  it('reuses a generation persisted by another host process', async () => {
    const { sqlite, scopeId, governor } = fixture()
    const other = createSourceExecutionGovernor(createDrizzleDatabase(sqlite))
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const establish = vi.fn(async () => { await gate; return { status: 'ready' as const, sessionId: 'shared' } })
    const first = createSourceSessionExecutor({ governor, refreshWaitMs: 5 }).refresh(scopeId, establish)
    await vi.waitFor(() => expect(governor.getScope(scopeId).status).toBe('refreshing'))
    const secondEstablish = vi.fn()
    const second = createSourceSessionExecutor({ governor: other, refreshWaitMs: 5 }).refresh(scopeId, secondEstablish)
    release()
    await expect(Promise.all([first, second])).resolves.toEqual([
      { status: 'ready', sessionId: 'shared' }, { status: 'ready', sessionId: 'shared' },
    ])
    expect(secondEstablish).not.toHaveBeenCalled()
    sqlite.close()
  })

  it('fences an expired establishment lease from replacing the newer generation', async () => {
    const { sqlite, scopeId, governor } = fixture()
    const other = createSourceExecutionGovernor(createDrizzleDatabase(sqlite))
    let clock = new Date('2026-07-12T12:00:00.000Z'); let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const stale = createSourceSessionExecutor({ governor, now: () => clock, refreshLeaseMs: 10 })
      .refresh(scopeId, async () => { await gate; return { status: 'ready', sessionId: 'stale' } })
    await vi.waitFor(() => expect(governor.getScope(scopeId).status).toBe('refreshing'))
    clock = new Date('2026-07-12T12:00:00.020Z')
    await expect(createSourceSessionExecutor({ governor: other, now: () => clock, refreshLeaseMs: 10 })
      .refresh(scopeId, async () => ({ status: 'ready', sessionId: 'winner' }))).resolves.toEqual({ status: 'ready', sessionId: 'winner' })
    release()
    await expect(stale).resolves.toEqual({ status: 'ready', sessionId: 'winner' })
    expect(governor.loadActiveSession(scopeId)?.encryptedSession).toBe('winner')
    sqlite.close()
  })

  it.each([
    { status: 'rate_limited' as const, reason: 'old_limit', serverMinimumDelayMs: 60_000 },
    { status: 'retryable' as const, reason: 'old_retry', retryReason: 'server_failure' as const },
    { status: 'failed' as const, reason: 'old_failure' },
    { status: 'action_required' as const, reason: 'old_action' },
    { status: 'cancelled' as const, reason: 'old_cancel' },
    { status: 'invocation_timeout' as const, reason: 'old_timeout' },
  ])('returns the newer canonical generation when a stale owner finishes with $status', async (staleResult) => {
    const { sqlite, scopeId, governor } = fixture()
    const other = createSourceExecutionGovernor(createDrizzleDatabase(sqlite))
    let clock = new Date('2026-07-12T12:00:00.000Z'); let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const stale = createSourceSessionExecutor({ governor, now: () => clock, refreshLeaseMs: 10 })
      .refresh(scopeId, async () => { await gate; return staleResult })
    await vi.waitFor(() => expect(governor.getScope(scopeId).status).toBe('refreshing'))
    clock = new Date('2026-07-12T12:00:00.020Z')
    await createSourceSessionExecutor({ governor: other, now: () => clock, refreshLeaseMs: 10 })
      .refresh(scopeId, async () => ({ status: 'ready', sessionId: 'winner' }))
    release()
    await expect(stale).resolves.toEqual({ status: 'ready', sessionId: 'winner' })
    expect(governor.getScope(scopeId)).toMatchObject({ status: 'available', authGeneration: 1 })
    sqlite.close()
  })

  it('fences an expired explicit reconnect from a newer-generation winner', async () => {
    const { sqlite, scopeId, governor } = fixture()
    const other = createSourceExecutionGovernor(createDrizzleDatabase(sqlite))
    let clock = new Date('2026-07-12T12:00:00.000Z'); let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const lease = governor.acquireReconnectLease(scopeId, {
      now: clock.toISOString(), leaseMs: 10, token: 'stale-reconnect',
    })!
    const stale = createSourceSessionExecutor({ governor, now: () => clock })
      .reconnect(scopeId, async () => { await gate; return { status: 'ready', sessionId: 'stale' } }, lease.token)
    clock = new Date('2026-07-12T12:00:00.020Z')
    await expect(createSourceSessionExecutor({ governor: other, now: () => clock, refreshLeaseMs: 10 })
      .refresh(scopeId, async () => ({ status: 'ready', sessionId: 'winner' })))
      .resolves.toEqual({ status: 'ready', sessionId: 'winner' })
    release()
    await expect(stale).resolves.toEqual({ status: 'ready', sessionId: 'winner' })
    expect(governor.loadActiveSession(scopeId)?.encryptedSession).toBe('winner')
    sqlite.close()
  })

  it('does not establish after an explicit reconnect token has already lost its lease', async () => {
    const { sqlite, scopeId, governor } = fixture()
    const other = createSourceExecutionGovernor(createDrizzleDatabase(sqlite))
    let clock = new Date('2026-07-12T12:00:00.000Z')
    const lease = governor.acquireReconnectLease(scopeId, {
      now: clock.toISOString(), leaseMs: 10, token: 'expired-reconnect',
    })!
    clock = new Date('2026-07-12T12:00:00.020Z')
    await createSourceSessionExecutor({ governor: other, now: () => clock, refreshLeaseMs: 10 })
      .refresh(scopeId, async () => ({ status: 'ready', sessionId: 'winner' }))
    const establish = vi.fn(async () => ({ status: 'ready' as const, sessionId: 'stale' }))
    await expect(createSourceSessionExecutor({ governor, now: () => clock })
      .reconnect(scopeId, establish, lease.token))
      .resolves.toEqual({ status: 'ready', sessionId: 'winner' })
    expect(establish).not.toHaveBeenCalled()
    sqlite.close()
  })

  it.each([
    [{ status: 'ready' as const, sessionId: 'ready' }, 'available'],
    [{ status: 'rate_limited' as const, reason: 'rate', serverMinimumDelayMs: 1500 }, 'cooldown'],
    [{ status: 'retryable' as const, reason: 'retry', retryReason: 'server_failure' as const }, 'action_required'],
    [{ status: 'action_required' as const, reason: 'action' }, 'action_required'],
    [{ status: 'failed' as const, reason: 'failed' }, 'action_required'],
    [{ status: 'cancelled' as const, reason: 'cancel' }, 'action_required'],
    [{ status: 'invocation_timeout' as const, reason: 'timeout' }, 'action_required'],
  ])('persists explicit $status validation and gates subsequent ordinary admission', async (result, expectedStatus) => {
    const { sqlite, scopeId, governor } = fixture()
    const lease = governor.acquireReconnectLease(scopeId, {
      now: '2026-07-12T12:00:00.000Z', leaseMs: 60_000, token: 'matrix',
    })!
    await createSourceSessionExecutor({ governor, now: () => new Date('2026-07-12T12:00:00.250Z') })
      .reconnect(scopeId, async () => result, lease.token)
    expect(governor.getScope(scopeId).status).toBe(expectedStatus)
    expect(governor.isAvailable(scopeId, '2026-07-12T12:00:00.250Z')).toBe(expectedStatus === 'available')
    sqlite.close()
  })

  it('persists a thrown explicit validation as action-required', async () => {
    const { sqlite, scopeId, governor } = fixture()
    const lease = governor.acquireReconnectLease(scopeId, {
      now: '2026-07-12T12:00:00.000Z', leaseMs: 60_000, token: 'throw',
    })!
    await expect(createSourceSessionExecutor({
      governor, now: () => new Date('2026-07-12T12:00:00.500Z'),
    }).reconnect(scopeId, async () => {
      throw new Error('sensitive failure')
    }, lease.token)).resolves.toEqual({ status: 'failed', reason: 'session_refresh_failed' })
    expect(governor.getScope(scopeId)).toMatchObject({ status: 'action_required', actionReason: 'session_refresh_failed' })
    sqlite.close()
  })

  it.each([
    { status: 'retryable' as const, reason: 'retry', retryReason: 'server_failure' as const },
    { status: 'cancelled' as const, reason: 'cancel' },
    { status: 'invocation_timeout' as const, reason: 'timeout' },
  ])('keeps $status closed to ordinary admission after explicit establishment', async (result) => {
    const { sqlite, scopeId, governor } = fixture()
    const lease = governor.acquireReconnectLease(scopeId, {
      now: '2026-07-12T12:00:00.000Z', leaseMs: 60_000, token: 'reconnect',
    })!
    const executor = createSourceSessionExecutor({
      governor, now: () => new Date('2026-07-12T12:00:00.500Z'),
    })
    await expect(executor.reconnect(scopeId, async () => result, lease.token)).resolves.toEqual(result)
    expect(governor.getScope(scopeId)).toMatchObject({
      status: 'action_required', actionReason: `source_validation_${result.status}`,
    })
    expect(governor.acquireRefreshLease(scopeId, {
      now: '2026-07-12T12:01:00.000Z', leaseMs: 1000,
    })).toBeNull()
    sqlite.close()
  })

  it('persists action-required establishment without retry loops', async () => {
    const { sqlite, scopeId, governor } = fixture()
    const establish = vi.fn(async () => ({ status: 'action_required' as const, reason: 'login_rejected' }))
    await expect(createSourceSessionExecutor({ governor }).refresh(scopeId, establish))
      .resolves.toEqual({ status: 'action_required', reason: 'login_rejected' })
    expect(governor.getScope(scopeId)).toMatchObject({ status: 'action_required', actionReason: 'login_rejected' })
    expect(establish).toHaveBeenCalledTimes(1)
    sqlite.close()
  })

  it('encrypts the canonical session at rest and decrypts it for connectors', async () => {
    const sqlite = createInMemoryDatabase(); migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const scopeId = deriveSourceExecutionScopeId('encrypted')
    const governor = createSourceExecutionGovernor(database, { encrypt: (v) => `enc:${v}`, decrypt: (v) => v.slice(4) })
    governor.ensureScope(scopeId, '2026-07-12T12:00:00.000Z')
    await createSourceSessionExecutor({ governor }).refresh(scopeId, async () => ({ status: 'ready', sessionId: 'secret-session' }))
    expect(governor.loadActiveSession(scopeId)?.encryptedSession).toBe('secret-session')
    expect(sqlite.prepare('select encrypted_session from source_execution_sessions').get()).toEqual({ encrypted_session: 'enc:secret-session' })
    sqlite.close()
  })
})
