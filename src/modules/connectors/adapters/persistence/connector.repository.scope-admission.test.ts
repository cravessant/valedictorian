import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { describe, expect, it } from 'vitest'
import { schema, sourceExecutionScopes } from '@sparxie/valedictorian-local-runtime/testing/db/schema'
import { useResettablePgliteTestOwner } from '../../../../test/pglite-test-owner'
import { createPgliteConnectorRepository } from '@sparxie/valedictorian-local-runtime/testing/modules/connectors/adapters/persistence/connector.repository'

const resettableOwner = useResettablePgliteTestOwner()

describe.sequential('connector scope admission', () => {
  it('locks the live instance row to serialize admission against retirement', async () => {
    const owner = resettableOwner()
    const queries: string[] = []
    const database = drizzle(owner.client, {
      schema,
      logger: { logQuery(query) { queries.push(query) } },
    })
    const repository = createPgliteConnectorRepository(database)
    const instance = await repository.upsertInstance({
      id: 'retirement-admission-race', connectorId: 'fixture.jobs', connectorVersion: '1.0.0',
      displayName: 'Retirement admission race', enabled: true,
    })
    queries.length = 0

    await repository.recordRunRequest({
      connectorInstanceId: instance.id,
      mode: 'manual',
      startedAt: '2026-07-12T12:00:00.000Z',
    })

    expect(queries.some((query) => /from "connector_instances"[\s\S]*for update/i.test(query)))
      .toBe(true)
  })

  /**
   * The owner holds the scope row instead of connectors restating the availability
   * rule in its own predicates, so the lock is what the admission verdict rests on.
   */
  it('locks the execution scope row so its admission verdict holds for the transaction', async () => {
    const owner = resettableOwner()
    const queries: string[] = []
    const database = drizzle(owner.client, {
      schema,
      logger: { logQuery(query) { queries.push(query) } },
    })
    const repository = createPgliteConnectorRepository(database)
    const instance = await repository.upsertInstance({
      id: 'scope-lock', connectorId: 'fixture.jobs', connectorVersion: '1.0.0',
      displayName: 'Scope lock', enabled: true,
    })
    queries.length = 0

    await repository.recordRunRequest({
      connectorInstanceId: instance.id,
      mode: 'manual',
      startedAt: '2026-07-12T12:00:00.000Z',
    })

    expect(queries.some((query) => /from "source_execution_scopes"[\s\S]*for update/i.test(query)))
      .toBe(true)
    expect(queries.some((query) => /exists\s*\(/i.test(query))).toBe(false)
  })

  it.each(['action_required', 'refreshing'] as const)('skips fresh discovery while scope is %s', async (status) => {
    const { database } = resettableOwner()
    const repository = createPgliteConnectorRepository(database)
    const instance = await repository.upsertInstance({
      id: `blocked-${status}`,
      connectorId: 'fixture.jobs',
      connectorVersion: '1.0.0',
      displayName: 'Blocked',
      enabled: true,
    })
    await database.update(sourceExecutionScopes).set({
      status,
      actionReason: status === 'action_required' ? 'session_refresh_failed' : null,
      refreshLeaseToken: status === 'refreshing' ? 'lease' : null,
      refreshLeaseExpiresAt: status === 'refreshing' ? '2026-07-12T13:00:00.000Z' : null,
    }).where(eq(sourceExecutionScopes.id, instance.executionScopeId))

    const request = await repository.recordRunRequest({
      connectorInstanceId: instance.id,
      mode: 'manual',
      startedAt: '2026-07-12T12:00:00.000Z',
      coverageEndedAt: '2026-07-12T12:00:00.000Z',
    })
    expect(request).toMatchObject({ acquired: false, acquiredWork: null, run: { status: 'skipped' } })
    await expect(repository.getRunSynchronization(request.run.id)).resolves.toMatchObject({
      outcome: { kind: 'action_required' },
    })
  })
})
