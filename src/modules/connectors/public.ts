/**
 * Connectors public surface (issue #327).
 *
 * The contracts production server and runtime composition consume, plus the
 * desktop edge envelopes relocated here from `src/ipc`. Module internals stay
 * private: nothing here re-exports a table, a persistence DTO, or an API no
 * consumer has, and this file reaches no runtime, server, IPC, or Electron edge.
 *
 * The connectors core/ports/adapters reorganization is #329's; this surface only
 * names what already crosses the boundary.
 */
export { ConnectorExecutionError } from './connector-execution.errors'
export { completedConnectorRefreshContract } from './connector-refresh-result.test-helpers'
export {
  localDesktopConnectorSchedulingCapability,
  resolveConnectorSchedulingCapability,
} from './connector-schedule.capability'
export { admitConnectorScheduleDue } from './connector-schedule.dispatch'
export { createConnectorScheduleError } from './connector-schedule.errors'
export { createConnectorCaptureHost } from './connector.capture-host'
export { createConnectorWorkspaceClient } from './connector.workspace-client'
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
} from './connector.consumer-contract'
export {
  connectorRetirementIpcConflict,
  connectorRetirementIpcSuccess,
  publicConnectorSkipActionResult,
} from './connector.edge-contract'
export {
  createConnectorRunRecoveryLifecycle,
  type ConnectorRunRecoveryLifecycle,
} from './connector.recovery'
export {
  createDefaultLocalConnectorRegistry,
  createStaticConnectorRegistry,
  type LocalConnectorRegistry,
} from './connector.registry'
export {
  publicConnectorRunSummary,
  publicConnectorRunsListResult,
} from './connector.run-projection'
export type {
  AppConnectorAuthHost,
  AppConnectorRuntimePorts,
  AppJobConnector,
} from './connector.runner'
export {
  createDefaultLocalConnectorPorts,
  type DefaultLocalConnectorPorts,
} from './connector.runtime-ports'
export {
  JOBRIGHT_CONNECTOR_ID,
  JOBRIGHT_PROVIDER_FIELD_RESOLVER_ID,
  JOBRIGHT_PROVIDER_FIELD_RESOLVER_VERSION,
} from './jobright.constants'
