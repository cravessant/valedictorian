import { afterEach, describe, expect, it } from 'vitest'
import { createHttpValedictorianClient } from 'sparxie'
import { createStaticConnectorRegistry } from '../modules/connectors/connector.registry'
import type { AppJobConnector } from '../modules/connectors/connector.runner'
import { createLocalValedictorianClient } from './local-valedictorian-client.test-harness'
import {
  createScheduleHttpTempDatabasePath,
  createValedictorianHttpServer,
  type ScheduleHttpServerHandle,
} from './local-server.connector-schedules.http-fixture'

describe('disabled connector execution', () => {
  let server: ScheduleHttpServerHandle | null = null

  afterEach(async () => {
    await server?.close()
    server = null
  })

  it('rejects local and HTTP manual admission without execution until reenabled', async () => {
    let refreshCalls = 0
    const connector: AppJobConnector = {
      definition: { id: 'fixture.jobs', version: '1.0.0' },
      async refresh(input) {
        refreshCalls += 1
        return {
          observations: [],
          nextCheckpoint: { checkpoint: {}, schemaVersion: 'fixture@1' },
          coverage: input.coverage,
          stats: { observations: 0 },
          warnings: [],
          status: 'completed',
          retryHints: null,
          operationOutcome: null,
          synchronization: {
            newestFrontier: { state: 'caught_up' },
            historicalBackfill: {
              state: 'caught_up',
              boundary: { earliestDate: input.coverage.start.slice(0, 10) },
            },
            pendingResolutionCount: 0,
            outcome: { kind: 'caught_up' },
          },
        }
      },
    }
    const workspaceId = 'disabled-connector-workspace'
    const localClient = await createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([connector]),
      seedDataMode: 'none',
      pgliteDataPath: createScheduleHttpTempDatabasePath(),
      workspaceId,
    })
    await localClient.connectors.create({
      id: 'disabled-fixture',
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      displayName: 'Disabled fixture',
      enabled: false,
      earliestBackfillDate: '2026-07-01',
    })
    const trigger = {
      connectorInstanceId: 'disabled-fixture',
      mode: 'manual' as const,
    }

    await expect(localClient.connectors.runs.trigger(trigger))
      .rejects.toThrow('Connector instance is disabled: disabled-fixture')
    expect(refreshCalls).toBe(0)
    await expect(localClient.connectors.runs.list({
      connectorInstanceId: 'disabled-fixture',
    })).resolves.toMatchObject({ items: [], total: 0 })

    server = await createValedictorianHttpServer({
      client: localClient,
      host: '127.0.0.1',
      port: 0,
      resolveWorkspaceClient: async () => localClient,
    })
    const httpClient = createHttpValedictorianClient({ baseUrl: server.url })
      .forWorkspace(workspaceId)
    await expect(httpClient.connectors.runs.trigger(trigger)).rejects.toMatchObject({
      status: 409,
      body: null,
    })
    expect(refreshCalls).toBe(0)

    await httpClient.connectors.update({
      connectorInstanceId: 'disabled-fixture',
      enabled: true,
    })
    await expect(httpClient.connectors.runs.trigger(trigger)).resolves.toMatchObject({
      connectorInstanceId: 'disabled-fixture',
      status: 'completed',
    })
    expect(refreshCalls).toBe(1)
  })
})
