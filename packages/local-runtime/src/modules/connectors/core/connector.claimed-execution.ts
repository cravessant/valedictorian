import type { ConnectorRefreshMode } from '@sparxie/valedictorian-connectors-core'
import { connectorInstalledVersionMismatchError } from '../public/connector.execution-errors.js'
import { revalidatePersistedConnectorSettings } from './connector.settings-validation.js'
import type { ConnectorRunRecord, ConnectorRepository } from '../ports/connector.repository.port.js'
import type { AppConnectorRefreshRecord, ConnectorRunner } from '../ports/connector.runner-contracts.js'
import type { LocalConnectorRegistry } from './connector.registry.js'
import { finalizeDeferredConnectorRefreshRecord } from './connector.retry-dispatch.js'

export async function executeClaimedConnectorRun({
  connectorRegistry,
  connectorRepository,
  connectorRunner,
  connectorRunId,
  coverageEndedAt,
  executionIntent = 'ordinary',
  mode,
  now,
  signal,
  startedAt,
}: {
  connectorRegistry: LocalConnectorRegistry
  connectorRepository: ConnectorRepository
  connectorRunner: ConnectorRunner
  connectorRunId: string
  coverageEndedAt: string
  executionIntent?: 'ordinary' | 'deferred_refresh'
  mode: ConnectorRefreshMode
  now: () => Date
  signal?: AbortSignal
  startedAt: string
}): Promise<ConnectorRunRecord> {
  try {
    const runRequest = await connectorRepository.getRun(connectorRunId)
    if (!runRequest) {
      throw new Error(`Connector run not found: ${connectorRunId}`)
    }
    if (runRequest.status !== 'running') {
      throw new Error(`Claimed connector run is not running: ${connectorRunId}`)
    }

    const instance = await connectorRepository.getInstance(runRequest.connectorInstanceId)
    if (!instance) {
      throw new Error(`Connector instance not found: ${runRequest.connectorInstanceId}`)
    }

    const registered = connectorRegistry.get(instance.connectorId) ?? null
    if (!registered) {
      throw new Error(`Unsupported connector id: ${instance.connectorId}`)
    }
    if (instance.connectorVersion !== registered.descriptor.connectorVersion) {
      throw connectorInstalledVersionMismatchError(
        instance.connectorId,
        registered.descriptor.connectorVersion,
      )
    }
    const connector = registered.connector
    // Single execution-side trust boundary: every entry point (manual, scheduled, retry,
    // deferred refresh) claims a run through here before any connector code is reached.
    revalidatePersistedConnectorSettings(registered.descriptor, instance)

    const coverageStartedAt = await persistedClaimedCoverageStart(
      connectorRepository,
      runRequest,
    )

    const refreshRecord: AppConnectorRefreshRecord = (
      executionIntent === 'deferred_refresh' || mode === 'catch_up'
        ? await connectorRunner.catchUpWithDeferredCheckpoint(connector, {
          connectorRunId: runRequest.id,
          connectorInstanceId: runRequest.connectorInstanceId,
          coverageStartedAt,
          now: coverageEndedAt,
          ...(signal ? { signal } : {}),
          startedAt,
        })
        : await connectorRunner.refreshWithDeferredCheckpoint(
          connector,
          {
            connectorRunId: runRequest.id,
            connectorInstanceId: runRequest.connectorInstanceId,
            mode,
            ...(signal ? { signal } : {}),
            coverage: {
              start: coverageStartedAt,
              end: coverageEndedAt,
            },
            startedAt,
          },
        )
    )

    return finalizeDeferredConnectorRefreshRecord({
      checkpoint: refreshRecord.checkpoint,
      connectorRepository,
      now,
      run: refreshRecord.run,
      terminalStatus: refreshRecord.terminalStatus,
    })
  } catch (error) {
    await markClaimedRunFailedIfStillRunning({
      connectorRepository,
      connectorRunId,
      now,
    })
    throw error
  }
}

async function persistedClaimedCoverageStart(
  connectorRepository: ConnectorRepository,
  run: ConnectorRunRecord,
): Promise<string> {
  if (!run.coverageStartedAt || !Number.isFinite(Date.parse(run.coverageStartedAt))) {
    throw new Error(`Claimed connector run has invalid persisted coverage start: ${run.id}`)
  }
  const snapshot = await connectorRepository.getRunSynchronization(run.id)
  const synchronization = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
    ? snapshot as Record<string, unknown>
    : null
  const backfill = synchronization?.historicalBackfill
  const boundary = backfill && typeof backfill === 'object' && !Array.isArray(backfill)
    ? (backfill as Record<string, unknown>).boundary
    : null
  const earliestDate = boundary && typeof boundary === 'object' && !Array.isArray(boundary)
    ? (boundary as Record<string, unknown>).earliestDate
    : null
  const normalized = new Date(run.coverageStartedAt).toISOString()
  if (earliestDate !== normalized.slice(0, 10)) {
    throw new Error(`Claimed connector run has inconsistent persisted coverage boundary: ${run.id}`)
  }
  return normalized
}

async function markClaimedRunFailedIfStillRunning({
  connectorRepository,
  connectorRunId,
  now,
}: {
  connectorRepository: ConnectorRepository
  connectorRunId: string
  now: () => Date
}): Promise<void> {
  const current = await connectorRepository.getRun(connectorRunId)
  if (!current || current.status !== 'running') {
    return
  }

  await connectorRepository.markRunFailed({
    connectorRunId,
    completedAt: now().toISOString(),
    retryHints: null,
    warning: {
      code: 'connector.execution_failed',
      message: 'Connector execution failed.',
    },
  })
}
