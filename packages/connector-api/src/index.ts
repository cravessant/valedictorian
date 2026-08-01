export {
  connectorRefreshWarning,
  connectorRefreshWarningMessages,
  ConnectorExecutionError,
  connectorExecutionErrorCode,
  connectorExecutionErrorMessage,
  sanitizeConnectorRefreshWarnings,
  sanitizeConnectorRefreshStopReason,
  sanitizeConnectorAuthValidationResult,
  sanitizeConnectorBoundaryDate,
  sanitizeConnectorSynchronization,
  sanitizeConnectorSynchronizationOutcome,
  type ConnectorAuthOutcomeReason,
  type ConnectorAuthValidationStatus,
  type SanitizedConnectorAuthValidationResult,
  type ConnectorProviderUrlResolverReason,
  type ConnectorRefreshStopReason,
  type ConnectorRefreshWarning,
  type ConnectorRefreshWarningCode,
  type ConnectorSynchronization,
  type ConnectorSynchronizationCancelledReason,
  type ConnectorSynchronizationFailedReason,
  type ConnectorSynchronizationOutcome,
} from "./connector-outcomes.js"

export {
  parseConnectorDynamicOptionsDeclaration,
  parseConnectorOptionValue,
  type ConnectorDynamicOptionSource,
  type ConnectorDynamicOptionsDeclaration,
  type ConnectorOptionObjectSchema,
  type ConnectorOptionScalar,
  type ConnectorOptionScalarSchema,
  type ConnectorOptionValue,
  type ConnectorOptionValueSchema,
} from "./dynamic-options.js"

export {
  scheduleRetry,
  type RetryPolicyDependencies,
  type RetryPolicyInput,
} from "./retry-policy.js"

// These five identifiers are the connector-owned projection of the Sparxie ABI.
// The established connector-authored contracts below remain local to this API;
// source-specific and application-owned contracts do not cross this boundary.
export type {
  ConnectorHistoricalBackfillState,
  ConnectorNewestFrontierState,
  ConnectorVersionedRendererSchema,
} from "./connector-contracts.js"
export { installedConnectorDescriptorSchema } from "./connector-contracts.js"
export { sourceAdapterKinds } from "./source-adapter-kinds.js"
export { canonicalDateOnlySchema, type CanonicalDateOnly } from "./canonical-date.js"

export type {
  CreateCaptureInput,
  EvidenceMode,
} from "./capture-contract.js"
export {
  captureAdapterSchema,
  captureEvidenceSchema,
  createCaptureInputSchema,
  evidenceModes,
} from "./capture-contract.js"
export type {
  SourceExecutionScopeId,
  SourceOperationOutcome,
} from "./source-execution.js"
export {
  sourceExecutionScopeIdSchema,
  sourceOperationOutcomeSchema,
} from "./source-execution.js"
export type {
  RetryAdvice,
  TransientRetryReason,
} from "./retry.js"
export {
  retryAdviceSchema,
  transientRetryReasons,
} from "./retry.js"

export type { JsonPrimitive, JsonValue, JsonObject } from "./json.js"
export {
  canonicalCandidateFields,
  canonicalCompensationIntervals,
  canonicalEmploymentTypes,
  canonicalPostedAtPrecisions,
  resolverCapabilities,
  resolverCostClasses,
  type CanonicalCandidateField,
  type CanonicalCompensation,
  type CanonicalCompensationInterval,
  type CanonicalEmploymentType,
  type CanonicalLocation,
  type CanonicalPostedAt,
  type CanonicalPostedAtPrecision,
  type FieldResolutionOutcome,
  type ResolutionEvidence,
  type ResolverCapability,
  type ResolverCostClass,
  type ResolverDeclaration,
  type SourceAdapterKind,
} from "./normalization-types.js"
export {
  connectorReportedOriginKinds,
  type ConnectorCaptureAdapter,
  type ConnectorCaptureEnvelope,
  type ConnectorCaptureEvidence,
  type ConnectorCaptureInput,
  type ConnectorCaptureIntakeRuntime,
  type ConnectorCaptureOccurrence,
  type ConnectorCaptureProvenance,
  type ConnectorCaptureReceipt,
  type ConnectorCaptureReference,
  type ConnectorCaptureRevision,
  type ConnectorReportedOrigin,
  type ConnectorReportedOriginKind,
} from "./capture.js"

export {
  jobObservationSchemaVersion,
  type JobObservation,
  type JobObservationEvidence,
  type JobObservationLinks,
  type JobObservationResolution,
  type JobObservationResolutionStatus,
} from "./observation.js"

export type {
  ConnectorAuthDeclaration,
  ConnectorAuthEstablish,
  ConnectorAuthEstablishmentResult,
  ConnectorAuthGrant,
  ConnectorAuthGrantStatus,
  ConnectorAuthMode,
  ConnectorAuthReference,
  ConnectorAuthRequirement,
  ConnectorAuthResolveInput,
  ConnectorAuthRuntime,
  ConnectorCancellationRuntime,
  ConnectorDelayInput,
  ConnectorDelayRuntime,
  ConnectorOptionRuntime,
  ConnectorProgressCounts,
  ConnectorProgressRuntime,
  ConnectorProgressSnapshot,
  ConnectorProgressStage,
  ConnectorProgressWait,
  ConnectorNormalizationInput,
  ConnectorNormalizationRuntime,
  ConnectorProviderUrlResolverRuntime,
  ConnectorRuntime,
} from "./runtime-ports.js"

export {
  sanitizeConnectorRefreshStats,
  type ConnectorCheckpointPayload,
  type ConnectorCoverageWindow,
  type ConnectorRefreshResult,
  type ConnectorRefreshStats,
  type ConnectorRefreshStatus,
} from "./refresh-result.js"

export type {
  ConnectorAuthValidationInput,
  ConnectorAuthValidationResult,
  ConnectorCapabilityDeclaration,
  ConnectorCheckpointDeclaration,
  ConnectorDefinition,
  ConnectorObservationDeclaration,
  ConnectorRefreshInput,
  ConnectorRefreshMode,
  ConnectorSchemaDeclaration,
  ConnectorOption,
  ConnectorOptionQueryInput,
  ConnectorOptionQueryResult,
  ConnectorProviderFieldResolver,
  ConnectorProviderFieldResolverInput,
  ConnectorProviderUrlResolver,
  ConnectorProviderUrlResolverEvidence,
  ConnectorProviderUrlResolverInput,
  ConnectorProviderUrlResolverResult,
  JobConnector,
} from "./connector-definition.js"
