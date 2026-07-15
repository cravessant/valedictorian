import { afterEach, describe, expect, it } from 'vitest'
import { createHttpValedictorianClient } from 'sparxie'
import { retryWork } from '../db/schema'
import { createDrizzleDatabase, createFileDatabase } from '../db/sqlite'
import { createConnectorScheduleRepository } from '../modules/connectors/connector-schedule.repository'
import { JOBRIGHT_CONNECTOR_VERSION } from '../modules/connectors/jobright.constants'
import { deriveSourceExecutionScopeId } from '../modules/source-execution/source-execution-governor'
import { createLocalValedictorianClient } from '../runtime/local-valedictorian-client'
import type { RendererBackendState } from '../ipc/valedictorian-http.preload'
import { createValedictorianHttpServer, type StartedValedictorianHttpServer } from '../server/local-server'
import { createTempSqlitePath } from '../server/local-server.http-test-harness'
import { defaultConnectorsApi } from './loaders'

const activeServers = new Set<StartedValedictorianHttpServer>()

afterEach(async () => {
  delete (window as Window & { valedictorianHttp?: unknown }).valedictorianHttp
  await Promise.all([...activeServers].map((server) => server.close()))
  activeServers.clear()
})

describe('connector re-add lifecycle through workspace HTTP and SQLite', () => {
  it('rejects resurrecting a retired connector-instance id as an immutable tombstone', async () => {
    const sqlitePath = createTempSqlitePath()
    const client = createLocalValedictorianClient({ seedDataMode: 'none', sqlitePath })
    const server = await start(client)
    const workspace = createHttpValedictorianClient({ baseUrl: server.url })
      .forWorkspace('workspace-transport')

    const first = await workspace.connectors.create(jobrightCreateInput('jobright-retired'))
    await workspace.connectors.remove({ connectorInstanceId: first.id })

    await expect(workspace.connectors.create(jobrightCreateInput('jobright-retired')))
      .rejects.toMatchObject({ status: 409, body: { code: 'already_configured' } })
    await expect(workspace.connectors.list()).resolves.toEqual({ items: [] })
  })

  it('creates a fresh Jobright instance after remove without reviving the retired id or scope', async () => {
    const sqlitePath = createTempSqlitePath()
    const client = createLocalValedictorianClient({ seedDataMode: 'none', sqlitePath })
    const server = await start(client)
    installRendererBinding(server.url, () => ({ origin: server.url, status: 'available' }))

    const first = await defaultConnectorsApi.create(jobrightCreateInput('jobright-first'))
    await defaultConnectorsApi.remove({ connectorInstanceId: first.id })
    const second = await defaultConnectorsApi.create(jobrightCreateInput('jobright-second'))

    expect(second.id).toBe('jobright-second')
    expect(second.id).not.toBe(first.id)
    expect(deriveSourceExecutionScopeId(second.id))
      .not.toBe(deriveSourceExecutionScopeId(first.id))
    await expect(defaultConnectorsApi.list()).resolves.toMatchObject({
      items: [{ id: second.id, connectorId: 'jobright.resolver' }],
    })

    const sqlite = createFileDatabase(sqlitePath)
    expect(sqlite.prepare(
      'select deleted_at as deletedAt from connector_instances where id = ?',
    ).get(first.id)).toEqual({ deletedAt: expect.any(String) })
    expect(sqlite.prepare(
      'select deleted_at as deletedAt from connector_instances where id = ?',
    ).get(second.id)).toEqual({ deletedAt: null })
    expect(sqlite.prepare(
      'select id from source_execution_scopes where id = ?',
    ).get(deriveSourceExecutionScopeId(first.id))).toEqual({
      id: deriveSourceExecutionScopeId(first.id),
    })
    expect(sqlite.prepare(
      'select id from source_execution_scopes where id = ?',
    ).get(deriveSourceExecutionScopeId(second.id))).toEqual({
      id: deriveSourceExecutionScopeId(second.id),
    })
    sqlite.close()
  })

  it('re-adds Jobright after process restart without copying retired schedule or retry state', async () => {
    const sqlitePath = createTempSqlitePath()
    const retiredAt = '2026-07-13T16:00:00.000Z'
    const firstClient = createLocalValedictorianClient({
      seedDataMode: 'none',
      sqlitePath,
      now: () => new Date(retiredAt),
    })
    const firstServer = await start(firstClient)
    const firstWorkspace = createHttpValedictorianClient({ baseUrl: firstServer.url })
      .forWorkspace('workspace-transport')

    const first = await firstWorkspace.connectors.create(jobrightCreateInput('jobright-before-restart'))
    const drizzle = createDrizzleDatabase(createFileDatabase(sqlitePath))
    const schedule = createConnectorScheduleRepository(drizzle, () => new Date(retiredAt)).create({
      connectorInstanceId: first.id,
      state: 'active',
      cadence: { kind: 'interval', everyMinutes: 60 },
      timezone: 'UTC',
    })
    drizzle.insert(retryWork).values({
      id: 'retry-before-restart',
      executionScopeId: deriveSourceExecutionScopeId(first.id),
      kind: 'connector_capture',
      connectorInstanceId: first.id,
      rawRevisionId: null,
      resolverId: null,
      resolverVersion: null,
      inputHash: null,
      reason: 'network_interruption',
      attempt: 1,
      maxAttempts: 3,
      lastAttemptAt: retiredAt,
      computedDelayMs: 60_000,
      nextAttemptAt: '2026-07-13T16:01:00.000Z',
      horizonAt: '2026-07-14T16:00:00.000Z',
      state: 'scheduled',
      ownerVersion: 'jobright.resolver@0.12.0',
      lineageJson: JSON.stringify({ connectorInstanceId: first.id }),
      filterSignature: 'filters:{}',
      checkpointSchemaVersion: 'jobright-checkpoint@1',
      checkpointGeneration: 1,
      createdAt: retiredAt,
      updatedAt: retiredAt,
      deletedAt: null,
    }).run()
    await firstWorkspace.connectors.remove({ connectorInstanceId: first.id })
    await firstServer.close()
    activeServers.delete(firstServer)

    const restarted = createLocalValedictorianClient({
      seedDataMode: 'none',
      sqlitePath,
      now: () => new Date('2026-07-13T17:00:00.000Z'),
    })
    const restartedServer = await start(restarted)
    const workspace = createHttpValedictorianClient({ baseUrl: restartedServer.url })
      .forWorkspace('workspace-transport')

    await expect(workspace.connectors.list()).resolves.toEqual({ items: [] })
    const replacement = await workspace.connectors.create(jobrightCreateInput('jobright-after-restart'))
    expect(replacement.id).toBe('jobright-after-restart')
    expect(replacement.id).not.toBe(first.id)

    const sqlite = createFileDatabase(sqlitePath)
    expect(sqlite.prepare(
      'select deleted_at as deletedAt from connector_schedules where id = ?',
    ).get(schedule.id)).toEqual({ deletedAt: retiredAt })
    expect(sqlite.prepare(
      'select deleted_at as deletedAt from retry_work where id = ?',
    ).get('retry-before-restart')).toEqual({ deletedAt: retiredAt })
    expect(sqlite.prepare(
      'select count(*) as count from connector_schedules where connector_instance_id = ? and deleted_at is null',
    ).get(replacement.id)).toEqual({ count: 0 })
    expect(sqlite.prepare(
      'select count(*) as count from retry_work where execution_scope_id = ? and deleted_at is null',
    ).get(deriveSourceExecutionScopeId(replacement.id))).toEqual({ count: 0 })
    expect(sqlite.prepare(
      'select status, action_reason as actionReason from source_execution_scopes where id = ?',
    ).get(deriveSourceExecutionScopeId(first.id))).toEqual({
      status: 'action_required',
      actionReason: 'connector_retired',
    })
    sqlite.close()
  })
})

async function start(client: ReturnType<typeof createLocalValedictorianClient>) {
  const server = await createValedictorianHttpServer({ client, host: '127.0.0.1', port: 0 })
  activeServers.add(server)
  return server
}

function installRendererBinding(
  initialOrigin: string,
  getBackendState: () => RendererBackendState,
) {
  ;(window as Window & { valedictorianHttp?: unknown }).valedictorianHttp = {
    apiBaseUrl: initialOrigin,
    getBackendState,
    onBackendStateChanged: () => () => undefined,
    workspaceId: 'workspace-transport',
  }
}

function jobrightCreateInput(id: string) {
  return {
    id,
    connectorId: 'jobright.resolver',
    connectorVersion: JOBRIGHT_CONNECTOR_VERSION,
    displayName: 'Jobright internslist',
    enabled: true,
    auth: [{ id: 'jobright', label: 'Jobright credentials', mode: 'username_password' as const }],
    config: {},
    filters: {
      jobTaxonomyList: [{ taxonomyId: 'software-engineering', title: 'Software Engineering' }],
    },
  }
}
