import path from 'node:path'
import type {
  ConnectorAuthReferenceInput,
} from 'sparxie'
import {
  connectorOverviewListQuerySchema,
  connectorOverviewListResultSchema,
  DEFAULT_CONNECTOR_OVERVIEW_LIST_LIMIT,
} from 'sparxie'
import { createApplicationServiceFromPglite } from '../modules/applications/application.runtime'
import { createPgliteActionQueueRepository } from '../modules/action-queue/action-queue.repository'
import { createSourceExecutionGovernor } from '../modules/source-execution/source-execution-governor'
import { createConnectorNormalizationHost } from '../modules/connectors/connector.normalization'
import {
  createDefaultLocalConnectorRegistry,
  type LocalConnectorRegistry
} from '../modules/connectors/connector.registry'
import { createPgliteConnectorRepository } from '../modules/connectors/connector.repository'
import { retireConnectorInstance } from '../modules/connectors/connector-retirement.persistence'
import {
  resolveConnectorSchedulingCapability,
} from '../modules/connectors/connector-schedule.capability'
import { createConnectorScheduleRepository } from '../modules/connectors/connector-schedule.repository'
import { createConnectorScheduleService } from '../modules/connectors/connector-schedule.service'
import { createConnectorScheduleWorkSource } from '../modules/connectors/connector-schedule.source'
import { createConnectorCaptureRetryWorkSource } from '../modules/connectors/connector-capture-retry.source'
import {
  inclusiveCoverageStartFromEarliestBackfillDate,
  maximumSelectableEarliestBackfillDate,
  validateSelectableEarliestBackfillDate,
} from '../modules/connectors/connector.earliest-backfill'
import { connectorCheckpointSignature } from '../modules/connectors/connector.checkpoint-signature'
import { reconcileConnectorPackageUpgrade } from './local-connector-upgrade-reconciliation'
import { connectorDisabledExecutionError } from '../modules/connectors/connector-execution.errors'
import {
  assertSupportedConnectorSettings,
  validateCompleteConnectorSettings,
} from '../modules/connectors/connector.settings-validation'
import {
  listInstalledConnectorDescriptors,
  projectInstalledConnectorDescriptor,
} from '../modules/connectors/connector.capabilities'
import { createConnectorOptionQueryService } from '../modules/connectors/connector.option-query'
import {
  createConnectorRunner,
  type AppConnectorAuthGrant,
  type AppConnectorAuthValidationResult,
} from '../modules/connectors/connector.runner'
import {
  mapConnectorStatusSummaries,
} from '../modules/connectors/connector.status'
import type {
  ConnectorAuthReference,
  ConnectorInstanceRecord,
  ConnectorRunRecord,
} from '../modules/connectors/connector.repository'
import { createPglitePolicyRepository } from '../modules/policy/policy.repository'
import { createJsonProfileService } from '../modules/profile/profile.composition'
import { createPgliteSecretService } from '../modules/secrets/secret.composition'
import { createWorkspaceSecretScope } from '../modules/secrets/secret.scope'
import type { SecretCodec } from '../modules/secrets/secret.codec'
import { isSecretCodecAvailable } from '../modules/secrets/secret.codec'
import { createLocalSecretResolutionService } from '../modules/secrets/local-secret-resolution'
import {
  composeTrustedConnectorAuth,
  createWorkspaceProfileMethods,
  createWorkspaceSecretMethods,
} from './local-profile-secret-client'
import { isReservedIdentitySecretKey } from '../modules/secrets/secret.identity'
import { createPgliteScoringRepository } from '../modules/scoring/scoring.repository'
import { createPgliteSourcingProcessor } from '../modules/sourcing/sourcing.processor'
import { createPgliteSourcingRepository } from '../modules/sourcing/sourcing.repository'
import { createCanonicalCandidateProjectionService } from '../modules/sourcing/canonical-candidate.projection'
import { createPgliteRawSourceRepository } from '../modules/sourcing/raw-source.repository'
import { createProviderUrlResolutionService } from '../modules/sourcing/provider-url-resolution.service'
import { createNormalizationOrchestrator } from '../modules/sourcing/normalization.orchestrator'
import {
  dispatchAcquiredNormalizationWork,
} from './local-connector-retry-dispatch'
import { executeClaimedConnectorRun } from './local-connector-claimed-execution'
import { mapConnectorRunSummary } from './local-connector-public-run'
import {
  mapConnectorAuthSummary,
  mapLocalConnectorStatusSummary,
} from './local-connector-status-mapping'
import { createNormalizationReplayService } from '../modules/sourcing/normalization-replay'
import { createPgliteNormalizationRepository } from '../modules/sourcing/normalization.repository'
import { createPgliteProjectionOutcomeRepository } from '../modules/sourcing/projection-outcome.repository'
import {
  createDefaultNormalizationResolverRegistry,
} from '../modules/sourcing/normalization.registry'
import { mapConnectorCheckpoint, mapConnectorObservation } from './local-connector-run-summary'
import { mapLocalConnectorOverviewRecord } from './local-connector-overview'
import {
  createConnectorOverviewCursor,
  readConnectorOverviewCursor,
} from './local-connector-overview.cursor'
import { createPgliteWorkflowRunRepository } from '../modules/workflow-runs/workflow-run.repository'
import { assertSeedOptions, seedLocalData } from './local-valedictorian-seeding'
export type {
  LocalValedictorianClientOptions,
  ValedictorianSeedDataMode,
} from './local-valedictorian-runtime-options'
export type {
  LocalConnectorAuthSummary,
  LocalConnectorInstanceSummary,
  LocalConnectorStatusSummary,
  LocalConnectorRunSummary,
  LocalConnectorObservationListInput,
  LocalConnectorInternalRunTriggerInput,
  LocalConnectorStatusActionInput,
  LocalConnectorSkipActionInput,
  LocalConnectorAuthGrantSummary,
  LocalConnectorReconnectActionResult,
  LocalConnectorSkipActionResult,
  LocalConnectorClient,
  LocalValedictorianClient,
} from './local-connector-client.contract'
import type {
  LocalValedictorianClientOptions,
} from './local-valedictorian-runtime-options'
import type {
  LocalConnectorInstanceSummary,
  LocalConnectorInternalRunTriggerInput,
  LocalConnectorRunSummary,
  LocalConnectorStatusActionInput,
  LocalConnectorReconnectActionResult,
  LocalValedictorianClient
} from './local-connector-client.contract'
const unavailableSecretCodec: SecretCodec = {
  decrypt() {
    throw new Error('Profile secrets are only available through local profile IPC')
  },
  encrypt() {
    throw new Error('Profile secrets are only available through local profile IPC')
  },
}
export async function createLocalValedictorianClient({
  database,
  connectorRunRecovery,
  connectorRegistry = createDefaultLocalConnectorRegistry(),
  connectorRuntime,
  connectorScheduling: connectorSchedulingOption,
  now = () => new Date(),
  normalizationRegistry = createDefaultNormalizationResolverRegistry(),
  onScheduledWorkChanged,
  projectCanonicalCandidate,
  registerScheduledWorkSource,
  referenceTrackerPath,
  seedDataMode = 'none',
  secretCodec = unavailableSecretCodec,
  localSecretResolutionEnabled = false,
  profilePath,
  profileService: preparedProfileService,
  secretService: preparedSecretService,
  pgliteDataPath,
  workspaceId = 'local-workspace',
}: LocalValedictorianClientOptions): Promise<LocalValedictorianClient> {
  assertSeedOptions({ referenceTrackerPath, seedDataMode })
  const connectorScheduling = resolveConnectorSchedulingCapability(connectorSchedulingOption)
  const applicationService = createApplicationServiceFromPglite(database)
  await seedLocalData(database, {
    referenceTrackerPath,
    seedDataMode,
  })
  const scoringRepository = createPgliteScoringRepository(database)
  const profileService = preparedProfileService
    ?? createJsonProfileService(profilePath ?? path.join(path.dirname(pgliteDataPath ?? '.'), 'profile.json'))
  const secretService = preparedSecretService ?? createPgliteSecretService(
    database,
    secretCodec,
    createWorkspaceSecretScope(workspaceId),
  )
  const localSecretResolution = createLocalSecretResolutionService({
    policy: {
      enabled: localSecretResolutionEnabled,
      isSecureStorageAvailable: () => isSecretCodecAvailable(secretCodec),
    },
    resolveSecret: (key) => isReservedIdentitySecretKey(key)
      ? Promise.resolve(null)
      : secretService.resolve(key),
  })
  const actionQueueRepository = createPgliteActionQueueRepository(database)
  const connectorRepository = createPgliteConnectorRepository(database)
  const recoverInterruptedRuns = async () => {
    await connectorRepository.recoverInterruptedRuns({
      completedAt: now().toISOString(),
    })
  }
  if (connectorRunRecovery) {
    if (!pgliteDataPath) {
      throw new Error('pgliteDataPath is required when connectorRunRecovery is provided')
    }
    await connectorRunRecovery.activate({ pgliteDataPath, workspaceId }, recoverInterruptedRuns)
  } else {
    await recoverInterruptedRuns()
  }
  const policyRepository = createPglitePolicyRepository(database)
  const workflowRunRepository = createPgliteWorkflowRunRepository(database)
  const sourcingProcessor = createPgliteSourcingProcessor(database)
  const sourcingRepository = createPgliteSourcingRepository(database)
  const rawSourceRepository = createPgliteRawSourceRepository(database, now)
  const canonicalCandidateProjection = createCanonicalCandidateProjectionService(now)
  const projectionOutcomes = createPgliteProjectionOutcomeRepository(database)
  const normalizationRepository = createPgliteNormalizationRepository(database, {
    stagePassedCandidate: (transaction, input) => projectionOutcomes.stagePending(transaction, input),
    projectPassedCandidate: async (candidateId, rawRevisionId) => {
      try {
        await database.transaction(async (transaction) => {
          const findingId = await (projectCanonicalCandidate ?? canonicalCandidateProjection.projectPersisted)(
            transaction, candidateId, rawRevisionId,
          )
          if (!findingId) throw new Error('Passed canonical candidate could not be projected')
          await projectionOutcomes.markProjected(transaction, candidateId, findingId, now().toISOString())
        })
      } catch {
        await projectionOutcomes.markFailed(candidateId, now().toISOString())
      }
    },
  })
  const normalizationOrchestrator = createNormalizationOrchestrator({
    repository: normalizationRepository,
    registry: normalizationRegistry,
    now,
  })
  const connectorNormalization = createConnectorNormalizationHost({
    repository: normalizationRepository,
    registry: normalizationRegistry,
    now,
  })
  const normalizationReplayService = createNormalizationReplayService({
    database,
    orchestrator: normalizationOrchestrator,
    registry: normalizationRegistry,
    now,
  })
  const trustedConnectorAuth = composeTrustedConnectorAuth(secretService)
  const connectorOptionQueries = createConnectorOptionQueryService({
    authHost: trustedConnectorAuth,
    connectorRegistry,
    connectorRepository,
    workspaceId,
  })
  const sourceExecutionGovernor = createSourceExecutionGovernor(database, secretCodec)
  const providerUrlResolution = await createProviderUrlResolutionService({
    authHost: trustedConnectorAuth, connectorRegistry, connectorRepository, connectorRuntime,
    database, governor: sourceExecutionGovernor, normalizationOrchestrator, normalizationRegistry, normalizationRepository, now,
    onScheduledWorkChanged, rawSourceRepository, workspaceId,
  }); registerScheduledWorkSource?.(providerUrlResolution.source)
  const connectorRunner = createConnectorRunner({
    auth: trustedConnectorAuth,
    normalization: connectorNormalization,
    rawSource: {
      async ingest(record) { return (await providerUrlResolution.ingestBatch({ records: [record] })).receipts[0] },
    },
    repository: connectorRepository,
    sourceExecutionGovernor,
    runtime: connectorRuntime,
    workspaceId,
    now,
  })
  const scheduleRepository = createConnectorScheduleRepository(database, now)
  const schedules = createConnectorScheduleService({
    claimQueuedRunToRunning: (input) => connectorRepository.claimQueuedRunToRunning(input),
    connectorScheduling,
    database,
    executeClaimedRun: (input) => executeClaimedConnectorRun({
      connectorRegistry,
      connectorRepository,
      connectorRunner,
      connectorRunId: input.connectorRunId,
      coverageEndedAt: input.coverageEndedAt,
      mode: input.mode,
      now,
      replayConnectorUpgrade: (input) => normalizationReplayService.replayConnectorUpgrade(input),
      ...(input.signal ? { signal: input.signal } : {}),
      startedAt: input.startedAt,
    }),
    getRun: (connectorRunId) => connectorRepository.getRun(connectorRunId),
    now,
    onScheduleChanged: onScheduledWorkChanged,
    repository: scheduleRepository,
  })
  registerScheduledWorkSource?.(createConnectorScheduleWorkSource({
    dispatchDue: (input, signal) => schedules.dispatchDueWithSignal(input, signal),
    listSchedules: () => scheduleRepository.listEnabled(),
    now,
  }))
  const mapRun = async (record: ConnectorRunRecord): Promise<LocalConnectorRunSummary> => {
    const synchronizedRecord = {
      ...record,
      synchronization: record.synchronization
        ?? await connectorRepository.getRunSynchronization(record.id),
    }
    const occurrence = await scheduleRepository.getOccurrenceLinkForRun(record.id)
    if (!occurrence || !occurrence.connectorRunId) {
      return mapConnectorRunSummary(synchronizedRecord)
    }
    return mapConnectorRunSummary(synchronizedRecord, {
      scheduleId: occurrence.scheduleId,
      scheduleRevision: occurrence.scheduleRevision,
      occurrenceId: occurrence.id,
      nominalAt: occurrence.nominalAt,
      admittedMode: occurrence.admittedMode,
      idempotencyKey: occurrence.idempotencyKey,
    })
  }
  const client: LocalValedictorianClient = {
    connectorScheduling,
    applications: {
      list: (query) => applicationService.listApplications(query),
      get: (id) => applicationService.getApplication(id),
      create: (input) => applicationService.createApplication(input),
      update: (input) => applicationService.updateApplication(input),
      updateStatus: (input) => applicationService.updateApplicationStatus(input),
      archive: (input) => applicationService.archiveApplication(input),
      workflow: {
        update: (input) => applicationService.updateApplicationWorkflow(input),
      },
      notes: {
        append: (input) => applicationService.appendApplicationNote(input),
      },
      links: {
        list: (input) => applicationService.listApplicationLinks(input),
        create: (input) => applicationService.createApplicationLink(input),
        update: (input) => applicationService.updateApplicationLink(input),
      },
      events: {
        list: (input) => applicationService.listApplicationEvents(input),
      },
      attempts: {
        list: (input) => applicationService.listApplicationAttempts(input),
        start: (input) => applicationService.startApplicationAttempt(input),
        step: (input) => applicationService.createApplicationAttemptStep(input),
        complete: (input) => applicationService.completeApplicationAttempt(input),
      },
    },
    scores: {
      record: (input) => scoringRepository.recordScore(input),
    },
    actionQueue: {
      list: (query) => actionQueueRepository.listActionQueue(query),
    },
    connectors: {
      list: async () => ({
        items: (await connectorRepository.listInstances()).map(mapConnectorInstanceSummary),
      }),
      descriptors: {
        list: async () => listInstalledConnectorDescriptors(connectorRegistry),
        get: async (connectorId, connectorVersion) => {
          const exactConnector = connectorRegistry.getVersion(connectorId, connectorVersion)
          const sameIdConnectors = connectorRegistry.list().filter((candidate) =>
            candidate.definition.id === connectorId)
          const connector = exactConnector
            ?? (sameIdConnectors.length === 1 ? connectorRegistry.get(connectorId) : null)
          if (!connector) {
            throw new Error(`Unsupported connector descriptor: ${connectorId}@${connectorVersion}`)
          }
          return projectInstalledConnectorDescriptor(connector)
        },
      },
      options: connectorOptionQueries,
      create: async (input) => {
        const connector = connectorRegistry.get(input.connectorId)
        if (!connector) {
          throw new Error(`Unsupported connector id: ${input.connectorId}`)
        }
        if (input.connectorVersion !== connector.definition.version) {
          throw new Error(
            `Connector version mismatch for ${input.connectorId}: expected ${connector.definition.version}`,
          )
        }
        assertSupportedConnectorSettings(connector, input.config, input.filters)
        if (input.enabled) validateCompleteConnectorSettings(connector, input.config, input.filters)
        const createdAt = now().toISOString()
        const earliestBackfillDate = input.earliestBackfillDate === undefined
          ? undefined
          : validateSelectableEarliestBackfillDateOrThrow(
            input.earliestBackfillDate,
            createdAt,
            createdAt,
          )
        const created = mapConnectorInstanceSummary(await connectorRunner.registerInstanceIfAbsent({
          id: input.id,
          connector,
          displayName: input.displayName,
          enabled: input.enabled,
          auth: mapConnectorAuthReferenceInputs(input.auth),
          config: input.config,
          filters: input.filters,
          earliestBackfillDate,
          createdAt,
        }))
        onScheduledWorkChanged?.()
        return created
      },
      update: async (input) => {
        const existing = await connectorRepository.getInstance(input.connectorInstanceId)
        if (!existing) {
          throw new Error(`Connector instance not found: ${input.connectorInstanceId}`)
        }
        const connector = connectorRegistry.get(existing.connectorId)
        if (
          connector
          && input.connectorVersion !== undefined
          && input.connectorVersion !== connector.definition.version
        ) {
          throw new Error(
            `Connector version mismatch for ${existing.connectorId}: expected ${connector.definition.version}`,
          )
        }
        const maintenanceOnly = isConnectorMaintenanceOnlyUpdate(input)
        const config = input.config ?? toConnectorJsonRecord(existing.config, 'config')
        const filters = input.filters ?? toConnectorJsonRecord(existing.filters, 'filters')
        const enabled = input.enabled ?? existing.enabled
        if (connector && !maintenanceOnly) {
          assertSupportedConnectorSettings(
            connector,
            config,
            filters,
          )
          if (enabled) {
            validateCompleteConnectorSettings(connector, config, filters)
          }
        }
        const updateNow = now().toISOString()
        const earliestBackfillDate = input.earliestBackfillDate === undefined
          ? existing.earliestBackfillDate
          : validateSelectableEarliestBackfillDateOrThrow(
            input.earliestBackfillDate,
            existing.createdAt,
            updateNow,
          )
        const proposedInstance = {
          id: existing.id,
          connectorId: existing.connectorId,
          connectorVersion: existing.connectorVersion,
          displayName: input.displayName ?? existing.displayName,
          enabled,
          auth: mapConnectorAuthReferenceInputs(input.auth) ?? existing.auth,
          config,
          filters,
          earliestBackfillDate,
          createdAt: existing.createdAt,
        }
        if (
          connector
          && !maintenanceOnly
          && existing.connectorVersion !== connector.definition.version
        ) {
          if (input.connectorVersion !== connector.definition.version) {
            throw new Error(
              `Connector version mismatch for ${existing.connectorId}: expected ${connector.definition.version}`,
            )
          }
          const reconciled = mapConnectorInstanceSummary(await reconcileConnectorPackageUpgrade({
            connector,
            connectorRepository,
            instance: { ...existing, ...proposedInstance },
            replayConnectorUpgrade: (replayInput) =>
              normalizationReplayService.replayConnectorUpgrade(replayInput),
          }))
          onScheduledWorkChanged?.()
          return reconciled
        }
        const updated = mapConnectorInstanceSummary(await connectorRepository.upsertInstance({
          ...proposedInstance,
          connectorVersion: maintenanceOnly
            ? existing.connectorVersion
            : input.connectorVersion ?? connector?.definition.version ?? existing.connectorVersion,
        }))
        onScheduledWorkChanged?.()
        return updated
      },
      remove: async ({ connectorInstanceId }) => {
        const result = await retireConnectorInstance(
          database,
          connectorInstanceId,
          now().toISOString(),
        )
        onScheduledWorkChanged?.()
        return result
      },
      inspect: async (connectorInstanceId) => {
        const record = await connectorRepository.getStatusSummary(connectorInstanceId)
        if (!record) {
          throw new Error(`Connector instance not found: ${connectorInstanceId}`)
        }
        return mapLocalConnectorStatusSummary(record)
      },
      overview: {
        list: async (input = {}) => {
          const query = connectorOverviewListQuerySchema.parse(input)
          const page = await connectorRepository.listOverviewStatusSummaries({
            cursorId: query.cursor
              ? readConnectorOverviewCursor(query.cursor, query)
              : undefined,
            enabled: query.enabled,
            limit: query.limit ?? DEFAULT_CONNECTOR_OVERVIEW_LIST_LIMIT,
            severity: query.severity,
            status: query.status,
          })
          const items = page.items.map(mapLocalConnectorOverviewRecord)
          return connectorOverviewListResultSchema.parse({
            items,
            nextCursor: page.hasMore
              ? createConnectorOverviewCursor(items.at(-1)!.id, query)
              : null,
          })
        },
      },
      runs: {
        list: async (input) => {
          const result = await connectorRepository.listRuns(input)
          return {
            ...result,
            items: await Promise.all(result.items.map(mapRun)),
          }
        },
        trigger: async (input) => {
          try {
            const instance = await connectorRepository.getInstance(input.connectorInstanceId)
            const connector = instance ? connectorRegistry.get(instance.connectorId) : null
            if (instance && connector) {
              validateCompleteConnectorSettings(connector, instance.config, instance.filters)
            }
            const run = await executeConnectorRunTrigger({
              connectorRegistry,
              connectorRepository,
              connectorRunner,
              input,
              normalizationOrchestrator,
              normalizationReplayService,
              normalizationRegistry,
              normalizationRepository,
              now,
            })
            return await mapRun(run)
          } finally {
            onScheduledWorkChanged?.()
          }
        },
      },
      checkpoints: {
        list: async (input) => ({
          items: (await connectorRepository.listCheckpoints(input)).map(mapConnectorCheckpoint),
        }),
      },
      observations: {
        list: async (input) => {
          const limit = input.limit ?? 50
          const offset = input.offset ?? 0
          const items = await connectorRepository.listObservations({
            connectorInstanceId: input.connectorInstanceId,
            connectorRunId: input.connectorRunId,
          })
          const pagedItems = items.slice(offset, offset + limit)
          return {
            items: pagedItems.map(mapConnectorObservation),
            total: items.length,
            limit,
            offset,
            hasMore: offset + pagedItems.length < items.length,
          }
        },
      },
      schedules,
      status: {
        list: async () => mapConnectorStatusSummaries(
          await connectorRepository.listStatusSummaries(),
        ),
        reconnect: (input) => reconnectConnectorStatus({
          connectorRegistry,
          connectorRepository,
          connectorRunner,
          input,
        }),
        skip: async (input) => {
          const run = await connectorRepository.recordRunSkipped({
            connectorInstanceId: input.connectorInstanceId,
            mode: 'manual',
            reason: input.reason,
            skippedAt: now().toISOString(),
          })
          return {
            action: 'skip',
            connectorInstanceId: input.connectorInstanceId,
            message: 'Connector run skipped.',
            run: await mapRun(run),
            status: 'skipped',
          }
        },
      },
    },
    policy: {
      config: {
        get: () => policyRepository.getConfig(),
        reset: () => policyRepository.resetConfig(),
        update: (patch) => policyRepository.updateConfig(patch),
      },
      evidence: {
        list: (query) => policyRepository.listEvidence(query),
        record: (input) => policyRepository.recordEvidence(input),
      },
      evaluate: {
        application: (input) => policyRepository.evaluateApplication(input),
        sourcingCandidate: (input) => policyRepository.evaluateSourcingCandidate(input),
        runWindow: (input) => policyRepository.evaluateRunWindow(input),
      },
    },
    profile: createWorkspaceProfileMethods(profileService),
    secrets: createWorkspaceSecretMethods(secretService, localSecretResolution),
    runs: {
      list: (query) => workflowRunRepository.listRuns(query),
      start: (input) => workflowRunRepository.startRun(input),
      step: (input) => workflowRunRepository.createRunStep(input),
      complete: (input) => workflowRunRepository.completeRun(input),
    },
    sourcing: {
      rawRevisions: {
        projection: {
          get: async (rawRevisionId) => {
            const result = await projectionOutcomes.get(rawRevisionId)
            if (!result) throw Object.assign(new Error('Raw source revision not found'), { statusCode: 404 })
            return result
          },
        },
      },
      rawRecords: { list: (query) => rawSourceRepository.list(query),
        ingestBatch: async (input) => {
          const result = await providerUrlResolution.ingestBatch(input)
          for (const receipt of result.receipts) {
            try {
              await normalizationOrchestrator.normalize(
                receipt.rawRecordId,
                receipt.revision.id,
              )
            } catch {
              // Intake is already durable. Normalization failures must never erase its receipt
              // or prevent later records in the same batch from being admitted independently.
            }
          }
          return result
        },
        get: async (rawRecordId) => {
          const record = await rawSourceRepository.get(rawRecordId)
          if (!record) {
            throw Object.assign(new Error('Raw source record not found'), { statusCode: 404 })
          }
          return record
        },
        replay: (input) => normalizationReplayService.replay(input),
        normalization: {
          get: async (rawRecordId) => {
            const result = await normalizationRepository.getLatest(rawRecordId)
            if (!result) {
              throw Object.assign(new Error('Raw source normalization not found'), {
                statusCode: 404,
              })
            }
            return result
          },
        },
      },
      candidates: {
        process: (input) => sourcingProcessor.processCandidate(input),
      },
      findings: {
        list: (query) => sourcingRepository.listFindings(query),
        create: (input) => sourcingRepository.createFinding(input),
        update: (input) => sourcingRepository.updateFinding(input),
        decide: (input) => sourcingRepository.decideFinding(input),
        promote: (input) => sourcingRepository.promoteFinding(input),
      },
    },
  }
  registerScheduledWorkSource?.(createConnectorCaptureRetryWorkSource({
    listRetries: () => scheduleRepository.listScheduledCaptureRetries(), now,
    runRetry: async (connectorInstanceId, signal) => await mapRun(await executeConnectorRunTrigger({
      connectorRegistry, connectorRepository, connectorRunner,
      input: { connectorInstanceId, reason: 'scheduled_capture_retry' }, mode: 'scheduled',
      normalizationOrchestrator, normalizationReplayService, normalizationRegistry,
      normalizationRepository, now,
      retryKind: 'connector_capture', ...(signal ? { signal } : {}),
    })),
  }))
  return client
}
async function reconnectConnectorStatus({
  connectorRegistry,
  connectorRepository,
  connectorRunner,
  input,
}: {
  connectorRegistry: LocalConnectorRegistry
  connectorRepository: ReturnType<typeof createPgliteConnectorRepository>
  connectorRunner: ReturnType<typeof createConnectorRunner>
  input: LocalConnectorStatusActionInput
}): Promise<LocalConnectorReconnectActionResult> {
  const instance = await connectorRepository.getInstance(input.connectorInstanceId)
  if (!instance) {
    throw new Error(`Connector instance not found: ${input.connectorInstanceId}`)
  }
  const connector = connectorRegistry.get(instance.connectorId)
  if (connector && typeof connector.validateAuth === 'function') {
    const validation = await connectorRunner.validateAuth(connector, {
      connectorInstanceId: input.connectorInstanceId,
    })
    const grantMode = instance.auth[0]?.mode ?? connector.definition.auth?.requirements?.[0]?.mode ?? 'username_password'
    return {
      action: 'reconnect',
      connectorInstanceId: input.connectorInstanceId,
      grants: [
        {
          id: instance.auth[0]?.id ?? connector.definition.auth?.requirements?.[0]?.id ?? 'jobright',
          mode: grantMode,
          status: mapValidationStatusToGrantStatus(validation.status),
          ...(validation.reason === undefined ? {} : { reason: validation.reason }),
        },
      ],
      message: validation.message,
      reason: validation.reason,
      status: validation.status,
    }
  }
  return {
    action: 'reconnect',
    connectorInstanceId: input.connectorInstanceId,
    grants: [],
    message: 'Connector auth validation is not supported.',
    reason: 'validate_auth_unsupported',
    status: 'unsupported',
  }
}
function mapValidationStatusToGrantStatus(
  status: AppConnectorAuthValidationResult['status'],
): AppConnectorAuthGrant['status'] {
  if (status === 'ready' || status === 'missing' || status === 'expired' || status === 'action_required') {
    return status
  }
  if (status === 'rate_limited' || status === 'retryable') {
    return 'action_required'
  }
  return 'action_required'
}
async function executeConnectorRunTrigger({
  connectorRegistry,
  connectorRepository,
  connectorRunner,
  input,
  mode = 'manual',
  normalizationOrchestrator,
  normalizationReplayService,
  normalizationRegistry,
  normalizationRepository,
  now,
  retryKind,
  signal,
}: {
  connectorRegistry: LocalConnectorRegistry
  connectorRepository: ReturnType<typeof createPgliteConnectorRepository>
  connectorRunner: ReturnType<typeof createConnectorRunner>
  input: LocalConnectorInternalRunTriggerInput
  mode?: 'manual' | 'scheduled'
  normalizationOrchestrator: ReturnType<typeof createNormalizationOrchestrator>
  normalizationReplayService: ReturnType<typeof createNormalizationReplayService>
  normalizationRegistry: ReturnType<typeof createDefaultNormalizationResolverRegistry>
  normalizationRepository: ReturnType<typeof createPgliteNormalizationRepository>
  now: () => Date
  retryKind?: 'connector_capture'
  signal?: AbortSignal
}): Promise<ConnectorRunRecord> {
  const startedAt = now().toISOString()
  const instance = await connectorRepository.getInstance(input.connectorInstanceId)
  if (!instance) {
    throw new Error(`Connector instance not found: ${input.connectorInstanceId}`)
  }
  if (!instance.enabled) {
    throw connectorDisabledExecutionError(input.connectorInstanceId)
  }
  const connector = connectorRegistry?.get(instance.connectorId) ?? null
  if (!connector) {
    throw new Error(`Unsupported connector id: ${instance.connectorId}`)
  }
  const executionIntent = input.executionIntent ?? 'ordinary'
  assertExecutableConnectorTrigger(input, executionIntent)
  const filters = toJsonRecord(instance.filters)
  const filterSignature = connectorCheckpointSignature({
    connectorId: connector.definition.id,
    connectorVersion: connector.definition.version,
    supportsFiltering: connector.definition.capabilities?.supportsFiltering,
    filters,
  })
  const coverageEndedAt = input.coverageEndedAt ?? startedAt
  const coverageStartedAt = inclusiveCoverageStartFromEarliestBackfillDate(
    instance.earliestBackfillDate,
  )
  const runRequestResult = await connectorRepository.recordRunRequest({
    connectorInstanceId: input.connectorInstanceId,
    mode,
    startedAt,
    coverageStartedAt,
    coverageEndedAt,
    filterSignature,
    filters,
    reason: input.reason,
    ...(retryKind === undefined ? {} : { retryKind }),
  })
  if (!runRequestResult.acquired) {
    return runRequestResult.run
  }
  const runRequest = runRequestResult.run
  const acquiredWork = runRequestResult.acquiredWork
  const claim = await connectorRepository.claimQueuedRunToRunning({
    connectorRunId: runRequest.id,
    startedAt,
  })
  if (!claim.claimed) {
    return claim.run
  }
  try {
    await reconcileConnectorPackageUpgrade({
      connector,
      connectorRepository,
      instance,
      replayConnectorUpgrade: (replayInput) => normalizationReplayService.replayConnectorUpgrade(replayInput),
    })
  } catch (error) {
    await connectorRepository.markRunFailed({
      connectorRunId: claim.run.id,
      completedAt: now().toISOString(),
      retryHints: null,
      warning: {
        code: 'connector.upgrade_replay_failed',
        message: 'Connector upgrade replay failed.',
      },
    })
    throw error
  }
  if (acquiredWork?.kind === 'normalization') {
    return dispatchAcquiredNormalizationWork({
      acquiredWork,
      connector,
      connectorRepository,
      connectorRunner,
      instanceId: input.connectorInstanceId,
      normalizationOrchestrator,
      normalizationRegistry,
      normalizationRepository,
      now,
      runRequest: claim.run,
      startedAt,
      coverageEndedAt,
    })
  }
  return executeClaimedConnectorRun({
    connectorRegistry,
    connectorRepository,
    connectorRunner,
    connectorRunId: claim.run.id,
    coverageEndedAt,
    executionIntent,
    mode,
    now,
    replayConnectorUpgrade: (replayInput) => normalizationReplayService.replayConnectorUpgrade(replayInput),
    ...(signal ? { signal } : {}),
    startedAt,
  })
}
function toJsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
function assertExecutableConnectorTrigger(
  input: LocalConnectorInternalRunTriggerInput,
  executionIntent: NonNullable<LocalConnectorInternalRunTriggerInput['executionIntent']> | 'ordinary',
) {
  if (input.dryRun) {
    throw new Error('dryRun connector triggers are not supported for executed connector runs')
  }
  if (input.filters !== undefined || input.filterSignature !== undefined) {
    throw new Error('Per-run connector filter overrides are not supported for executed connector runs')
  }
  if (executionIntent === 'deferred_refresh') {
    return
  }
}
function validateSelectableEarliestBackfillDateOrThrow(
  candidate: string,
  createdAt: string,
  nowInstant: string,
): string {
  const validated = validateSelectableEarliestBackfillDate({
    candidate,
    createdAt,
    todayUtc: maximumSelectableEarliestBackfillDate(nowInstant),
  })
  if (!validated.ok) {
    throw new Error(validated.message)
  }
  return validated.value
}
function mapConnectorInstanceSummary(
  record: ConnectorInstanceRecord,
): LocalConnectorInstanceSummary {
  return {
    id: record.id,
    connectorId: record.connectorId,
    connectorVersion: record.connectorVersion,
    displayName: record.displayName,
    enabled: record.enabled,
    lifecycle: record.enabled ? 'enabled' : 'disabled',
    auth: record.auth.map(mapConnectorAuthSummary),
    config: record.config,
    filters: record.filters,
    earliestBackfillDate: record.earliestBackfillDate,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}
function mapConnectorAuthReferenceInputs(
  references: ConnectorAuthReferenceInput[] | undefined,
): ConnectorAuthReference[] | undefined {
  return references?.map((reference) => {
    if (!isLocalConnectorAuthMode(reference.mode)) {
      throw new Error(`Invalid connector auth mode: ${reference.mode}`)
    }
    return {
      id: reference.id,
      mode: reference.mode,
      ...(reference.label === undefined || reference.label === null ? {} : { label: reference.label }),
      ...(reference.secretKey === undefined ? {} : { secretKey: reference.secretKey }),
    }
  })
}

function isConnectorMaintenanceOnlyUpdate(input: object & { auth?: unknown; enabled?: boolean }) {
  const keys = Object.keys(input)
  return (input.enabled === false && keys.every((key) =>
    key === 'connectorInstanceId' || key === 'enabled'))
    || (input.auth !== undefined && keys.every((key) =>
      key === 'connectorInstanceId' || key === 'auth'))
}
const localConnectorAuthModes = new Set<ConnectorAuthReference['mode']>([
  'none', 'api_key', 'bearer_token', 'oauth', 'cookie_jar', 'username_password',
])
function isLocalConnectorAuthMode(value: string): value is ConnectorAuthReference['mode'] {
  return localConnectorAuthModes.has(value as ConnectorAuthReference['mode'])
}
function toConnectorJsonRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  throw new Error(`Invalid connector ${fieldName}`)
}
