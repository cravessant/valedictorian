import { afterEach, beforeEach } from 'vitest'
import {
  type ConnectorSchedulingCapability,
} from '@sparxie/sdk'
import {
  createLocalValedictorianClient,
  createOwnedPgliteTestDataPath,
} from './local-valedictorian-client.test-harness'
import { createStaticConnectorRegistry } from '../modules/connectors/connector.registry'
import type { AppJobConnector } from '../modules/connectors/connector.runner'
import {
  createLocalServerHttpTestFixture,
  workspaceHttpClient,
} from './local-server.http-test-harness'
import {
  createValedictorianHttpServer,
  type CreateValedictorianHttpServerOptions,
  type StartedValedictorianHttpServer,
  type WorkspaceClientResolver,
} from './local-server'
import type { LocalValedictorianClient } from '../runtime/local-connector-client.contract'

const SCHEDULE_PGLITE_PATH_PREFIX = 'valedictorian-schedule-http-'

/**
 * Managed temporary PGlite directory for suites that arrange schedules without the
 * HTTP fixture; removed after the test once its database owners are closed.
 */
export function createScheduleHttpTempDatabasePath() {
  return createOwnedPgliteTestDataPath(SCHEDULE_PGLITE_PATH_PREFIX)
}

export async function readScheduleHttpJson(response: Response) {
  return response.json() as Promise<unknown>
}

/** Resolver that serves exactly one workspace id and rejects any other routing attempt. */
export function onlyScheduleWorkspace(
  workspaceId: string,
  client: LocalValedictorianClient,
): WorkspaceClientResolver {
  return async (id) => {
    if (id !== workspaceId) {
      throw new Error(`Unexpected workspace: ${id}`)
    }
    return client
  }
}

export interface ScheduleHttpWorkspaceServer {
  server: StartedValedictorianHttpServer
  workspace: ReturnType<typeof workspaceHttpClient>
}

export interface StartScheduleWorkspaceServerOptions {
  client: LocalValedictorianClient
  workspaceId: string
  /** Defaults to routing every workspace id to `client`, matching direct server construction. */
  resolveWorkspaceClient?: WorkspaceClientResolver
}

export interface ScheduleHttpFixture {
  createPgliteDataPath(): string
  start(
    options: Omit<CreateValedictorianHttpServerOptions, 'host' | 'port'>,
  ): Promise<StartedValedictorianHttpServer>
  startWorkspaceServer(
    options: StartScheduleWorkspaceServerOptions,
  ): Promise<ScheduleHttpWorkspaceServer>
}

/**
 * Connector-schedule HTTP arrangement composed from the shared local-server HTTP fixture.
 * The fixture owns loopback server startup and closure; every started server is closed
 * after the test even when the test fails partway through.
 */
export function useScheduleHttpFixture(): ScheduleHttpFixture {
  const fixture = createLocalServerHttpTestFixture()

  beforeEach(() => fixture.setup())
  afterEach(() => fixture.teardown())

  return {
    createPgliteDataPath() {
      return fixture.createPgliteDataPath(SCHEDULE_PGLITE_PATH_PREFIX)
    },
    start(options) {
      return fixture.start(options)
    },
    async startWorkspaceServer({ client, workspaceId, resolveWorkspaceClient }) {
      const server = await fixture.start({
        client,
        resolveWorkspaceClient: resolveWorkspaceClient ?? (async () => client),
      })
      return { server, workspace: workspaceHttpClient(server, workspaceId) }
    },
  }
}

export const availableConnectorSchedulingCapability: Extract<
  ConnectorSchedulingCapability,
  { available: true }
> = {
  available: true,
  supportedCadences: ['interval', 'daily', 'weekly'],
  minimumIntervalMinutes: 15,
  maximumCatchUpAgeMinutes: 24 * 60,
  timezoneModel: 'iana',
  missedOccurrencePolicy: 'coalesce_one',
}

export function createScheduleHttpFixtureConnector(): AppJobConnector {
  return {
    definition: {
      id: 'fixture.jobs',
      version: '0.0.0-fixture',
    },
    async refresh(input) {
      return {
        coverage: input.coverage,
        nextCheckpoint: {
          checkpoint: {},
          schemaVersion: 'fixture-checkpoint@1',
        },
        observations: [],
        operationOutcome: null,
        status: 'completed',
        stats: { observations: 0 },
        synchronization: {
          newestFrontier: { state: 'caught_up' },
          historicalBackfill: { state: 'caught_up', boundary: { earliestDate: input.coverage.start.slice(0, 10) } },
          pendingResolutionCount: 0,
          outcome: { kind: 'caught_up' },
        },
        warnings: [],
      }
    },
  }
}

/** Direct server handle for suites outside the connector-schedule HTTP fixture. */
export type ScheduleHttpServerHandle = StartedValedictorianHttpServer

export {
  createLocalValedictorianClient,
  createStaticConnectorRegistry,
  createValedictorianHttpServer,
  workspaceHttpClient as scheduleWorkspaceHttpClient,
}
