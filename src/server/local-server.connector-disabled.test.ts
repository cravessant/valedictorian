import { afterEach, describe, expect, it } from 'vitest'
import { createHttpValedictorianClient } from 'sparxie'
import { createStaticConnectorRegistry } from '../modules/connectors/connector.registry'
import type { AppJobConnector } from '../modules/connectors/connector.runner'
import { createLocalValedictorianClient } from '../runtime/local-valedictorian-client'
import {
  createScheduleHttpTempSqlitePath,
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
    const localClient = createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([connector]),
      seedDataMode: 'none',
      sqlitePath: createScheduleHttpTempSqlitePath(),
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
      coverageEndedAt: '2026-07-13T13:00:00.000Z',
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
    const disabledResponse = await triggerThroughHttp(server.url, workspaceId, trigger)
    expect(disabledResponse.status).toBe(409)
    await expect(disabledResponse.json()).resolves.toEqual({
      message: 'Connector instance is disabled: disabled-fixture',
    })
    expect(refreshCalls).toBe(0)

    await httpClient.connectors.update({
      connectorInstanceId: 'disabled-fixture',
      enabled: true,
    })
    const enabledResponse = await triggerThroughHttp(server.url, workspaceId, trigger)
    expect(enabledResponse.status).toBe(200)
    await expect(enabledResponse.json()).resolves.toMatchObject({
      connectorInstanceId: 'disabled-fixture',
      status: 'completed',
    })
    expect(refreshCalls).toBe(1)
  })
})

function triggerThroughHttp(
  baseUrl: string,
  workspaceId: string,
  trigger: { connectorInstanceId: string; coverageEndedAt: string; mode: 'manual' },
) {
  return fetch(
    `${baseUrl}/v1/workspaces/${workspaceId}/connectors/${trigger.connectorInstanceId}/runs`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        coverageEndedAt: trigger.coverageEndedAt,
        mode: trigger.mode,
      }),
    },
  )
}
