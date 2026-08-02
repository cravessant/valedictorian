import type {
  ConnectorProgressRuntime,
  ConnectorProgressSnapshot,
} from '@sparxie/valedictorian-connectors-core'
import type {
  ConnectorInstanceRecord,
  ConnectorRefreshResultInput,
  ConnectorRepository,
  ConnectorRunTerminalStatus,
} from '../ports/connector.repository.port.js'
import type {
  AppConnectorAuthHost,
  AppConnectorAuthValidationResult,
  AppConnectorRefreshRecord,
  AppConnectorRuntimePorts,
  AppJobConnector,
  ConnectorRunner,
  RegisterConnectorInstanceInput,
  RunConnectorCatchUpInput,
  RunConnectorRefreshInput,
  ValidateConnectorAuthInput,
} from '../ports/connector.runner-contracts.js'
import type { AppConnectorCaptureHost } from '../ports/connector.capture-host.port.js'
import type {
  ConnectorSourceExecutionGovernor,
  ConnectorSourceSession,
} from '../ports/connector.source-execution.port.js'
import { inclusiveCoverageStartFromEarliestBackfillDate } from '../public/connector.earliest-backfill.js'
import * as connectorCheckpointSignatureModule from './connector.checkpoint-signature.js'
import { restoreUnacquiredJobrightV5RetryEntries } from './connector.jobright-checkpoint-merge.js'
import {
  createBoundConnectorDataRuntime,
} from './connector.bound-data-runtime.js'
import { unexpectedConnectorExecutionError } from '../public/connector.execution-errors.js'
import { sanitizeConnectorRefreshResult } from './connector.refresh-result-sanitizer.js'
import { assertConnectorRefreshResult } from './connector.refresh-contract.js'
import { createRunRuntime, redactSensitiveValue } from './connector.run-runtime.js'
import { validateConnectorAuth } from './connector.auth-validation.js'

export interface CreateConnectorRunnerCoreOptions {
  auth?: AppConnectorAuthHost
  captureHost?: AppConnectorCaptureHost
  repository: ConnectorRepository
  sourceExecutionGovernor?: ConnectorSourceExecutionGovernor
  sessionExecutor: ConnectorSourceSession | null
  runtime?: AppConnectorRuntimePorts
  workspaceId: string
  now?: () => Date
}

export function createConnectorRunnerCore({
  auth,
  captureHost,
  repository,
  sessionExecutor,
  sourceExecutionGovernor,
  runtime = {},
  workspaceId,
  now = () => new Date(),
}: CreateConnectorRunnerCoreOptions): ConnectorRunner {
  async function runRefresh(
    connector: AppJobConnector,
    input: RunConnectorRefreshInput,
    instance?: ConnectorInstanceRecord,
    options: { checkpointPersistence?: 'deferred' | 'immediate' } = {},
  ): Promise<AppConnectorRefreshRecord> {
    const startedAt = input.startedAt ?? now().toISOString()
    const connectorInstance = instance ?? await repository.getInstance(input.connectorInstanceId)
    if (!connectorInstance) {
      throw new Error(`Connector instance not found: ${input.connectorInstanceId}`)
    }
    const config = cloneJsonRecord(toJsonRecord(connectorInstance.config))
    const filters = cloneJsonRecord(toJsonRecord(connectorInstance.filters))
    const runConfig = cloneJsonRecord(config)
    const runFilters = cloneJsonRecord(filters)
    const filterSignature = checkpointSignatureForConnector(connector, filters)
    const checkpoint = await repository.getCheckpoint({
      connectorInstanceId: input.connectorInstanceId,
      filterSignature,
    })
    const sensitiveValues = new Set<string>()
    const authRequirements = connector.definition.auth?.requirements ?? []
    const runRuntime = createRunRuntime(
      input.signal ? { ...runtime, cancellation: { signal: input.signal } } : runtime,
      connectorInstance.auth,
      authRequirements,
      auth,
      sensitiveValues,
      connectorInstance.executionScopeId,
      sessionExecutor,
      false,
      input.connectorRunId
        ? createPersistedProgressRuntime(repository, input.connectorRunId, now, runtime.progress)
        : runtime.progress,
      input.connectorRunId
          ? createBoundConnectorDataRuntime({
            captureHost,
            connector,
            connectorInstanceId: connectorInstance.id,
            connectorRunId: input.connectorRunId,
            executionScopeId: connectorInstance.executionScopeId,
          })
        : undefined,
    )
    let result: ConnectorRefreshResultInput
    try {
      const refreshInput = {
        connectorInstanceId: input.connectorInstanceId,
        executionScopeId: connectorInstance.executionScopeId,
        workspaceId,
        mode: input.mode,
        coverage: input.coverage,
        config,
        filters,
        ...(input.checkpointOverride !== undefined
          ? { checkpoint: input.checkpointOverride }
          : checkpoint
            ? { checkpoint: checkpoint.checkpoint }
            : {}),
        ...(input.observations ? { observations: input.observations } : {}),
      }
      try {
        result = sanitizeConnectorRefreshResult(
          await connector.refresh(refreshInput, runRuntime),
        )
        assertConnectorRefreshResult(result, connectorInstance.executionScopeId)
      } catch {
        throw unexpectedConnectorExecutionError()
      }
      if (result.operationOutcome?.kind === 'scope_rate_limited') {
        if (result.operationOutcome.executionScopeId !== connectorInstance.executionScopeId) {
          throw new Error('Connector returned rate-limit evidence for a different execution scope')
        }
        if (!sourceExecutionGovernor) throw new Error('Source execution governor is required')
        await sourceExecutionGovernor.blockScope(connectorInstance.executionScopeId, {
          now: now().toISOString(), retryAfter: result.operationOutcome.retryAt,
        })
      }
    } finally {
      // Canonical capture intake owns no per-run normalization resources.
    }
    const safeResult = withRunProgressStats(redactRefreshResult(result, sensitiveValues))
    const nextCheckpoint = input.restoreUnacquiredJobrightRetryEntries
      ? restoreUnacquiredJobrightV5RetryEntries({
          acquiredProviderRecordId: input.restoreUnacquiredJobrightRetryEntries.acquiredProviderRecordId,
          originalCheckpoint: input.restoreUnacquiredJobrightRetryEntries.originalCheckpoint,
          returned: safeResult.nextCheckpoint,
        })
      : safeResult.nextCheckpoint
    const completedAt = input.completedAt ?? now().toISOString()
    const run = await repository.recordRefreshResult({
      connectorRunId: input.connectorRunId,
      connectorInstanceId: input.connectorInstanceId,
      mode: input.mode,
      startedAt,
      completedAt,
      config: runConfig,
      filters: runFilters,
      filterSignature,
      checkpointPersistence: options.checkpointPersistence,
      result: {
        ...safeResult,
        status: terminalConnectorRunStatus(safeResult.status),
        nextCheckpoint,
      },
    })
    return {
      checkpoint: {
        connectorInstanceId: input.connectorInstanceId,
        filterSignature,
        checkpoint: nextCheckpoint,
        coverage: safeResult.coverage,
        savedAt: completedAt,
      },
      run,
      terminalStatus: terminalConnectorRunStatus(safeResult.status),
    }
  }
  async function prepareCatchUpRefresh(
    _connector: AppJobConnector,
    input: RunConnectorCatchUpInput,
  ): Promise<{
    instance: ConnectorInstanceRecord
    refreshInput: RunConnectorRefreshInput
  }> {
    const instance = await repository.getInstance(input.connectorInstanceId)
    if (!instance) {
      throw new Error(`Connector instance not found: ${input.connectorInstanceId}`)
    }
    const end = parseIsoDate(input.now ?? now().toISOString(), 'catch-up now')
    const coverageStart = input.coverageStartedAt === undefined
      ? inclusiveCoverageStartFromEarliestBackfillDate(instance.earliestBackfillDate)
      : parseIsoDate(input.coverageStartedAt, 'catch-up coverage start').toISOString()
    return {
      instance,
      refreshInput: {
        connectorRunId: input.connectorRunId,
        connectorInstanceId: input.connectorInstanceId,
        mode: 'catch_up',
        coverage: {
          start: coverageStart,
          end: end.toISOString(),
        },
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        ...(input.observations ? { observations: input.observations } : {}),
        ...(input.checkpointOverride !== undefined
          ? { checkpointOverride: input.checkpointOverride }
          : {}),
        ...(input.restoreUnacquiredJobrightRetryEntries
          ? { restoreUnacquiredJobrightRetryEntries: input.restoreUnacquiredJobrightRetryEntries }
          : {}),
        ...(input.signal ? { signal: input.signal } : {}),
      },
    }
  }
  async function validateAuth(
    connector: AppJobConnector,
    input: ValidateConnectorAuthInput,
  ): Promise<AppConnectorAuthValidationResult> {
    return validateConnectorAuth(
      { auth, now, repository, runtime, sessionExecutor, sourceExecutionGovernor, workspaceId },
      connector,
      input,
    )
  }
  return {
    async registerInstance(input: RegisterConnectorInstanceInput) {
      return repository.upsertInstance({
        id: input.id,
        connectorId: input.connector.definition.id,
        connectorVersion: input.connector.definition.version,
        displayName: input.displayName,
        enabled: input.enabled,
        auth: input.auth,
        config: input.config,
        filters: input.filters,
        earliestBackfillDate: input.earliestBackfillDate,
        createdAt: input.createdAt,
      })
    },
    async registerInstanceIfAbsent(input: RegisterConnectorInstanceInput) {
      return repository.createInstance({
        id: input.id,
        connectorId: input.connector.definition.id,
        connectorVersion: input.connector.definition.version,
        displayName: input.displayName,
        enabled: input.enabled,
        auth: input.auth,
        config: input.config,
        filters: input.filters,
        earliestBackfillDate: input.earliestBackfillDate,
        createdAt: input.createdAt,
      })
    },
    async refresh(
      connector: AppJobConnector,
      input: RunConnectorRefreshInput,
    ) {
      return (await runRefresh(connector, input)).run
    },
    async refreshWithDeferredCheckpoint(
      connector: AppJobConnector,
      input: RunConnectorRefreshInput,
    ): Promise<AppConnectorRefreshRecord> {
      return runRefresh(connector, input, undefined, {
        checkpointPersistence: 'deferred',
      })
    },
    async catchUp(
      connector: AppJobConnector,
      input: RunConnectorCatchUpInput,
    ) {
      const { instance, refreshInput } = await prepareCatchUpRefresh(connector, input)
      return (await runRefresh(connector, refreshInput, instance)).run
    },
    async catchUpWithDeferredCheckpoint(
      connector: AppJobConnector,
      input: RunConnectorCatchUpInput,
    ): Promise<AppConnectorRefreshRecord> {
      const { instance, refreshInput } = await prepareCatchUpRefresh(connector, input)
      return runRefresh(
        connector,
        refreshInput,
        instance,
        {
          checkpointPersistence: 'deferred',
        },
      )
    },
    validateAuth,
  }
}

function terminalConnectorRunStatus(value: unknown): ConnectorRunTerminalStatus {
  if (
    value === 'cancelled' ||
    value === 'failed' ||
    value === 'skipped'
  ) {
    return value
  }
  if (value === 'completed') return value
  throw new Error(`Invalid connector refresh status: ${String(value)}`)
}
const connectorRunProgressMetricKeys = [
  'attempted',
  'authRequired',
  'discovered',
  'eligible',
  'resolved',
] as const
function withRunProgressStats(
  result: ConnectorRefreshResultInput,
): ConnectorRefreshResultInput {
  const checkpoint = toJsonRecord(result.nextCheckpoint.checkpoint)
  const checkpointStats: Record<string, number> = {}
  for (const key of connectorRunProgressMetricKeys) {
    const value = checkpoint[key]
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
      checkpointStats[key] = value
    }
  }
  return {
    ...result,
    stats: {
      ...checkpointStats,
      ...result.stats,
    },
  }
}
const connectorProgressCountKeys = [
  'attempted',
  'discovered',
  'eligible',
  'filtered',
  'resolvedEmployerOrAts',
  'resolvedThirdParty',
  'skipped',
  'unresolved',
] as const
function createPersistedProgressRuntime(
  repository: ConnectorRepository,
  connectorRunId: string,
  now: () => Date,
  downstream: ConnectorProgressRuntime | undefined,
): ConnectorProgressRuntime {
  return {
    async report(snapshot) {
      await repository.updateRunProgress({
        connectorRunId,
        stats: sanitizeProgressSnapshot(snapshot, now().toISOString()),
      })
      await downstream?.report(snapshot)
    },
  }
}
function sanitizeProgressSnapshot(
  snapshot: ConnectorProgressSnapshot,
  lastProgressAt: string,
): Record<string, unknown> {
  const counts: Record<string, number> = {}
  for (const key of connectorProgressCountKeys) {
    const value = snapshot.counts[key]
    counts[key] = typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0, Math.floor(value))
      : 0
  }
  return {
    ...counts,
    lastProgressAt,
    stage: snapshot.stage,
    wait: snapshot.wait
      ? {
          maxDelayMs: Math.max(0, Math.floor(snapshot.wait.maxDelayMs)),
          minDelayMs: Math.max(0, Math.floor(snapshot.wait.minDelayMs)),
          reason: snapshot.wait.reason === 'jobright_resolution'
            ? 'jobright_resolution'
            : 'connector_pacing',
        }
      : null,
  }
}
function redactRefreshResult(
  result: ConnectorRefreshResultInput,
  sensitiveValues: Set<string>,
): ConnectorRefreshResultInput {
  if (sensitiveValues.size === 0) {
    return result
  }
  return redactSensitiveValue(result, sensitiveValues) as ConnectorRefreshResultInput
}
function parseIsoDate(value: string, label: string): Date {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid connector ${label}: ${value}`)
  }
  return date
}
function toJsonRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return value as Record<string, unknown>
}
function cloneJsonRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(stableJsonStringify(value)) as Record<string, unknown>
}
function checkpointSignatureForConnector(
  connector: AppJobConnector,
  filters: Record<string, unknown>,
): string {
  return connectorCheckpointSignatureModule.connectorCheckpointSignature({
    connectorId: connector.definition.id,
    connectorVersion: connector.definition.version,
    supportsFiltering: connector.definition.capabilities?.supportsFiltering,
    filters,
  })
}
export function isJobrightRawFirstConnector(connector: AppJobConnector): boolean {
  return connectorCheckpointSignatureModule.isJobrightProviderStateSignature({
    connectorId: connector.definition.id,
    connectorVersion: connector.definition.version,
    supportsFiltering: connector.definition.capabilities?.supportsFiltering,
  })
}
function stableJsonStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(',')}]`
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJsonStringify(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}
