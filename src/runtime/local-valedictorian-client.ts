import fs from 'node:fs'
import type {
  ConnectorAuthReferenceInput,
  ConnectorObservation,
  ConnectorRunSummary,
  RetryAdvice,
  ValedictorianWorkspaceClient
} from 'sparxie'
import { retryAdviceSchema } from 'sparxie'
import { applications } from '../db/schema'
import { createDrizzleDatabase, createFileDatabase } from '../db/sqlite'
import {
  seedReferenceTrackerApplications,
  seedSampleApplications,
  seedSampleSourcingFindings
} from '../modules/applications/application.fixtures'
import { createApplicationServiceFromSqlite } from '../modules/applications/application.runtime'
import { createSqliteActionQueueRepository } from '../modules/action-queue/action-queue.repository'
import { createConnectorNormalizationHost } from '../modules/connectors/connector.normalization'
import {
  createDefaultLocalConnectorRegistry,
  type LocalConnectorRegistry
} from '../modules/connectors/connector.registry'
import { createSqliteConnectorRepository } from '../modules/connectors/connector.repository'
import {
  resolveConnectorSchedulingCapability,
} from '../modules/connectors/connector-schedule.capability'
import { createConnectorScheduleRepository } from '../modules/connectors/connector-schedule.repository'
import { createConnectorScheduleService } from '../modules/connectors/connector-schedule.service'
import {
  inclusiveCoverageStartFromEarliestBackfillDate,
  maximumSelectableEarliestBackfillDate,
  validateSelectableEarliestBackfillDate,
} from '../modules/connectors/connector.earliest-backfill'
import { connectorCheckpointSignature } from '../modules/connectors/connector.checkpoint-signature'
import {
  createConnectorRunner,
  type AppConnectorAuthGrant,
  type AppConnectorAuthHost,
  type AppConnectorAuthValidationResult,
} from '../modules/connectors/connector.runner'
import {
  mapConnectorWarnings,
  mapConnectorStatusSummaries,
  mapConnectorStatusSummary,
  type ConnectorStatusView
} from '../modules/connectors/connector.status'
import type {
  ConnectorAuthReference,
  ConnectorCheckpointRecord,
  ConnectorInstanceRecord,
  ConnectorObservationRecord,
  ConnectorRunRecord
} from '../modules/connectors/connector.repository'
import { createSqlitePolicyRepository } from '../modules/policy/policy.repository'
import { createSqliteProfileRepository, type ProfileSecretCodec } from '../modules/profile/profile.repository'
import { createSqliteScoringRepository } from '../modules/scoring/scoring.repository'
import { createSqliteSourcingProcessor } from '../modules/sourcing/sourcing.processor'
import { createSqliteSourcingRepository } from '../modules/sourcing/sourcing.repository'
import { createCanonicalCandidateProjectionService } from '../modules/sourcing/canonical-candidate.projection'
import { createSqliteRawSourceRepository } from '../modules/sourcing/raw-source.repository'
import { createNormalizationOrchestrator } from '../modules/sourcing/normalization.orchestrator'
import {
  dispatchAcquiredNormalizationWork,
} from './local-connector-retry-dispatch'
import { executeClaimedConnectorRun } from './local-connector-claimed-execution'
import { createNormalizationReplayService } from '../modules/sourcing/normalization-replay'
import { createSqliteNormalizationRepository } from '../modules/sourcing/normalization.repository'
import {
  createDefaultNormalizationResolverRegistry,
} from '../modules/sourcing/normalization.registry'
import { createSqliteWorkflowRunRepository } from '../modules/workflow-runs/workflow-run.repository'

export type {
  LocalValedictorianClientOptions,
  ValedictorianSeedDataMode,
  LocalConnectorAuthSummary,
  LocalConnectorInstanceSummary,
  LocalConnectorStatusSummary,
  LocalConnectorRunSummary,
  LocalConnectorObservationListInput,
  LocalConnectorRunTriggerInput,
  LocalConnectorStatusActionInput,
  LocalConnectorSkipActionInput,
  LocalConnectorAuthGrantSummary,
  LocalConnectorReconnectActionResult,
  LocalConnectorSkipActionResult,
  LocalConnectorClient,
  LocalValedictorianClient,
} from './local-valedictorian-client.types'
import type {
  LocalValedictorianClientOptions,
  LocalConnectorAuthSummary,
  LocalConnectorInstanceSummary,
  LocalConnectorStatusSummary,
  LocalConnectorRunSummary,
  LocalConnectorInternalRunTriggerInput,
  LocalConnectorStatusActionInput,
  LocalConnectorReconnectActionResult,
  LocalValedictorianClient
} from './local-valedictorian-client.types'

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
  connectorScheduling: connectorSchedulingOption,
  now = () => new Date(),
  normalizationRegistry = createDefaultNormalizationResolverRegistry(),
  referenceTrackerPath,
  seedDataMode = 'none',
  secretCodec = unavailableSecretCodec,
  sqlitePath,
  workspaceId = 'local-workspace',
}: LocalValedictorianClientOptions): LocalValedictorianClient {
  assertSeedOptions({ referenceTrackerPath, seedDataMode })

  const connectorScheduling = resolveConnectorSchedulingCapability(connectorSchedulingOption)
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
      startedAt: input.startedAt,
    }),
    getRun: (connectorRunId) => connectorRepository.getRun(connectorRunId),
    now,
    repository: scheduleRepository,
  })

  const mapRun = (record: ConnectorRunRecord): LocalConnectorRunSummary => {
    const occurrence = scheduleRepository.getOccurrenceLinkForRun(record.id)
    if (!occurrence || !occurrence.connectorRunId) {
      return mapConnectorRunSummary(record)
    }

    return mapConnectorRunSummary(record, {
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

        const createdAt = now().toISOString()
        const earliestBackfillDate = input.earliestBackfillDate === undefined
          ? undefined
          : validateSelectableEarliestBackfillDateOrThrow(
            input.earliestBackfillDate,
            createdAt,
            createdAt,
          )

        return mapConnectorInstanceSummary(await connectorRunner.registerInstance({
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

        const updateNow = now().toISOString()
        const earliestBackfillDate = input.earliestBackfillDate === undefined
          ? existing.earliestBackfillDate
          : validateSelectableEarliestBackfillDateOrThrow(
            input.earliestBackfillDate,
            existing.createdAt,
            updateNow,
          )

        return mapConnectorInstanceSummary(await connectorRepository.upsertInstance({
          id: existing.id,
          connectorId: existing.connectorId,
          connectorVersion,
          displayName: input.displayName ?? existing.displayName,
          enabled: input.enabled ?? existing.enabled,
          auth: mapConnectorAuthReferenceInputs(input.auth) ?? existing.auth,
          config: input.config ?? toConnectorJsonRecord(existing.config, 'config'),
          filters: input.filters ?? toConnectorJsonRecord(existing.filters, 'filters'),
          earliestBackfillDate,
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
            items: result.items.map(mapRun),
          }
        },
        trigger: async (input) => {
          const run = await executeConnectorRunTrigger({
            connectorRegistry,
            connectorRepository,
            connectorRunner,
            input,
            normalizationOrchestrator,
            normalizationRegistry,
            normalizationRepository,
            now,
          })

          return mapRun(run)
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
            run: mapRun(run),
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

async function executeConnectorRunTrigger({
  connectorRegistry,
  connectorRepository,
  connectorRunner,
  input,
  normalizationOrchestrator,
  normalizationRegistry,
  normalizationRepository,
  now,
}: {
  connectorRegistry: LocalConnectorRegistry
  connectorRepository: ReturnType<typeof createSqliteConnectorRepository>
  connectorRunner: ReturnType<typeof createConnectorRunner>
  input: LocalConnectorInternalRunTriggerInput
  normalizationOrchestrator: ReturnType<typeof createNormalizationOrchestrator>
  normalizationRegistry: ReturnType<typeof createDefaultNormalizationResolverRegistry>
  normalizationRepository: ReturnType<typeof createSqliteNormalizationRepository>
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

  const executionIntent = input.executionIntent ?? 'ordinary'
  const mode = 'manual'
  assertExecutableConnectorTrigger(input, executionIntent)
  const filters = toJsonRecord(instance.filters)
  const filterSignature = connectorCheckpointSignature({
    connectorId: connector.definition.id,
    connectorVersion: connector.definition.version,
    supportsFiltering: connector.definition.capabilities?.supportsFiltering,
    filters,
  })
  const coverageEndedAt = executionIntent === 'deferred_refresh'
    ? (input.coverageEndedAt ?? startedAt)
    : input.coverageEndedAt
  if (!coverageEndedAt) {
    throw new Error('coverageEndedAt is required for connector runs')
  }
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

  if (!input.coverageEndedAt) {
    throw new Error('coverageEndedAt is required for manual connector runs')
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
    auth: record.auth.map(mapConnectorAuthSummary),
    config: record.config,
    filters: record.filters,
    earliestBackfillDate: record.earliestBackfillDate,
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

function mapConnectorRunSummary(
  record: ConnectorRunRecord,
  scheduleOccurrence: ConnectorRunSummary['scheduleOccurrence'] = null,
): ConnectorRunSummary {
  if (
    scheduleOccurrence
    && record.mode === 'scheduled'
    && scheduleOccurrence.admittedMode === 'scheduled'
  ) {
    return {
      id: record.id,
      connectorInstanceId: record.connectorInstanceId,
      mode: 'scheduled',
      scheduleOccurrence,
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
      retryHints: parseConnectorRetryAdvice(record.retryHints),
      startedAt: record.startedAt,
      completedAt: record.completedAt,
    }
  }

  if (
    scheduleOccurrence
    && record.mode === 'catch_up'
    && scheduleOccurrence.admittedMode === 'catch_up'
  ) {
    return {
      id: record.id,
      connectorInstanceId: record.connectorInstanceId,
      mode: 'catch_up',
      scheduleOccurrence,
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
      retryHints: parseConnectorRetryAdvice(record.retryHints),
      startedAt: record.startedAt,
      completedAt: record.completedAt,
    }
  }

  return {
    id: record.id,
    connectorInstanceId: record.connectorInstanceId,
    mode: 'manual',
    scheduleOccurrence: null,
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
    retryHints: parseConnectorRetryAdvice(record.retryHints),
    startedAt: record.startedAt,
    completedAt: record.completedAt,
  }
}

function parseConnectorRetryAdvice(value: unknown): RetryAdvice | null {
  if (value === null || value === undefined) return null
  return retryAdviceSchema.parse(value)
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
