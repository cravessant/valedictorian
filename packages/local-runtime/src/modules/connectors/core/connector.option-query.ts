import type {
  ConnectorOptionQueryResult,
  ValedictorianWorkspaceClient,
} from '@sparxie/sdk'
import {
  connectorOptionQueryBodySchema,
  connectorOptionQueryResultSchema,
} from '@sparxie/sdk'
import type { ConnectorRepository } from '../ports/connector.repository.port.js'
import type { AppConnectorAuthHost } from '../ports/connector.runner-contracts.js'
import { createConnectorOptionRuntime } from './connector.option-runtime.js'
import type { LocalConnectorRegistry } from './connector.registry.js'
import {
  ConnectorOptionQueryCapabilityError,
  sanitizeConnectorOptionCoreResult,
  validateConnectorOptionQueryContract,
} from './connector.option-query.contract.js'

export { ConnectorOptionQueryCapabilityError } from './connector.option-query.contract.js'

type OptionQueryInput = Parameters<ValedictorianWorkspaceClient['connectors']['options']['query']>[0]

export function createConnectorOptionQueryService({
  authHost,
  connectorRegistry,
  connectorRepository,
  workspaceId,
}: {
  authHost?: AppConnectorAuthHost
  connectorRegistry: LocalConnectorRegistry
  connectorRepository: ConnectorRepository
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
      const registered = connectorRegistry.get(instance.connectorId)
      if (!registered) throw new ConnectorOptionQueryCapabilityError('unsupported_descriptor')
      const { connector, descriptor } = registered
      const dynamicOptions = descriptor.dynamicOptions
      const filterSchema = descriptor.filterSchema
      if (!dynamicOptions || !filterSchema || !connector.queryOptions) {
        throw new ConnectorOptionQueryCapabilityError('option_query_unavailable')
      }
      const source = validateConnectorOptionQueryContract({
        actualIdentity: {
          connectorId: descriptor.connectorId,
          connectorVersion: descriptor.connectorVersion,
          filterSchemaVersion: filterSchema.version,
          catalogVersion: dynamicOptions.version,
        },
        body,
        dynamicOptions,
        expectedIdentity: rawInput.expectedIdentity,
        filterSchema: filterSchema.schema,
      })
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
        ...sanitizeConnectorOptionCoreResult(coreResult, source.valueSchema),
      })
    },
  }
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}
