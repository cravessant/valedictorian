import type { createNormalizationOrchestrator } from './normalization.orchestrator'
import type { createPgliteNormalizationRepository } from './normalization.repository'
import {
  createNormalizationResolverRegistry,
  type NormalizationResolver,
} from './normalization.registry'
import {
  mapProviderUrlResolverResult,
  validateProviderUrlResolverResult,
  type ProviderUrlResolverResult,
} from './provider-url-resolution.outcome'
import type { createProviderUrlResolutionRepository } from './provider-url-resolution.repository'
import type { ClaimedProviderUrlResolutionWork } from './provider-url-resolution.source'
import { providerUrlNormalizationDeclaration } from './provider-url-resolution.connector'
import type { NormalizationResolverRegistry } from './normalization.registry'

export function createProviderUrlResolutionExecutor(options: {
  normalizationOrchestrator: ReturnType<typeof createNormalizationOrchestrator>
  normalizationRepository: ReturnType<typeof createPgliteNormalizationRepository>
  pureNormalizationRegistry?: NormalizationResolverRegistry
  now: () => Date
  random: () => number
  repository: ReturnType<typeof createProviderUrlResolutionRepository>
  resolve: (
    work: ClaimedProviderUrlResolutionWork,
    signal?: AbortSignal,
  ) => Promise<ProviderUrlResolverResult>
}) {
  return async function execute(
    work: ClaimedProviderUrlResolutionWork,
    signal?: AbortSignal,
  ): Promise<void> {
    const raw = await options.normalizationRepository.getRawContext(
      work.captureEvidenceVersionId,
    )
    if (!raw) {
      await options.repository.recordFailureEvidence({
        ...work,
        evidence: { reason: 'provider_url_capture_missing' },
        terminal: true,
      })
      return
    }

    if (options.pureNormalizationRegistry) {
      try {
        await options.normalizationOrchestrator.normalize(
          raw.revision.rawRecordId,
          raw.revision.id,
          {
            kind: 'replay',
            replayId: `provider-url-pure:${work.retryWorkId}:${work.acquisitionToken}`,
            fieldDirectives: [],
            targetResolverVersions: [],
          },
          {
            cache: false,
            enabledCapabilities: ['pure'],
            registry: options.pureNormalizationRegistry,
          },
        )
      } catch (error) {
        await options.repository.release(work)
        throw error
      }
      if (signal?.aborted) {
        await options.repository.release(work)
        return
      }
    }

    let result: ProviderUrlResolverResult
    try {
      result = await options.resolve(work, signal)
    } catch (error) {
      if (isCancellation(error, signal)) {
        await options.repository.release(work)
        throw error
      }
      result = {
        status: 'retryable',
        reason: 'provider_url_resolver_exception',
        retryReason: 'server_failure',
      }
    }
    if (signal?.aborted) {
      await options.repository.release(work)
      return
    }
    if (!validateProviderUrlResolverResult(result)) {
      result = { status: 'terminal', reason: 'provider_url_invalid_result' }
    }
    if (result.status === 'interrupted' && result.reason === 'cancelled') {
      await options.repository.release(work)
      return
    }
    if (result.status === 'interrupted' && result.reason === 'runtime_limit') {
      result = {
        status: 'retryable',
        reason: 'provider_url_runtime_limit',
        retryReason: 'operation_timeout',
      }
    }
    const resolver = providerUrlNormalizationResolver(work, result, options)
    const failureFinalization = result.status === 'retryable'
      ? {
          evidence: {
            reason: result.reason,
            retryReason: result.retryReason,
            serverMinimumDelayMs: result.serverMinimumDelayMs ?? null,
          },
        }
      : result.status === 'terminal'
        ? {
            evidence: {
              action: result.action ?? null,
              parserChanged: result.parserChanged ?? null,
              reason: result.reason,
            },
            terminal: true as const,
          }
        : undefined
    const currentFields = new Set(resolver.declaration.outputFields)
    const latest = await options.normalizationRepository.getLatestForRevision(raw.revision.id)
    const baselineOutcomes = latest
      ?.fieldOutcomes.filter(({ field }) => !currentFields.has(field)) ?? []

    try {
      await options.normalizationOrchestrator.normalize(
        raw.revision.rawRecordId,
        raw.revision.id,
        {
          kind: 'replay',
          replayId: `provider-url-work:${work.retryWorkId}:${work.acquisitionToken}`,
          fieldDirectives: [],
          targetResolverVersions: [{
            resolverId: work.resolverId,
            version: work.resolverVersion,
          }],
        },
        {
          acquiredRetryWork: {
            acquisitionToken: work.acquisitionToken,
            executionScopeId: work.executionScopeId,
            failureFinalization,
            retryWorkId: work.retryWorkId,
          },
          baselineOutcomes,
          cache: false,
          enabledCapabilities: ['network'],
          registry: createNormalizationResolverRegistry([resolver]),
        },
      )
    } catch (error) {
      await options.repository.release(work)
      throw error
    }

  }
}

function providerUrlNormalizationResolver(
  work: ClaimedProviderUrlResolutionWork,
  result: ProviderUrlResolverResult,
  options: { now: () => Date; random: () => number },
): NormalizationResolver {
  return {
    declaration: providerUrlNormalizationDeclaration({
      id: work.resolverId,
      version: work.resolverVersion,
    }),
    resolve: (context) => [{
      ...mapProviderUrlResolverResult(work, result, {
        nowEpochMs: () => options.now().getTime(),
        random: options.random,
      }),
      inputHash: context.hashInput({
        providerRecordId: work.providerRecordId,
        resolverId: work.resolverId,
        resolverVersion: work.resolverVersion,
      }),
    }],
  }
}

function isCancellation(error: unknown, signal?: AbortSignal) {
  return signal?.aborted === true
    || (error instanceof Error && error.name === 'AbortError')
}
