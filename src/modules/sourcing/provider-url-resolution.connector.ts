import type {
  AppConnectorRuntime,
  AppJobConnector,
} from '../connectors/connector.runner'
import type { ResolverDeclaration } from 'sparxie'
import type { ProviderUrlResolverResult } from './provider-url-resolution.outcome'

export interface ProviderUrlResolver {
  id: string
  version: string
  resolve(
    input: {
      connectorInstanceId: string
      executionScopeId: string
      providerRecordId: string
      workspaceId: string
    },
    runtime: Pick<AppConnectorRuntime, 'auth' | 'cancellation'>,
  ): Promise<ProviderUrlResolverResult>
}

export interface ProviderUrlNormalizationDeclaration extends ResolverDeclaration {
  providerUrlNormalization: true
}

export function providerUrlResolverFor(
  connector: AppJobConnector | null,
): ProviderUrlResolver | null {
  const resolver = (connector as AppJobConnector & {
    providerUrlResolver?: ProviderUrlResolver
  } | null)?.providerUrlResolver
  return resolver
    && typeof resolver.id === 'string'
    && typeof resolver.version === 'string'
    && typeof resolver.resolve === 'function'
    ? resolver
    : null
}

export function providerUrlNormalizationDeclaration(
  resolver: Pick<ProviderUrlResolver, 'id' | 'version'>,
): ProviderUrlNormalizationDeclaration {
  const declaration: ResolverDeclaration = {
    id: resolver.id,
    version: resolver.version,
    requiredInputs: ['providerRecordId'],
    outputFields: ['destinationUrl'],
    capabilities: ['network'],
    costClass: 'high',
    precedence: 1_000,
    scopeRequirement: 'source',
  }
  Object.defineProperty(declaration, 'providerUrlNormalization', {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  })
  return declaration as ProviderUrlNormalizationDeclaration
}

export function jobrightIntermediaryUrl(
  connectorId: string,
  providerRecordId: string,
): string | null {
  if (connectorId !== 'jobright.resolver') return null
  const prefix = 'jobright.public:'
  const jobrightId = providerRecordId.startsWith(prefix)
    ? providerRecordId.slice(prefix.length)
    : providerRecordId
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(jobrightId)
    ? `https://jobright.ai/jobs/info/${encodeURIComponent(jobrightId)}`
    : null
}
