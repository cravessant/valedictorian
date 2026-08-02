import path from 'node:path'
import { createLocalLifecycleMethods } from './local-lifecycle-methods'
import { createPgliteActionQueueRepository } from '../modules/action-queue/public'
import {
  createCaptureDestinationResolutionService,
  createCaptureFieldOutcomeStore,
  createCaptureMaterializationService,
  createCaptureResolutionService,
  createCaptureResolutionV2Service,
  createManualCaptureCompletionService,
  createPgliteCaptureService,
} from '../modules/capture/public'
import {
  createInitialCompanyAssignment,
  createPgliteCompanyAssignmentService,
  createPgliteCompanyService,
} from '../modules/company/public'
import {
  createConnectorCaptureHost,
  createConnectorWorkspaceClient,
  createDefaultLocalConnectorRegistry,
  JOBRIGHT_CONNECTOR_ID,
  resolveConnectorSchedulingCapability,
} from '../modules/connectors/public'
import { createPgliteJobIdentityService, createPgliteJobService } from '../modules/job/public'
import { createPgliteJobPromotion } from '../modules/lifecycle/public'
import { createPglitePolicyRepository } from '../modules/policy/public'
import { createJsonProfileService } from '../modules/profile/public'
import {
  createCaptureDestinationWorkExecutor,
  createCaptureDestinationWorkRepository,
  createNormalizationExecutor,
  createNormalizationWorkRepository,
  createScheduledWorkSource,
  enqueueCaptureDestinationWork,
  enqueueNormalizationWork,
  reconcileCaptureDestinationWork,
  reconcileNormalizationWork,
  retireProviderUrlResolutionWork,
} from '../modules/scheduling/public'
import { createPgliteScoringRepository } from '../modules/scoring/public'
import {
  createLocalSecretResolutionService,
  createPgliteSecretService,
  createWorkspaceSecretScope,
  isReservedIdentitySecretKey,
  isSecretCodecAvailable,
  type SecretCodec,
} from '../modules/secrets/public'
import {
  createSourceExecutionGovernor,
  createSourceSessionExecutor,
} from '../modules/source-execution/public'
import { createPgliteWorkflowRunRepository } from '../modules/workflow-runs/public'
import { createJobrightProviderFieldResolver, jobrightProviderFieldResolverDeclaration } from '@sparxie/valedictorian-connectors-jobright'
import { workspaces } from '../db/workspaces.schema'
import {
  composeTrustedConnectorAuth,
  createWorkspaceProfileMethods,
  createWorkspaceSecretMethods,
} from './local-profile-secret-client'
import { assertSeedOptions, seedLocalData } from './local-valedictorian-seeding'
import { WorkspaceAuthorityAdmissionController } from '@sparxie/valedictorian-workspace-server'
import {
  guardLocalValedictorianClient,
  guardScheduledWorkSource,
} from './workspace-authority-admission'
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
import type { LocalValedictorianClient } from './local-connector-client.contract'
const unavailableSecretCodec: SecretCodec = {
  decrypt() {
    throw new Error('Profile secrets are only available through local profile IPC')
  },
  encrypt() {
    throw new Error('Profile secrets are only available through local profile IPC')
  },
}
export async function createLocalValedictorianClient({
  authorityAdmissionController,
  database,
  connectorRunRecovery,
  connectorRegistry = createDefaultLocalConnectorRegistry(),
  connectorRuntime,
  connectorScheduling: connectorSchedulingOption,
  now = () => new Date(),
  onScheduledWorkChanged,
  registerScheduledWorkSource,
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
  const admission = authorityAdmissionController
    ?? new WorkspaceAuthorityAdmissionController({ workspaceId })
  admission.admit('internal.workspace.initialize', {}, 'internal')
  const registerAdmittedScheduledWorkSource = (source: Parameters<
    NonNullable<typeof registerScheduledWorkSource>
  >[0]) => registerScheduledWorkSource?.(guardScheduledWorkSource(source, admission))
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
  const initialCompanyAssignment = createInitialCompanyAssignment({
    now,
    ...(newId ? { newId } : {}),
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
  const sourceExecutionGovernor = createSourceExecutionGovernor(database, secretCodec)
  const destinationSessionExecutor = createSourceSessionExecutor({
    governor: sourceExecutionGovernor,
    now,
  })
  const connectorWorkspace = createConnectorWorkspaceClient({
    authHost: trustedConnectorAuth,
    captureHost,
    connectorRegistry,
    connectorRuntime,
    connectorScheduling,
    database,
    destinationSessionExecutor,
    now,
    ...(onScheduledWorkChanged ? { onScheduledWorkChanged } : {}),
    sourceExecutionGovernor,
    workspaceId,
  })
  for (const source of connectorWorkspace.scheduledWorkSources) {
    registerAdmittedScheduledWorkSource(source)
  }
  const lifecycle = createLocalLifecycleMethods(database, {
    workspaceId,
    now,
    initialCompanyAssignment,
  })
  const manualCompletionJobService = createPgliteJobService(database, {
    now,
    initialCompanyAssignment,
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
    connectors: connectorWorkspace.connectors,
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
  const normalizationExecutor = createNormalizationExecutor({
    database,
    fieldOutcomes: captureFieldOutcomes,
    getResolver: getProviderFieldResolver,
    repository: normalizationRepository,
    workspaceId,
    now,
  })
  registerAdmittedScheduledWorkSource(createScheduledWorkSource({
    id: 'normalization',
    repository: normalizationRepository,
    execute: (work) => normalizationExecutor(work),
    now,
  }))
  const destinationExecutor = createCaptureDestinationWorkExecutor({
    repository: destinationRepository,
    state: captureDestination,
    execute: (context, signal) => connectorWorkspace.resolveProviderDestination(context, signal),
  })
  registerAdmittedScheduledWorkSource(createScheduledWorkSource({
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
    await connectorWorkspace.recoverInterruptedRuns(now().toISOString())
  }
  if (connectorRunRecovery) {
    if (!pgliteDataPath) {
      throw new Error('pgliteDataPath is required when connectorRunRecovery is provided')
    }
    await connectorRunRecovery.activate({ pgliteDataPath, workspaceId }, recoverInterruptedRuns)
  } else {
    await recoverInterruptedRuns()
  }
  return guardLocalValedictorianClient(client, admission)
}
