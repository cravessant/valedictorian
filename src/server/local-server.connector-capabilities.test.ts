import { afterEach, describe, expect, it } from 'vitest'
import { createHttpValedictorianClient } from 'sparxie'
import {
  createDefaultLocalConnectorRegistry,
  createStaticConnectorRegistry,
} from '../modules/connectors/connector.registry'
import type { AppJobConnector } from '../modules/connectors/connector.runner'
import { createLocalValedictorianClient } from '../runtime/local-valedictorian-client'
import {
  createScheduleHttpTempSqlitePath,
  createValedictorianHttpServer,
  type ScheduleHttpServerHandle,
} from './local-server.connector-schedules.http-fixture'

const CLOCK = '2026-07-14T14:00:00.000Z'
const WORKSPACE_ID = 'connector-capabilities'
const INSTANCE_ID = 'fixture-provider-instance'

describe('released connector capability boundary', () => {
  let server: ScheduleHttpServerHandle | null = null

  afterEach(async () => {
    await server?.close()
    server = null
  })

  it('exposes only sanitized declarative metadata and executes its declared option source', async () => {
    const optionQueries: unknown[] = []
    const connector = createCapabilityFixture(optionQueries)
    const local = createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([connector]),
      now: () => new Date(CLOCK),
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
    server = await createValedictorianHttpServer({
      client: local,
      host: '127.0.0.1',
      port: 0,
      resolveWorkspaceClient: async (workspaceId) => {
        if (workspaceId !== WORKSPACE_ID) throw new Error('Workspace is not available.')
        return local
      },
    })
    const http = createHttpValedictorianClient({ baseUrl: server.url })
      .forWorkspace(WORKSPACE_ID)

    await expect(http.connectors.descriptors.get('fixture.provider', '1.2.3'))
      .resolves.toEqual({
        connectorId: 'fixture.provider',
        connectorVersion: '1.2.3',
        displayName: 'Fixture provider',
        filterSchema: fixtureFilterSchema,
        dynamicOptions: publicFixtureDynamicOptions,
      })
    const listed = await http.connectors.descriptors.list()
    expect(listed.items).toEqual([expect.objectContaining({
      connectorId: 'fixture.provider',
      connectorVersion: '1.2.3',
    })])
    expect(JSON.stringify(listed)).not.toMatch(
      /private-login|secretKey|bearer_token/i,
    )

    await expect(http.connectors.options.query({
      connectorInstanceId: INSTANCE_ID,
      body: {
        sourceId: 'fixture.skills',
        dependencies: { country: 'US' },
        operation: { kind: 'search', search: 'rea', limit: 10 },
      },
      expectedIdentity: {
        connectorId: 'fixture.provider',
        connectorVersion: '1.2.3',
        filterSchemaVersion: 'fixture-provider-filters@1',
        catalogVersion: 'fixture-provider-options@1',
        sourceVersion: 'fixture-skills@1',
      },
    })).resolves.toEqual({
      connectorInstanceId: INSTANCE_ID,
      connectorId: 'fixture.provider',
      connectorVersion: '1.2.3',
      filterSchemaVersion: 'fixture-provider-filters@1',
      catalogVersion: 'fixture-provider-options@1',
      sourceId: 'fixture.skills',
      sourceVersion: 'fixture-skills@1',
      status: 'search_ready',
      options: [{ key: 'react', label: 'React', value: 'react' }],
      truncated: false,
    })
    expect(optionQueries).toEqual([expect.objectContaining({
      connectorInstanceId: INSTANCE_ID,
      connectorVersion: '1.2.3',
      filterSchemaVersion: 'fixture-provider-filters@1',
      catalogVersion: 'fixture-provider-options@1',
      sourceId: 'fixture.skills',
      sourceVersion: 'fixture-skills@1',
      dependencies: { country: 'US' },
      operation: { kind: 'search', search: 'rea', limit: 10 },
      workspaceId: WORKSPACE_ID,
    })])

    await expect(http.connectors.options.query(optionInput('temporary'))).resolves.toEqual({
      ...optionIdentity(),
      status: 'error',
      code: 'temporarily_unavailable',
      retryable: true,
      retryAfterMs: 125,
    })
    const terminal = await http.connectors.options.query(optionInput('terminal'))
    expect(terminal).toEqual({
      ...optionIdentity(),
      status: 'error',
      code: 'provider_rejected',
      retryable: false,
    })
    expect(terminal).not.toHaveProperty('retryAfterMs')
    await expect(http.connectors.options.query(optionInput('auth'))).resolves.toEqual({
      ...optionIdentity(),
      status: 'auth_required',
    })
    expect(JSON.stringify([terminal, await http.connectors.options.query(optionInput('temporary'))]))
      .not.toMatch(/provider-private-code|private-login|requirementIds/i)

    const crossWorkspace = await fetch(
      `${server.url}/v1/workspaces/other-workspace/connectors/${INSTANCE_ID}/options:query`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(optionInput('rea').body),
      },
    )
    expect(crossWorkspace.ok).toBe(false)
    expect(await crossWorkspace.text()).not.toContain('React')
  })

  it('round-trips installed Jobright internship [4] and full-time [1] include/exclude filters through HTTP and SQLite', async () => {
    const sqlitePath = createScheduleHttpTempSqlitePath()
    const internshipFilters = {
      jobTaxonomyList: [{ taxonomyId: 'software-engineering', title: 'Software Engineering' }],
      jobTypes: [4],
      country: 'US',
      skills: ['TypeScript'],
      excludedSkills: ['PHP'],
      excludedTitle: ['Senior'],
    }
    const fullTimeFilters = {
      jobTaxonomyList: [{ taxonomyId: 'software-engineering', title: 'Software Engineering' }],
      jobTypes: [1],
      country: 'US',
      companies: [{ companyId: 'acme', companyName: 'Acme' }],
      excludedCompanies: [{ companyId: 'staffing-inc', companyName: 'Staffing Inc' }],
    }
    const createLocal = () => createLocalValedictorianClient({
      connectorRegistry: createDefaultLocalConnectorRegistry(),
      now: () => new Date(CLOCK),
      seedDataMode: 'none' as const,
      sqlitePath,
      workspaceId: WORKSPACE_ID,
    })
    let local = createLocal()
    server = await createValedictorianHttpServer({
      client: local,
      host: '127.0.0.1',
      port: 0,
      resolveWorkspaceClient: async () => local,
    })
    let http = createHttpValedictorianClient({ baseUrl: server.url }).forWorkspace(WORKSPACE_ID)

    await http.connectors.create({
      id: 'jobright-filter-roundtrip',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.14.0',
      displayName: 'Jobright filter round-trip',
      enabled: true,
      auth: [],
      config: {},
      filters: internshipFilters,
    })
    await server.close()
    server = null

    local = createLocal()
    server = await createValedictorianHttpServer({
      client: local,
      host: '127.0.0.1',
      port: 0,
      resolveWorkspaceClient: async () => local,
    })
    http = createHttpValedictorianClient({ baseUrl: server.url }).forWorkspace(WORKSPACE_ID)
    let reloaded = await http.connectors.list()
    expect(reloaded.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'jobright-filter-roundtrip', filters: internshipFilters }),
    ]))
    await http.connectors.update({
      connectorInstanceId: 'jobright-filter-roundtrip',
      filters: fullTimeFilters,
    })
    await server.close()
    server = null

    local = createLocal()
    server = await createValedictorianHttpServer({
      client: local,
      host: '127.0.0.1',
      port: 0,
      resolveWorkspaceClient: async () => local,
    })
    http = createHttpValedictorianClient({ baseUrl: server.url }).forWorkspace(WORKSPACE_ID)
    reloaded = await http.connectors.list()
    expect(reloaded.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'jobright-filter-roundtrip', filters: fullTimeFilters }),
    ]))
  })
})

function optionInput(search: string) {
  return {
    connectorInstanceId: INSTANCE_ID,
    body: {
      sourceId: 'fixture.skills',
      dependencies: { country: 'US' },
      operation: { kind: 'search' as const, search, limit: 10 },
    },
    expectedIdentity: {
      connectorId: 'fixture.provider',
      connectorVersion: '1.2.3',
      filterSchemaVersion: 'fixture-provider-filters@1',
      catalogVersion: 'fixture-provider-options@1',
      sourceVersion: 'fixture-skills@1',
    },
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

const publicFixtureDynamicOptions = {
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
      id: 'country',
      filterPointer: '/country',
      cardinality: 'one' as const,
      required: true,
    }],
  }],
  bindings: [{
    filterPointer: '/skills',
    sourceId: 'fixture.skills',
    cardinality: 'many' as const,
    intent: 'include' as const,
  }],
}

const connectorFixtureDynamicOptions = {
  ...publicFixtureDynamicOptions,
  sources: publicFixtureDynamicOptions.sources.map((source) => ({
    ...source,
    auth: { mode: 'connector' as const, requirementIds: ['private-login'] },
  })),
}

function createCapabilityFixture(optionQueries: unknown[]): AppJobConnector {
  return {
    definition: {
      id: 'fixture.provider',
      version: '1.2.3',
      displayName: 'Fixture provider',
      auth: {
        modes: ['bearer_token'],
        requirements: [{
          id: 'private-login',
          mode: 'bearer_token',
          label: 'Private provider login',
          required: true,
        }],
      },
      filterSchema: fixtureFilterSchema,
      dynamicOptions: connectorFixtureDynamicOptions,
    },
    async queryOptions(input) {
      optionQueries.push(input)
      if (input.operation.kind === 'search' && input.operation.search === 'temporary') {
        return {
          status: 'error',
          code: 'temporarily_unavailable',
          retryable: true,
          retryAfterMs: 125,
        }
      }
      if (input.operation.kind === 'search' && input.operation.search === 'terminal') {
        return {
          status: 'error',
          code: 'provider_rejected',
          retryable: false,
        }
      }
      if (input.operation.kind === 'search' && input.operation.search === 'auth') {
        return {
          status: 'auth_required',
          requirementIds: ['private-login'],
        }
      }
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
