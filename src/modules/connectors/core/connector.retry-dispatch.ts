import type { ConnectorRunRecord, ConnectorRepository } from '../ports/connector.repository.port'

/** Finalize an already-durable connector capture run and its checkpoint. */
export async function finalizeDeferredConnectorRefreshRecord({
  checkpoint,
  connectorRepository,
  now,
  run,
  terminalStatus,
}: {
  checkpoint: Parameters<ConnectorRepository['recordCheckpoint']>[0]
  connectorRepository: ConnectorRepository
  now: () => Date
  run: ConnectorRunRecord
  terminalStatus: Parameters<ConnectorRepository['completeRun']>[0]['status']
}): Promise<ConnectorRunRecord> {
  let projectedRun = run
  try {
    projectedRun = await connectorRepository.updateRunProgress({
      connectorRunId: run.id,
      stats: { stage: 'finalizing', lastProgressAt: now().toISOString() },
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
      retryHints: null,
      warning: {
        code: 'connector.finalize_failed',
        message: 'Connector captured durable intake but failed to finalize its checkpoint.',
      },
    })
    throw error
  }
  return projectedRun
}
