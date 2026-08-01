import type { CreateCaptureInput } from "./capture-contract.js"
import type { SourceExecutionScopeId } from "./source-execution.js"

/**
 * Connector-owned Capture intake ABI.
 *
 * `connector API` 0.29.0 publishes the first-class `createCaptureInputSchema` /
 * `CreateCaptureInput` contract but intentionally exposes no raw transport
 * receipt type from its package root. Core therefore owns the connector-facing
 * Capture input/runtime/receipt/revision shapes. A connector supplies provider
 * record content; the host binds the trusted adapter into a strict
 * `CreateCaptureInput`, validates it with the connector API schema, and records
 * it inside an envelope whose adjacent provenance carries host-bound connector
 * lineage and reported origin. The envelope wraps one accepted Capture input;
 * it is not a second Capture schema.
 */
export type ConnectorCaptureEvidence = CreateCaptureInput["evidence"][number]

export const connectorReportedOriginKinds = [
  "employer",
  "ats",
  "job_board",
  "aggregator",
  "referral",
  "other",
] as const
export type ConnectorReportedOriginKind =
  (typeof connectorReportedOriginKinds)[number]

/** Reported provenance of a captured provider record. */
export type ConnectorReportedOrigin = {
  kind: ConnectorReportedOriginKind
  name: string
  providerId?: string | null
  url?: string | null
}
/**
 * Provider record content supplied by a connector for Capture intake.
 *
 * Derived from the published `CreateCaptureInput` minus the host-bound
 * `adapter`, with `observedAt` required and reported origin kept adjacent. The
 * host binds `adapter` from the registered connector definition and validates
 * the completed `CreateCaptureInput` before persistence. `reportedOrigin` is
 * connector provenance preserved adjacent to the accepted payload; it is not
 * part of the strict Sparxie `CreateCaptureInput`.
 */
export type ConnectorCaptureInput =
  & Partial<Omit<CreateCaptureInput, "adapter" | "observedAt">>
  & Pick<CreateCaptureInput, "observedAt">
  & { reportedOrigin?: ConnectorReportedOrigin | null }

/** Host-bound connector lineage attached to a captured record. */
export type ConnectorCaptureReference = {
  connectorInstanceId: string
  connectorRunId: string
  executionScopeId: SourceExecutionScopeId
}

/** Host-bound adapter provenance for a connector capture. */
export type ConnectorCaptureAdapter =
  & CreateCaptureInput["adapter"]
  & { kind: "connector" }

/**
 * Adjacent host-bound provenance recorded alongside the accepted Capture
 * input: connector instance/run/execution scope and reported origin.
 */
export type ConnectorCaptureProvenance = {
  connectorInstanceId: string
  connectorRunId: string
  executionScopeId: SourceExecutionScopeId
  reportedOrigin: ConnectorReportedOrigin | null
}

/**
 * The durable host envelope for one accepted Capture: the nested payload is
 * exactly the first-class `CreateCaptureInput` (directly parseable by
 * `createCaptureInputSchema`), with host-bound provenance and the per-batch
 * item acknowledgement kept adjacent.
 */
export type ConnectorCaptureEnvelope = {
  input: CreateCaptureInput
  provenance: ConnectorCaptureProvenance
  captureItemId: string
}

export type ConnectorCaptureRevision = {
  readonly id: string
  readonly captureId: string
  readonly revision: number
  readonly contentHash: string
  readonly reused: boolean
  readonly createdAt: string
}

export type ConnectorCaptureOccurrence = {
  readonly id: string
  readonly captureId: string
  readonly captureRevisionId: string
  readonly capture?: ConnectorCaptureReference | null
  readonly observedAt: string
  readonly receivedAt: string
}

export type ConnectorCaptureReceipt = {
  readonly captureItemId: string
  readonly captureId: string
  readonly sourceEntityId: string | null
  readonly revision: ConnectorCaptureRevision
  readonly occurrence: ConnectorCaptureOccurrence
}

export type ConnectorCaptureIntakeRuntime = {
  /**
   * Persists a provider record with host-bound connector instance/run lineage.
   * Connectors must acknowledge every safely representable row in a bounded
   * provider batch before invoking normalization or detail resolution for any
   * row in that batch.
   */
  capture(input: ConnectorCaptureInput): Promise<ConnectorCaptureReceipt>
}
