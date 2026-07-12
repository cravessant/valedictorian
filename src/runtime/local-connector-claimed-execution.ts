import type { ConnectorRefreshMode } from '@sparxie/valedictorian-connectors-core'
import type { LocalConnectorRegistry } from '../modules/connectors/connector.registry'
import type { createSqliteConnectorRepository, ConnectorRunRecord } from '../modules/connectors/connector.repository'
import { inclusiveCoverageStartFromEarliestBackfillDate } from '../modules/connectors/connector.earliest-backfill'
import type { createConnectorRunner, AppConnectorRefreshRecord } from '../modules/connectors/connector.runner'
import { finalizeDeferredConnectorRefreshRecord } from './local-connector-retry-dispatch'

export async function executeClaimedConnectorRun({
  connectorRegistry,
  connectorRepository,
  connectorRunner,
  connectorRunId,
  coverageEndedAt,
  executionIntent = 'ordinary',
  mode,
  now,
  startedAt,
}: {
  connectorRegistry: LocalConnectorRegistry
  connectorRepository: ReturnType<typeof createSqliteConnectorRepository>
  connectorRunner: ReturnType<typeof createConnectorRunner>
  connectorRunId: string
  coverageEndedAt: string
  executionIntent?: 'ordinary' | 'deferred_refresh'
  mode: ConnectorRefreshMode
  now: () => Date
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

    const connector = connectorRegistry.get(instance.connectorId) ?? null
    if (!connector) {
      throw new Error(`Unsupported connector id: ${instance.connectorId}`)
    }
    if (instance.connectorVersion !== connector.definition.version) {
      throw new Error(
        `Connector version mismatch for ${instance.connectorId}: expected ${connector.definition.version}`,
      )
    }

    const coverageStartedAt = inclusiveCoverageStartFromEarliestBackfillDate(
      instance.earliestBackfillDate,
    )

    const refreshRecord: AppConnectorRefreshRecord = (
      executionIntent === 'deferred_refresh' || mode === 'catch_up'
        ? await connectorRunner.catchUpWithDeferredCheckpoint(connector, {
          connectorRunId: runRequest.id,
          connectorInstanceId: runRequest.connectorInstanceId,
          now: coverageEndedAt,
          startedAt,
        })
        : await connectorRunner.refreshWithDeferredCheckpoint(
          connector,
          {
            connectorRunId: runRequest.id,
            connectorInstanceId: runRequest.connectorInstanceId,
            mode,
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

async function markClaimedRunFailedIfStillRunning({
  connectorRepository,
  connectorRunId,
  now,
}: {
  connectorRepository: ReturnType<typeof createSqliteConnectorRepository>
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
