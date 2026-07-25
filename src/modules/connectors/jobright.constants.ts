import { jobrightProviderFieldResolverDeclaration } from '@sparxie/valedictorian-connectors-jobright'

export const JOBRIGHT_CONNECTOR_ID = 'jobright.resolver'
export const JOBRIGHT_CONNECTOR_VERSION = '0.18.2'
export const JOBRIGHT_CAPTURE_CHECKPOINT_SCHEMA_V1 = 'jobright-capture-checkpoint@1'
export const JOBRIGHT_CHECKPOINT_SCHEMA_V5 = 'jobright-resolution-checkpoint@5'
export const JOBRIGHT_AUTHENTICATED_DESTINATION_RESOLVER_ID = 'jobright.authenticated-destination'
export const JOBRIGHT_AUTHENTICATED_DESTINATION_RESOLVER_VERSION = 'jobright-authenticated-destination@1'

// #325: the trusted Jobright provider-field resolver adopted from the connector package.
// The package declaration is the source of truth for scheduling identity and replay.
export const JOBRIGHT_PROVIDER_FIELD_RESOLVER_DECLARATION = jobrightProviderFieldResolverDeclaration
export const JOBRIGHT_PROVIDER_FIELD_RESOLVER_ID = jobrightProviderFieldResolverDeclaration.id
export const JOBRIGHT_PROVIDER_FIELD_RESOLVER_VERSION = jobrightProviderFieldResolverDeclaration.version

export const JOBRIGHT_DEFAULT_DISCOVERY_COUNT = 20
export const JOBRIGHT_MIN_DISCOVERY_COUNT = 1
export const JOBRIGHT_MAX_DISCOVERY_COUNT = 100
