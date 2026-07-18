import { jobObservationSchemaVersion } from '@sparxie/valedictorian-connectors-core'
import type { LocalConnectorRegistry } from '../modules/connectors/connector.registry'
import { createPgliteConnectorRepository } from '../modules/connectors/connector.repository'
import type { createConnectorRunner } from '../modules/connectors/connector.runner'
import { connectorCheckpointSignature } from '../modules/connectors/connector.checkpoint-signature'
import {
  JOBRIGHT_AUTHENTICATED_DESTINATION_RESOLVER_ID,
  JOBRIGHT_AUTHENTICATED_DESTINATION_RESOLVER_VERSION,
  JOBRIGHT_CHECKPOINT_SCHEMA_V5,
  JOBRIGHT_CONNECTOR_ID,
  JOBRIGHT_CONNECTOR_VERSION,
} from '../modules/connectors/jobright.constants'
import { createNormalizationOrchestrator } from '../modules/sourcing/normalization.orchestrator'
import {
  createNormalizationResolverRegistry,
  type NormalizationResolverRegistry,
} from '../modules/sourcing/normalization.registry'
import { createPgliteNormalizationRepository } from '../modules/sourcing/normalization.repository'
import type { ConnectorRunRecord } from '../modules/connectors/connector.repository'

const JOBRIGHT_PUBLIC_SOURCE_PREFIX = 'jobright.public:'
const JOBRIGHT_API_PARSER_VERSION = 'jobright-api@2'

export async function dispatchAcquiredNormalizationWork({
  acquiredWork,
  connector,
  connectorRepository,
  connectorRunner,
  instanceId,
  normalizationOrchestrator,
  normalizationRegistry,
  normalizationRepository,
  now,
  runRequest,
  startedAt,
  coverageEndedAt,
}: {
  acquiredWork: Extract<NonNullable<Awaited<ReturnType<ReturnType<typeof createPgliteConnectorRepository>['recordRunRequest']>>['acquiredWork']>, { kind: 'normalization' }>
  connector: NonNullable<ReturnType<LocalConnectorRegistry['get']>>
  connectorRepository: ReturnType<typeof createPgliteConnectorRepository>
  connectorRunner: ReturnType<typeof createConnectorRunner>
  instanceId: string
  normalizationOrchestrator: ReturnType<typeof createNormalizationOrchestrator>
  normalizationRegistry: NormalizationResolverRegistry
  normalizationRepository: ReturnType<typeof createPgliteNormalizationRepository>
  now: () => Date
  runRequest: ConnectorRunRecord
  startedAt: string
  coverageEndedAt?: string | null
}): Promise<ConnectorRunRecord> {
  const isJobrightAuthenticatedDestination = acquiredWork.resolverId === JOBRIGHT_AUTHENTICATED_DESTINATION_RESOLVER_ID
    && acquiredWork.resolverVersion === JOBRIGHT_AUTHENTICATED_DESTINATION_RESOLVER_VERSION
    && connector.definition.id === JOBRIGHT_CONNECTOR_ID

  if (isJobrightAuthenticatedDestination) {
    return dispatchJobrightAuthenticatedDestinationRetry({
      acquiredWork,
      connector,
      connectorRepository,
      connectorRunner,
      instanceId,
      now,
      runRequest,
      startedAt,
      coverageEndedAt,
      normalizationRepository,
    })
  }

  const resolver = normalizationRegistry.resolvers.find(({ declaration }) =>
    declaration.id === acquiredWork.resolverId
    && declaration.version === acquiredWork.resolverVersion)

  if (!resolver) {
    await connectorRepository.markRunFailed({
      connectorRunId: runRequest.id,
      completedAt: now().toISOString(),
      retryHints: null,
      warning: {
        code: 'connector.normalization_owner_unavailable',
        message: `Trusted normalization owner unavailable: ${acquiredWork.resolverId}@${acquiredWork.resolverVersion}`,
      },
    })
    throw new Error(
      `Trusted normalization owner unavailable: ${acquiredWork.resolverId}@${acquiredWork.resolverVersion}`,
    )
  }

  try {
    const raw = await normalizationRepository.getRawContext(acquiredWork.rawRevisionId)
    if (!raw) {
      throw new NormalizationDispatchFailure(
        'connector.normalization_revision_missing',
        `Raw revision missing for normalization retry: ${acquiredWork.rawRevisionId}`,
      )
    }

    const latest = await normalizationRepository.getLatestForRevision(raw.revision.id)
    const resolverFields = new Set(resolver.declaration.outputFields)
    const baselineOutcomes = latest?.fieldOutcomes.filter(({ field }) => !resolverFields.has(field)) ?? []

    // Direct resolver replay does not rediscover or recapture the job. Use
    // truthful no-capture lineage (null trigger occurrence) and complete the
    // acquired retry row by its exact persisted identity.
    await normalizationOrchestrator.normalize(
      raw.revision.rawRecordId,
      acquiredWork.rawRevisionId,
      {
        kind: 'replay',
        replayId: `retry-work:${acquiredWork.retryWorkId}:${runRequest.id}`,
        fieldDirectives: [],
        targetResolverVersions: [{ resolverId: acquiredWork.resolverId, version: acquiredWork.resolverVersion }],
      },
      {
        acquiredRetryWork: {
          retryWorkId: acquiredWork.retryWorkId,
          acquisitionRunId: runRequest.id,
          executionScopeId: acquiredWork.executionScopeId,
        },
        baselineOutcomes,
        cache: false,
        enabledCapabilities: resolver.declaration.capabilities,
        registry: createNormalizationResolverRegistry([resolver]),
      },
    )

    return await connectorRepository.completeRun({
      completedAt: now().toISOString(),
      connectorRunId: runRequest.id,
      status: 'completed',
    })
  } catch (error) {
    const failure = error instanceof NormalizationDispatchFailure
      ? error
      : new NormalizationDispatchFailure(
          'connector.normalization_replay_failed',
          'Normalization retry replay failed.',
        )
    await connectorRepository.markRunFailed({
      connectorRunId: runRequest.id,
      completedAt: now().toISOString(),
      retryHints: null,
      warning: { code: failure.code, message: failure.message },
    })
    throw error
  }
}

class NormalizationDispatchFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

async function dispatchJobrightAuthenticatedDestinationRetry(input: {
  acquiredWork: Extract<NonNullable<Awaited<ReturnType<ReturnType<typeof createPgliteConnectorRepository>['recordRunRequest']>>['acquiredWork']>, { kind: 'normalization' }>
  connector: NonNullable<ReturnType<LocalConnectorRegistry['get']>>
  connectorRepository: ReturnType<typeof createPgliteConnectorRepository>
  connectorRunner: ReturnType<typeof createConnectorRunner>
  instanceId: string
  normalizationRepository: ReturnType<typeof createPgliteNormalizationRepository>
  now: () => Date
  runRequest: ConnectorRunRecord
  startedAt: string
  coverageEndedAt?: string | null
}): Promise<ConnectorRunRecord> {
  const {
    acquiredWork,
    connector,
    connectorRepository,
    connectorRunner,
    instanceId,
    normalizationRepository,
    now,
    runRequest,
    startedAt,
    coverageEndedAt,
  } = input

  try {
  const raw = await normalizationRepository.getRawContext(acquiredWork.rawRevisionId)
  if (!raw?.revision.providerRecordId) {
    throw new NormalizationDispatchFailure(
      'connector.normalization_revision_missing',
      `Raw revision missing provider identity for normalization retry: ${acquiredWork.rawRevisionId}`,
    )
  }

  const instance = await connectorRepository.getInstance(instanceId)
  if (!instance) {
    throw new Error(`Connector instance not found: ${instanceId}`)
  }
  const filters = instance.filters && typeof instance.filters === 'object' && !Array.isArray(instance.filters)
    ? instance.filters as Record<string, unknown>
    : {}
  const filterSignature = connectorCheckpointSignature({
    connectorId: connector.definition.id,
    connectorVersion: connector.definition.version,
    supportsFiltering: connector.definition.capabilities?.supportsFiltering,
    filters,
  })
  const storedCheckpoint = await connectorRepository.getCheckpoint({
    connectorInstanceId: instanceId,
    filterSignature,
  })
  if (!storedCheckpoint || storedCheckpoint.schemaVersion !== JOBRIGHT_CHECKPOINT_SCHEMA_V5) {
    throw new NormalizationDispatchFailure(
      'connector.jobright_checkpoint_missing',
      'Jobright v5 checkpoint is required for authenticated-destination retry dispatch.',
    )
  }

  const providerRecordId = raw.revision.providerRecordId
  if (
    !acquiredWork.resolverId
    || !acquiredWork.resolverVersion
    || !acquiredWork.inputHash
    || acquiredWork.resolverId !== JOBRIGHT_AUTHENTICATED_DESTINATION_RESOLVER_ID
    || acquiredWork.resolverVersion !== JOBRIGHT_AUTHENTICATED_DESTINATION_RESOLVER_VERSION
  ) {
    throw new NormalizationDispatchFailure(
      'connector.normalization_retry_identity_invalid',
      'Acquired Jobright normalization retry identity is incomplete or mismatched.',
    )
  }

  const exactIdentity = {
    retryWorkId: acquiredWork.retryWorkId,
    acquisitionRunId: runRequest.id,
    rawRevisionId: acquiredWork.rawRevisionId,
    resolverId: acquiredWork.resolverId,
    resolverVersion: acquiredWork.resolverVersion,
    inputHash: acquiredWork.inputHash,
    executionScopeId: acquiredWork.executionScopeId,
  }

    const exactSuccessAlreadyPersisted = await normalizationRepository.hasExactSuccessfulNormalizationAttempt({
      rawRevisionId: exactIdentity.rawRevisionId,
      resolverId: exactIdentity.resolverId,
      resolverVersion: exactIdentity.resolverVersion,
      inputHash: exactIdentity.inputHash,
      retryWindowStartedAt: acquiredWork.lastAttemptAt,
    })
    if (exactSuccessAlreadyPersisted) {
      const completedAt = now().toISOString()
      const restoredCheckpoint = {
        schemaVersion: storedCheckpoint.schemaVersion,
        checkpoint: removeJobrightProviderFromPendingRetries(
          storedCheckpoint.checkpoint,
          providerRecordId,
        ),
      }
      return await connectorRepository.finalizeExactAcquiredNormalizationRetry({
        acquiredRetryWork: exactIdentity,
        checkpoint: restoredCheckpoint,
        completedAt,
        connectorInstanceId: instanceId,
        connectorRunId: runRequest.id,
        coverage: {
          start: storedCheckpoint.coverageStartedAt ?? startedAt,
          end: coverageEndedAt ?? storedCheckpoint.coverageEndedAt ?? startedAt,
        },
        filterSignature,
        finalizationMode: 'require-persisted-exact-success',
        savedAt: completedAt,
        terminalStatus: 'completed',
      })
    }

    const narrowedCheckpoint = narrowJobrightV5CheckpointToProvider(
      storedCheckpoint.checkpoint,
      providerRecordId,
    )
    const seededObservation = jobrightRetrySeedObservation({
      checkpoint: storedCheckpoint.checkpoint,
      observedAt: startedAt,
      providerRecordId,
      rawRevision: {
        id: raw.revision.id,
        rawRecordId: raw.revision.rawRecordId,
        revision: raw.revision.revision,
        contentHash: raw.revision.contentHash,
        reused: true,
        createdAt: raw.revision.createdAt,
      },
      payload: raw.revision.payload,
    })

    const refreshRecord = await connectorRunner.catchUpWithDeferredCheckpoint(connector, {
      connectorRunId: runRequest.id,
      connectorInstanceId: instanceId,
      now: coverageEndedAt ?? startedAt,
      startedAt,
      checkpointOverride: narrowedCheckpoint,
      observations: [seededObservation],
      restoreUnacquiredJobrightRetryEntries: {
        acquiredProviderRecordId: providerRecordId,
        originalCheckpoint: storedCheckpoint.checkpoint,
      },
      acquiredNormalizationReplay: exactIdentity,
    })

    const completedAt = now().toISOString()
    return await connectorRepository.finalizeExactAcquiredNormalizationRetry({
      acquiredRetryWork: exactIdentity,
      checkpoint: refreshRecord.checkpoint.checkpoint,
      completedAt,
      connectorInstanceId: instanceId,
      connectorRunId: runRequest.id,
      coverage: refreshRecord.checkpoint.coverage,
      filterSignature: refreshRecord.checkpoint.filterSignature,
      finalizationMode: 'complete-only-on-persisted-exact-success',
      savedAt: completedAt,
      terminalStatus: refreshRecord.terminalStatus,
    })
  } catch (error) {
    const completedAt = now().toISOString()
    const failure = error instanceof NormalizationDispatchFailure
      ? error
      : new NormalizationDispatchFailure(
          'connector.execution_failed',
          'Connector execution failed.',
        )
    try {
      await connectorRepository.markRunFailed({
        connectorRunId: runRequest.id,
        completedAt,
        retryHints: null,
        warning: {
          code: failure.code,
          message: failure.message,
        },
      })
    } catch {
      await connectorRepository.releaseAcquiredNormalizationWorkForRun({
        connectorRunId: runRequest.id,
        completedAt,
      })
    }
    throw error
  }
}

function removeJobrightProviderFromPendingRetries(
  checkpoint: unknown,
  providerRecordId: string,
): unknown {
  const record = readJobrightV5Checkpoint(checkpoint)
  const pendingDetailRetries = readPendingDetailRetries(record)
  const sourceId = `${JOBRIGHT_PUBLIC_SOURCE_PREFIX}${providerRecordId}`
  const nextPending = pendingDetailRetries.filter((entry) => entry.sourceId !== sourceId)
  return {
    ...record,
    pendingDetailRetries: nextPending,
    retryState: activeRetryStateFromPending(nextPending),
  }
}

function narrowJobrightV5CheckpointToProvider(
  checkpoint: unknown,
  providerRecordId: string,
): unknown {
  const record = readJobrightV5Checkpoint(checkpoint)
  const pendingDetailRetries = readPendingDetailRetries(record)
  const sourceId = `${JOBRIGHT_PUBLIC_SOURCE_PREFIX}${providerRecordId}`
  const narrowedPending = pendingDetailRetries.filter((entry) => entry.sourceId === sourceId)
  if (narrowedPending.length !== 1) {
    throw new Error(`Jobright v5 checkpoint is missing acquired pending retry for ${sourceId}`)
  }
  const entry = narrowedPending[0]!
  if (entry.ownership !== 'active') {
    throw new Error(`Jobright v5 pending retry for ${sourceId} is not active`)
  }
  if (entry.generationId !== record.generationId) {
    throw new Error(`Jobright v5 pending retry generation mismatch for ${sourceId}`)
  }
  return {
    ...record,
    pendingDetailRetries: narrowedPending,
    retryState: activeRetryStateFromPending(narrowedPending),
  }
}

function jobrightRetrySeedObservation(input: {
  checkpoint: unknown
  observedAt: string
  providerRecordId: string
  rawRevision: {
    id: string
    rawRecordId: string
    revision: number
    contentHash: string
    reused: boolean
    createdAt: string
  }
  payload: unknown
}) {
  const record = readJobrightV5Checkpoint(input.checkpoint)
  const cycleId = record.cycleId
  if (typeof cycleId !== 'string' || cycleId.length === 0) {
    throw new Error('Jobright v5 checkpoint cycle identity is malformed')
  }
  const sourceRecordKey = `${JOBRIGHT_PUBLIC_SOURCE_PREFIX}${input.providerRecordId}`
  const jobrightUrl = `https://jobright.ai/jobs/info/${input.providerRecordId}`
  const payload = input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)
    ? input.payload as Record<string, unknown>
    : {}
  const companyName = typeof payload.companyName === 'string' ? payload.companyName : ''
  const roleTitle = typeof payload.roleTitle === 'string'
    ? payload.roleTitle
    : typeof payload.jobTitle === 'string'
      ? payload.jobTitle
      : ''
  const locationRaw = typeof payload.locationRaw === 'string'
    ? payload.locationRaw
    : typeof payload.location === 'string'
      ? payload.location
      : null
  const descriptionText = typeof payload.descriptionText === 'string'
    ? payload.descriptionText
    : typeof payload.description === 'string'
      ? payload.description
      : null
  return {
    connectorId: JOBRIGHT_CONNECTOR_ID,
    connectorVersion: JOBRIGHT_CONNECTOR_VERSION,
    parserVersion: JOBRIGHT_API_PARSER_VERSION,
    observationSchemaVersion: jobObservationSchemaVersion,
    sourceRecordKey,
    observedAt: input.observedAt,
    companyName,
    roleTitle,
    locationRaw,
    descriptionText,
    pay: null,
    links: {
      source: jobrightUrl,
      intermediary: jobrightUrl,
      official: null,
    },
    resolution: {
      status: 'unresolved' as const,
      method: 'jobright_visitor_list',
      reason: 'jobright_resolution_deferred',
    },
    dedupeKeys: [
      `jobright:${input.providerRecordId}`,
      `source-record:${sourceRecordKey}`,
      `source:${jobrightUrl}`,
    ],
    sourceMetadata: {
      jobrightCycleId: cycleId,
      jobrightId: input.providerRecordId,
      source: 'jobright',
      rawRevision: input.rawRevision,
    },
    evidence: [
      {
        type: 'jobright_visitor_list_record',
        capturedAt: input.observedAt,
        sourceUrl: 'https://jobright.ai/swan/recommend/visitor-list/jobs',
      },
    ],
  }
}

function readJobrightV5Checkpoint(checkpoint: unknown): Record<string, unknown> {
  if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) {
    throw new Error('Jobright v5 checkpoint is malformed')
  }
  return checkpoint as Record<string, unknown>
}

function readPendingDetailRetries(checkpoint: Record<string, unknown>): Array<Record<string, unknown>> {
  if (!Array.isArray(checkpoint.pendingDetailRetries)) {
    throw new Error('Jobright v5 checkpoint pending retry ledger is malformed')
  }
  return checkpoint.pendingDetailRetries.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('Jobright v5 checkpoint pending retry entry is malformed')
    }
    const pending = entry as Record<string, unknown>
    if (typeof pending.sourceId !== 'string') {
      throw new Error('Jobright v5 checkpoint pending retry entry is malformed')
    }
    if (pending.ownership !== 'active' && pending.ownership !== 'suspended') {
      throw new Error('Jobright v5 checkpoint pending retry ownership is malformed')
    }
    return pending
  })
}

function activeRetryStateFromPending(
  pendingDetailRetries: Array<Record<string, unknown>>,
): Array<{ sourceId: unknown; advice: unknown }> {
  return pendingDetailRetries
    .filter((entry) => entry.ownership === 'active')
    .map((entry) => ({
      sourceId: entry.sourceId,
      advice: entry.advice,
    }))
}

export async function finalizeDeferredConnectorRefreshRecord({
  checkpoint,
  connectorRepository,
  now,
  run,
  terminalStatus,
}: {
  checkpoint: Parameters<ReturnType<typeof createPgliteConnectorRepository>['recordCheckpoint']>[0]
  connectorRepository: ReturnType<typeof createPgliteConnectorRepository>
  now: () => Date
  run: ConnectorRunRecord
  terminalStatus: Parameters<ReturnType<typeof createPgliteConnectorRepository>['completeRun']>[0]['status']
}): Promise<ConnectorRunRecord> {
  let projectedRun = run
  try {
    projectedRun = await connectorRepository.updateRunProgress({
      connectorRunId: run.id,
      stats: {
        stage: 'finalizing',
        lastProgressAt: now().toISOString(),
      },
    })
    await connectorRepository.recordCheckpoint(checkpoint)
    projectedRun = await connectorRepository.completeRun({
      completedAt: now().toISOString(),
      connectorRunId: run.id,
      status: terminalStatus,
    })
  } catch (error) {
    await connectorRepository.markRunFailed({
      connectorRunId: run.id,
      completedAt: now().toISOString(),
      retryHints: null,
      warning: {
        code: 'connector.sourcing_projection_failed',
        message: 'Canonical sourcing projection failed.',
      },
    })
    throw error
  }
  return projectedRun
}
