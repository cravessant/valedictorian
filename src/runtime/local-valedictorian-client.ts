import fs from 'node:fs'
import type {
  ConnectorAuthReferenceInput,
  ConnectorObservation,
  CreateConnectorInstanceInput,
  UpdateConnectorInstanceInput,
  ValedictorianWorkspaceClient,
} from 'sparxie'
import { applications } from '../db/schema'
import { createDrizzleDatabase, createFileDatabase } from '../db/sqlite'
import {
  seedReferenceTrackerApplications,
  seedSampleApplications,
  seedSampleSourcingFindings,
} from '../modules/applications/application.fixtures'
import { createApplicationServiceFromSqlite } from '../modules/applications/application.runtime'
import { createSqliteActionQueueRepository } from '../modules/action-queue/action-queue.repository'
import { createConnectorNormalizationHost } from '../modules/connectors/connector.normalization'
import type { ConnectorRunRecoveryLifecycle } from '../modules/connectors/connector.recovery'
import {
  createDefaultLocalConnectorRegistry,
  type LocalConnectorRegistry,
} from '../modules/connectors/connector.registry'
import { createSqliteConnectorRepository } from '../modules/connectors/connector.repository'
import {
  createConnectorRunner,
  type AppConnectorAuthGrant,
  type AppConnectorAuthHost,
  type AppConnectorAuthValidationResult,
  type AppConnectorRefreshRecord,
  type AppConnectorRuntimePorts,
} from '../modules/connectors/connector.runner'
import {
  mapConnectorWarnings,
  mapConnectorStatusSummaries,
  mapConnectorStatusSummary,
  type ConnectorStatusListResult,
  type ConnectorStatusWarningView,
  type ConnectorStatusView,
} from '../modules/connectors/connector.status'
import type {
  ConnectorAuthMode,
  ConnectorAuthReference,
  ConnectorCheckpointRecord,
  ConnectorInstanceRecord,
  ConnectorObservationRecord,
  ConnectorRunRecord,
} from '../modules/connectors/connector.repository'
import { createSqlitePolicyRepository } from '../modules/policy/policy.repository'
import { createSqliteProfileRepository, type ProfileSecretCodec } from '../modules/profile/profile.repository'
import { createSqliteScoringRepository } from '../modules/scoring/scoring.repository'
import { createSqliteSourcingProcessor } from '../modules/sourcing/sourcing.processor'
import { createSqliteSourcingRepository } from '../modules/sourcing/sourcing.repository'
import { createCanonicalCandidateProjectionService } from '../modules/sourcing/canonical-candidate.projection'
import { createSqliteRawSourceRepository } from '../modules/sourcing/raw-source.repository'
import { createNormalizationOrchestrator } from '../modules/sourcing/normalization.orchestrator'
import { createNormalizationReplayService } from '../modules/sourcing/normalization-replay'
import { createSqliteNormalizationRepository } from '../modules/sourcing/normalization.repository'
import {
  createDefaultNormalizationResolverRegistry,
  type NormalizationResolverRegistry,
} from '../modules/sourcing/normalization.registry'
import { createSqliteWorkflowRunRepository } from '../modules/workflow-runs/workflow-run.repository'

export interface LocalValedictorianClientOptions {
  connectorRunRecovery?: ConnectorRunRecoveryLifecycle
  connectorRegistry?: LocalConnectorRegistry
  connectorRuntime?: AppConnectorRuntimePorts
  now?: () => Date
  normalizationRegistry?: NormalizationResolverRegistry
  referenceTrackerPath?: string
  seedDataMode?: ValedictorianSeedDataMode
  secretCodec?: ProfileSecretCodec
  sqlitePath: string
  workspaceId?: string
}

export type ValedictorianSeedDataMode = 'none' | 'sample' | 'reference-tracker'

export interface LocalConnectorAuthSummary {
  id: string
  mode: ConnectorAuthMode
  label: string | null
  configured: boolean
}

export interface LocalConnectorInstanceSummary {
  id: string
  connectorId: string
  connectorVersion: string
  displayName: string
  enabled: boolean
  auth: LocalConnectorAuthSummary[]
  config: unknown
  filters: unknown
  createdAt: string
  updatedAt: string
}

export interface LocalConnectorStatusSummary extends ConnectorStatusView {
  connectorVersion: string | null
  auth: LocalConnectorAuthSummary[]
  actionRequired: Array<{
    id: string
    kind: 'auth' | 'captcha' | 'configuration' | 'manual_review' | 'rate_limit'
    label: string
    message: string
    severity: 'healthy' | 'warning' | 'blocked'
  }>
}

export interface LocalConnectorRunSummary {
  id: string
  connectorInstanceId: string
  mode: string
  status: string
  coverage: {
    start: string | null
    end: string | null
  }
  filterSignature: string
  observationCount: number
  warningCount: number
  stats: unknown
  warnings: ConnectorStatusWarningView[]
  retryHints: unknown
  startedAt: string
  completedAt: string | null
}

export interface LocalConnectorObservationListInput {
  connectorInstanceId: string
  connectorRunId?: string
  limit?: number
  offset?: number
}

export interface LocalConnectorRunTriggerInput {
  connectorInstanceId: string
  mode?: 'manual' | 'scheduled' | 'catch_up'
  coverageStartedAt?: string | null
  coverageEndedAt?: string | null
  filterSignature?: string | null
  filters?: unknown
  reason?: string | null
  dryRun?: boolean
}

export interface LocalConnectorStartupCatchUpResult {
  runs: LocalConnectorRunSummary[]
  skipped: Array<{
    connectorInstanceId: string
    reason: 'disabled' | 'execution_failed' | 'unsupported_connector'
  }>
}

export interface LocalConnectorStatusActionInput {
  connectorInstanceId: string
}

export interface LocalConnectorSkipActionInput extends LocalConnectorStatusActionInput {
  reason?: string | null
}

export interface LocalConnectorAuthGrantSummary {
  id: string
  mode: ConnectorAuthMode
  status: AppConnectorAuthGrant['status']
  expiresAt?: string
  reason?: string
}

export interface LocalConnectorReconnectActionResult {
  action: 'reconnect'
  connectorInstanceId: string
  grants: LocalConnectorAuthGrantSummary[]
  message: string
  reason?: string
  status: AppConnectorAuthValidationResult['status'] | AppConnectorAuthGrant['status'] | 'unsupported'
}

export interface LocalConnectorSkipActionResult {
  action: 'skip'
  connectorInstanceId: string
  message: string
  run: LocalConnectorRunSummary
  status: 'skipped'
}

export interface LocalConnectorClient {
  list(): Promise<{ items: LocalConnectorInstanceSummary[] }>
  create(input: CreateConnectorInstanceInput): Promise<LocalConnectorInstanceSummary>
  update(input: UpdateConnectorInstanceInput): Promise<LocalConnectorInstanceSummary>
  inspect(connectorInstanceId: string): Promise<LocalConnectorStatusSummary>
  runs: {
    list(input: {
      connectorInstanceId: string
      status?: string
      mode?: string
      limit?: number
      offset?: number
    }): Promise<{
      items: LocalConnectorRunSummary[]
      total: number
      limit: number
      offset: number
      hasMore: boolean
    }>
    startupCatchUp(): Promise<LocalConnectorStartupCatchUpResult>
    trigger(input: LocalConnectorRunTriggerInput): Promise<LocalConnectorRunSummary>
  }
  checkpoints: {
    list(input: { connectorInstanceId: string; filterSignature?: string }): Promise<{
      items: Array<{
        connectorInstanceId: string
        filterSignature: string
        checkpoint: unknown
        schemaVersion: string
        coverage: {
          start: string | null
          end: string | null
        }
      }>
    }>
  }
  observations: {
    list(input: LocalConnectorObservationListInput): Promise<{
      items: ConnectorObservation[]
      total: number
      limit: number
      offset: number
      hasMore: boolean
    }>
  }
  status: {
    list(): Promise<ConnectorStatusListResult>
    reconnect(input: LocalConnectorStatusActionInput): Promise<LocalConnectorReconnectActionResult>
    skip(input: LocalConnectorSkipActionInput): Promise<LocalConnectorSkipActionResult>
  }
}

export type LocalValedictorianClient = ValedictorianWorkspaceClient & {
  connectors: LocalConnectorClient
}

const unavailableSecretCodec: ProfileSecretCodec = {
  decrypt() {
    throw new Error('Profile secrets are only available through local profile IPC')
  },
  encrypt() {
    throw new Error('Profile secrets are only available through local profile IPC')
  },
}

export function createLocalValedictorianClient({
  connectorRunRecovery,
  connectorRegistry = createDefaultLocalConnectorRegistry(),
  connectorRuntime,
  now = () => new Date(),
  normalizationRegistry = createDefaultNormalizationResolverRegistry(),
  referenceTrackerPath,
  seedDataMode = 'none',
  secretCodec = unavailableSecretCodec,
  sqlitePath,
  workspaceId = 'local-workspace',
}: LocalValedictorianClientOptions): LocalValedictorianClient {
  assertSeedOptions({ referenceTrackerPath, seedDataMode })

  const sqlite = createFileDatabase(sqlitePath)
  const applicationService = createApplicationServiceFromSqlite(sqlite)
  const database = createDrizzleDatabase(sqlite)

  seedLocalData(database, {
    referenceTrackerPath,
    seedDataMode,
  })

  const scoringRepository = createSqliteScoringRepository(database)
  const profileRepository = createSqliteProfileRepository(database, secretCodec)
  const actionQueueRepository = createSqliteActionQueueRepository(database)
  const connectorRepository = createSqliteConnectorRepository(database)
  const recoverInterruptedRuns = () => {
    connectorRepository.recoverInterruptedRuns({
      completedAt: now().toISOString(),
    })
  }

  if (connectorRunRecovery) {
    connectorRunRecovery.activate({ sqlitePath, workspaceId }, recoverInterruptedRuns)
  } else {
    recoverInterruptedRuns()
  }
  const policyRepository = createSqlitePolicyRepository(database)
  const workflowRunRepository = createSqliteWorkflowRunRepository(database)
  const sourcingProcessor = createSqliteSourcingProcessor(database)
  const sourcingRepository = createSqliteSourcingRepository(database)
  const rawSourceRepository = createSqliteRawSourceRepository(database, now)
  const canonicalCandidateProjection = createCanonicalCandidateProjectionService(now)
  const normalizationRepository = createSqliteNormalizationRepository(database, {
    projectPassedCandidate: (transaction, candidateId, rawRevisionId) =>
      canonicalCandidateProjection.projectPersisted(transaction, candidateId, rawRevisionId),
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
  const trustedConnectorAuth = composeTrustedConnectorAuth(profileRepository)
  const connectorRunner = createConnectorRunner({
    auth: trustedConnectorAuth,
    normalization: connectorNormalization,
    rawSource: {
      async ingest(record) {
        const result = await rawSourceRepository.ingestBatch({ records: [record] })
        return result.receipts[0]
      },
    },
    repository: connectorRepository,
    runtime: connectorRuntime,
    workspaceId,
    now,
  })
  let startupCatchUpPromise: Promise<LocalConnectorStartupCatchUpResult> | null = null

  const runStartupCatchUpOnce = () => {
    startupCatchUpPromise ??= executeConnectorStartupCatchUp({
      connectorRegistry,
      connectorRepository,
      connectorRunner,
      now,
    })

    return startupCatchUpPromise
  }

  const client: LocalValedictorianClient = {
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

        return mapConnectorInstanceSummary(await connectorRunner.registerInstance({
          id: input.id,
          connector,
          displayName: input.displayName,
          enabled: input.enabled,
          auth: mapConnectorAuthReferenceInputs(input.auth),
          config: input.config,
          filters: input.filters,
        }))
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

        if (connector && existing.connectorVersion !== connector.definition.version) {
          throw new Error(
            `Connector version mismatch for ${existing.connectorId}: expected ${connector.definition.version}`,
          )
        }

        const connectorVersion = input.connectorVersion
          ?? connector?.definition.version
          ?? existing.connectorVersion

        return mapConnectorInstanceSummary(await connectorRepository.upsertInstance({
          id: existing.id,
          connectorId: existing.connectorId,
          connectorVersion,
          displayName: input.displayName ?? existing.displayName,
          enabled: input.enabled ?? existing.enabled,
          auth: mapConnectorAuthReferenceInputs(input.auth) ?? existing.auth,
          config: input.config ?? toConnectorJsonRecord(existing.config, 'config'),
          filters: input.filters ?? toConnectorJsonRecord(existing.filters, 'filters'),
          createdAt: existing.createdAt,
        }))
      },
      inspect: async (connectorInstanceId) => {
        const record = await connectorRepository.getStatusSummary(connectorInstanceId)

        if (!record) {
          throw new Error(`Connector instance not found: ${connectorInstanceId}`)
        }

        return mapLocalConnectorStatusSummary(record)
      },
      runs: {
        list: async (input) => {
          const result = await connectorRepository.listRuns(input)

          return {
            ...result,
            items: result.items.map(mapConnectorRunSummary),
          }
        },
        startupCatchUp: runStartupCatchUpOnce,
        trigger: async (input) => {
          const run = await executeConnectorRunTrigger({
            connectorRegistry,
            connectorRepository,
            connectorRunner,
            input,
            now,
          })

          return mapConnectorRunSummary(run)
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
            run: mapConnectorRunSummary(run),
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
    profile: {
      get: () => profileRepository.getProfile(),
      update: (input) => profileRepository.updateProfile(input),
      agentContext: {
        get: () => profileRepository.getAgentContext(),
      },
      secrets: {
        delete: (key: string) => profileRepository.deleteSecret(key),
        list: () => profileRepository.listSecrets(),
        upsert: (input: Parameters<typeof profileRepository.upsertSecret>[0]) =>
          profileRepository.upsertSecret(input),
      },
      sensitive: {
        get: () => profileRepository.getSensitiveDetails(),
        update: (input: Parameters<typeof profileRepository.updateSensitiveDetails>[0]) =>
          profileRepository.updateSensitiveDetails(input),
      },
    } as ValedictorianWorkspaceClient['profile'],
    secrets: {
      delete: (key) => profileRepository.deleteSecret(key),
      list: async () => ({ items: await profileRepository.listSecrets() }),
      upsert: (input) => profileRepository.upsertSecret(input),
    },
    runs: {
      list: (query) => workflowRunRepository.listRuns(query),
      start: (input) => workflowRunRepository.startRun(input),
      step: (input) => workflowRunRepository.createRunStep(input),
      complete: (input) => workflowRunRepository.completeRun(input),
    },
    sourcing: {
      rawRecords: {
        ingestBatch: async (input) => {
          const result = await rawSourceRepository.ingestBatch(input)
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
            const result = normalizationRepository.getLatest(rawRecordId)
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

  return client
}

function composeTrustedConnectorAuth(
  profileRepository: ReturnType<typeof createSqliteProfileRepository>,
): AppConnectorAuthHost {
  return {
    secrets: {
      revealSecret: (key) => profileRepository.revealSecret(key),
    },
  }
}

async function reconnectConnectorStatus({
  connectorRegistry,
  connectorRepository,
  connectorRunner,
  input,
}: {
  connectorRegistry: LocalConnectorRegistry
  connectorRepository: ReturnType<typeof createSqliteConnectorRepository>
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

async function executeConnectorStartupCatchUp({
  connectorRegistry,
  connectorRepository,
  connectorRunner,
  now,
}: {
  connectorRegistry: LocalConnectorRegistry
  connectorRepository: ReturnType<typeof createSqliteConnectorRepository>
  connectorRunner: ReturnType<typeof createConnectorRunner>
  now: () => Date
}): Promise<LocalConnectorStartupCatchUpResult> {
  const runs: LocalConnectorRunSummary[] = []
  const skipped: LocalConnectorStartupCatchUpResult['skipped'] = []
  const coverageEndedAt = now().toISOString()

  for (const instance of await connectorRepository.listInstances()) {
    if (!instance.enabled) {
      skipped.push({
        connectorInstanceId: instance.id,
        reason: 'disabled',
      })
      continue
    }

    if (!connectorRegistry.get(instance.connectorId)) {
      skipped.push({
        connectorInstanceId: instance.id,
        reason: 'unsupported_connector',
      })
      continue
    }

    try {
      runs.push(mapConnectorRunSummary(await executeConnectorRunTrigger({
        connectorRegistry,
        connectorRepository,
        connectorRunner,
        input: {
          connectorInstanceId: instance.id,
          coverageEndedAt,
          mode: 'catch_up',
        },
        now,
      })))
    } catch {
      skipped.push({
        connectorInstanceId: instance.id,
        reason: 'execution_failed',
      })
    }
  }

  return { runs, skipped }
}

async function executeConnectorRunTrigger({
  connectorRegistry,
  connectorRepository,
  connectorRunner,
  input,
  now,
}: {
  connectorRegistry: LocalConnectorRegistry
  connectorRepository: ReturnType<typeof createSqliteConnectorRepository>
  connectorRunner: ReturnType<typeof createConnectorRunner>
  input: LocalConnectorRunTriggerInput
  now: () => Date
}): Promise<ConnectorRunRecord> {
  const startedAt = now().toISOString()
  const instance = await connectorRepository.getInstance(input.connectorInstanceId)

  if (!instance) {
    throw new Error(`Connector instance not found: ${input.connectorInstanceId}`)
  }

  const connector = connectorRegistry?.get(instance.connectorId) ?? null

  if (!connector) {
    throw new Error(`Unsupported connector id: ${instance.connectorId}`)
  }

  if (instance.connectorVersion !== connector.definition.version) {
    throw new Error(
      `Connector version mismatch for ${instance.connectorId}: expected ${connector.definition.version}`,
    )
  }

  const mode = input.mode ?? 'manual'
  assertExecutableConnectorTrigger(input, mode)
  const runRequestResult = await connectorRepository.recordRunRequest({
    connectorInstanceId: input.connectorInstanceId,
    mode,
    startedAt,
    coverageStartedAt: input.coverageStartedAt,
    coverageEndedAt: input.coverageEndedAt,
    reason: input.reason,
  })

  if (!runRequestResult.acquired) {
    return runRequestResult.run
  }

  const runRequest = runRequestResult.run

  await connectorRepository.markRunRunning({
    connectorRunId: runRequest.id,
    startedAt,
  })

  let refreshRecord: AppConnectorRefreshRecord

  try {
    refreshRecord = mode === 'catch_up'
      ? await connectorRunner.catchUpWithDeferredCheckpoint(connector, {
        connectorRunId: runRequest.id,
        connectorInstanceId: input.connectorInstanceId,
        now: input.coverageEndedAt ?? startedAt,
        startedAt,
      })
      : await connectorRunner.refreshWithDeferredCheckpoint(
        connector,
        {
          connectorRunId: runRequest.id,
          connectorInstanceId: input.connectorInstanceId,
          mode,
          coverage: requiredCoverageWindow(input, mode),
          startedAt,
        },
      )
  } catch (error) {
    await connectorRepository.markRunFailed({
      connectorRunId: runRequest.id,
      completedAt: now().toISOString(),
      retryHints: {
        reason: 'connector_execution_failed',
      },
      warning: {
        code: 'connector.execution_failed',
        message: 'Connector execution failed.',
      },
    })
    throw error
  }

  const { checkpoint, run, terminalStatus } = refreshRecord
  let projectedRun = run

  try {
    projectedRun = await connectorRepository.updateRunProgress({
      connectorRunId: run.id,
      stats: {
        projected: 0,
        projectedEmployerOrAts: 0,
        projectedThirdParty: 0,
        projectedUsable: 0,
        retainedForReview: 0,
        stage: 'persisting',
        lastProgressAt: now().toISOString(),
      },
    })
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
      retryHints: {
        reason: 'sourcing_projection_failed',
      },
      warning: {
        code: 'connector.sourcing_projection_failed',
        message: 'Canonical sourcing projection failed.',
      },
    })
    throw error
  }

  return projectedRun
}

function assertExecutableConnectorTrigger(
  input: LocalConnectorRunTriggerInput,
  mode: NonNullable<LocalConnectorRunTriggerInput['mode']>,
) {
  if (input.dryRun) {
    throw new Error('dryRun connector triggers are not supported for executed connector runs')
  }

  if (input.filters !== undefined || input.filterSignature !== undefined) {
    throw new Error('Per-run connector filter overrides are not supported for executed connector runs')
  }

  if (mode === 'catch_up') {
    return
  }

  if (!input.coverageStartedAt || !input.coverageEndedAt) {
    throw new Error(`coverageStartedAt and coverageEndedAt are required for ${mode} connector runs`)
  }
}

function requiredCoverageWindow(
  input: LocalConnectorRunTriggerInput,
  mode: Exclude<NonNullable<LocalConnectorRunTriggerInput['mode']>, 'catch_up'>,
) {
  if (!input.coverageStartedAt || !input.coverageEndedAt) {
    throw new Error(`coverageStartedAt and coverageEndedAt are required for ${mode} connector runs`)
  }

  return {
    start: input.coverageStartedAt,
    end: input.coverageEndedAt,
  }
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
    auth: record.auth.map(mapConnectorAuthSummary),
    config: record.config,
    filters: record.filters,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function mapLocalConnectorStatusSummary(
  record: ConnectorInstanceRecord & { latestRun: ConnectorRunRecord | null },
): LocalConnectorStatusSummary {
  const status = mapConnectorStatusSummary(record)
  const auth = record.auth.map(mapConnectorAuthSummary)

  return {
    ...status,
    connectorVersion: record.connectorVersion,
    auth,
    actionRequired: actionRequiredForStatus(status, auth),
  }
}

function mapConnectorAuthSummary(reference: ConnectorAuthReference): LocalConnectorAuthSummary {
  return {
    id: reference.id,
    mode: reference.mode,
    label: reference.label ?? null,
    configured: isConnectorAuthConfigured(reference),
  }
}

function isConnectorAuthConfigured(reference: ConnectorAuthReference): boolean {
  if (reference.mode === 'none') {
    return true
  }

  if (reference.mode === 'browser_session') {
    return typeof reference.sessionKey === 'string' && reference.sessionKey.trim().length > 0
  }

  return typeof reference.secretKey === 'string' && reference.secretKey.trim().length > 0
}

function actionRequiredForStatus(
  status: ConnectorStatusView,
  auth: LocalConnectorAuthSummary[],
): LocalConnectorStatusSummary['actionRequired'] {
  if (status.status === 'auth_required') {
    return [
      {
        id: auth[0]?.id ?? status.id,
        kind: 'auth',
        label: status.actionLabel ?? 'Reconnect',
        message: status.summary,
        severity: status.severity,
      },
    ]
  }

  const actions: LocalConnectorStatusSummary['actionRequired'] = []

  for (const warning of status.warnings) {
    if (warning.code === 'source.captcha') {
      actions.push({
        id: warning.code,
        kind: 'captcha',
        label: warning.label,
        message: warning.message,
        severity: warning.severity,
      })
      continue
    }

    if (warning.code === 'source.rate_limited') {
      actions.push({
        id: warning.code,
        kind: 'rate_limit',
        label: warning.label,
        message: warning.message,
        severity: warning.severity,
      })
    }
  }

  return actions
}

function mapConnectorRunSummary(record: ConnectorRunRecord): LocalConnectorRunSummary {
  return {
    id: record.id,
    connectorInstanceId: record.connectorInstanceId,
    mode: record.mode,
    status: record.status,
    coverage: {
      start: record.coverageStartedAt,
      end: record.coverageEndedAt,
    },
    filterSignature: record.filterSignature,
    observationCount: record.observationCount,
    warningCount: record.warningCount,
    stats: record.stats,
    warnings: mapConnectorWarnings(record.warnings),
    retryHints: safeConnectorRetryHints(record.retryHints),
    startedAt: record.startedAt,
    completedAt: record.completedAt,
  }
}

const safeConnectorRetryReasons = new Set([
  'auth_reference_missing',
  'auth_required',
  'auth_validation_failed',
  'browser_session_action_required',
  'browser_session_expired',
  'browser_session_key_missing',
  'browser_session_login_cancelled',
  'browser_session_login_failed',
  'browser_session_resolution_failed',
  'browser_session_runtime_missing',
  'browser_session_runtime_unavailable',
  'browser_session_verification_failed',
  'browser_session_verification_required',
  'browser_session_verification_timed_out',
  'budget_exhausted',
  'connector_execution_failed',
  'connector_run_interrupted',
  'disabled',
  'execution_failed',
  'jobright_auth_failed',
  'jobright_auth_ready',
  'jobright_auth_request_failed',
  'jobright_auth_required',
  'jobright_auth_retryable',
  'jobright_challenge_blocked',
  'jobright_discovery_rate_limited',
  'jobright_discovery_failed',
  'jobright_discovery_retryable',
  'jobright_login_rejected',
  'jobright_login_retryable',
  'jobright_not_logged_in',
  'jobright_parser_changed',
  'jobright_rate_limited',
  'jobright_retryable_failure',
  'jobright_resolution',
  'jobright_resolution_deferred',
  'jobright_zero_useful_results',
  'projection_failed',
  'secret_missing',
  'secret_reference_missing',
  'settings_manual_refresh',
  'unsupported_connector',
  'user_skipped_auth_required_run',
  'username_password_malformed',
  'username_password_missing',
  'validate_auth_failed',
  'validate_auth_unsupported',
])

const safeConnectorRetryActions = new Set([
  'refresh_jobright_auth',
  'retry_jobright_after_challenge',
  'retry_jobright_with_backoff',
  'review_jobright_results',
  'update_jobright_parser',
])

function safeConnectorRetryHints(value: unknown): Record<string, unknown> | null {
  const retryHints = safeJsonRecord(value)
  const safeHints: Record<string, unknown> = {}
  const reason = retryHints.reason

  if (typeof reason === 'string' && safeConnectorRetryReasons.has(reason)) {
    safeHints.reason = reason
  }

  for (const key of ['authRequired', 'rateLimited'] as const) {
    const metric = retryHints[key]

    if (typeof metric === 'boolean' || (
      typeof metric === 'number' && Number.isFinite(metric) && metric >= 0
    )) {
      safeHints[key] = metric
    }
  }

  for (const key of ['captcha', 'parserChanged', 'retryAfterSeconds', 'retryableFailures'] as const) {
    const metric = retryHints[key]

    if (typeof metric === 'number' && Number.isFinite(metric) && metric >= 0) {
      safeHints[key] = metric
    }
  }

  if (typeof retryHints.recommended === 'boolean') {
    safeHints.recommended = retryHints.recommended
  }

  if (Array.isArray(retryHints.actions)) {
    const actions = retryHints.actions.filter(
      (action): action is string => typeof action === 'string' && safeConnectorRetryActions.has(action),
    )

    if (actions.length > 0) {
      safeHints.actions = [...new Set(actions)]
    }
  }

  if (retryHints.source === 'jobright') {
    safeHints.source = 'jobright'
  }

  if (retryHints.skippedBy === 'user') {
    safeHints.skippedBy = 'user'
  }

  return Object.keys(safeHints).length > 0 ? safeHints : null
}

function safeJsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function mapConnectorCheckpoint(record: ConnectorCheckpointRecord) {
  return {
    connectorInstanceId: record.connectorInstanceId,
    filterSignature: record.filterSignature,
    checkpoint: record.checkpoint,
    schemaVersion: record.schemaVersion,
    coverage: {
      start: record.coverageStartedAt,
      end: record.coverageEndedAt,
    },
  }
}

function mapConnectorObservation(record: ConnectorObservationRecord): ConnectorObservation {
  return {
    ...record,
    locationRaw: record.locationRaw ?? null,
    descriptionText: record.descriptionText ?? null,
    pay: record.pay ?? null,
  }
}

function mapConnectorAuthReferenceInputs(
  references: ConnectorAuthReferenceInput[] | undefined,
): ConnectorAuthReference[] | undefined {
  return references?.map((reference) => ({
    id: reference.id,
    mode: reference.mode,
    ...(reference.label === undefined || reference.label === null ? {} : { label: reference.label }),
    ...(reference.secretKey === undefined ? {} : { secretKey: reference.secretKey }),
    ...(reference.sessionKey === undefined ? {} : { sessionKey: reference.sessionKey }),
  }))
}

function toConnectorJsonRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  throw new Error(`Invalid connector ${fieldName}`)
}

function seedLocalData(
  database: ReturnType<typeof createDrizzleDatabase>,
  {
    referenceTrackerPath,
    seedDataMode,
  }: Pick<LocalValedictorianClientOptions, 'referenceTrackerPath' | 'seedDataMode'>,
) {
  if (seedDataMode === 'none') {
    return
  }

  if (database.select().from(applications).limit(1).get()) {
    return
  }

  if (seedDataMode === 'sample') {
    seedSampleApplications(database)
    seedSampleSourcingFindings(database)
    return
  }

  seedReferenceTrackerApplications(
    database,
    fs.readFileSync(requireReferenceTrackerPath(referenceTrackerPath), 'utf8'),
  )
}

function assertSeedOptions({
  referenceTrackerPath,
  seedDataMode,
}: Pick<LocalValedictorianClientOptions, 'referenceTrackerPath' | 'seedDataMode'>) {
  if (seedDataMode === 'reference-tracker' && !referenceTrackerPath) {
    throw new Error(
      'VALEDICTORIAN_REFERENCE_TRACKER_PATH is required when VALEDICTORIAN_SEED_DATA=reference-tracker',
    )
  }
}

function requireReferenceTrackerPath(referenceTrackerPath: string | undefined) {
  if (!referenceTrackerPath) {
    throw new Error(
      'VALEDICTORIAN_REFERENCE_TRACKER_PATH is required when VALEDICTORIAN_SEED_DATA=reference-tracker',
    )
  }

  return referenceTrackerPath
}
