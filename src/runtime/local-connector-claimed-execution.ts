import type { ConnectorRefreshMode } from '@sparxie/valedictorian-connectors-core'
import type { LocalConnectorRegistry } from '../modules/connectors/connector.registry'
import type { createPgliteConnectorRepository, ConnectorRunRecord } from '../modules/connectors/connector.repository'
import type { createConnectorRunner, AppConnectorRefreshRecord } from '../modules/connectors/connector.runner'
import { finalizeDeferredConnectorRefreshRecord } from './local-connector-retry-dispatch'
import { reconcileConnectorPackageUpgrade } from './local-connector-upgrade-reconciliation'

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
  connectorRepository: ReturnType<typeof createPgliteConnectorRepository>
  connectorRunner: ReturnType<typeof createConnectorRunner>
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

    let instance = await connectorRepository.getInstance(runRequest.connectorInstanceId)
    if (!instance) {
      throw new Error(`Connector instance not found: ${runRequest.connectorInstanceId}`)
    }

    const connector = connectorRegistry.get(instance.connectorId) ?? null
    if (!connector) {
      throw new Error(`Unsupported connector id: ${instance.connectorId}`)
    }
    instance = await reconcileConnectorPackageUpgrade({
      connector,
      connectorRepository,
      instance,
    })

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
  connectorRepository: ReturnType<typeof createPgliteConnectorRepository>,
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
  connectorRepository: ReturnType<typeof createPgliteConnectorRepository>
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
