import { describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { sourceExecutionSessions } from '../../db/schema'
import { useResettablePgliteTestDatabase } from '../../test/pglite-test-owner'
import { createSourceExecutionGovernor, deriveSourceExecutionScopeId } from './source-execution-governor'
import { createSourceSessionExecutor } from './source-session-executor'

const resettableDatabase = useResettablePgliteTestDatabase()

async function createTestDatabase() {
  return resettableDatabase()
}

async function fixture() {
  const database = await createTestDatabase()
  const scopeId = deriveSourceExecutionScopeId(crypto.randomUUID())
  const governor = createSourceExecutionGovernor(database)
  await governor.ensureScope(scopeId, '2026-07-12T12:00:00.000Z')
  return { database, scopeId, governor }
}

describe.sequential('source session executor', () => {
  it('singleflights connector-owned establishment and returns one canonical generation', async () => {
    const { scopeId, governor } = await fixture()
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
    expect((await governor.getScope(scopeId)).authGeneration).toBe(1)
  })

  it('reuses a generation persisted by another host process', async () => {
    const { database, scopeId, governor } = await fixture()
    const other = createSourceExecutionGovernor(database)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const establish = vi.fn(async () => { await gate; return { status: 'ready' as const, sessionId: 'shared' } })
    const first = createSourceSessionExecutor({ governor, refreshWaitMs: 5 }).refresh(scopeId, establish)
    await vi.waitFor(async () => expect((await governor.getScope(scopeId)).status).toBe('refreshing'))
    const secondEstablish = vi.fn()
    const second = createSourceSessionExecutor({ governor: other, refreshWaitMs: 5 }).refresh(scopeId, secondEstablish)
    release()
    await expect(Promise.all([first, second])).resolves.toEqual([
      { status: 'ready', sessionId: 'shared' }, { status: 'ready', sessionId: 'shared' },
    ])
    expect(secondEstablish).not.toHaveBeenCalled()
  })

  it('fences an expired establishment lease from replacing the newer generation', async () => {
    const { database, scopeId, governor } = await fixture()
    const other = createSourceExecutionGovernor(database)
    let clock = new Date('2026-07-12T12:00:00.000Z'); let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const stale = createSourceSessionExecutor({ governor, now: () => clock, refreshLeaseMs: 10 })
      .refresh(scopeId, async () => { await gate; return { status: 'ready', sessionId: 'stale' } })
    await vi.waitFor(async () => expect((await governor.getScope(scopeId)).status).toBe('refreshing'))
    clock = new Date('2026-07-12T12:00:00.020Z')
    await expect(createSourceSessionExecutor({ governor: other, now: () => clock, refreshLeaseMs: 10 })
      .refresh(scopeId, async () => ({ status: 'ready', sessionId: 'winner' }))).resolves.toEqual({ status: 'ready', sessionId: 'winner' })
    release()
    await expect(stale).resolves.toEqual({ status: 'ready', sessionId: 'winner' })
    expect((await governor.loadActiveSession(scopeId))?.encryptedSession).toBe('winner')
  })

  it.each([
    { status: 'rate_limited' as const, reason: 'old_limit', serverMinimumDelayMs: 60_000 },
  ])('returns the newer canonical generation when a stale owner finishes with $status', async (staleResult) => {
    const { database, scopeId, governor } = await fixture()
    const other = createSourceExecutionGovernor(database)
    let clock = new Date('2026-07-12T12:00:00.000Z'); let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const stale = createSourceSessionExecutor({ governor, now: () => clock, refreshLeaseMs: 10 })
      .refresh(scopeId, async () => { await gate; return staleResult })
    await vi.waitFor(async () => expect((await governor.getScope(scopeId)).status).toBe('refreshing'))
    clock = new Date('2026-07-12T12:00:00.020Z')
    await createSourceSessionExecutor({ governor: other, now: () => clock, refreshLeaseMs: 10 })
      .refresh(scopeId, async () => ({ status: 'ready', sessionId: 'winner' }))
    release()
    await expect(stale).resolves.toEqual({ status: 'ready', sessionId: 'winner' })
    expect(await governor.getScope(scopeId)).toMatchObject({ status: 'available', authGeneration: 1 })
  })

  it('fences an expired explicit reconnect from a newer-generation winner', async () => {
    const { database, scopeId, governor } = await fixture()
    const other = createSourceExecutionGovernor(database)
    let clock = new Date('2026-07-12T12:00:00.000Z'); let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const lease = (await governor.acquireReconnectLease(scopeId, {
      now: clock.toISOString(), leaseMs: 10, token: 'stale-reconnect',
    }))!
    const stale = createSourceSessionExecutor({ governor, now: () => clock })
      .reconnect(scopeId, async () => {
        markStarted()
        await gate
        return { status: 'ready', sessionId: 'stale' }
      }, lease.token)
    await started
    clock = new Date('2026-07-12T12:00:00.020Z')
    await expect(createSourceSessionExecutor({ governor: other, now: () => clock, refreshLeaseMs: 10 })
      .refresh(scopeId, async () => ({ status: 'ready', sessionId: 'winner' })))
      .resolves.toEqual({ status: 'ready', sessionId: 'winner' })
    release()
    await expect(stale).resolves.toEqual({ status: 'ready', sessionId: 'winner' })
    expect((await governor.loadActiveSession(scopeId))?.encryptedSession).toBe('winner')
  })

  it('does not establish after an explicit reconnect token has already lost its lease', async () => {
    const { database, scopeId, governor } = await fixture()
    const other = createSourceExecutionGovernor(database)
    let clock = new Date('2026-07-12T12:00:00.000Z')
    const lease = (await governor.acquireReconnectLease(scopeId, {
      now: clock.toISOString(), leaseMs: 10, token: 'expired-reconnect',
    }))!
    clock = new Date('2026-07-12T12:00:00.020Z')
    await createSourceSessionExecutor({ governor: other, now: () => clock, refreshLeaseMs: 10 })
      .refresh(scopeId, async () => ({ status: 'ready', sessionId: 'winner' }))
    const establish = vi.fn(async () => ({ status: 'ready' as const, sessionId: 'stale' }))
    await expect(createSourceSessionExecutor({ governor, now: () => clock })
      .reconnect(scopeId, establish, lease.token))
      .resolves.toEqual({ status: 'ready', sessionId: 'winner' })
    expect(establish).not.toHaveBeenCalled()
  })

  it.each([
    [{ status: 'ready' as const, sessionId: 'ready' }, 'available'],
    [{ status: 'rate_limited' as const, reason: 'rate', serverMinimumDelayMs: 1500 }, 'cooldown'],
    [{ status: 'action_required' as const, reason: 'action' }, 'action_required'],
  ])('persists explicit $status validation and gates subsequent ordinary admission', async (result, expectedStatus) => {
    const { scopeId, governor } = await fixture()
    const lease = (await governor.acquireReconnectLease(scopeId, {
      now: '2026-07-12T12:00:00.000Z', leaseMs: 60_000, token: 'matrix',
    }))!
    await createSourceSessionExecutor({ governor, now: () => new Date('2026-07-12T12:00:00.250Z') })
      .reconnect(scopeId, async () => result, lease.token)
    expect((await governor.getScope(scopeId)).status).toBe(expectedStatus)
    expect(await governor.isAvailable(scopeId, '2026-07-12T12:00:00.250Z')).toBe(expectedStatus === 'available')
  })

  it('persists a thrown explicit validation as action-required', async () => {
    const { scopeId, governor } = await fixture()
    const lease = (await governor.acquireReconnectLease(scopeId, {
      now: '2026-07-12T12:00:00.000Z', leaseMs: 60_000, token: 'throw',
    }))!
    await expect(createSourceSessionExecutor({
      governor, now: () => new Date('2026-07-12T12:00:00.500Z'),
    }).reconnect(scopeId, async () => {
      throw new Error('sensitive failure')
    }, lease.token)).resolves.toEqual({ status: 'failed', reason: 'session_refresh_failed' })
    expect(await governor.getScope(scopeId)).toMatchObject({ status: 'action_required', actionReason: 'session_refresh_failed' })
  })

  it.each([
    { status: 'retryable' as const, reason: 'retry', retryReason: 'server_failure' as const },
  ])('keeps $status closed to ordinary admission after explicit establishment', async (result) => {
    const { scopeId, governor } = await fixture()
    const lease = (await governor.acquireReconnectLease(scopeId, {
      now: '2026-07-12T12:00:00.000Z', leaseMs: 60_000, token: 'reconnect',
    }))!
    const executor = createSourceSessionExecutor({
      governor, now: () => new Date('2026-07-12T12:00:00.500Z'),
    })
    await expect(executor.reconnect(scopeId, async () => result, lease.token)).resolves.toEqual(result)
    expect(await governor.getScope(scopeId)).toMatchObject({
      status: 'action_required', actionReason: `source_validation_${result.status}`,
    })
    expect(await governor.acquireRefreshLease(scopeId, {
      now: '2026-07-12T12:01:00.000Z', leaseMs: 1000,
    })).toBeNull()
  })

  it('persists action-required establishment without retry loops', async () => {
    const { scopeId, governor } = await fixture()
    const establish = vi.fn(async () => ({ status: 'action_required' as const, reason: 'login_rejected' }))
    await expect(createSourceSessionExecutor({ governor }).refresh(scopeId, establish))
      .resolves.toEqual({ status: 'action_required', reason: 'login_rejected' })
    expect(await governor.getScope(scopeId)).toMatchObject({ status: 'action_required', actionReason: 'login_rejected' })
    expect(establish).toHaveBeenCalledTimes(1)
  })

  it('encrypts the canonical session at rest and decrypts it for connectors', async () => {
    const database = await createTestDatabase()
    const scopeId = deriveSourceExecutionScopeId('encrypted')
    const governor = createSourceExecutionGovernor(database, { encrypt: (v) => `enc:${v}`, decrypt: (v) => v.slice(4) })
    await governor.ensureScope(scopeId, '2026-07-12T12:00:00.000Z')
    await createSourceSessionExecutor({ governor }).refresh(scopeId, async () => ({ status: 'ready', sessionId: 'secret-session' }))
    expect((await governor.loadActiveSession(scopeId))?.encryptedSession).toBe('secret-session')
    const [stored] = await database.select({ encryptedSession: sourceExecutionSessions.encryptedSession })
      .from(sourceExecutionSessions)
      .where(eq(sourceExecutionSessions.executionScopeId, scopeId))
      .limit(1)
    expect(stored).toEqual({ encryptedSession: 'enc:secret-session' })
  })
})
