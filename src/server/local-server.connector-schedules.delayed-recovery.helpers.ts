import type { DispatchConnectorScheduleDueResult } from 'sparxie'
import { createDrizzleDatabase, createFileDatabase } from '../db/sqlite'
import { admitConnectorScheduleDue } from '../modules/connectors/connector-schedule.dispatch'
import type { AppJobConnector } from '../modules/connectors/connector.runner'
import {
  availableConnectorSchedulingCapability as availableSchedulingCapability,
  createLocalValedictorianClient,
  createScheduleHttpFixtureConnector as fixtureConnector,
  createStaticConnectorRegistry,
} from './local-server.connector-schedules.http-fixture'

export const CONNECTOR_INSTANCE_ID = 'connector-instance-schedule'

export async function seedHourlyScheduleWorkspace(input: {
  workspaceId: string
  sqlitePath: string
  now: () => Date
}) {
  const client = createLocalValedictorianClient({
    connectorRegistry: createStaticConnectorRegistry([fixtureConnector()]),
    connectorScheduling: availableSchedulingCapability,
    now: input.now,
    seedDataMode: 'none',
    sqlitePath: input.sqlitePath,
    workspaceId: input.workspaceId,
  })

  await client.connectors.create({
    id: CONNECTOR_INSTANCE_ID,
    connectorId: 'fixture.jobs',
    connectorVersion: '0.0.0-fixture',
    displayName: 'Fixture Jobs',
    enabled: true,
  })

  const created = await client.connectors.schedules.upsert({
    connectorInstanceId: CONNECTOR_INSTANCE_ID,
    expectedRevision: null,
    state: 'enabled',
    cadence: { kind: 'interval', everyMinutes: 60 },
    timezone: 'UTC',
  })

  return { client, created }
}

export function admitScheduleDueOnly(input: {
  sqlitePath: string
  now: () => Date
  expectedRevision: string
}): Extract<DispatchConnectorScheduleDueResult, { status: 'admitted' }> {
  const sqlite = createFileDatabase(input.sqlitePath)
  try {
    const admitted = admitConnectorScheduleDue({
      database: createDrizzleDatabase(sqlite),
      now: input.now,
      maximumCatchUpAgeMinutes: availableSchedulingCapability.maximumCatchUpAgeMinutes,
      input: {
        connectorInstanceId: CONNECTOR_INSTANCE_ID,
        expectedRevision: input.expectedRevision,
      },
    })
    if (admitted.status !== 'admitted') {
      throw new Error(`expected admitted setup, got ${admitted.status}`)
    }
    return admitted
  } finally {
    sqlite.close()
  }
}

export function openScheduleSqlite(sqlitePath: string) {
  const sqlite = createFileDatabase(sqlitePath)
  const database = createDrizzleDatabase(sqlite)
  return {
    sqlite,
    database,
    close() {
      sqlite.close()
    },
  }
}

export function createReopenedScheduleClient(input: {
  workspaceId: string
  sqlitePath: string
  now: () => Date
  onRefresh?: AppJobConnector['refresh']
  connectorRegistry?: ReturnType<typeof createStaticConnectorRegistry>
}) {
  let refreshCalls = 0
  const client = createLocalValedictorianClient({
    connectorRegistry: input.connectorRegistry ?? createStaticConnectorRegistry([
      {
        definition: { id: 'fixture.jobs', version: '0.0.0-fixture' },
        async refresh(refreshInput, runtime) {
          refreshCalls += 1
          if (input.onRefresh) {
            return input.onRefresh(refreshInput, runtime)
          }
          return {
            coverage: refreshInput.coverage,
            nextCheckpoint: {
              checkpoint: { cursor: `refresh-${refreshCalls}` },
              schemaVersion: 'fixture-checkpoint@1',
            },
            observations: [],
            stats: { observations: 0 },
            warnings: [],
          }
        },
      },
    ]),
    connectorScheduling: availableSchedulingCapability,
    now: input.now,
    seedDataMode: 'none',
    sqlitePath: input.sqlitePath,
    workspaceId: input.workspaceId,
  })

  return {
    client,
    get refreshCalls() {
      return refreshCalls
    },
  }
}
