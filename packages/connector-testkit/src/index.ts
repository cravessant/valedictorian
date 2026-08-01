export type { ConnectorRunCoverageWindow } from "./result-sanitizers.js"
export {
  sanitizeConnectorRunCoverage,
  sanitizeConnectorRunLifecycle,
  sanitizeRetryHints,
} from "./result-sanitizers.js"
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
