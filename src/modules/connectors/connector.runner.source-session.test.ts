import { describe, expect, it, vi } from 'vitest'
import { createDrizzleDatabase, createInMemoryDatabase, migrateDatabase } from '../../db/sqlite'
import { createSourceExecutionGovernor } from '../source-execution/source-execution-governor'
import { createConnectorRunner, type AppJobConnector } from './connector.runner'
import { createSqliteConnectorRepository } from './connector.repository'

function result(input: Parameters<AppJobConnector['refresh']>[0]) {
  return { observations: [], nextCheckpoint: { checkpoint: {}, schemaVersion: 'fixture@1' }, coverage: input.coverage,
    operationOutcome: null, stats: { observations: 0 }, status: 'completed' as const, warnings: [],
    synchronization: { newestFrontier: { state: 'caught_up' as const }, historicalBackfill: { state: 'caught_up' as const,
      boundary: { earliestDate: input.coverage.start.slice(0, 10) } }, pendingResolutionCount: 0, outcome: { kind: 'caught_up' as const } } }
}

describe('connector runner 0.10 auth boundary', () => {
  it('uses a persisted session without revealing missing credentials during healthy work', async () => {
    const sqlite = createInMemoryDatabase(); migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite); const governor = createSourceExecutionGovernor(database)
    const revealSecret = vi.fn(async () => null)
    const connector: AppJobConnector = { definition: { id: 'fixture.optimistic', version: '1.0.0', auth: { requirements: [{ id: 'jobright', mode: 'username_password' }] } },
      async refresh(input, runtime) {
        expect(await runtime.auth.resolve({ id: 'jobright', mode: 'username_password' })).toMatchObject({ status: 'ready', sessionId: 'good-session' })
        return result(input)
      } }
    const runner = createConnectorRunner({ auth: { secrets: { revealSecret } }, repository: createSqliteConnectorRepository(database),
      sourceExecutionGovernor: governor, workspaceId: 'workspace' })
    const instance = await runner.registerInstance({ id: 'optimistic', connector, displayName: 'Optimistic', enabled: true,
      auth: [{ id: 'jobright', mode: 'username_password', secretKey: 'missing' }] })
    const lease = governor.acquireRefreshLease(instance.executionScopeId, { now: '2026-07-12T00:00:00.000Z', leaseMs: 1000 })!
    governor.completeRefresh(instance.executionScopeId, { now: '2026-07-12T00:00:00.001Z', token: lease.token, encryptedSession: 'good-session' })
    await runner.refresh(connector, { connectorInstanceId: instance.id, mode: 'manual', coverage: { start: '2026-07-01T00:00:00.000Z', end: '2026-07-12T00:00:00.000Z' } })
    expect(revealSecret).not.toHaveBeenCalled()
    sqlite.close()
  })

  it('resolves credentials only inside establishment after a persisted session is rejected', async () => {
    const sqlite = createInMemoryDatabase(); migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite); const governor = createSourceExecutionGovernor(database)
    const revealSecret = vi.fn(async () => null)
    const connector: AppJobConnector = { definition: { id: 'fixture.rejected', version: '1.0.0', auth: { requirements: [{ id: 'jobright', mode: 'username_password' }] } },
      async refresh(input, runtime) {
        expect(await runtime.auth.resolve({ id: 'jobright', mode: 'username_password' })).toMatchObject({ sessionId: 'rejected-session' })
        const refreshed = await runtime.auth.refresh({ id: 'jobright', mode: 'username_password', executionScopeId: input.executionScopeId }, async () => {
          const credentials = await runtime.auth.resolve({ id: 'jobright', mode: 'username_password' })
          return { status: 'action_required', reason: credentials.reason ?? 'credentials_missing' }
        })
        expect(refreshed.status).toBe('action_required')
        return result(input)
      } }
    const runner = createConnectorRunner({ auth: { secrets: { revealSecret } }, repository: createSqliteConnectorRepository(database),
      sourceExecutionGovernor: governor, workspaceId: 'workspace' })
    const instance = await runner.registerInstance({ id: 'rejected', connector, displayName: 'Rejected', enabled: true,
      auth: [{ id: 'jobright', mode: 'username_password', secretKey: 'missing' }] })
    const lease = governor.acquireRefreshLease(instance.executionScopeId, { now: '2026-07-12T00:00:00.000Z', leaseMs: 1000 })!
    governor.completeRefresh(instance.executionScopeId, { now: '2026-07-12T00:00:00.001Z', token: lease.token, encryptedSession: 'rejected-session' })
    await runner.refresh(connector, { connectorInstanceId: instance.id, mode: 'manual', coverage: { start: '2026-07-01T00:00:00.000Z', end: '2026-07-12T00:00:00.000Z' } })
    expect(revealSecret).toHaveBeenCalledTimes(1)
    expect(governor.getScope(instance.executionScopeId).status).toBe('action_required')
    sqlite.close()
  })

  it('uses explicit validation to reset action/cooldown session state after credential rotation', async () => {
    const sqlite = createInMemoryDatabase(); migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite); const governor = createSourceExecutionGovernor(database)
    const connector: AppJobConnector = { definition: { id: 'fixture.rotate', version: '1.0.0' }, refresh: async (input) => result(input),
      async validateAuth(input, runtime) {
        const established = await runtime.auth.refresh({ id: 'jobright', mode: 'username_password', executionScopeId: input.executionScopeId },
          async () => ({ status: 'ready', sessionId: 'rotated-session' }))
        return { status: established.status, reason: established.status === 'ready' ? 'jobright_auth_ready' : established.reason }
      } }
    const runner = createConnectorRunner({ repository: createSqliteConnectorRepository(database), sourceExecutionGovernor: governor,
      workspaceId: 'workspace', now: () => new Date('2026-07-12T12:00:00.000Z') })
    const instance = await runner.registerInstance({ id: 'rotate', connector, displayName: 'Rotate', enabled: true })
    const lease = governor.acquireRefreshLease(instance.executionScopeId, { now: '2026-07-12T11:00:00.000Z', leaseMs: 1000 })!
    governor.failRefresh(instance.executionScopeId, { now: '2026-07-12T11:00:00.001Z', token: lease.token, reason: 'old_credentials' })
    await expect(runner.validateAuth(connector, { connectorInstanceId: instance.id })).resolves.toMatchObject({ status: 'ready' })
    expect(governor.getScope(instance.executionScopeId)).toMatchObject({ status: 'available', authGeneration: 1 })
    expect(governor.loadActiveSession(instance.executionScopeId)?.encryptedSession).toBe('rotated-session')
    sqlite.close()
  })
  it('persists connector-emitted scope-wide rate-limit evidence for later work', async () => {
    const sqlite = createInMemoryDatabase(); migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite); const governor = createSourceExecutionGovernor(database)
    const connector: AppJobConnector = { definition: { id: 'fixture.rate-limit', version: '1.0.0' },
      async refresh(input) {
        const operation = { kind: 'scope_rate_limited' as const, executionScopeId: input.executionScopeId,
          retryAt: '2026-07-12T12:02:00.000Z', serverMinimumDelayMs: 120_000 }
        return { ...result(input), operationOutcome: operation,
          synchronization: { newestFrontier: { state: 'advancing' as const }, historicalBackfill: { state: 'advancing' as const,
            boundary: { earliestDate: input.coverage.start.slice(0, 10) } }, pendingResolutionCount: 1,
            outcome: { kind: 'cooling_down' as const, operation } } }
      } }
    const runner = createConnectorRunner({ repository: createSqliteConnectorRepository(database), sourceExecutionGovernor: governor,
      workspaceId: 'workspace', now: () => new Date('2026-07-12T12:00:00.000Z') })
    const instance = await runner.registerInstance({ id: 'limited', connector, displayName: 'Limited', enabled: true })
    await runner.refresh(connector, { connectorInstanceId: instance.id, mode: 'manual',
      coverage: { start: '2026-07-01T00:00:00.000Z', end: '2026-07-12T00:00:00.000Z' } })
    expect(governor.getScope(instance.executionScopeId)).toMatchObject({ status: 'cooldown', blockedUntil: '2026-07-12T12:02:00.000Z' })
    sqlite.close()
  })

  it('passes the persisted scope to connector-owned establishment and exposes the canonical session', async () => {
    const sqlite = createInMemoryDatabase(); migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite); const governor = createSourceExecutionGovernor(database)
    const establish = vi.fn(async () => ({ status: 'ready' as const, sessionId: 'fresh-session' }))
    const connector: AppJobConnector = { definition: { id: 'fixture.session', version: '1.0.0', auth: { requirements: [{ id: 'jobright', mode: 'username_password' }] } },
      async refresh(input, runtime) {
        const first = await runtime.auth.resolve({ id: 'jobright', mode: 'username_password' })
        expect(first.sessionId).toBeUndefined()
        expect(await runtime.auth.refresh({ id: 'jobright', mode: 'username_password', executionScopeId: input.executionScopeId }, establish))
          .toEqual({ status: 'ready', sessionId: 'fresh-session' })
        expect(await runtime.auth.resolve({ id: 'jobright', mode: 'username_password' })).toMatchObject({ sessionId: 'fresh-session' })
        return result(input)
      } }
    const runner = createConnectorRunner({ auth: { secrets: { revealSecret: async (key) => ({ key, value: '{"username":"u","password":"p"}' }) } },
      repository: createSqliteConnectorRepository(database), sourceExecutionGovernor: governor, workspaceId: 'workspace' })
    const instance = await runner.registerInstance({ id: 'instance', connector, displayName: 'Session', enabled: true,
      auth: [{ id: 'jobright', mode: 'username_password', secretKey: 'credential' }] })
    await expect(runner.refresh(connector, { connectorInstanceId: instance.id, mode: 'manual', coverage: { start: '2026-07-01T00:00:00.000Z', end: '2026-07-12T00:00:00.000Z' } }))
      .resolves.toMatchObject({ status: 'completed' })
    expect(establish).toHaveBeenCalledTimes(1)
    sqlite.close()
  })

  it('does not establish when a valid persisted session is available', async () => {
    const sqlite = createInMemoryDatabase(); migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite); const governor = createSourceExecutionGovernor(database)
    const connector: AppJobConnector = { definition: { id: 'fixture.session', version: '1.0.0', auth: { requirements: [{ id: 'jobright', mode: 'username_password' }] } },
      async refresh(input, runtime) {
        expect(await runtime.auth.resolve({ id: 'jobright', mode: 'username_password' })).toMatchObject({ sessionId: 'persisted' })
        return result(input)
      } }
    const runner = createConnectorRunner({ auth: { secrets: { revealSecret: async (key) => ({ key, value: 'credentials' }) } },
      repository: createSqliteConnectorRepository(database), sourceExecutionGovernor: governor, workspaceId: 'workspace' })
    const instance = await runner.registerInstance({ id: 'valid', connector, displayName: 'Session', enabled: true,
      auth: [{ id: 'jobright', mode: 'username_password', secretKey: 'credential' }] })
    const lease = governor.acquireRefreshLease(instance.executionScopeId, { leaseMs: 1_000, now: '2026-07-12T00:00:00.000Z' })!
    governor.completeRefresh(instance.executionScopeId, { encryptedSession: 'persisted', token: lease.token, now: '2026-07-12T00:00:00.001Z' })
    await runner.refresh(connector, { connectorInstanceId: instance.id, mode: 'manual', coverage: { start: '2026-07-01T00:00:00.000Z', end: '2026-07-12T00:00:00.000Z' } })
    sqlite.close()
  })
})
