import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  type ConnectorSchedulingCapability,
} from 'sparxie'
import { createLocalValedictorianClient } from './local-valedictorian-client.test-harness'
import { createStaticConnectorRegistry } from '../modules/connectors/connector.registry'
import type { AppJobConnector } from '../modules/connectors/connector.runner'
import {
  createValedictorianHttpServer,
  type StartedValedictorianHttpServer,
} from './local-server'

/** Shared HTTP/database fixtures for connector-schedule server tests. */
export function createScheduleHttpTempDatabasePath() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-schedule-http-'))
}

export async function readScheduleHttpJson(response: Response) {
  return response.json() as Promise<unknown>
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

export type ScheduleHttpServerHandle = StartedValedictorianHttpServer

export {
  createLocalValedictorianClient,
  createStaticConnectorRegistry,
  createValedictorianHttpServer,
}
