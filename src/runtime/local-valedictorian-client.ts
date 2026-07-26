import path from 'node:path'
import type {
  ConnectorAuthReferenceInput,
} from '@sparxie/sdk'
import {
  connectorOverviewListQuerySchema,
  connectorOverviewListResultSchema,
  DEFAULT_CONNECTOR_OVERVIEW_LIST_LIMIT,
} from '@sparxie/sdk'
import { createLocalLifecycleMethods } from './local-lifecycle-methods'
import { createPgliteActionQueueRepository } from '../modules/action-queue/action-queue.repository'
import { createPgliteCaptureService } from '../modules/capture/capture.service'
import { createCaptureMaterializationService } from '../modules/capture/capture.materialization'
import {
  createCaptureResolutionService,
  createCaptureResolutionV2Service,
} from '../modules/capture/capture.resolution'
import { createManualCaptureCompletionService } from '../modules/capture/capture.manual-completion'
import { createCaptureDestinationResolutionService } from '../modules/capture/capture.destination-resolution'
import { createCaptureFieldOutcomeStore } from '../modules/capture/capture.field-outcomes'
import { createScheduledWorkSource } from '../modules/scheduling/scheduled-work.source'
import {
  createCaptureDestinationWorkExecutor,
  createCaptureDestinationWorkRepository,
  enqueueCaptureDestinationWork,
  reconcileCaptureDestinationWork,
} from '../modules/scheduling/capture-destination-work'
import { retireProviderUrlResolutionWork } from '../modules/scheduling/provider-url-resolution-retirement'
import {
  createNormalizationExecutor,
  createNormalizationWorkRepository,
  enqueueNormalizationWork,
  reconcileNormalizationWork,
} from '../modules/scheduling/normalization-work'
import {
  JOBRIGHT_CONNECTOR_ID,
} from '../modules/connectors/jobright.constants'
import { createJobrightProviderFieldResolver, jobrightProviderFieldResolverDeclaration } from '@sparxie/valedictorian-connectors-jobright'
import { workspaces } from '../db/workspaces.schema'
import { createSourceExecutionGovernor } from '../modules/source-execution/source-execution-governor'
import { createConnectorCaptureHost } from '../modules/connectors/connector.capture-host'
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
import {
  connectorDisabledExecutionError,
  connectorInstalledVersionMismatchError,
} from '../modules/connectors/connector-execution.errors'
import {
  admitConnectorSettings,
} from '../modules/connectors/connector.settings-validation'
import {
  listInstalledConnectorDescriptors,
} from '../modules/connectors/connector.capabilities'
import { createConnectorOptionQueryService } from '../modules/connectors/connector.option-query'
import {
  createConnectorRunner,
  createRunRuntime,
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
import { executeClaimedConnectorRun } from './local-connector-claimed-execution'
import { mapConnectorRunSummary } from './local-connector-public-run'
import {
  mapConnectorAuthSummary,
  mapLocalConnectorStatusSummary,
} from './local-connector-status-mapping'
import { mapConnectorCheckpoint, mapConnectorObservation } from './local-connector-run-summary'
import { mapLocalConnectorOverviewRecord } from './local-connector-overview'
import {
  createConnectorOverviewCursor,
  readConnectorOverviewCursor,
} from './local-connector-overview.cursor'
import { createPgliteWorkflowRunRepository } from '../modules/workflow-runs/workflow-run.repository'
import { assertSeedOptions, seedLocalData } from './local-valedictorian-seeding'
import { createCompanyCoverageService } from '../modules/company/company.coverage'
import { createPgliteCompanyAssignmentService } from '../modules/company/company.assignment.service'
import { createPgliteCompanyService } from '../modules/company/company.service'
import { createPgliteJobIdentityService } from '../modules/job/job.identity'
import { createPgliteJobService } from '../modules/job/job.service'
import { createPgliteJobPromotion } from '../modules/lifecycle/capture-to-job.promotion'
import { createSourceSessionExecutor } from '../modules/source-execution/source-session-executor'
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
  deferCompanyCoverageMigration = false,
  now = () => new Date(),
  onScheduledWorkChanged,
  registerScheduledWorkSource,
  scheduleCompanyCoverageMigration = scheduleCompanyCoverageInBackground,
  referenceTrackerPath,
  seedDataMode = 'none',
  secretCodec = unavailableSecretCodec,
  localSecretResolutionEnabled = false,
  newId,
  profilePath,
  profileService: preparedProfileService,
  secretService: preparedSecretService,
  pgliteDataPath,
  workspaceId = 'local-workspace',
}: LocalValedictorianClientOptions): Promise<LocalValedictorianClient> {
  assertSeedOptions({ referenceTrackerPath, seedDataMode })
  const connectorScheduling = resolveConnectorSchedulingCapability(connectorSchedulingOption)
  const openedAt = now().toISOString()
  await database.insert(workspaces).values({
    id: workspaceId,
    name: workspaceId,
    createdAt: openedAt,
    updatedAt: openedAt,
  }).onConflictDoNothing()
  await seedLocalData(database, {
    referenceTrackerPath,
    seedDataMode,
  })
  const companyCoverage = createCompanyCoverageService(database, {
    now,
    ...(newId ? { newId } : {}),
  })
  await companyCoverage.prepare(workspaceId)
  if (!deferCompanyCoverageMigration) {
    await companyCoverage.migrateToReady(workspaceId)
  }
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
  const policyRepository = createPglitePolicyRepository(database)
  const workflowRunRepository = createPgliteWorkflowRunRepository(database)
  const captureService = createPgliteCaptureService(database, {
    now,
    ...(newId ? { newId } : {}),
  })
  const captureMaterialization = createCaptureMaterializationService(database, { now })
  await captureMaterialization.migrateToReady(workspaceId)
  const destinationRepository = createCaptureDestinationWorkRepository(database, { workspaceId, now })
  const captureDestination = createCaptureDestinationResolutionService({
    database,
    materialization: captureMaterialization,
    publisher: {
      async enqueue(identity) {
        const created = await enqueueCaptureDestinationWork(destinationRepository, identity)
        if (created) onScheduledWorkChanged?.()
        return created
      },
    },
    selectResolver: (adapterId, adapterVersion) => {
      const resolver = connectorRegistry.getVersion(adapterId, adapterVersion)
        ?.connector.providerUrlResolver
      return resolver ? { id: resolver.id, version: resolver.version } : null
    },
    workspaceId,
    now,
  })
  const captureFieldOutcomes = createCaptureFieldOutcomeStore(database)
  // Static resolver metadata (no connector loading); the resolver function resolves lazily so
  // client construction never loads connector implementations (retirement invariant).
  const providerFieldDeclaration = jobrightProviderFieldResolverDeclaration
  const getProviderFieldResolver = () =>
    connectorRegistry.get(JOBRIGHT_CONNECTOR_ID)?.connector.providerFieldResolver
    ?? createJobrightProviderFieldResolver()
  const normalizationRepository = createNormalizationWorkRepository(database, { workspaceId, now })
  const captureHost = createConnectorCaptureHost({
    captureService,
    now,
    workspaceId,
    enqueueProviderFieldWork: async (input) => {
      if (input.adapterId !== JOBRIGHT_CONNECTOR_ID) return
      const supportedSchemas = providerFieldDeclaration.supportedProviderSchemas
      if (supportedSchemas && (input.providerSchema === null || !supportedSchemas.includes(input.providerSchema))) return
      const created = await enqueueNormalizationWork(normalizationRepository, {
        workspaceId,
        captureId: input.captureId,
        captureRevision: input.captureRevision,
        resolverId: providerFieldDeclaration.id,
        resolverVersion: providerFieldDeclaration.version,
        inputHash: input.contentHash,
      })
      if (created) onScheduledWorkChanged?.()
    },
    enqueueDestinationWork: ({ captureId }) => captureDestination.scheduleAcknowledged(captureId),
  })
  const trustedConnectorAuth = composeTrustedConnectorAuth(secretService)
  const connectorOptionQueries = createConnectorOptionQueryService({
    authHost: trustedConnectorAuth,
    connectorRegistry,
    connectorRepository,
    workspaceId,
  })
  const sourceExecutionGovernor = createSourceExecutionGovernor(database, secretCodec)
  const destinationSessionExecutor = createSourceSessionExecutor({
    governor: sourceExecutionGovernor,
    now,
  })
  const connectorRunner = createConnectorRunner({
    auth: trustedConnectorAuth,
    captureHost,
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
  const lifecycle = createLocalLifecycleMethods(database, {
    workspaceId,
    now,
    jobCreationCoverage: companyCoverage.jobCreationCoverage,
  })
  const manualCompletionJobService = createPgliteJobService(database, {
    now,
    creationCoverage: companyCoverage.jobCreationCoverage,
  })
  const manualCompletionJobIdentityService = createPgliteJobIdentityService(database, { now })
  const manualCaptureCompletion = createManualCaptureCompletionService(database, {
    workspaceId,
    jobService: manualCompletionJobService,
    promotion: createPgliteJobPromotion(database, captureService, manualCompletionJobService, {
      now,
      jobIdentityService: manualCompletionJobIdentityService,
    }),
    jobIdentityService: manualCompletionJobIdentityService,
    now,
  })
  const captureResolutionOptions = {
    workspaceId,
    materialization: captureMaterialization,
    destination: captureDestination,
    manualCompletion: manualCaptureCompletion,
  }
  const client: LocalValedictorianClient = {
    workspaceId,
    connectorScheduling,
    ...lifecycle,
    captureResolution: createCaptureResolutionService(database, captureResolutionOptions),
    captureResolutionV2: createCaptureResolutionV2Service(database, captureResolutionOptions),
    companies: createPgliteCompanyService(database, {
      workspaceId,
      coverage: companyCoverage,
      now,
      ...(newId ? { newId } : {}),
    }),
    companyAssignments: createPgliteCompanyAssignmentService(database, {
      workspaceId,
      now,
    }),
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
          const exact = connectorRegistry.getVersion(connectorId, connectorVersion)
          const sameId = connectorRegistry.list().filter((candidate) =>
            candidate.descriptor.connectorId === connectorId)
          const registered = exact
            ?? (sameId.length === 1 ? connectorRegistry.get(connectorId) : null)
          if (!registered) {
            throw new Error(`Unsupported connector descriptor: ${connectorId}@${connectorVersion}`)
          }
          return registered.descriptor
        },
      },
      options: connectorOptionQueries,
      create: async (input) => {
        const registered = connectorRegistry.get(input.connectorId)
        if (!registered) {
          throw new Error(`Unsupported connector id: ${input.connectorId}`)
        }
        const { connector, descriptor } = registered
        if (input.connectorVersion !== descriptor.connectorVersion) {
          throw connectorInstalledVersionMismatchError(
            input.connectorId,
            descriptor.connectorVersion,
          )
        }
        const { config, filters } = input
        admitConnectorSettings(descriptor, { config, filters }, input.enabled ? 'enabled' : 'draft')
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
        const registered = connectorRegistry.get(existing.connectorId)
        if (registered) {
          const installedVersion = registered.descriptor.connectorVersion
          if (
            existing.connectorVersion !== installedVersion
            || (input.connectorVersion !== undefined && input.connectorVersion !== installedVersion)
          ) {
            throw connectorInstalledVersionMismatchError(existing.connectorId, installedVersion)
          }
        }
        const maintenanceOnly = isConnectorMaintenanceOnlyUpdate(input)
        const config = input.config ?? toConnectorJsonRecord(existing.config, 'config')
        const filters = input.filters ?? toConnectorJsonRecord(existing.filters, 'filters')
        const enabled = input.enabled ?? existing.enabled
        if (registered && !maintenanceOnly) {
          const mode = enabled ? 'enabled' : 'draft'
          admitConnectorSettings(registered.descriptor, { config, filters }, mode)
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
        const updated = mapConnectorInstanceSummary(
          await connectorRepository.upsertInstance(proposedInstance),
        )
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
            const run = await executeConnectorRunTrigger({
              connectorRegistry,
              connectorRepository,
              connectorRunner,
              input,
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
        opportunity: (input) => policyRepository.evaluateOpportunity(input),
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
  }
  registerScheduledWorkSource?.(createConnectorCaptureRetryWorkSource({
    listRetries: () => scheduleRepository.listScheduledCaptureRetries(), now,
    runRetry: async (connectorInstanceId, signal) => await mapRun(await executeConnectorRunTrigger({
      connectorRegistry, connectorRepository, connectorRunner,
      input: { connectorInstanceId, reason: 'scheduled_capture_retry' }, mode: 'scheduled',
      now,
      retryKind: 'connector_capture', ...(signal ? { signal } : {}),
    })),
  }))
  const normalizationExecutor = createNormalizationExecutor({
    database,
    fieldOutcomes: captureFieldOutcomes,
    getResolver: getProviderFieldResolver,
    repository: normalizationRepository,
    workspaceId,
    now,
  })
  registerScheduledWorkSource?.(createScheduledWorkSource({
    id: 'normalization',
    repository: normalizationRepository,
    execute: (work) => normalizationExecutor(work),
    now,
  }))
  const destinationExecutor = createCaptureDestinationWorkExecutor({
    repository: destinationRepository,
    state: captureDestination,
    execute: async (context, signal) => {
      const instance = await connectorRepository.getInstance(context.connectorInstanceId)
      if (!instance || !instance.enabled || instance.executionScopeId !== context.executionScopeId) {
        return { status: 'terminal', reason: 'provider_record_invalid' }
      }
      const connector = connectorRegistry
        .getVersion(instance.connectorId, instance.connectorVersion)?.connector
      const resolver = connector?.providerUrlResolver
      if (!resolver || resolver.id !== context.resolverId || resolver.version !== context.resolverVersion) {
        return { status: 'terminal', reason: 'provider_schema_changed' }
      }
      const runtime = createRunRuntime(
        { ...connectorRuntime, ...(signal ? { cancellation: { signal } } : {}) },
        instance.auth,
        connector.definition.auth?.requirements ?? [],
        trustedConnectorAuth,
        new Set<string>(),
        instance.executionScopeId,
        destinationSessionExecutor,
        false,
        undefined,
      )
      return resolver.resolve({
        connectorInstanceId: instance.id,
        executionScopeId: instance.executionScopeId,
        providerRecordId: context.providerRecordId,
        workspaceId,
      }, runtime)
    },
  })
  registerScheduledWorkSource?.(createScheduledWorkSource({
    id: 'capture_destination_resolution',
    repository: destinationRepository,
    execute: (work, signal) => destinationExecutor(work, signal),
    now,
  }))
  // #325 startup reconciliation: recover orphaned normalization claims, cancel obsolete active
  // resolver-version work, and idempotently enqueue every eligible Jobright revision with an
  // available immutable payload for the current resolver version (closes the post-ack gap).
  await normalizationRepository.recoverClaimed(now().toISOString())
  await retireProviderUrlResolutionWork(database, workspaceId, now().toISOString())
  await destinationRepository.recoverClaimed(now().toISOString())
  await reconcileCaptureDestinationWork(database, workspaceId, captureDestination)
  await captureDestination.reconcile()
  const normalizationReconciliation = await reconcileNormalizationWork({
    database,
    fieldOutcomes: captureFieldOutcomes,
    repository: normalizationRepository,
    workspaceId,
    adapterId: JOBRIGHT_CONNECTOR_ID,
    resolverId: providerFieldDeclaration.id,
    resolverVersion: providerFieldDeclaration.version,
    supportedProviderSchemas: providerFieldDeclaration.supportedProviderSchemas,
    now,
  })
  if (normalizationReconciliation.enqueued > 0 || normalizationReconciliation.cancelled > 0) {
    onScheduledWorkChanged?.()
  }
  const recoverInterruptedRuns = async () => {
    await connectorRepository.recoverInterruptedRuns({ completedAt: now().toISOString() })
  }
  if (connectorRunRecovery) {
    if (!pgliteDataPath) {
      throw new Error('pgliteDataPath is required when connectorRunRecovery is provided')
    }
    await connectorRunRecovery.activate({ pgliteDataPath, workspaceId }, recoverInterruptedRuns)
  } else {
    await recoverInterruptedRuns()
  }
  if (deferCompanyCoverageMigration) {
    scheduleCompanyCoverageMigration(async () => {
      await companyCoverage.migrateToReady(workspaceId)
    })
  }
  return client
}

function scheduleCompanyCoverageInBackground(run: () => Promise<void>) {
  queueMicrotask(() => {
    void run().catch(() => undefined)
  })
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
  const connector = connectorRegistry.get(instance.connectorId)?.connector
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
  now,
  retryKind,
  signal,
}: {
  connectorRegistry: LocalConnectorRegistry
  connectorRepository: ReturnType<typeof createPgliteConnectorRepository>
  connectorRunner: ReturnType<typeof createConnectorRunner>
  input: LocalConnectorInternalRunTriggerInput
  mode?: 'manual' | 'scheduled'
  now: () => Date
  retryKind?: 'connector_capture'
  signal?: AbortSignal
}): Promise<ConnectorRunRecord> {
  const startedAt = now().toISOString()
  const instance = await connectorRepository.getInstance(input.connectorInstanceId)
  if (!instance) {
    throw new Error(`Connector instance not found: ${input.connectorInstanceId}`)
  }
  const registered = connectorRegistry?.get(instance.connectorId) ?? null
  // Drift outranks lifecycle state so every mismatch reports the one canonical diagnostic;
  // an uninstalled connector id still reports disabled first, as it always has.
  if (registered && instance.connectorVersion !== registered.descriptor.connectorVersion) {
    throw connectorInstalledVersionMismatchError(
      instance.connectorId,
      registered.descriptor.connectorVersion,
    )
  }
  if (!instance.enabled) {
    throw connectorDisabledExecutionError(input.connectorInstanceId)
  }
  if (!registered) {
    throw new Error(`Unsupported connector id: ${instance.connectorId}`)
  }
  const connector = registered.connector
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
  const claim = await connectorRepository.claimQueuedRunToRunning({
    connectorRunId: runRequest.id,
    startedAt,
  })
  if (!claim.claimed) {
    return claim.run
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
      throw new Error(`Invalid connector auth mode: ${String(reference.mode)}`)
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
