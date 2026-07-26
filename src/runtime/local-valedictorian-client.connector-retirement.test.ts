import { connectorRetirementResultSchema } from '@sparxie/sdk'
import { describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { sourceExecutionScopes, sourceExecutionSessions } from '../db/schema'
import { createPgliteConnectorRepository } from '../modules/connectors/connector.repository'
import { createConnectorScheduleRepository } from '../modules/connectors/connector-schedule.repository'
import {
  createSourceExecutionGovernor,
} from '../modules/source-execution/source-execution-governor'
import {
  closeTestLocalValedictorianClient,
  createOwnedTestPgliteDataPath,
  createTestLocalValedictorianClient as createFreshLocalValedictorianClient,
  getTestLocalValedictorianDatabase,
  useResettablePgliteTestLocalValedictorianClient,
} from './local-valedictorian-client.test-harness'

const createLocalValedictorianClient = useResettablePgliteTestLocalValedictorianClient()

describe.sequential('local connector instance retirement', () => {
  it('signals scheduled work only after retirement succeeds', async () => {
    const onScheduledWorkChanged = vi.fn()
    const client = await createLocalValedictorianClient({
      connectorRegistry: { get: () => null },
      onScheduledWorkChanged,
    })
    await createPgliteConnectorRepository(getTestLocalValedictorianDatabase(client)).upsertInstance({
      id: 'retirement-notification',
      connectorId: 'removed.connector',
      connectorVersion: '0.1.0',
      displayName: 'Retirement notification',
      enabled: true,
    })

    await expect(client.connectors.remove({ connectorInstanceId: 'missing-connector' }))
      .rejects.toThrow(/not found/i)
    expect(onScheduledWorkChanged).not.toHaveBeenCalled()

    const retirement = client.connectors.remove({ connectorInstanceId: 'retirement-notification' })
    expect(onScheduledWorkChanged).not.toHaveBeenCalled()
    await expect(retirement)
      .resolves.toMatchObject({ connectorInstanceId: 'retirement-notification' })
    expect(onScheduledWorkChanged).toHaveBeenCalledOnce()
  })

  it('retires an unregistered connector without loading its implementation or authentication', async () => {
    const pgliteDataPath = createOwnedTestPgliteDataPath('connector-retirement-')
    const setupClient = await createFreshLocalValedictorianClient({ pgliteDataPath })
    await createPgliteConnectorRepository(
      getTestLocalValedictorianDatabase(setupClient),
    ).upsertInstance({
      id: 'stale-connector',
      connectorId: 'removed.connector',
      connectorVersion: '0.1.0',
      displayName: 'Removed connector',
      enabled: true,
      auth: [{
        id: 'removed-auth',
        mode: 'api_key',
        secretKey: 'workspace-secret-that-remains-administered',
      }],
      config: { privateOption: 'remove-me' },
      filters: { role: 'intern' },
      createdAt: '2026-07-13T12:00:00.000Z',
    })
    await closeTestLocalValedictorianClient(setupClient)
    const getConnector = vi.fn(() => {
      throw new Error('retirement must not load connector implementations')
    })
    const decrypt = vi.fn(() => {
      throw new Error('retirement must not retrieve authentication')
    })
    const client = await createFreshLocalValedictorianClient({
      connectorRegistry: { get: getConnector },
      secretCodec: {
        decrypt,
        encrypt: vi.fn(() => ({
          ciphertext: 'unused',
          iv: 'unused',
          keyVersion: 1,
          tag: 'unused',
        })),
      },
      seedDataMode: 'none',
      pgliteDataPath,
      workspaceId: 'workspace-retirement',
      now: () => new Date('2026-07-13T16:00:00.000Z'),
    })

    const result = await client.connectors.remove({ connectorInstanceId: 'stale-connector' })

    expect(connectorRetirementResultSchema.parse(result)).toEqual(result)
    expect(result).toMatchObject({
      connectorInstanceId: 'stale-connector',
      lifecycle: 'retired',
      requirements: {
        authenticationValidation: 'not_required',
        connectorImplementation: 'not_required',
      },
    })
    await expect(client.connectors.list()).resolves.toEqual({ items: [] })
    expect(getConnector).not.toHaveBeenCalled()
    expect(decrypt).not.toHaveBeenCalled()
  })

  it('returns a typed conflict and preserves the instance when queued work is active', async () => {
    const client = await createLocalValedictorianClient({
      connectorRegistry: { get: () => null },
      seedDataMode: 'none',
      now: () => new Date('2026-07-13T16:00:00.000Z'),
    })
    const repository = createPgliteConnectorRepository(getTestLocalValedictorianDatabase(client))
    await repository.upsertInstance({
      id: 'connector-with-active-work',
      connectorId: 'removed.connector',
      connectorVersion: '0.1.0',
      displayName: 'Active removed connector',
      enabled: true,
      createdAt: '2026-07-13T12:00:00.000Z',
    })
    const queued = (await repository.recordRunRequest({
      connectorInstanceId: 'connector-with-active-work',
      mode: 'manual',
      startedAt: '2026-07-13T15:00:00.000Z',
    })).run

    await expect(client.connectors.remove({
      connectorInstanceId: 'connector-with-active-work',
    })).rejects.toMatchObject({
      code: 'connector_retirement_active_work_conflict',
      connectorInstanceId: 'connector-with-active-work',
      cancellationRequired: true,
      activeRuns: [{ connectorRunId: queued.id, status: 'queued' }],
      statusCode: 409,
    })
    await expect(client.connectors.list()).resolves.toMatchObject({
      items: [expect.objectContaining({ id: 'connector-with-active-work' })],
    })
  })

  it('destroys connector-owned session credentials while preserving workspace secret administration', async () => {
    const client = await createLocalValedictorianClient({
      connectorRegistry: { get: () => null },
      secretCodec: {
        decrypt: (value) => value.replace(/^encrypted:/, ''),
        encrypt: (value) => `encrypted:${value}`,
      },
      seedDataMode: 'none',
      now: () => new Date('2026-07-13T16:00:00.000Z'),
    })
    const database = getTestLocalValedictorianDatabase(client)
    const instance = await createPgliteConnectorRepository(database).upsertInstance({
      id: 'connector-with-session',
      connectorId: 'removed.connector',
      connectorVersion: '0.1.0',
      displayName: 'Connector with session',
      enabled: true,
      auth: [{ id: 'credential', mode: 'api_key', secretKey: 'connector-api-key' }],
      createdAt: '2026-07-13T12:00:00.000Z',
    })
    await database.insert(sourceExecutionSessions).values({
      executionScopeId: instance.executionScopeId,
      encryptedSession: 'encrypted:connector-runtime-session',
      authGeneration: 1,
      updatedAt: '2026-07-13T15:00:00.000Z',
    })
    await client.secrets.upsert({
      key: 'connector-api-key',
      kind: 'token',
      label: 'Connector API key',
      value: 'workspace-administered-secret',
    })

    await client.connectors.remove({ connectorInstanceId: instance.id })

    expect((await database.execute(sql`
      select encrypted_session from source_execution_sessions
      where execution_scope_id = ${instance.executionScopeId}
    `)).rows[0]).toBeUndefined()
    await expect(client.secrets.list()).resolves.toEqual({
      items: [expect.objectContaining({ key: 'connector_api_key' })],
    })
    expect((await database.execute(sql`
      select auth_json as "authJson" from connector_instances where id = ${instance.id}
    `)).rows[0]).toEqual({ authJson: '[]' })
  })

  it('fences a late refresh completion from recreating a retired connector session', async () => {
    const client = await createFreshLocalValedictorianClient({
      connectorRegistry: { get: () => null },
      seedDataMode: 'none',
      now: () => new Date('2026-07-13T16:00:00.000Z'),
    })
    const database = getTestLocalValedictorianDatabase(client)
    const instance = await createPgliteConnectorRepository(database).upsertInstance({
      id: 'connector-refreshing-during-retirement',
      connectorId: 'removed.connector',
      connectorVersion: '0.1.0',
      displayName: 'Refreshing connector',
      enabled: true,
      createdAt: '2026-07-13T12:00:00.000Z',
    })
    const governor = createSourceExecutionGovernor(database)
    const lease = await governor.acquireRefreshLease(instance.executionScopeId, {
      leaseMs: 60_000,
      now: '2026-07-13T15:59:30.000Z',
      token: 'refresh-issued-before-retirement',
    })!

    await client.connectors.remove({ connectorInstanceId: instance.id })

    expect(await governor.completeRefresh(instance.executionScopeId, {
      encryptedSession: 'late-provider-session',
      now: '2026-07-13T16:00:01.000Z',
      token: lease.token,
    })).toBeNull()
    expect(await database.select().from(sourceExecutionSessions)).toEqual([])
  })

  it('retires mutable execution state while preserving checkpoints and canonical Capture lineage', async () => {
    const retiredAt = '2026-07-13T16:00:00.000Z'
    const client = await createLocalValedictorianClient({
      connectorRegistry: { get: () => null },
      seedDataMode: 'none',
      now: () => new Date(retiredAt),
    })
    const database = getTestLocalValedictorianDatabase(client)
    const repository = createPgliteConnectorRepository(database)
    const instance = await repository.upsertInstance({
      id: 'connector-with-history',
      connectorId: 'removed.connector',
      connectorVersion: '0.1.0',
      displayName: 'Connector with history',
      enabled: true,
      auth: [{ id: 'credential', mode: 'api_key', secretKey: 'historical-secret' }],
      config: { privateOption: 'remove-me' },
      filters: { role: 'intern' },
      createdAt: '2026-07-13T12:00:00.000Z',
    })
    const run = (await repository.recordRunRequest({
      connectorInstanceId: instance.id,
      mode: 'manual',
      startedAt: '2026-07-13T13:00:00.000Z',
    })).run
    const capture = await client.captures.create({
      evidenceMode: 'reported',
      adapter: { id: instance.connectorId, kind: 'connector', version: instance.connectorVersion },
      observedAt: '2026-07-13T13:00:00.000Z',
      providerRecordId: 'historical-job',
      providerSchema: 'removed-connector@1',
      payload: { companyName: 'Historical Co', roleTitle: 'Software Intern' },
      evidence: [],
    })
    if (capture.status !== 'succeeded') throw new Error('Expected canonical Capture creation')
    await repository.recordCheckpoint({
      connectorInstanceId: instance.id,
      filterSignature: 'filters:{"role":"intern"}',
      checkpoint: { checkpoint: { cursor: 'historical' }, schemaVersion: 'checkpoint@1' },
      coverage: {
        start: '2026-07-01T00:00:00.000Z',
        end: '2026-07-13T13:00:00.000Z',
      },
      savedAt: '2026-07-13T13:30:00.000Z',
    })
    const schedule = await createConnectorScheduleRepository(database, () => new Date(
      '2026-07-13T14:00:00.000Z',
    )).create({
      connectorInstanceId: instance.id,
      state: 'active',
      cadence: { kind: 'interval', everyMinutes: 60 },
      timezone: 'UTC',
    })
    await repository.markRunRunning({
      connectorRunId: run.id,
      startedAt: '2026-07-13T13:00:00.000Z',
    })
    await repository.completeRun({
      connectorRunId: run.id,
      completedAt: '2026-07-13T15:00:00.000Z',
      status: 'completed',
    })

    await client.connectors.remove({ connectorInstanceId: instance.id })

    await expect(client.connectors.runs.list({ connectorInstanceId: instance.id }))
      .resolves.toMatchObject({ items: [expect.objectContaining({ id: run.id })] })
    await expect(client.connectors.checkpoints.list({ connectorInstanceId: instance.id }))
      .resolves.toMatchObject({ items: [expect.objectContaining({
        checkpoint: { cursor: 'historical' },
      })] })
    await expect(client.captures.get(capture.resource.id))
      .resolves.toMatchObject({ id: capture.resource.id, revision: 1 })
    expect((await database.execute(sql`
      select enabled, config_json as "configJson", auth_json as "authJson",
        filters_json as "filtersJson", earliest_backfill_date as "earliestBackfillDate",
        deleted_at as "deletedAt" from connector_instances where id = ${instance.id}
    `)).rows[0]).toEqual({
      enabled: false,
      configJson: '{}',
      authJson: '[]',
      filtersJson: '{}',
      earliestBackfillDate: null,
      deletedAt: retiredAt,
    })
    expect((await database.execute(sql`
      select deleted_at as "deletedAt" from connector_schedules where id = ${schedule.id}
    `)).rows[0]).toEqual({ deletedAt: retiredAt })
    expect(await database.select().from(sourceExecutionScopes)).toEqual([
      expect.objectContaining({ id: instance.executionScopeId, deletedAt: null }),
    ])
    await expect(createConnectorScheduleRepository(database).create({
      connectorInstanceId: instance.id,
      state: 'active',
      cadence: { kind: 'interval', everyMinutes: 60 },
      timezone: 'UTC',
    })).rejects.toThrow(/connector instance not found/i)
    await expect(client.connectors.runs.trigger({
      connectorInstanceId: instance.id,
      mode: 'manual',
    })).rejects.toThrow()
  })
})
