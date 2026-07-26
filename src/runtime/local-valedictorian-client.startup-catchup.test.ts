import { describe, expect, it } from 'vitest'
import {
  createOwnedTestPgliteDataPath,
  createTestLocalValedictorianClient as createRuntimeLocalValedictorianClient,
  getTestLocalValedictorianDatabase,
  useTestMissingReferenceTrackerPath,
} from './local-valedictorian-client.test-harness'
import { createStaticConnectorRegistry } from '../modules/connectors/connector.registry'
import { createPgliteConnectorRepository } from '../modules/connectors/connector.repository'
import { completedConnectorRefreshContract } from '../modules/connectors/connector-refresh-result.test-helpers'
import type { AppJobConnector } from '../modules/connectors/connector.runner'

describe('runtime local Valedictorian client deferred refresh', () => {
  useTestMissingReferenceTrackerPath()

  it('persists deferred_refresh work as public manual mode without schedule provenance or a startup scan API', async () => {
    const pgliteDataPath = createOwnedTestPgliteDataPath('valedictorian-client-')
    const client = await createRuntimeLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([fixtureConnector()]),
      now: () => new Date('2026-07-09T16:00:00.000Z'),
      seedDataMode: 'none',
      pgliteDataPath,
    })
    const connectorRepository = createPgliteConnectorRepository(
      getTestLocalValedictorianDatabase(client),
    )

    await connectorRepository.upsertInstance({
      id: 'connector-instance-enabled',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Enabled Fixture Jobs',
      enabled: true,
      createdAt: '2026-07-08T15:00:00.000Z',
    })

    expect(client.connectors.runs).not.toHaveProperty('startupCatchUp')

    const run = await client.connectors.runs.trigger({
      connectorInstanceId: 'connector-instance-enabled',
      mode: 'manual',
      executionIntent: 'deferred_refresh',
      coverageEndedAt: '2026-07-09T16:00:00.000Z',
    })

    expect(run).toMatchObject({
      connectorInstanceId: 'connector-instance-enabled',
      mode: 'manual',
      scheduleOccurrence: null,
      status: 'completed',
    })
  })
})

function fixtureConnector(): AppJobConnector {
  return {
    definition: {
      id: 'fixture.jobs',
      version: '0.0.0-fixture',
    },
    async refresh(input) {
        return {
          ...completedConnectorRefreshContract(input.coverage.start.slice(0, 10)),
          coverage: input.coverage,
        nextCheckpoint: {
          checkpoint: { cursor: 'fixture-cursor' },
          schemaVersion: 'fixture-checkpoint@1',
        },
        observations: [],
        stats: { observations: 0 },
        warnings: [],
      }
    },
  }
}
