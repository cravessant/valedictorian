/**
 * Private composition root, imported only by `public.ts`. `core/` holds business
 * behaviour, `ports/` the connector-owned contracts core speaks to, `adapters/`
 * the concrete persistence, runtime, provider, scheduling, and capture
 * implementations filling those ports, and `public/` the stable external
 * contracts. Dependencies point inward.
 */
export { createConnectorWorkspaceClient } from './adapters/connector.workspace-client.js'
export type { ConnectorWorkspaceClient } from './adapters/connector.workspace-client.js'
export { createConnectorRunner } from './adapters/connector.runner.js'
export type { CreateConnectorRunnerOptions } from './adapters/connector.runner.js'
export { createConnectorCaptureHost } from './adapters/capture/connector.capture-host.js'
export { createDefaultLocalConnectorRegistry } from './adapters/provider/connector.default-registry.js'
export {
  JOBRIGHT_PROVIDER_FIELD_RESOLVER_DECLARATION,
  JOBRIGHT_PROVIDER_FIELD_RESOLVER_ID,
  JOBRIGHT_PROVIDER_FIELD_RESOLVER_VERSION,
} from './adapters/provider/jobright.provider-field-resolver.js'
export { admitConnectorScheduleDue } from './adapters/persistence/connector-schedule.dispatch.js'
export { createPgliteConnectorRepository } from './adapters/persistence/connector.repository.js'
export { createConnectorScheduleRepository } from './adapters/persistence/connector-schedule.repository.js'
export {
  createDefaultLocalConnectorPorts,
  type DefaultLocalConnectorPorts,
} from './adapters/runtime/connector.runtime-ports.js'

export {
  createStaticConnectorRegistry,
  type LocalConnectorRegistry,
} from './core/connector.registry.js'
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
} from './core/connector.consumer-contract.js'
export type { ConnectorStatusListResult, ConnectorStatusView } from './core/connector.status.js'

export type {
  AppConnectorAuthHost,
  AppConnectorRuntime,
  AppConnectorRuntimePorts,
  AppConnectorSecretResolver,
  AppJobConnector,
} from './ports/connector.runner-contracts.js'
export type { ConnectorRepository } from './ports/connector.repository.port.js'
