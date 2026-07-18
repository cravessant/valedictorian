import type { LocalConnectorRegistry } from '../connectors/connector.registry'
import type { createPgliteConnectorRepository } from '../connectors/connector.repository'
import {
  createRunRuntime,
  redactSensitiveValue,
  type AppConnectorAuthHost,
  type AppConnectorRuntimePorts,
} from '../connectors/connector.runner'
import type { createSourceExecutionGovernor } from '../source-execution/source-execution-governor'
import { createSourceSessionExecutor } from '../source-execution/source-session-executor'
import { providerUrlResolverFor } from './provider-url-resolution.connector'
import {
  validateProviderUrlResolverResult,
  type ProviderUrlResolverResult,
} from './provider-url-resolution.outcome'
import type { ClaimedProviderUrlResolutionWork } from './provider-url-resolution.source'

export function createProviderUrlResolutionRuntime(options: {
  authHost?: AppConnectorAuthHost
  connectorRegistry: LocalConnectorRegistry
  connectorRepository: ReturnType<typeof createPgliteConnectorRepository>
  connectorRuntime?: AppConnectorRuntimePorts
  governor: ReturnType<typeof createSourceExecutionGovernor>
  now: () => Date
  workspaceId: string
}) {
  const sessionExecutor = createSourceSessionExecutor({
    governor: options.governor,
    now: options.now,
  })

  return async function resolve(
    work: ClaimedProviderUrlResolutionWork,
    signal?: AbortSignal,
  ): Promise<ProviderUrlResolverResult> {
    if (signal?.aborted) return { status: 'interrupted', reason: 'cancelled' }
    const instance = await options.connectorRepository.getInstance(
      work.connectorInstanceId,
    )
    if (!instance || instance.executionScopeId !== work.executionScopeId) {
      return { status: 'terminal', reason: 'provider_url_connector_instance_unavailable' }
    }
    if (!instance.enabled) {
      return { status: 'terminal', reason: 'provider_url_connector_disabled' }
    }
    const timestamp = options.now().toISOString()
    const scope = options.governor.getScope(work.executionScopeId)
    if (scope.status === 'action_required') {
      return { status: 'terminal', reason: 'provider_url_source_action_required', action: 'authenticate' }
    }
    if ((scope.status === 'cooldown' && (!scope.blockedUntil || scope.blockedUntil > timestamp))
      || (scope.blockedUntil && scope.blockedUntil > timestamp)) {
      const delay = scope.blockedUntil
        ? Date.parse(scope.blockedUntil) - Date.parse(timestamp)
        : Number.NaN
      const serverMinimumDelayMs = Number.isFinite(delay) ? Math.max(0, delay) : undefined
      return {
        status: 'retryable',
        reason: 'source_scope_cooldown',
        retryReason: 'rate_limit',
        ...(serverMinimumDelayMs === undefined ? {} : { serverMinimumDelayMs }),
      }
    }
    if (scope.status === 'refreshing') {
      return { status: 'retryable', reason: 'source_scope_unavailable', retryReason: 'server_failure' }
    }
    const connector = typeof options.connectorRegistry.getVersion === 'function'
      ? options.connectorRegistry.getVersion(instance.connectorId, instance.connectorVersion)
      : (() => {
          const candidate = options.connectorRegistry.get(instance.connectorId)
          return candidate?.definition.version === instance.connectorVersion ? candidate : null
        })()
    const resolver = providerUrlResolverFor(connector)
    if (!resolver
      || resolver.id !== work.resolverId
      || resolver.version !== work.resolverVersion) {
      return { status: 'terminal', reason: 'provider_url_resolver_unavailable' }
    }
    const sensitiveValues = new Set<string>()
    const runtime = createRunRuntime(
      signal
        ? { ...options.connectorRuntime, cancellation: { signal } }
        : options.connectorRuntime ?? {},
      instance.auth,
      connector?.definition.auth?.requirements ?? [],
      options.authHost,
      sensitiveValues,
      instance.executionScopeId,
      sessionExecutor,
      false,
      undefined,
    )
    const result = await resolver.resolve({
      connectorInstanceId: instance.id,
      executionScopeId: instance.executionScopeId,
      providerRecordId: work.providerRecordId,
      workspaceId: options.workspaceId,
    }, {
      auth: runtime.auth,
      ...(runtime.cancellation ? { cancellation: runtime.cancellation } : {}),
    })
    if (!validateProviderUrlResolverResult(result)) {
      return { status: 'terminal', reason: 'provider_url_invalid_result' }
    }
    const redacted = redactSensitiveValue(result, sensitiveValues) as ProviderUrlResolverResult
    if (!validateProviderUrlResolverResult(redacted)) {
      return { status: 'terminal', reason: 'provider_url_invalid_result' }
    }
    if (redacted.status === 'retryable' && redacted.retryReason === 'rate_limit') {
      options.governor.blockScope(work.executionScopeId, {
        now: options.now().toISOString(),
        serverMinimumDelayMs: redacted.serverMinimumDelayMs,
      })
    }
    return redacted
  }
}
