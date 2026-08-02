/**
 * Sandbox-safe connector values shared with Electron preload and the renderer.
 *
 * Keep this surface separate from the host connector composition in
 * `modules/connectors/public.ts`: every value exported here must remain free of
 * Node built-ins, database drivers, schemas, repositories, and persistence.
 */
export {
  type ConnectorSkipActionResult,
  parseConnectorRetirementIpcEnvelope,
  publicConnectorSkipActionResult,
} from './modules/connectors/public/connector.edge-contract.js'
export {
  maximumSelectableEarliestBackfillDate,
  minimumSelectableEarliestBackfillDate,
  validateSelectableEarliestBackfillDate,
} from './modules/connectors/public/connector.earliest-backfill.js'
export {
  type ConnectorSchemaValidationIssue,
  validateConnectorConfigPersistenceValue,
  validateConnectorSchemaValue,
} from './modules/connectors/public/connector.renderer-schema-validation.js'
export {
  connectorRunSynchronizationCopy,
  type ConnectorSynchronizationCopy,
  type ConnectorSynchronizationInput,
} from './modules/connectors/public/connector.run-presentation.js'
export {
  JOBRIGHT_CONNECTOR_ID,
  JOBRIGHT_CONNECTOR_VERSION,
} from './modules/connectors/public/jobright.constants.js'
