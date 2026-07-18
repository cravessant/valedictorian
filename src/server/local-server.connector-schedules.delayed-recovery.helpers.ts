import type { DispatchConnectorScheduleDueResult } from 'sparxie'
import { createPgliteClient, migratePgliteDatabase, type PgliteDatabase } from '../db/pglite'
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
  database: PgliteDatabase
  pgliteDataPath: string
  now: () => Date
}) {
  const client = await createLocalValedictorianClient({
    connectorRegistry: createStaticConnectorRegistry([fixtureConnector()]),
    connectorScheduling: availableSchedulingCapability,
    database: input.database,
    now: input.now,
    seedDataMode: 'none',
    pgliteDataPath: input.pgliteDataPath,
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

export async function admitScheduleDueOnly(input: {
  database: PgliteDatabase
  now: () => Date
  expectedRevision: string
}): Promise<Extract<DispatchConnectorScheduleDueResult, { status: 'admitted' }>> {
  const admitted = await admitConnectorScheduleDue({
    database: input.database,
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
}

export async function openScheduleDatabase(pgliteDataPath: string) {
  const client = await createPgliteClient({ dataDir: pgliteDataPath })
  const database = await migratePgliteDatabase(client)
  return {
    client,
    database,
    async close() {
      await client.close()
    },
  }
}

export async function createReopenedScheduleClient(input: {
  workspaceId: string
  database: PgliteDatabase
  pgliteDataPath: string
  now: () => Date
  onRefresh?: AppJobConnector['refresh']
  connectorRegistry?: ReturnType<typeof createStaticConnectorRegistry>
}) {
  let refreshCalls = 0
  const client = await createLocalValedictorianClient({
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
            operationOutcome: null,
            status: 'completed',
            stats: { observations: 0 },
            synchronization: {
              newestFrontier: { state: 'caught_up' },
              historicalBackfill: { state: 'caught_up', boundary: { earliestDate: refreshInput.coverage.start.slice(0, 10) } },
              pendingResolutionCount: 0,
              outcome: { kind: 'caught_up' },
            },
            warnings: [],
          }
        },
      },
    ]),
    connectorScheduling: availableSchedulingCapability,
    database: input.database,
    now: input.now,
    seedDataMode: 'none',
    pgliteDataPath: input.pgliteDataPath,
    workspaceId: input.workspaceId,
  })

  return {
    client,
    get refreshCalls() {
      return refreshCalls
    },
  }
}
