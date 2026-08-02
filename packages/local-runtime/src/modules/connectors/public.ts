/**
 * The supported external surface for connectors. Everything outside this module
 * imports from here, and nothing here exposes a table, a persistence row, or a
 * runtime, server, IPC, or Electron edge.
 */
export { ConnectorExecutionError } from './public/connector.execution-errors.js'
export {
  localDesktopConnectorSchedulingCapability,
  resolveConnectorSchedulingCapability,
} from './public/connector.schedule-capability.js'
export { createConnectorScheduleError } from './public/connector.schedule-errors.js'
export {
  assertPersistedEarliestBackfillDate,
  defaultEarliestBackfillDate,
  maximumSelectableEarliestBackfillDate,
  minimumSelectableEarliestBackfillDate,
  validateSelectableEarliestBackfillDate,
} from './public/connector.earliest-backfill.js'
export {
  connectorRetirementIpcConflict,
  connectorRetirementIpcSuccess,
  parseConnectorRetirementIpcEnvelope,
  publicConnectorSkipActionResult,
  type ConnectorSkipActionResult,
} from './public/connector.edge-contract.js'
export {
  createConnectorRunRecoveryLifecycle,
  type ConnectorRunRecoveryLifecycle,
} from './public/connector.recovery.js'
export {
  validateConnectorConfigPersistenceValue,
  validateConnectorSchemaValue,
  type ConnectorSchemaValidationIssue,
} from './public/connector.renderer-schema-validation.js'
export { connectorRunSynchronizationCopy } from './public/connector.run-presentation.js'
export {
  publicConnectorRunSummary,
  publicConnectorRunsListResult,
} from './public/connector.run-projection.js'
export {
  JOBRIGHT_CONNECTOR_ID,
  JOBRIGHT_CONNECTOR_VERSION,
} from './public/jobright.constants.js'

export {
  admitConnectorScheduleDue,
  createConnectorCaptureHost,
  createConnectorWorkspaceClient,
  createDefaultLocalConnectorPorts,
  createDefaultLocalConnectorRegistry,
  createStaticConnectorRegistry,
  JOBRIGHT_PROVIDER_FIELD_RESOLVER_ID,
  JOBRIGHT_PROVIDER_FIELD_RESOLVER_VERSION,
  type AppConnectorAuthHost,
  type AppConnectorRuntime,
  type AppConnectorRuntimePorts,
  type AppConnectorSecretResolver,
  type AppJobConnector,
  type ConnectorStatusListResult,
  type ConnectorStatusView,
  type DefaultLocalConnectorPorts,
  type LocalConnectorAuthGrantSummary,
  type LocalConnectorAuthSummary,
  type LocalConnectorClient,
  type LocalConnectorExecutionIntent,
  type LocalConnectorInstanceSummary,
  type LocalConnectorInternalRunTriggerInput,
  type LocalConnectorObservationListInput,
  type LocalConnectorReconnectActionResult,
  type LocalConnectorRegistry,
  type LocalConnectorRunSummary,
  type LocalConnectorSkipActionInput,
  type LocalConnectorSkipActionResult,
  type LocalConnectorStatusActionInput,
  type LocalConnectorStatusSummary,
} from './module.js'
