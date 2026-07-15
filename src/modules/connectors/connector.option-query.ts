import type {
  ConnectorOptionQueryBody,
  ConnectorOptionQueryErrorCode,
  ConnectorOptionQueryResult,
  ValedictorianWorkspaceClient,
} from 'sparxie'
import {
  connectorOptionQueryBodySchema,
  connectorOptionQueryErrorBodies,
  connectorOptionQueryErrorStatusByCode,
  connectorOptionQueryResultSchema,
} from 'sparxie'
import { parseConnectorOptionValue } from '@sparxie/valedictorian-connectors-core'
import type { createSqliteConnectorRepository } from './connector.repository'
import type { AppConnectorAuthHost } from './connector.runner'
import { createConnectorOptionRuntime } from './connector.option-runtime'
import type { LocalConnectorRegistry } from './connector.registry'
import { projectInstalledConnectorDescriptor } from './connector.capabilities'
import {
  connectorSchemaAtPointer,
  validateConnectorSchemaValue,
} from './connector.renderer-schema-validation'

type OptionQueryInput = Parameters<ValedictorianWorkspaceClient['connectors']['options']['query']>[0]

export class ConnectorOptionQueryCapabilityError extends Error {
  readonly body
  readonly code: ConnectorOptionQueryErrorCode
  readonly statusCode: number

  constructor(code: ConnectorOptionQueryErrorCode) {
    const body = connectorOptionQueryErrorBodies[code]
    super(body.message)
    this.name = 'ConnectorOptionQueryCapabilityError'
    this.body = body
    this.code = code
    this.statusCode = connectorOptionQueryErrorStatusByCode[code]
  }
}

export function createConnectorOptionQueryService({
  authHost,
  connectorRegistry,
  connectorRepository,
  workspaceId,
}: {
  authHost?: AppConnectorAuthHost
  connectorRegistry: LocalConnectorRegistry
  connectorRepository: ReturnType<typeof createSqliteConnectorRepository>
  workspaceId: string
}) {
  return {
    async query(
      rawInput: OptionQueryInput,
      options: { signal?: AbortSignal } = {},
    ): Promise<ConnectorOptionQueryResult> {
      const body = connectorOptionQueryBodySchema.parse(rawInput.body)
      const instance = await connectorRepository.getInstance(rawInput.connectorInstanceId)
      if (!instance) throw new ConnectorOptionQueryCapabilityError('unsupported_descriptor')
      const connector = connectorRegistry.get(instance.connectorId)
      if (!connector) throw new ConnectorOptionQueryCapabilityError('unsupported_descriptor')
      const descriptor = projectInstalledConnectorDescriptor(connector)
      const dynamicOptions = descriptor.dynamicOptions
      const filterSchema = descriptor.filterSchema
      if (!dynamicOptions || !filterSchema || !connector.queryOptions) {
        throw new ConnectorOptionQueryCapabilityError('option_query_unavailable')
      }
      assertExpectedIdentity(rawInput.expectedIdentity, {
        connectorId: descriptor.connectorId,
        connectorVersion: descriptor.connectorVersion,
        filterSchemaVersion: filterSchema.version,
        catalogVersion: dynamicOptions.version,
      })
      const source = dynamicOptions.sources.find((candidate) => candidate.id === body.sourceId)
      if (!source) throw new ConnectorOptionQueryCapabilityError('option_source_undeclared')
      if (rawInput.expectedIdentity.sourceVersion !== source.version) {
        throw new ConnectorOptionQueryCapabilityError('option_source_version_mismatch')
      }
      validateOperation(body, source)
      validateDependencies(body, source, filterSchema.schema)
      const identity = {
        connectorInstanceId: instance.id,
        connectorId: descriptor.connectorId,
        connectorVersion: descriptor.connectorVersion,
        filterSchemaVersion: filterSchema.version,
        catalogVersion: dynamicOptions.version,
        sourceId: source.id,
        sourceVersion: source.version,
      }
      let coreResult
      try {
        coreResult = await connector.queryOptions({
          connectorInstanceId: instance.id,
          workspaceId,
          executionScopeId: instance.executionScopeId,
          connectorVersion: descriptor.connectorVersion,
          filterSchemaVersion: filterSchema.version,
          catalogVersion: dynamicOptions.version,
          sourceVersion: source.version,
          sourceId: source.id,
          dependencies: body.dependencies,
          operation: body.operation,
        }, createConnectorOptionRuntime({
          authHost,
          authReferences: instance.auth,
          authRequirements: connector.definition.auth?.requirements ?? [],
          executionScopeId: instance.executionScopeId,
          signal: options.signal,
        }))
      } catch (error) {
        if (options.signal?.aborted || isAbortError(error)) {
          return connectorOptionQueryResultSchema.parse({ ...identity, status: 'cancelled' })
        }
        throw Object.assign(new Error('Connector option query failed.'), { statusCode: 502 })
      }
      return connectorOptionQueryResultSchema.parse({
        ...identity,
        ...sanitizeCoreResult(coreResult, source.valueSchema),
      })
    },
  }
}

function assertExpectedIdentity(
  expected: OptionQueryInput['expectedIdentity'],
  actual: Omit<OptionQueryInput['expectedIdentity'], 'sourceVersion'>,
) {
  if (expected.connectorId !== actual.connectorId) fail('unsupported_descriptor')
  if (expected.connectorVersion !== actual.connectorVersion) fail('connector_version_mismatch')
  if (expected.filterSchemaVersion !== actual.filterSchemaVersion) fail('filter_schema_version_mismatch')
  if (expected.catalogVersion !== actual.catalogVersion) fail('option_catalog_version_mismatch')
}

function validateOperation(
  body: ConnectorOptionQueryBody,
  source: NonNullable<ReturnType<typeof projectInstalledConnectorDescriptor>['dynamicOptions']>['sources'][number],
) {
  if (body.operation.kind === 'search') {
    const { search, limit } = body.operation
    if (search.length < source.operations.search.minSearchLength
      || search.length > source.operations.search.maxSearchLength
      || (limit !== undefined && limit > source.operations.search.maxLimit)) {
      fail('option_value_invalid')
    }
    return
  }
  if (!source.operations.resolve || body.operation.values.length > source.operations.resolve.maxValues) {
    fail('option_value_invalid')
  }
  for (const value of body.operation.values) parseOptionValue(value, source.valueSchema)
}

function validateDependencies(
  body: ConnectorOptionQueryBody,
  source: NonNullable<ReturnType<typeof projectInstalledConnectorDescriptor>['dynamicOptions']>['sources'][number],
  filterSchema: NonNullable<ReturnType<typeof projectInstalledConnectorDescriptor>['filterSchema']>['schema'],
) {
  const declarations = new Map((source.dependencies ?? []).map((dependency) => [dependency.id, dependency]))
  for (const key of Object.keys(body.dependencies)) {
    if (!declarations.has(key)) fail('option_dependency_undeclared')
  }
  for (const declaration of declarations.values()) {
    const value = body.dependencies[declaration.id]
    if (value === undefined) {
      if (declaration.required) fail('option_dependency_invalid')
      continue
    }
    const valueSchema = connectorSchemaAtPointer(filterSchema, declaration.filterPointer)
    if (!valueSchema) fail('option_dependency_invalid')
    if (declaration.cardinality === 'many') {
      if (!Array.isArray(value)) fail('option_dependency_invalid')
      const itemSchema = 'type' in valueSchema && valueSchema.type === 'array'
        ? valueSchema.items
        : valueSchema
      if (value.some((item) => validateConnectorSchemaValue(itemSchema, item).length > 0)) {
        fail('option_dependency_invalid')
      }
    } else if (Array.isArray(value) || validateConnectorSchemaValue(valueSchema, value).length > 0) {
      fail('option_dependency_invalid')
    }
  }
}

function sanitizeCoreResult(
  result: Awaited<ReturnType<NonNullable<import('./connector.runner').AppJobConnector['queryOptions']>>>,
  valueSchema: Parameters<typeof parseConnectorOptionValue>[1],
) {
  if (result.status === 'search_ready') {
    return { status: result.status, options: sanitizeOptions(result.options, valueSchema), truncated: result.truncated }
  }
  if (result.status === 'search_empty' || result.status === 'cancelled') return { status: result.status }
  if (result.status === 'resolve_ready') {
    return {
      status: result.status,
      options: sanitizeOptions(result.options, valueSchema),
      unknownValues: result.unknownValues.map((value) => parseOptionValue(value, valueSchema)),
    }
  }
  if (result.status === 'auth_required') return { status: 'auth_required' as const }
  const knownCode = result.code === 'rate_limited'
    || result.code === 'temporarily_unavailable'
    || result.code === 'provider_rejected'
    || result.code === 'unexpected_response'
    ? result.code
    : 'unexpected_response'
  if (knownCode === 'provider_rejected') {
    return { status: 'error' as const, code: knownCode, retryable: false as const }
  }
  const retryable = knownCode === 'rate_limited' || knownCode === 'temporarily_unavailable'
    ? true
    : result.retryable === true
  return {
    status: 'error' as const,
    code: knownCode,
    retryable,
    ...(retryable && isValidRetryAfterMs(result.retryAfterMs)
      ? { retryAfterMs: result.retryAfterMs }
      : {}),
  }
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}

function isValidRetryAfterMs(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value > 0
    && value <= 86_400_000
}

function sanitizeOptions(
  options: readonly { key: string; label: string; value: unknown }[],
  schema: Parameters<typeof parseConnectorOptionValue>[1],
) {
  return options.map((option) => ({
    key: option.key,
    label: option.label,
    value: parseOptionValue(option.value, schema),
  }))
}

function parseOptionValue(value: unknown, schema: Parameters<typeof parseConnectorOptionValue>[1]) {
  try {
    return parseConnectorOptionValue(value, schema)
  } catch {
    fail('option_value_invalid')
  }
}

function fail(code: ConnectorOptionQueryErrorCode): never {
  throw new ConnectorOptionQueryCapabilityError(code)
}
