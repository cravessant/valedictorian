import type { ConnectorNormalizationInput } from '@sparxie/valedictorian-connectors-core'
import type { CanonicalCandidateField, RawSourceNormalizationResult, ResolverCapability } from 'sparxie'
import { createNormalizationOrchestrator } from '../sourcing/normalization.orchestrator'
import {
  createNormalizationResolverRegistry,
  hashJson,
  type NormalizationResolver,
  type NormalizationResolverRegistry,
} from '../sourcing/normalization.registry'
import type { createSqliteNormalizationRepository } from '../sourcing/normalization.repository'
import type { AppConnectorNormalizationHost } from './connector.runner'

export function createConnectorNormalizationHost(options: {
  repository: ReturnType<typeof createSqliteNormalizationRepository>
  registry: NormalizationResolverRegistry
  now?: () => Date
  onNormalized?: (result: RawSourceNormalizationResult) => Promise<unknown>
}): AppConnectorNormalizationHost {
  const orchestrator = createNormalizationOrchestrator({
    repository: options.repository,
    registry: options.registry,
    now: options.now,
  })

  return {
    async run(input, context) {
      const invokesNetwork = input.resolver.capabilities.includes('network')
      const registry = createNormalizationResolverRegistry([
        connectorResolver(input),
        ...(invokesNetwork ? [] : options.registry.resolvers),
      ])
      const executionRegistry = {
        ...registry,
        resolverSetHash: hashJson({
          occurrenceId: context.triggerOccurrence?.id
            ?? (context.acquiredRetryWork
              ? `retry-work:${context.acquiredRetryWork.retryWorkId}`
              : null),
          resolverSetHash: registry.resolverSetHash,
        }),
      }
      const currentFields = new Set<CanonicalCandidateField>(input.resolver.outputFields)
      const baselineOutcomes = options.repository.getLatest(input.rawRevision.rawRecordId)
        ?.fieldOutcomes.filter(({ field }) => !currentFields.has(field)) ?? []
      const exactReplay = context.acquiredRetryWork
      const result = await orchestrator.normalize(
        input.rawRevision.rawRecordId,
        input.rawRevision.id,
        exactReplay
          ? {
              kind: 'replay',
              replayId: `retry-work:${exactReplay.retryWorkId}:${context.connectorRunId}`,
              fieldDirectives: [],
              targetResolverVersions: [{ resolverId: input.resolver.id, version: input.resolver.version }],
            }
          : { kind: 'intake' },
        {
          ...(exactReplay
            ? {
                acquiredRetryWork: exactReplay,
                deferAcquiredRetryCompletion: context.deferAcquiredRetryCompletion === true,
              }
            : {}),
          baselineOutcomes,
          cache: !invokesNetwork && !exactReplay,
          enabledCapabilities: supportedCapabilities(context.enabledCapabilities),
          registry: executionRegistry,
          ...(context.triggerOccurrence
            ? { triggerOccurrence: context.triggerOccurrence }
            : {}),
        },
      )
      await options.onNormalized?.(result)
      const attempt = result.attempts.find(({ resolver }) =>
        resolver.id === input.resolver.id && resolver.version === input.resolver.version)

      if (!attempt) {
        throw new Error(`Connector normalization attempt was not persisted: ${input.resolver.id}`)
      }

      return attempt.outcomes
    },
  }
}

function connectorResolver(input: ConnectorNormalizationInput): NormalizationResolver {
  return {
    declaration: input.resolver,
    resolve: () => input.resolve(),
  }
}

function supportedCapabilities(
  capabilities: readonly ResolverCapability[],
): readonly ResolverCapability[] {
  return capabilities.filter((capability) => capability === 'pure' || capability === 'network')
}
