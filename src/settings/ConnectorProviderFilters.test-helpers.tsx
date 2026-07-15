import { render } from '@testing-library/react'
import { vi } from 'vitest'
import type {
  ConnectorOptionQueryResult,
  InstalledConnectorDescriptor,
  ValedictorianWorkspaceClient,
} from 'sparxie'
import { createConnectorsApi, createProfileApi } from '../App.test-helpers'
import type { ConnectorScheduleUiApi } from './connector-schedule.types'
import { ConnectorSettingsPanel } from './ConnectorSettingsPanel'

export const INSTANCE_ID = 'fixture-provider-instance'

type PublicOptionQuery = ValedictorianWorkspaceClient['connectors']['options']['query']
export type PublicOptionQueryInput = Parameters<PublicOptionQuery>[0]

export async function createFixtureApi(
  filters: Record<string, unknown>,
  dynamic: {
    search?: (
      input: PublicOptionQueryInput,
      signal: AbortSignal | undefined,
    ) => Promise<ConnectorOptionQueryResult>
    resolve?: (
      input: PublicOptionQueryInput,
      signal: AbortSignal | undefined,
    ) => Promise<ConnectorOptionQueryResult>
  } = {},
  config: Record<string, unknown> = {},
  descriptor: InstalledConnectorDescriptor = fixtureDescriptor,
  instanceConnectorVersion: string = descriptor.connectorVersion,
) {
  const base = createConnectorsApi()
  await base.create({
    id: INSTANCE_ID,
    connectorId: descriptor.connectorId,
    connectorVersion: instanceConnectorVersion,
    displayName: descriptor.displayName,
    enabled: true,
    auth: [],
    config,
    filters,
  })
  const query = vi.fn(async (
    input: PublicOptionQueryInput,
    options?: { signal?: AbortSignal },
  ): Promise<ConnectorOptionQueryResult> => {
    if (input.body.operation.kind === 'search' && dynamic.search) {
      return dynamic.search(input, options?.signal)
    }
    if (input.body.operation.kind === 'resolve' && dynamic.resolve) {
      return dynamic.resolve(input, options?.signal)
    }
    const values = input.body.operation.kind === 'resolve'
      ? input.body.operation.values
      : []
    return boundOptionResult(input, {
      status: 'resolve_ready',
      options: values.map((value) => ({
        key: optionKey(value),
        label: optionLabel(value),
        value,
      })),
      unknownValues: [],
    })
  })

  return Object.assign(base, {
    descriptors: {
      list: vi.fn(async () => ({ items: [descriptor] })),
      get: vi.fn(async () => descriptor),
    },
    options: { query },
  })
}

export function renderPanel(connectorsApi: Awaited<ReturnType<typeof createFixtureApi>>) {
  return render(
    <ConnectorSettingsPanel
      connectorsApi={connectorsApi}
      connectorScheduleApi={unavailableScheduleApi()}
      onRunSettled={vi.fn()}
      profileApi={createProfileApi()}
      workspaceId="workspace-1"
    />,
  )
}

function unavailableScheduleApi(): ConnectorScheduleUiApi {
  return {
    getCapabilities: vi.fn(async () => ({
      connectorScheduling: { available: false as const },
    })),
    getSchedule: vi.fn(async () => null),
    upsertSchedule: vi.fn(async () => { throw new Error('unavailable') }),
    pauseSchedule: vi.fn(async () => { throw new Error('unavailable') }),
    resumeSchedule: vi.fn(async () => { throw new Error('unavailable') }),
    deleteSchedule: vi.fn(async () => { throw new Error('unavailable') }),
  }
}

export function searchResult(key: string, label: string): ConnectorOptionQueryResult {
  return {
    connectorInstanceId: INSTANCE_ID,
    connectorId: fixtureDescriptor.connectorId,
    connectorVersion: fixtureDescriptor.connectorVersion,
    filterSchemaVersion: fixtureDescriptor.filterSchema!.version,
    catalogVersion: fixtureDescriptor.dynamicOptions!.version,
    sourceId: 'fixture.skills',
    sourceVersion: 'fixture-skills@1',
    status: 'search_ready',
    options: [{ key, label, value: key }],
    truncated: false,
  }
}

export function optionIdentityForFixture() {
  return {
    connectorInstanceId: INSTANCE_ID,
    connectorId: fixtureDescriptor.connectorId,
    connectorVersion: fixtureDescriptor.connectorVersion,
    filterSchemaVersion: fixtureDescriptor.filterSchema!.version,
    catalogVersion: fixtureDescriptor.dynamicOptions!.version,
    sourceId: 'fixture.skills',
    sourceVersion: 'fixture-skills@1',
  }
}

export function boundOptionResult(
  input: PublicOptionQueryInput,
  result: Pick<
    Extract<ConnectorOptionQueryResult, { status: 'resolve_ready' }>,
    'status' | 'options' | 'unknownValues'
  >,
): ConnectorOptionQueryResult {
  return {
    connectorInstanceId: input.connectorInstanceId,
    ...input.expectedIdentity,
    sourceId: input.body.sourceId,
    ...result,
  }
}

function optionLabel(value: unknown): string {
  if (value === 'typescript') return 'TypeScript'
  if (value === 'php') return 'PHP'
  return scalarOrJson(value)
}

function optionKey(value: unknown): string {
  return scalarOrJson(value)
}

function scalarOrJson(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return `${value}`
  return JSON.stringify(value) ?? ''
}

export function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => { resolve = settle })
  return { promise, resolve }
}

export const fixtureDescriptor = {
  connectorId: 'fixture.provider',
  connectorVersion: '1.2.3',
  displayName: 'Fixture provider',
  configSchema: {
    version: 'fixture-provider-config@1',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        discoveryLimit: { type: 'integer', enum: [10, 20, 50] },
      },
    },
  },
  filterSchema: {
    version: 'fixture-provider-filters@1',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        employmentKind: { type: 'string', enum: ['internship', 'full_time'] },
        remoteOnly: { type: 'boolean', default: false },
        minimumSalary: {
          type: 'integer', minimum: 0, maximum: 300_000, multipleOf: 10_000,
        },
        compensationRange: {
          type: 'array', minItems: 2, maxItems: 2,
          items: {
            type: 'integer', minimum: 0, maximum: 300_000, multipleOf: 10_000,
          },
        },
        keyword: { type: 'string', minLength: 2, maxLength: 40 },
        daysAgo: { type: 'integer', enum: [1, 3, 7] },
        postedAfter: { type: 'string', format: 'date', maxLength: 10 },
        workModels: {
          type: 'array', maxItems: 3, uniqueItems: true,
          items: { type: 'string', enum: ['remote', 'hybrid', 'onsite'] },
        },
        country: { type: 'string', enum: ['US', 'CA'] },
        skills: {
          type: 'array', maxItems: 10, uniqueItems: true,
          items: { type: 'string', minLength: 1, maxLength: 100 },
        },
        excludedSkills: {
          type: 'array', maxItems: 10, uniqueItems: true,
          items: { type: 'string', minLength: 1, maxLength: 100 },
        },
        unsupportedProviderObject: {
          type: 'object', additionalProperties: false, properties: {},
        },
      },
    },
  },
  dynamicOptions: {
    protocolVersion: 'connector-dynamic-options@1',
    version: 'fixture-provider-options@1',
    sources: [{
      id: 'fixture.skills',
      version: 'fixture-skills@1',
      label: 'Skill',
      valueSchema: { type: 'string', minLength: 1, maxLength: 100 },
      display: { kind: 'value' },
      operations: {
        search: {
          minSearchLength: 1, maxSearchLength: 100, defaultLimit: 10, maxLimit: 20,
        },
        resolve: { maxValues: 10 },
      },
      dependencies: [{
        id: 'country', filterPointer: '/country', cardinality: 'one', required: true,
      }],
    }],
    bindings: [{
      filterPointer: '/skills', sourceId: 'fixture.skills', cardinality: 'many', intent: 'include',
    }, {
      filterPointer: '/excludedSkills', sourceId: 'fixture.skills', cardinality: 'many', intent: 'exclude',
    }],
  },
} satisfies InstalledConnectorDescriptor
