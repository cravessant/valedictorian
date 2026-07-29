/**
 * Private composition root, imported only by `public.ts`. `core/` holds business
 * behaviour, `ports/` the connector-owned contracts core speaks to, `adapters/`
 * the concrete persistence, runtime, provider, scheduling, and capture
 * implementations filling those ports, and `public/` the stable external
 * contracts. Dependencies point inward.
 */
export { createConnectorWorkspaceClient } from './adapters/connector.workspace-client'
export type { ConnectorWorkspaceClient } from './adapters/connector.workspace-client'
export { createConnectorRunner } from './adapters/connector.runner'
export type { CreateConnectorRunnerOptions } from './adapters/connector.runner'
export { createConnectorCaptureHost } from './adapters/capture/connector.capture-host'
export { createDefaultLocalConnectorRegistry } from './adapters/provider/connector.default-registry'
export {
  JOBRIGHT_PROVIDER_FIELD_RESOLVER_DECLARATION,
  JOBRIGHT_PROVIDER_FIELD_RESOLVER_ID,
  JOBRIGHT_PROVIDER_FIELD_RESOLVER_VERSION,
} from './adapters/provider/jobright.provider-field-resolver'
export { admitConnectorScheduleDue } from './adapters/persistence/connector-schedule.dispatch'
export { createPgliteConnectorRepository } from './adapters/persistence/connector.repository'
export { createConnectorScheduleRepository } from './adapters/persistence/connector-schedule.repository'
export {
  createDefaultLocalConnectorPorts,
  type DefaultLocalConnectorPorts,
} from './adapters/runtime/connector.runtime-ports'

export {
  createStaticConnectorRegistry,
  type LocalConnectorRegistry,
} from './core/connector.registry'
export type {
  LocalConnectorAuthGrantSummary,
  LocalConnectorAuthSummary,
  LocalConnectorClient,
  LocalConnectorExecutionIntent,
  LocalConnectorInstanceSummary,
  LocalConnectorInternalRunTriggerInput,
  LocalConnectorObservationListInput,
  LocalConnectorReconnectActionResult,
  LocalConnectorRunSummary,
  LocalConnectorSkipActionInput,
  LocalConnectorSkipActionResult,
  LocalConnectorStatusActionInput,
  LocalConnectorStatusSummary,
} from './core/connector.consumer-contract'
export type { ConnectorStatusListResult, ConnectorStatusView } from './core/connector.status'

export type {
  AppConnectorAuthHost,
  AppConnectorRuntime,
  AppConnectorRuntimePorts,
  AppConnectorSecretResolver,
  AppJobConnector,
} from './ports/connector.runner-contracts'
export type { ConnectorRepository } from './ports/connector.repository.port'
