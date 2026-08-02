// The package declaration is the source of truth for scheduling identity and replay.
import type { ResolverDeclaration } from '@sparxie/valedictorian-connectors-core'
import { jobrightProviderFieldResolverDeclaration } from '@sparxie/valedictorian-connectors-jobright'

export const JOBRIGHT_PROVIDER_FIELD_RESOLVER_DECLARATION: ResolverDeclaration =
  jobrightProviderFieldResolverDeclaration
export const JOBRIGHT_PROVIDER_FIELD_RESOLVER_ID = jobrightProviderFieldResolverDeclaration.id
export const JOBRIGHT_PROVIDER_FIELD_RESOLVER_VERSION = jobrightProviderFieldResolverDeclaration.version
