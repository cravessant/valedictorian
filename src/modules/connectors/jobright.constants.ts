export const JOBRIGHT_CONNECTOR_ID = 'jobright.resolver'
export const JOBRIGHT_CONNECTOR_VERSION = '0.10.0'
export const JOBRIGHT_CHECKPOINT_SCHEMA_V5 = 'jobright-resolution-checkpoint@5'
export const JOBRIGHT_AUTHENTICATED_DESTINATION_RESOLVER_ID = 'jobright.authenticated-destination'
export const JOBRIGHT_AUTHENTICATED_DESTINATION_RESOLVER_VERSION = 'jobright-authenticated-destination@1'

/** Connector default when config.usefulTarget is absent. */
export const JOBRIGHT_DEFAULT_USEFUL_TARGET = 100
export const JOBRIGHT_MIN_USEFUL_TARGET = 1
export const JOBRIGHT_MAX_USEFUL_TARGET = 500

/** Host request budget currently takes precedence over connector-supported maximum. */
export const JOBRIGHT_HOST_REQUEST_BUDGET = 10
export const JOBRIGHT_CONNECTOR_MAX_REQUESTS_PER_RUN = 25

export const JOBRIGHT_DEFAULT_DISCOVERY_COUNT = 20
export const JOBRIGHT_MIN_DISCOVERY_COUNT = 1
export const JOBRIGHT_MAX_DISCOVERY_COUNT = 100

export const JOBRIGHT_DEFAULT_MAX_DISCOVERY_PAGES = 40
export const JOBRIGHT_MIN_MAX_DISCOVERY_PAGES = 1
export const JOBRIGHT_MAX_MAX_DISCOVERY_PAGES = 100

export const JOBRIGHT_DEFAULT_MAX_DISCOVERY_RECORDS = 500
export const JOBRIGHT_MIN_MAX_DISCOVERY_RECORDS = 1
export const JOBRIGHT_MAX_MAX_DISCOVERY_RECORDS = 1_000

export const JOBRIGHT_DEFAULT_MAX_RESOLUTION_COUNT = 10
export const JOBRIGHT_PACING_CONCURRENCY = 1
export const JOBRIGHT_PACING_MIN_DELAY_SECONDS = 1
export const JOBRIGHT_PACING_MAX_DELAY_SECONDS = 10
