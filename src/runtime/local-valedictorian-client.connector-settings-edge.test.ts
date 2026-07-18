import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizationReplayRequests } from '../db/schema'
import type { AppJobConnector } from '../modules/connectors/connector.runner'
import type { LocalConnectorRegistry } from '../modules/connectors/connector.registry'
import { createStaticConnectorRegistry } from '../modules/connectors/connector.registry'
import { createPgliteConnectorRepository } from '../modules/connectors/connector.repository'
import {
  createTestLocalValedictorianClient as createLocalValedictorianClient,
  getTestLocalValedictorianDatabase,
} from './local-valedictorian-client.test-harness'

const INSTANCE_ID = 'fixture-required-settings-instance'
const CONNECTOR_ID = 'fixture.required-settings'

describe('local connector settings completeness and upgrade edges', () => {
  it('validates descriptor-required config and filters when creating an enabled instance', async () => {
    const client = await clientFor(requiredSettingsConnector('1.0.0'))

    await expect(client.connectors.create(createInput({
      config: {},
      filters: { category: 'engineering' },
    }))).rejects.toThrow(/config|batchSize|required/i)
    await expect(client.connectors.create(createInput({
      config: { batchSize: 20 },
      filters: {},
    }))).rejects.toThrow(/filter|category|required/i)
  })

  it('validates descriptor-required config as well as filters when enabling an existing draft', async () => {
    const client = await clientFor(requiredSettingsConnector('1.0.0'))
    await client.connectors.create(createInput({ enabled: false }))

    await expect(client.connectors.update({
      connectorInstanceId: INSTANCE_ID,
      enabled: true,
      filters: { category: 'engineering' },
    })).rejects.toThrow(/config|batchSize|required/i)
    await expect(client.connectors.list()).resolves.toMatchObject({
      items: [{ id: INSTANCE_ID, enabled: false, config: {}, filters: {} }],
    })
  })

  it('validates descriptor-required config before running a persisted enabled instance', async () => {
    const pgliteDataPath = tempDatabasePath()
    const legacy = await createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([legacyConnector('1.0.0')]),
      seedDataMode: 'none',
      pgliteDataPath,
    })
    await legacy.connectors.create(createInput({
      config: {},
      filters: { category: 'engineering' },
    }))
    const current = await createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([requiredSettingsConnector('1.0.0')]),
      seedDataMode: 'none',
      pgliteDataPath,
    })

    await expect(current.connectors.runs.trigger({
      connectorInstanceId: INSTANCE_ID,
      coverageEndedAt: '2026-07-14T12:00:00.000Z',
      coverageStartedAt: '2026-07-13T12:00:00.000Z',
      mode: 'manual',
    })).rejects.toThrow(/config|batchSize|required/i)
  })

  it('disables incompatible persisted settings unchanged while other invalid saves stay blocked', async () => {
    const pgliteDataPath = tempDatabasePath()
    const legacy = await createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([legacyConnector('1.0.0')]),
      seedDataMode: 'none',
      pgliteDataPath,
    })
    await legacy.connectors.create(createInput({
      config: { legacyPrivate: true },
      filters: { legacyCategory: 'old' },
    }))
    const current = await createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([requiredSettingsConnector('1.0.0')]),
      seedDataMode: 'none',
      pgliteDataPath,
    })

    await expect(current.connectors.update({
      connectorInstanceId: INSTANCE_ID,
      displayName: 'Destructive invalid edit',
    })).rejects.toThrow(/config|filter|legacyPrivate|legacyCategory|declared/i)

    await expect(current.connectors.update({
      connectorInstanceId: INSTANCE_ID,
      enabled: false,
    })).resolves.toMatchObject({
      id: INSTANCE_ID,
      enabled: false,
      config: { legacyPrivate: true },
      filters: { legacyCategory: 'old' },
    })
    await expect(current.connectors.list()).resolves.toMatchObject({
      items: [{
        id: INSTANCE_ID,
        enabled: false,
        config: { legacyPrivate: true },
        filters: { legacyCategory: 'old' },
      }],
    })
  })

  it('upgrades an old incomplete instance by saving a newly required field through reconciliation', async () => {
    const pgliteDataPath = tempDatabasePath()
    const legacy = await createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([legacyConnector('0.12.0')]),
      seedDataMode: 'none',
      pgliteDataPath,
    })
    await legacy.connectors.create(createInput({
      connectorVersion: '0.12.0',
      config: {},
      enabled: false,
      filters: {},
    }))
    const current = await createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([requiredSettingsConnector('0.13.0')]),
      seedDataMode: 'none',
      pgliteDataPath,
    })

    await expect(current.connectors.update({
      connectorInstanceId: INSTANCE_ID,
      connectorVersion: '0.13.0',
      config: { batchSize: 20 },
      enabled: true,
      filters: { category: 'engineering' },
    })).resolves.toMatchObject({
      id: INSTANCE_ID,
      connectorVersion: '0.13.0',
      config: { batchSize: 20 },
      enabled: true,
      filters: { category: 'engineering' },
    })

    const replayRequests = await getTestLocalValedictorianDatabase(current)
      .select()
      .from(normalizationReplayRequests)
    expect(replayRequests).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^connector-upgrade:/),
        status: 'completed',
      }),
    ])
  })

  it('can disable and replace credentials on an old-version instance without remove and re-add', async () => {
    const pgliteDataPath = tempDatabasePath()
    const legacy = await createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([legacyConnector('0.12.0')]),
      seedDataMode: 'none',
      pgliteDataPath,
    })
    await legacy.connectors.create(createInput({
      connectorVersion: '0.12.0',
      auth: [{ id: 'fixture', mode: 'api_key', secretKey: 'old-secret' }],
      filters: {},
    }))
    const current = await createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([requiredSettingsConnector('0.13.0')]),
      seedDataMode: 'none',
      pgliteDataPath,
    })

    await expect(current.connectors.update({
      connectorInstanceId: INSTANCE_ID,
      enabled: false,
    })).resolves.toMatchObject({
      id: INSTANCE_ID,
      connectorVersion: '0.12.0',
      enabled: false,
    })
    await expect(current.connectors.update({
      connectorInstanceId: INSTANCE_ID,
      auth: [{ id: 'fixture', mode: 'api_key', secretKey: 'replacement-secret' }],
    })).resolves.toMatchObject({
      id: INSTANCE_ID,
      connectorVersion: '0.12.0',
      auth: [{ configured: true, id: 'fixture', mode: 'api_key' }],
    })
    await expect(current.connectors.list()).resolves.toMatchObject({
      items: [{ id: INSTANCE_ID, connectorVersion: '0.12.0' }],
    })
  })

  it('allows only a current bounded option query to repair an authenticated old-version instance', async () => {
    const pgliteDataPath = tempDatabasePath()
    const secretCodec = {
      decrypt: (value: string) => value.replace(/^enc:/, ''),
      encrypt: (value: string) => `enc:${value}`,
    }
    const legacy = await createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([legacyConnector('0.12.0')]),
      secretCodec,
      seedDataMode: 'none',
      pgliteDataPath,
      workspaceId: 'repair-workspace',
    })
    await legacy.secrets.upsert({
      key: 'repair-secret',
      kind: 'token',
      label: 'Repair fixture credential',
      value: 'persisted-repair-token',
    })
    await legacy.connectors.create(createInput({
      connectorVersion: '0.12.0',
      auth: [{ id: 'repair-auth', mode: 'api_key', secretKey: 'repair-secret' }],
      enabled: false,
      filters: {},
    }))
    const persisted = await createPgliteConnectorRepository(
      getTestLocalValedictorianDatabase(legacy),
    )
      .getInstance(INSTANCE_ID)
    const providerQueries: Array<{ grant: unknown; input: unknown }> = []
    const currentConnector = dynamicRepairConnector(providerQueries)
    const current = await createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([currentConnector]),
      secretCodec,
      seedDataMode: 'none',
      pgliteDataPath,
      workspaceId: 'repair-workspace',
    })
    const expectedIdentity = {
      connectorId: CONNECTOR_ID,
      connectorVersion: '0.13.0',
      filterSchemaVersion: 'fixture-repair-filters@2',
      catalogVersion: 'fixture-repair-options@2',
      sourceVersion: 'fixture-repair-skills@2',
    }
    const body = {
      sourceId: 'fixture.repair-skills',
      dependencies: {},
      operation: { kind: 'search' as const, search: 'rea', limit: 10 },
    }

    for (const invalid of [
      { expectedIdentity: { ...expectedIdentity, connectorVersion: '0.12.0' }, body },
      { expectedIdentity: { ...expectedIdentity, connectorId: 'fixture.other' }, body },
      { expectedIdentity, body: { ...body, sourceId: 'fixture.undeclared' } },
      { expectedIdentity, body: { ...body, dependencies: { endpoint: 'https://invalid.test' } } },
    ]) {
      await expect(current.connectors.options.query({
        connectorInstanceId: INSTANCE_ID,
        ...invalid,
      })).rejects.toThrow()
    }

    await expect(Promise.all([
      current.connectors.options.query({
        connectorInstanceId: INSTANCE_ID,
        expectedIdentity,
        body,
      }),
      current.connectors.options.query({
        connectorInstanceId: INSTANCE_ID,
        expectedIdentity,
        body: {
          sourceId: 'fixture.repair-skills',
          dependencies: {},
          operation: { kind: 'resolve', values: ['react'] },
        },
      }),
    ])).resolves.toEqual([
      expect.objectContaining({
        connectorInstanceId: INSTANCE_ID,
        connectorVersion: '0.13.0',
        status: 'search_ready',
      }),
      expect.objectContaining({
        connectorInstanceId: INSTANCE_ID,
        connectorVersion: '0.13.0',
        status: 'resolve_ready',
      }),
    ])
    expect(providerQueries).toHaveLength(2)
    expect(providerQueries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        grant: expect.objectContaining({ status: 'ready' }),
        input: expect.objectContaining({
          connectorInstanceId: INSTANCE_ID,
          connectorVersion: '0.13.0',
          executionScopeId: persisted?.executionScopeId,
        }),
      }),
    ]))
  })

  it('prefers an exact descriptor and otherwise falls back only to the installed same-id version', async () => {
    const old = legacyConnector('0.12.0')
    const current = requiredSettingsConnector('0.13.0')
    const exactClient = await createLocalValedictorianClient({
      connectorRegistry: versionedRegistry(current, old),
      seedDataMode: 'none',
      pgliteDataPath: tempDatabasePath(),
    })
    await expect(exactClient.connectors.descriptors.get(CONNECTOR_ID, '0.12.0'))
      .resolves.toMatchObject({ connectorId: CONNECTOR_ID, connectorVersion: '0.12.0' })

    const fallbackClient = await clientFor(current)
    await expect(fallbackClient.connectors.descriptors.get(CONNECTOR_ID, '0.12.0'))
      .resolves.toMatchObject({ connectorId: CONNECTOR_ID, connectorVersion: '0.13.0' })
    await expect(fallbackClient.connectors.descriptors.get('fixture.other', '0.12.0'))
      .rejects.toThrow(/unsupported/i)
  })
})

async function clientFor(connector: AppJobConnector) {
  return await createLocalValedictorianClient({
    connectorRegistry: createStaticConnectorRegistry([connector]),
    seedDataMode: 'none',
    pgliteDataPath: tempDatabasePath(),
  })
}

function createInput(overrides: Record<string, unknown> = {}) {
  return {
    id: INSTANCE_ID,
    connectorId: CONNECTOR_ID,
    connectorVersion: '1.0.0',
    displayName: 'Required settings fixture',
    enabled: true,
    auth: [],
    config: {},
    filters: {},
    ...overrides,
  }
}

function requiredSettingsConnector(version: string): AppJobConnector {
  return fixtureConnector(version, {
    configSchema: {
      version: 'fixture-required-config@1',
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { batchSize: { type: 'integer', enum: [10, 20] } },
        required: ['batchSize'],
      },
    },
    filterSchema: {
      version: 'fixture-required-filters@1',
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { category: { type: 'string', enum: ['engineering', 'design'] } },
        required: ['category'],
      },
    },
  })
}

function legacyConnector(version: string): AppJobConnector {
  return fixtureConnector(version)
}

function dynamicRepairConnector(
  providerQueries: Array<{ grant: unknown; input: unknown }>,
): AppJobConnector {
  return {
    ...fixtureConnector('0.13.0'),
    definition: {
      id: CONNECTOR_ID,
      version: '0.13.0',
      auth: {
        modes: ['api_key'],
        requirements: [{ id: 'repair-auth', mode: 'api_key', required: true }],
      },
      filterSchema: {
        version: 'fixture-repair-filters@2',
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            skills: {
              type: 'array', maxItems: 5, uniqueItems: true,
              items: { type: 'string', minLength: 1, maxLength: 40 },
            },
          },
          required: ['skills'],
        },
      },
      dynamicOptions: {
        protocolVersion: 'connector-dynamic-options@1',
        version: 'fixture-repair-options@2',
        sources: [{
          id: 'fixture.repair-skills',
          version: 'fixture-repair-skills@2',
          label: 'Repair skill',
          valueSchema: { type: 'string', minLength: 1, maxLength: 40 },
          display: { kind: 'value' },
          operations: {
            search: { minSearchLength: 1, maxSearchLength: 40, defaultLimit: 10, maxLimit: 10 },
            resolve: { maxValues: 5 },
          },
          dependencies: [],
        }],
        bindings: [{
          filterPointer: '/skills',
          sourceId: 'fixture.repair-skills',
          cardinality: 'many',
          intent: 'include',
        }],
      },
    },
    async queryOptions(input, runtime) {
      providerQueries.push({
        grant: await runtime.auth.resolve({ id: 'repair-auth', mode: 'api_key' }),
        input,
      })
      if (input.operation.kind === 'resolve') {
        return {
          status: 'resolve_ready',
          options: [{ key: 'react', label: 'React', value: 'react' }],
          unknownValues: [],
        }
      }
      return {
        status: 'search_ready',
        options: [{ key: 'react', label: 'React', value: 'react' }],
        truncated: false,
      }
    },
  }
}

function fixtureConnector(
  version: string,
  schemas: Pick<AppJobConnector['definition'], 'configSchema' | 'filterSchema'> = {},
): AppJobConnector {
  return {
    definition: {
      id: CONNECTOR_ID,
      version,
      ...schemas,
    },
    async refresh(input) {
      return {
        coverage: input.coverage,
        nextCheckpoint: { checkpoint: {}, schemaVersion: 'fixture-checkpoint@1' },
        observations: [],
        operationOutcome: null,
        status: 'completed',
        stats: { observations: 0 },
        synchronization: {
          newestFrontier: { state: 'caught_up' },
          historicalBackfill: {
            state: 'caught_up',
            boundary: { earliestDate: input.coverage.start.slice(0, 10) },
          },
          pendingResolutionCount: 0,
          outcome: { kind: 'caught_up' },
        },
        warnings: [],
      }
    },
  }
}

function versionedRegistry(current: AppJobConnector, exact: AppJobConnector): LocalConnectorRegistry {
  return {
    get(connectorId) {
      return connectorId === CONNECTOR_ID ? current : null
    },
    getVersion(connectorId, connectorVersion) {
      if (connectorId !== CONNECTOR_ID) return null
      if (connectorVersion === exact.definition.version) return exact
      if (connectorVersion === current.definition.version) return current
      return null
    },
    list() {
      return [current, exact]
    },
  }
}

function tempDatabasePath() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-settings-edge-'))
}
