import { fireEvent, render, screen, within } from '@testing-library/react'
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
  const view = render(
    <ConnectorSettingsPanel
      connectorsApi={connectorsApi}
      connectorScheduleApi={unavailableScheduleApi()}
      onRunSettled={vi.fn()}
      profileApi={createProfileApi()}
      workspaceId="workspace-1"
    />,
  )
  void screen.findByRole('button', { name: /^View .+ details$/ })
    .then((trigger) => {
      fireEvent.click(trigger)
      return screen.findByRole('dialog')
    })
    .then((dialog) => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Edit connector' }))
    })
  return view
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

const fixtureConfigSchema = {
  version: 'fixture-provider-config@1',
  schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      discoveryLimit: { type: 'integer' as const, enum: [10, 20, 50] },
      maxRunElapsedMs: {
        type: 'integer' as const,
        minimum: 1,
        maximum: 1_800_000,
        default: 120_000,
      },
    },
  },
  presentation: {
    fields: {
      '/discoveryLimit': {
        label: 'Discovery limit',
        description: 'Maximum number of discoveries retained for one run.',
        options: [
          { value: 10, label: '10' },
          { value: 20, label: '20' },
          { value: 50, label: '50' },
        ],
      },
      '/maxRunElapsedMs': {
        label: 'Maximum run duration',
        description: 'Maximum elapsed time allowed for one run.',
        display: {
          kind: 'duration' as const,
          storageUnit: 'milliseconds' as const,
          displayUnit: 'minutes' as const,
        },
      },
    },
  },
}

const fixtureFilterSchema = {
  version: 'fixture-provider-filters@1',
  schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      employmentKind: { type: 'string' as const, enum: ['internship', 'full_time'] },
      remoteOnly: { type: 'boolean' as const, default: false },
      minimumSalary: {
        type: 'integer' as const, minimum: 0, maximum: 300_000, multipleOf: 10_000,
      },
      compensationRange: {
        type: 'array' as const, minItems: 2, maxItems: 2,
        items: {
          type: 'integer' as const, minimum: 0, maximum: 300_000, multipleOf: 10_000,
        },
      },
      keyword: { type: 'string' as const, minLength: 2, maxLength: 40 },
      daysAgo: { type: 'integer' as const, enum: [1, 3, 7] },
      postedAfter: { type: 'string' as const, format: 'date' as const, maxLength: 10 },
      workModels: {
        type: 'array' as const, maxItems: 3, uniqueItems: true,
        items: { type: 'string' as const, enum: ['remote', 'hybrid', 'onsite'] },
      },
      country: { type: 'string' as const, enum: ['US', 'CA'] },
      skills: {
        type: 'array' as const, maxItems: 10, uniqueItems: true,
        items: { type: 'string' as const, minLength: 1, maxLength: 100 },
      },
      excludedSkills: {
        type: 'array' as const, maxItems: 10, uniqueItems: true,
        items: { type: 'string' as const, minLength: 1, maxLength: 100 },
      },
      unsupportedProviderObject: {
        type: 'object' as const, additionalProperties: false, properties: {},
      },
    },
  },
  presentation: {
    fields: {
      '/employmentKind': {
        label: 'Employment kind',
        description: 'Employment classification used for sourcing.',
        options: [
          { value: 'internship', label: 'Internship' },
          { value: 'full_time', label: 'Full time' },
        ],
      },
      '/remoteOnly': {
        label: 'Remote only',
        description: 'Limit results to remote roles.',
      },
      '/minimumSalary': {
        label: 'Minimum salary',
        description: 'Lowest salary to include.',
      },
      '/compensationRange': {
        label: 'Compensation range',
        description: 'Inclusive minimum and maximum compensation.',
      },
      '/keyword': {
        label: 'Keyword',
        description: 'Free-text keyword applied to sourcing.',
      },
      '/daysAgo': {
        label: 'Days ago',
        description: 'Only include jobs posted within this many days.',
        options: [
          { value: 1, label: '1' },
          { value: 3, label: '3' },
          { value: 7, label: '7' },
        ],
      },
      '/postedAfter': {
        label: 'Posted after',
        description: 'Only include jobs posted on or after this date.',
      },
      '/workModels': {
        label: 'Work models',
        description: 'Work arrangements to include.',
        options: [
          { value: 'remote', label: 'Remote' },
          { value: 'hybrid', label: 'Hybrid' },
          { value: 'onsite', label: 'Onsite' },
        ],
      },
      '/country': {
        label: 'Country',
        description: 'Country used for location search.',
        options: [
          { value: 'US', label: 'United States' },
          { value: 'CA', label: 'Canada' },
        ],
      },
      '/skills': {
        label: 'Skills',
        description: 'Skills to include.',
      },
      '/excludedSkills': {
        label: 'Excluded skills',
        description: 'Skills to exclude.',
      },
    },
  },
}

export const fixtureDescriptor = {
  connectorId: 'fixture.provider',
  connectorVersion: '1.2.3',
  displayName: 'Fixture provider',
  configSchema: fixtureConfigSchema,
  filterSchema: fixtureFilterSchema,
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
} as InstalledConnectorDescriptor

export const missingPresentationDescriptor = {
  connectorId: fixtureDescriptor.connectorId,
  connectorVersion: fixtureDescriptor.connectorVersion,
  displayName: fixtureDescriptor.displayName,
  configSchema: {
    version: fixtureConfigSchema.version,
    schema: fixtureConfigSchema.schema,
  },
  filterSchema: {
    version: fixtureFilterSchema.version,
    schema: fixtureFilterSchema.schema,
  },
  dynamicOptions: fixtureDescriptor.dynamicOptions,
} as InstalledConnectorDescriptor
