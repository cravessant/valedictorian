import { afterEach, describe, expect, it } from 'vitest'
import type {
  ConnectorOptionQueryErrorCode,
  InstalledConnectorDescriptor,
} from 'sparxie'
import {
  connectorOptionQueryErrorBodies,
  connectorOptionQueryErrorStatusByCode,
  connectorOptionQueryResultSchema,
} from 'sparxie'
import {
  createStaticConnectorRegistry,
} from '../modules/connectors/connector.registry'
import type { AppJobConnector } from '../modules/connectors/connector.runner'
import { createLocalValedictorianClient } from '../runtime/local-valedictorian-client'
import {
  createScheduleHttpTempSqlitePath,
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

  it.each([
    {
      name: 'an undeclared module-like source',
      mutate: (body: OptionBody) => ({ ...body, sourceId: 'internal.module.exec' }),
      code: 'option_source_undeclared',
    },
    {
      name: 'an arbitrary endpoint source',
      mutate: (body: OptionBody) => ({ ...body, sourceId: 'https://attacker.invalid/options' }),
      code: 'option_source_undeclared',
    },
    {
      name: 'an undeclared dependency',
      mutate: (body: OptionBody) => ({
        ...body,
        dependencies: { ...body.dependencies, endpoint: 'https://attacker.invalid/options' },
      }),
      code: 'option_dependency_undeclared',
    },
    {
      name: 'a search beyond the source bound',
      mutate: (body: OptionBody) => ({
        ...body,
        operation: { kind: 'search', search: 'x'.repeat(101), limit: 10 },
      }),
      code: 'option_value_invalid',
    },
    {
      name: 'a result limit beyond the source bound',
      mutate: (body: OptionBody) => ({
        ...body,
        operation: { kind: 'search', search: 'react', limit: 21 },
      }),
      code: 'option_value_invalid',
    },
    {
      name: 'a malformed resolve value',
      mutate: (body: OptionBody) => ({
        ...body,
        operation: { kind: 'resolve', values: [42] },
      }),
      code: 'option_value_invalid',
    },
    {
      name: 'too many resolve values',
      mutate: (body: OptionBody) => ({
        ...body,
        operation: {
          kind: 'resolve',
          values: Array.from({ length: 11 }, (_, index) => `skill-${index}`),
        },
      }),
      code: 'option_value_invalid',
    },
  ] satisfies Array<{
    name: string
    mutate: (body: OptionBody) => unknown
    code: ConnectorOptionQueryErrorCode
  }>)('maps $name to the canonical $code response before provider execution', async ({
    mutate,
    code,
  }) => {
    const harness = await createHarness()
    servers.push(harness.server)

    const response = await harness.query(mutate(validBody()))

    await expectCanonicalOptionError(response, code)
    expect(harness.providerQueries).toEqual([])
  })

  it.each([
    {
      name: 'connector descriptor',
      code: 'unsupported_descriptor',
      transform: (descriptor: InstalledConnectorDescriptor) => ({
        ...descriptor,
        connectorId: 'fixture.stale-provider',
      }),
    },
    {
      name: 'connector version',
      code: 'connector_version_mismatch',
      transform: (descriptor: InstalledConnectorDescriptor) => ({
        ...descriptor,
        connectorVersion: '1.2.2',
      }),
    },
    {
      name: 'filter schema',
      code: 'filter_schema_version_mismatch',
      transform: (descriptor: InstalledConnectorDescriptor) => ({
        ...descriptor,
        filterSchema: { ...descriptor.filterSchema!, version: 'fixture-provider-filters@0' },
      }),
    },
    {
      name: 'option catalog',
      code: 'option_catalog_version_mismatch',
      transform: (descriptor: InstalledConnectorDescriptor) => ({
        ...descriptor,
        dynamicOptions: { ...descriptor.dynamicOptions!, version: 'fixture-provider-options@0' },
      }),
    },
    {
      name: 'option source',
      code: 'option_source_version_mismatch',
      transform: (descriptor: InstalledConnectorDescriptor) => ({
        ...descriptor,
        dynamicOptions: {
          ...descriptor.dynamicOptions!,
          sources: descriptor.dynamicOptions!.sources.map((source) => ({
            ...source,
            version: 'fixture-skills@0',
          })),
        },
      }),
    },
  ] satisfies Array<{
    name: string
    code: ConnectorOptionQueryErrorCode
    transform: (descriptor: InstalledConnectorDescriptor) => InstalledConnectorDescriptor
  }>)('maps a stale $name identity to the exact canonical $code response', async ({
    code,
    transform,
  }) => {
    const harness = await createHarness({ descriptorTransform: transform })
    servers.push(harness.server)

    const response = await harness.query(validBody())

    await expectCanonicalOptionError(response, code)
    expect(harness.providerQueries).toEqual([])
  })

  it('maps a missing connector instance to the canonical unsupported descriptor response', async () => {
    const harness = await createHarness()
    servers.push(harness.server)

    await expectCanonicalOptionError(
      await harness.query(validBody(), { connectorInstanceId: 'missing-instance' }),
      'unsupported_descriptor',
    )
    expect(harness.providerQueries).toEqual([])
  })

  it('maps a missing installed descriptor to the canonical unsupported descriptor response', async () => {
    const harness = await createHarness({ descriptorUnavailable: true })
    servers.push(harness.server)

    await expectCanonicalOptionError(
      await harness.query(validBody()),
      'unsupported_descriptor',
    )
    expect(harness.providerQueries).toEqual([])
  })

  it.each([
    {
      search: 'rate-limited-lie',
      core: {
        status: 'error', code: 'rate_limited', retryable: false, retryAfterMs: 125,
      },
      public: {
        status: 'error', code: 'rate_limited', retryable: true, retryAfterMs: 125,
      },
    },
    {
      search: 'temporarily-unavailable-lie',
      core: {
        status: 'error', code: 'temporarily_unavailable', retryable: false,
      },
      public: {
        status: 'error', code: 'temporarily_unavailable', retryable: true,
      },
    },
    {
      search: 'provider-rejected-lie',
      core: {
        status: 'error', code: 'provider_rejected', retryable: true, retryAfterMs: 125,
      },
      public: {
        status: 'error', code: 'provider_rejected', retryable: false,
      },
    },
    {
      search: 'terminal-unexpected-retry-after',
      core: {
        status: 'error', code: 'unexpected_response', retryable: false, retryAfterMs: 125,
      },
      public: {
        status: 'error', code: 'unexpected_response', retryable: false,
      },
    },
    {
      search: 'retryable-unexpected',
      core: {
        status: 'error', code: 'unexpected_response', retryable: true, retryAfterMs: 125,
      },
      public: {
        status: 'error', code: 'unexpected_response', retryable: true, retryAfterMs: 125,
      },
    },
    {
      search: 'private-provider-error',
      core: {
        status: 'error',
        code: 'private_cookie_expired',
        message: 'session_cookie=private-cookie; password=private-password',
        retryable: false,
        retryAfterMs: 125,
      },
      public: {
        status: 'error', code: 'unexpected_response', retryable: false,
      },
    },
    {
      search: 'private-retryable-value',
      core: {
        status: 'error',
        code: 'unexpected_response',
        retryable: 'session_cookie=private-cookie',
        message: 'password=private-password',
        retryAfterMs: 125,
      },
      public: {
        status: 'error', code: 'unexpected_response', retryable: false,
      },
    },
    {
      search: 'invalid-retry-after',
      core: {
        status: 'error', code: 'temporarily_unavailable', retryable: true, retryAfterMs: -125,
      },
      public: {
        status: 'error', code: 'temporarily_unavailable', retryable: true,
      },
    },
  ])('sanitizes malicious connector error $search into a schema-valid public invariant', async ({
    search,
    core,
    public: publicResult,
  }) => {
    const harness = await createHarness({
      queryResult(searchText) {
        return searchText === search ? core : null
      },
    })
    servers.push(harness.server)

    const response = await harness.query({
      ...validBody(),
      operation: { kind: 'search', search, limit: 10 },
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(connectorOptionQueryResultSchema.parse(body)).toEqual({
      ...optionIdentity(),
      ...publicResult,
    })
    expect(JSON.stringify(body)).not.toMatch(/private_cookie|session_cookie|private-cookie|private-password|password/i)
  })

  it('does not echo a connector exception containing credential material through generic HTTP errors', async () => {
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

  it('rejects the exact cross-workspace options/query route before provider execution', async () => {
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
    | { kind: 'resolve'; values: unknown[] }
}

function validBody(): OptionBody {
  return {
    sourceId: 'fixture.skills',
    dependencies: { country: 'US' },
    operation: { kind: 'search', search: 'react', limit: 10 },
  }
}

function optionIdentity() {
  return {
    connectorInstanceId: INSTANCE_ID,
    connectorId: 'fixture.provider',
    connectorVersion: '1.2.3',
    filterSchemaVersion: 'fixture-provider-filters@1',
    catalogVersion: 'fixture-provider-options@1',
    sourceId: 'fixture.skills',
    sourceVersion: 'fixture-skills@1',
  }
}

async function expectCanonicalOptionError(
  response: Response,
  code: ConnectorOptionQueryErrorCode,
) {
  expect(response.status).toBe(connectorOptionQueryErrorStatusByCode[code])
  await expect(response.json()).resolves.toEqual(connectorOptionQueryErrorBodies[code])
}

async function createHarness(options: {
  descriptorTransform?: (descriptor: InstalledConnectorDescriptor) => InstalledConnectorDescriptor
  descriptorUnavailable?: boolean
  queryResult?: (search: string) => unknown
} = {}) {
  const providerQueries: unknown[] = []
  const connector = createEdgeFixture(providerQueries, options.queryResult)
  const local = createLocalValedictorianClient({
    connectorRegistry: createStaticConnectorRegistry([connector]),
    seedDataMode: 'none',
    sqlitePath: createScheduleHttpTempSqlitePath(),
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
          const descriptor = await local.connectors.descriptors.get(connectorId, connectorVersion)
          return options.descriptorTransform?.(descriptor) ?? descriptor
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
    query(body: unknown, identity: {
      connectorInstanceId?: string
      workspaceId?: string
    } = {}) {
      const workspaceId = identity.workspaceId ?? WORKSPACE_ID
      const connectorInstanceId = identity.connectorInstanceId ?? INSTANCE_ID
      return fetch(
        `${server.url}/v1/workspaces/${workspaceId}/connectors/${connectorInstanceId}/options/query`,
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
