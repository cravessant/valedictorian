import { describe, expect, it } from 'vitest'
import { createStaticConnectorRegistry } from '../modules/connectors/core/connector.registry'
import type { AppJobConnector } from '../modules/connectors/ports/connector.runner-contracts'
import {
  createOwnedTestPgliteDataPath,
  createTestLocalValedictorianClient as createRuntimeLocalValedictorianClient,
} from './local-valedictorian-client.test-harness'

function createFixtureConnector(): AppJobConnector {
  return {
    definition: {
      id: 'fixture.create',
      version: '1.0.0',
      displayName: 'Create fixture',
      capabilities: {
        fetchesPublicPages: false,
        resolvesIntermediaryLinks: false,
        supportsFiltering: false,
        supportsIncrementalRefresh: true,
      },
      checkpoint: { schemaVersion: 'fixture-checkpoint@1' },
    },
    async refresh() {
      throw new Error('refresh is not used by earliest-create tracer')
    },
  }
}

describe('runtime connectors.create earliest backfill date', () => {
  it('defaults omitted dates from the create instant and rejects out-of-range explicit dates', async () => {
    const pgliteDataPath = createOwnedTestPgliteDataPath('valedictorian-earliest-create-')
    const createInstant = '2026-07-11T15:30:00.000Z'
    const client = await createRuntimeLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([createFixtureConnector()]),
      now: () => new Date(createInstant),
      seedDataMode: 'none',
      pgliteDataPath,
    })

    const omitted = await client.connectors.create({
      id: 'create-default',
      connectorId: 'fixture.create',
      connectorVersion: '1.0.0',
      displayName: 'Default earliest',
      enabled: true,
    })
    expect(omitted).toMatchObject({
      createdAt: createInstant,
      earliestBackfillDate: '2026-07-04',
    })

    const explicit = await client.connectors.create({
      id: 'create-explicit',
      connectorId: 'fixture.create',
      connectorVersion: '1.0.0',
      displayName: 'Explicit earliest',
      enabled: true,
      earliestBackfillDate: '2026-04-12',
    })
    expect(explicit).toMatchObject({
      createdAt: createInstant,
      earliestBackfillDate: '2026-04-12',
    })

    await expect(client.connectors.create({
      id: 'create-too-early',
      connectorId: 'fixture.create',
      connectorVersion: '1.0.0',
      displayName: 'Too early',
      enabled: true,
      earliestBackfillDate: '2026-04-11',
    })).rejects.toThrow(/createdAt minus 90 UTC calendar days/i)

    await expect(client.connectors.create({
      id: 'create-future',
      connectorId: 'fixture.create',
      connectorVersion: '1.0.0',
      displayName: 'Future',
      enabled: true,
      earliestBackfillDate: '2026-07-12',
    })).rejects.toThrow(/today's UTC date/i)

    const listed = await client.connectors.list()
    expect(listed.items.map((item) => item.id).sort()).toEqual([
      'create-default',
      'create-explicit',
    ])
  })
})
