import { createHash } from "node:crypto"

import type {
  ConnectorAuthGrant,
  ConnectorAuthEstablishmentResult,
  ConnectorAuthReference,
  ConnectorAuthRequirement,
  ConnectorAuthResolveInput,
  ConnectorCaptureEnvelope,
  ConnectorCaptureInput,
  ConnectorCaptureReceipt,
  ConnectorCaptureRevision,
  ConnectorRuntime,
  CreateCaptureInput,
  JobConnector,
} from "@sparxie/valedictorian-connectors-core"
import { createCaptureInputSchema } from "@sparxie/sdk"
import { cloneJsonLike, stableJsonStringify } from "./stable-json.js"
import type {
  InMemoryCaptureRecord,
  InMemoryConnectorHostOptions,
  InMemoryNormalizationRecord,
} from "./host-contract.js"

export type RuntimeCaptureContext = {
  connector: JobConnector
  connectorInstanceId: string
  connectorRunId: string
  workspaceId: string
  normalizations: InMemoryNormalizationRecord[]
  captures: InMemoryCaptureRecord[]
  captureIdsByIdentity: Map<string, string>
  captureRevisionsByContent: Map<string, ConnectorCaptureRevision>
  revisionCountsByCapture: Map<string, number>
  nextCaptureRecordSequence: () => number
  nextCaptureRevisionSequence: () => number
  nextCaptureOccurrenceSequence: () => number
}

export function createConnectorRuntime(
  authReferences: ConnectorAuthReference[],
  authRequirements: ConnectorAuthRequirement[],
  options: InMemoryConnectorHostOptions,
  authRefreshFlights: Map<
    string,
    Promise<ConnectorAuthEstablishmentResult>
  >,
  signal?: AbortSignal,
  captureContext?: RuntimeCaptureContext,
): ConnectorRuntime {
  let resolvedSessionGeneration: number | undefined
  const runtime: ConnectorRuntime = {
    auth: {
      async resolve(input) {
        const grant = resolveAuthGrant(
          input,
          authReferences,
          authRequirements,
          options,
        )
        const persistedSession = captureContext
          ? options.authSessions?.[`connector.${captureContext.connectorInstanceId}`]
          : undefined
        if (persistedSession) {
          resolvedSessionGeneration = persistedSession.generation
        }
        return grant.status === "ready" &&
          grant.mode === "username_password" &&
          captureContext
          ? {
              ...grant,
              sessionId:
                persistedSession?.sessionId ??
                `connector.${captureContext.connectorInstanceId}`,
            }
          : grant
      },
      async refresh(input, establish) {
        const existingFlight = authRefreshFlights.get(input.executionScopeId)
        if (existingFlight) return await existingFlight

        const currentSession = options.authSessions?.[input.executionScopeId]
        if (
          currentSession &&
          resolvedSessionGeneration !== undefined &&
          currentSession.generation > resolvedSessionGeneration
        ) {
          return {
            status: "ready",
            sessionId: currentSession.sessionId,
            ...(currentSession.expiresAt === undefined
              ? {}
              : { expiresAt: currentSession.expiresAt }),
          }
        }
        const observedGeneration =
          options.authSessions?.[input.executionScopeId]?.generation ?? 0
        const flight = (async (): Promise<ConnectorAuthEstablishmentResult> => {
          const established = await establish()
          const canonical = options.authSessions?.[input.executionScopeId]
          if (canonical && canonical.generation > observedGeneration) {
            return {
              status: "ready",
              sessionId: canonical.sessionId,
              ...(canonical.expiresAt === undefined
                ? {}
                : { expiresAt: canonical.expiresAt }),
            }
          }
          if (established.status !== "ready") return established
          const persisted = {
            generation: observedGeneration + 1,
            sessionId: established.sessionId,
            ...(established.expiresAt === undefined
              ? {}
              : { expiresAt: established.expiresAt }),
          }
          options.authSessions ??= {}
          options.authSessions[input.executionScopeId] = persisted
          return established
        })()
        authRefreshFlights.set(input.executionScopeId, flight)
        try {
          return await flight
        } finally {
          if (authRefreshFlights.get(input.executionScopeId) === flight) {
            authRefreshFlights.delete(input.executionScopeId)
          }
        }
      },
    },
  }

  if (captureContext) {
    runtime.captureIntake = {
      async capture(input: ConnectorCaptureInput) {
        const receivedAt = new Date().toISOString()
        const captureItemId = `${captureContext.connectorRunId}:item:${captureContext.captures.length + 1}`
        const captureInput: CreateCaptureInput = {
          evidenceMode: input.evidenceMode ?? "reported",
          adapter: {
            id: captureContext.connector.definition.id,
            kind: "connector",
            version: captureContext.connector.definition.version,
          },
          observedAt: input.observedAt,
          providerRecordId: input.providerRecordId ?? null,
          providerSchema: input.providerSchema ?? null,
          payload: cloneJsonLike(input.payload ?? null),
          evidence: cloneJsonLike(input.evidence ?? []),
        }
        // Validate the exact accepted Capture input before any persistence hook
        // or host-state append so an invalid payload fails closed and leaves no
        // persisted capture.
        const acceptedInput = createCaptureInputSchema.parse(captureInput)
        const envelope: ConnectorCaptureEnvelope = {
          input: acceptedInput,
          provenance: {
            connectorInstanceId: captureContext.connectorInstanceId,
            connectorRunId: captureContext.connectorRunId,
            executionScopeId: `connector.${captureContext.connectorInstanceId}`,
            reportedOrigin: cloneJsonLike(input.reportedOrigin ?? null),
          },
          captureItemId,
        }
        await options.onCapture?.(cloneJsonLike(envelope))
        const identity = captureStrongIdentity(
          captureContext.workspaceId,
          envelope,
        )
        let captureId = identity
          ? captureContext.captureIdsByIdentity.get(identity)
          : undefined
        if (!captureId) {
          captureId = `capture_${captureContext.nextCaptureRecordSequence()}`
          if (identity) {
            captureContext.captureIdsByIdentity.set(identity, captureId)
          }
        }
        const contentHash = captureContentHash(envelope)
        const revisionKey = `${captureId}:${contentHash}`
        const existingRevision =
          captureContext.captureRevisionsByContent.get(revisionKey)
        const revisionNumber =
          captureContext.revisionCountsByCapture.get(captureId) ?? 0
        const revision: ConnectorCaptureRevision = existingRevision
          ? { ...existingRevision, reused: true }
          : {
              id: `capture_revision_${captureContext.nextCaptureRevisionSequence()}`,
              captureId,
              revision: revisionNumber + 1,
              contentHash,
              reused: false,
              createdAt: receivedAt,
            }
        if (!existingRevision) {
          captureContext.captureRevisionsByContent.set(revisionKey, revision)
          captureContext.revisionCountsByCapture.set(
            captureId,
            revision.revision,
          )
        }
        const occurrenceSequence = captureContext.nextCaptureOccurrenceSequence()
        const receipt: ConnectorCaptureReceipt = {
          captureItemId,
          captureId,
          sourceEntityId: null,
          revision,
          occurrence: {
            id: `capture_occurrence_${occurrenceSequence}`,
            captureId,
            captureRevisionId: revision.id,
            capture: {
              connectorInstanceId: envelope.provenance.connectorInstanceId,
              connectorRunId: envelope.provenance.connectorRunId,
              executionScopeId: envelope.provenance.executionScopeId,
            },
            observedAt: input.observedAt,
            receivedAt,
          },
        }
        captureContext.captures.push({
          ...cloneJsonLike(envelope),
          receipt: cloneJsonLike(receipt),
        })
        return cloneJsonLike(receipt)
      },
    }
    runtime.normalization = {
      async run(input) {
        const outcomes = await input.resolve()
        captureContext.normalizations.push({
          captureRevisionId: input.captureRevision.id,
          resolver: cloneJsonLike(input.resolver),
          outcomes: cloneJsonLike(outcomes),
        })
        return cloneJsonLike(outcomes)
      },
    }
  }

  if (signal) {
    runtime.cancellation = { signal }
  }

  if (options.delay) {
    runtime.delay = {
      async wait(input) {
        return await options.delay!(input)
      },
    }
  }

  if (options.progress) {
    runtime.progress = {
      report(snapshot) {
        return options.progress!(cloneJsonLike(snapshot))
      },
    }
  }

  return runtime
}

function resolveAuthGrant(
  input: ConnectorAuthResolveInput,
  authReferences: ConnectorAuthReference[],
  authRequirements: ConnectorAuthRequirement[],
  options: InMemoryConnectorHostOptions,
): ConnectorAuthGrant {
  const reference = authReferences.find(
    (authReference) =>
      authReference.id === input.id &&
      (input.mode === undefined || authReference.mode === input.mode),
  )
  const requirement = authRequirements.find(
    (authRequirement) =>
      authRequirement.id === input.id &&
      (input.mode === undefined || authRequirement.mode === input.mode),
  )
  const mode = input.mode ?? reference?.mode ?? requirement?.mode

  if (mode === "none") {
    return {
      id: input.id,
      mode,
      status: "ready",
    }
  }

  if (!reference) {
    return {
      id: input.id,
      mode: mode ?? "none",
      reason: "auth_reference_missing",
      status: "missing",
    }
  }
  return resolveSecretGrant(reference, options)
}

function resolveSecretGrant(
  reference: ConnectorAuthReference,
  options: InMemoryConnectorHostOptions,
): ConnectorAuthGrant {
  if (!reference.secretKey) {
    return {
      id: reference.id,
      mode: reference.mode,
      reason: "secret_reference_missing",
      status: "missing",
    }
  }

  const value = options.secrets?.[reference.secretKey]

  if (value === undefined) {
    return {
      id: reference.id,
      mode: reference.mode,
      reason: "secret_missing",
      secretKey: reference.secretKey,
      status: "missing",
    }
  }

  return {
    id: reference.id,
    mode: reference.mode,
    secretKey: reference.secretKey,
    status: "ready",
    value,
  }
}

function captureStrongIdentity(
  workspaceId: string,
  envelope: ConnectorCaptureEnvelope,
): string | null {
  const providerRecordId = envelope.input.providerRecordId?.trim()
  if (envelope.input.adapter.kind !== "connector" || !providerRecordId) {
    return null
  }
  return stableJsonStringify([
    workspaceId,
    envelope.input.adapter.id,
    envelope.input.providerSchema ?? null,
    providerRecordId,
  ])
}

function captureContentHash(envelope: ConnectorCaptureEnvelope): string {
  const canonicalContent = stableJsonStringify({
    adapter: envelope.input.adapter,
    evidence: envelope.input.evidence ?? [],
    payload: envelope.input.payload ?? null,
    providerRecordId: envelope.input.providerRecordId ?? null,
    providerSchema: envelope.input.providerSchema ?? null,
    reportedOrigin: envelope.provenance.reportedOrigin ?? null,
  })
  return `sha256:${createHash("sha256").update(canonicalContent).digest("hex")}`
}
