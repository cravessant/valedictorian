import { afterEach, describe, expect, it } from 'vitest'
import {
  connectorOptionQueryErrorBodies,
  connectorOptionQueryErrorStatusByCode,
} from '@sparxie/sdk'
import { createStaticConnectorRegistry } from '../modules/connectors/connector.registry'
import type { AppJobConnector } from '../modules/connectors/connector.runner'
import { createLocalValedictorianClient } from './local-valedictorian-client.test-harness'
import {
  createScheduleHttpTempDatabasePath,
  createValedictorianHttpServer,
  type ScheduleHttpServerHandle,
} from './local-server.connector-schedules.http-fixture'

const WORKSPACE_ID = 'connector-option-edge-contracts'
const INSTANCE_ID = 'fixture-provider-instance'

describe('connector option HTTP edge contracts', () => {
  const servers: ScheduleHttpServerHandle[] = []

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()))
  })

  it('maps a schema-invalid option query body to the fixed validation response', async () => {
    const harness = await createHarness()
    servers.push(harness.server)

    const response = await harness.query({ operation: { kind: 'search' } })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ message: 'The request is invalid.' })
    expect(harness.providerQueries).toEqual([])
  })

  it('maps a missing installed descriptor to the canonical HTTP response', async () => {
    const harness = await createHarness({ descriptorUnavailable: true })
    servers.push(harness.server)

    const response = await harness.query(validBody())

    expect(response.status).toBe(
      connectorOptionQueryErrorStatusByCode.unsupported_descriptor,
    )
    await expect(response.json()).resolves.toEqual(
      connectorOptionQueryErrorBodies.unsupported_descriptor,
    )
    expect(harness.providerQueries).toEqual([])
  })

  it('does not echo connector exceptions containing credential material', async () => {
    const harness = await createHarness({
      queryResult(search) {
        if (search === 'throw-private-error') {
          throw new Error(
            'provider failed with session_cookie=private-cookie and password=private-password',
          )
        }
        return null
      },
    })
    servers.push(harness.server)

    const response = await harness.query({
      ...validBody(),
      operation: { kind: 'search', search: 'throw-private-error', limit: 10 },
    })
    const body = await response.text()

    expect(response.ok).toBe(false)
    expect(body).not.toMatch(/session_cookie|private-cookie|private-password|password/i)
  })

  it('rejects the exact cross-workspace route before provider execution', async () => {
    const harness = await createHarness()
    servers.push(harness.server)

    const response = await harness.query(validBody(), { workspaceId: 'other-workspace' })

    expect(response.ok).toBe(false)
    expect(await response.text()).not.toContain('React')
    expect(harness.providerQueries).toEqual([])
  })
})

type OptionBody = {
  sourceId: string
  dependencies: Record<string, unknown>
  operation: { kind: 'search'; search: string; limit?: number }
}

function validBody(): OptionBody {
  return {
    sourceId: 'fixture.skills',
    dependencies: { country: 'US' },
    operation: { kind: 'search', search: 'react', limit: 10 },
  }
}

async function createHarness(options: {
  descriptorUnavailable?: boolean
  queryResult?: (search: string) => unknown
} = {}) {
  const providerQueries: unknown[] = []
  const connector = createEdgeFixture(providerQueries, options.queryResult)
  const local = await createLocalValedictorianClient({
    connectorRegistry: createStaticConnectorRegistry([connector]),
    seedDataMode: 'none',
    pgliteDataPath: createScheduleHttpTempDatabasePath(),
    workspaceId: WORKSPACE_ID,
  })
  await local.connectors.create({
    id: INSTANCE_ID,
    connectorId: connector.definition.id,
    connectorVersion: connector.definition.version,
    displayName: 'Fixture provider',
    enabled: true,
    auth: [],
    filters: { country: 'US', skills: [] },
  })
  const routeClient = {
    ...local,
    connectors: {
      ...local.connectors,
      descriptors: {
        ...local.connectors.descriptors,
        async get(connectorId: string, connectorVersion: string) {
          if (options.descriptorUnavailable) {
            throw new Error(`Unsupported connector descriptor: ${connectorId}@${connectorVersion}`)
          }
          return local.connectors.descriptors.get(connectorId, connectorVersion)
        },
      },
    },
  } as typeof local
  const server = await createValedictorianHttpServer({
    client: routeClient,
    host: '127.0.0.1',
    port: 0,
    resolveWorkspaceClient: async (workspaceId) => {
      if (workspaceId !== WORKSPACE_ID) throw new Error('Workspace is not available.')
      return routeClient
    },
  })
  return {
    providerQueries,
    server,
    query(body: unknown, identity: { workspaceId?: string } = {}) {
      const workspaceId = identity.workspaceId ?? WORKSPACE_ID
      return fetch(
        `${server.url}/v1/workspaces/${workspaceId}/connectors/${INSTANCE_ID}/options/query`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      )
    },
  }
}

const fixtureFilterSchema = {
  version: 'fixture-provider-filters@1',
  schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      country: { type: 'string' as const, enum: ['US', 'CA'] },
      skills: {
        type: 'array' as const,
        maxItems: 10,
        uniqueItems: true,
        items: { type: 'string' as const, minLength: 1, maxLength: 100 },
      },
    },
  },
}

const fixtureDynamicOptions = {
  protocolVersion: 'connector-dynamic-options@1' as const,
  version: 'fixture-provider-options@1',
  sources: [{
    id: 'fixture.skills',
    version: 'fixture-skills@1',
    label: 'Skill',
    valueSchema: { type: 'string' as const, minLength: 1, maxLength: 100 },
    display: { kind: 'value' as const },
    operations: {
      search: { minSearchLength: 1, maxSearchLength: 100, defaultLimit: 10, maxLimit: 20 },
      resolve: { maxValues: 10 },
    },
    auth: { mode: 'none' as const },
    dependencies: [{
      id: 'country', filterPointer: '/country', cardinality: 'one' as const, required: true,
    }],
  }],
  bindings: [{
    filterPointer: '/skills', sourceId: 'fixture.skills', cardinality: 'many' as const,
    intent: 'include' as const,
  }],
}

function createEdgeFixture(
  providerQueries: unknown[],
  queryResult?: (search: string) => unknown,
): AppJobConnector {
  return {
    definition: {
      id: 'fixture.provider',
      version: '1.2.3',
      displayName: 'Fixture provider',
      filterSchema: fixtureFilterSchema,
      dynamicOptions: fixtureDynamicOptions,
    },
    async queryOptions(input) {
      providerQueries.push(input)
      const search = input.operation.kind === 'search' ? input.operation.search : ''
      const result = queryResult?.(search)
      if (result !== null && result !== undefined) return result as never
      return {
        status: 'search_ready',
        options: [{ key: 'react', label: 'React', value: 'react' }],
        truncated: false,
      }
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
