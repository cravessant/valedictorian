export type { ConnectorRunCoverageWindow } from "./result-sanitizers.js"
export { assertValidConnectorRunSummary } from "./result-validation.js"
export {
  createFixtureConnector,
  type FixtureConnectorOptions,
} from "./fixture-connector.js"
export type {
  ConnectorCheckpointRecord,
  ConnectorInstanceRecord,
  ConnectorRunRecord,
  HostObservationRecord,
  InMemoryCaptureRecord,
  InMemoryConnectorHost,
  InMemoryConnectorHostOptions,
  InMemoryConnectorHostRefreshRequest,
  InMemoryConnectorHostSnapshot,
  InMemoryConnectorHostValidateAuthRequest,
  InMemoryNormalizationRecord,
} from "./host-contract.js"
export { createInMemoryConnectorHost } from "./in-memory-host.js"
