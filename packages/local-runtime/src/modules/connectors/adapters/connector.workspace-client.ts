/**
 * The connector workspace client (issue #327).
 *
 * The one way server, runtime, and IPC composition talks to connectors. It owns
 * repository construction, every repository call, and every record-to-result
 * projection, so a persisted connector row never leaves this module: the factory
 * takes composition dependencies, and every method it returns speaks only command
 * inputs and consumer-shaped results.
 *
 * Internal layering of this module is #329's; this is the ownership boundary only.
 */
import {
  connectorOverviewListQuerySchema,
  connectorOverviewListResultSchema,
  DEFAULT_CONNECTOR_OVERVIEW_LIST_LIMIT,
} from '@sparxie/sdk'
import type { ConnectorSchedulingCapability } from '@sparxie/sdk'
import type { ConnectorProviderUrlResolverResult } from '@sparxie/valedictorian-connectors-core'
import type { PgliteDatabase } from '../../../db/pglite.js'
import type { LocalScheduledWorkSource } from '../../scheduling/public.js'
import { createConnectorCaptureRetryWorkSource } from './scheduling/connector-capture-retry.source.js'
import {
  connectorDisabledExecutionError,
  connectorInstalledVersionMismatchError,
} from '../public/connector.execution-errors.js'
import { retireConnectorInstance } from './persistence/connector-retirement.persistence.js'
import { createConnectorScheduleRepository } from './persistence/connector-schedule.repository.js'
import { createConnectorScheduleService } from './connector-schedule.service.js'
import { createConnectorScheduleWorkSource } from './scheduling/connector-schedule.source.js'
import { listInstalledConnectorDescriptors } from '../core/connector.capabilities.js'
import { executeClaimedConnectorRun } from '../core/connector.claimed-execution.js'
import { connectorCheckpointSignature } from '../core/connector.checkpoint-signature.js'
import type {
  LocalConnectorClient,
  LocalConnectorInternalRunTriggerInput,
  LocalConnectorReconnectActionResult,
  LocalConnectorStatusActionInput,
} from '../core/connector.consumer-contract.js'
import {
  inclusiveCoverageStartFromEarliestBackfillDate,
  maximumSelectableEarliestBackfillDate,
  validateSelectableEarliestBackfillDate,
} from '../public/connector.earliest-backfill.js'
import {
  mapConnectorInstanceSummary,
  mapLocalConnectorStatusSummary,
  parseConnectorAuthReferenceInputs,
} from '../core/connector.instance-projection.js'
import { createConnectorOptionQueryService } from '../core/connector.option-query.js'
import { toJsonRecord } from '../ports/connector.json-values.js'
import {
  createConnectorOverviewCursor,
  readConnectorOverviewCursor,
} from '../core/connector.overview-cursor.js'
import { mapLocalConnectorOverviewRecord } from '../core/connector.overview-projection.js'
import type { LocalConnectorRegistry } from '../core/connector.registry.js'
import { createPgliteConnectorRepository } from './persistence/connector.repository.js'
import {
  createConnectorRunSummaryProjection,
  mapConnectorCheckpoint,
  mapConnectorObservation,
} from '../core/connector.run-record.projection.js'
import type { AppConnectorAuthGrant, AppConnectorAuthHost, AppConnectorAuthValidationResult, AppConnectorRuntimePorts } from '../ports/connector.runner-contracts.js'
import { createRunRuntime } from '../core/connector.run-runtime.js'
import { createConnectorRunner } from './connector.runner.js'
import type { AppConnectorCaptureHost } from '../ports/connector.capture-host.port.js'
import type {
  createSourceExecutionGovernor,
  createSourceSessionExecutor,
} from '../../source-execution/public.js'
import { admitConnectorSettings } from '../core/connector.settings-validation.js'
import { mapConnectorStatusSummaries } from '../core/connector.status.js'

export interface ConnectorWorkspaceClient {
  /** The consumer-shaped connector conversation the workspace client exposes. */
  readonly connectors: LocalConnectorClient
  /** Sources the app scheduler registers; each is opaque scheduled work. */
  readonly scheduledWorkSources: readonly LocalScheduledWorkSource[]
  /** Resolves one provider destination URL for a scheduled capture-destination job. */
  resolveProviderDestination(
    context: {
      readonly connectorInstanceId: string
      readonly executionScopeId: string
      readonly providerRecordId: string
      readonly resolverId: string
      readonly resolverVersion: string
    },
    signal?: AbortSignal,
  ): Promise<ConnectorProviderUrlResolverResult>
  /** Returns interrupted runs to a terminal state after an unclean shutdown. */
  recoverInterruptedRuns(completedAt: string): Promise<void>
}

export function createConnectorWorkspaceClient({
  authHost,
  captureHost,
  connectorRegistry,
  connectorRuntime,
  connectorScheduling,
  database,
  destinationSessionExecutor,
  now,
  onScheduledWorkChanged,
  sourceExecutionGovernor,
  workspaceId,
}: {
  authHost: AppConnectorAuthHost
  captureHost: AppConnectorCaptureHost
  connectorRegistry: LocalConnectorRegistry
  connectorRuntime?: AppConnectorRuntimePorts
  connectorScheduling: ConnectorSchedulingCapability
  database: PgliteDatabase
  destinationSessionExecutor: ReturnType<typeof createSourceSessionExecutor>
  now: () => Date
  onScheduledWorkChanged?: () => void
  sourceExecutionGovernor: ReturnType<typeof createSourceExecutionGovernor>
  workspaceId: string
}): ConnectorWorkspaceClient {
  const connectorRepository = createPgliteConnectorRepository(database)
  const scheduleRepository = createConnectorScheduleRepository(database, now)
  const connectorOptionQueries = createConnectorOptionQueryService({
    authHost,
    connectorRegistry,
    connectorRepository,
    workspaceId,
  })
  const connectorRunner = createConnectorRunner({
    auth: authHost,
    captureHost,
    repository: connectorRepository,
    sourceExecutionGovernor,
    runtime: connectorRuntime,
    workspaceId,
    now,
  })
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
  const mapRun = createConnectorRunSummaryProjection({ connectorRepository, scheduleRepository })

  const connectors: LocalConnectorClient = {
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
        auth: parseConnectorAuthReferenceInputs(input.auth),
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
        auth: parseConnectorAuthReferenceInputs(input.auth) ?? existing.auth,
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
}

  return {
    connectors,
    scheduledWorkSources: [
      createConnectorScheduleWorkSource({
        dispatchDue: (input, signal) => schedules.dispatchDueWithSignal(input, signal),
        listSchedules: () => scheduleRepository.listEnabled(),
        now,
      }),
      createConnectorCaptureRetryWorkSource({
        listRetries: () => scheduleRepository.listScheduledCaptureRetries(),
        now,
        runRetry: async (connectorInstanceId, signal) => await mapRun(await executeConnectorRunTrigger({
          connectorRegistry, connectorRepository, connectorRunner,
          input: { connectorInstanceId, reason: 'scheduled_capture_retry' }, mode: 'scheduled',
          now,
          retryKind: 'connector_capture', ...(signal ? { signal } : {}),
        })),
      }),
    ],
    async resolveProviderDestination(context, signal) {
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
        authHost,
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
    async recoverInterruptedRuns(completedAt) {
      await connectorRepository.recoverInterruptedRuns({ completedAt })
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
}) {
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


function isConnectorMaintenanceOnlyUpdate(input: object & { auth?: unknown; enabled?: boolean }) {
  const keys = Object.keys(input)
  return (input.enabled === false && keys.every((key) =>
    key === 'connectorInstanceId' || key === 'enabled'))
    || (input.auth !== undefined && keys.every((key) =>
      key === 'connectorInstanceId' || key === 'auth'))
}

function toConnectorJsonRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  throw new Error(`Invalid connector ${fieldName}`)
}
