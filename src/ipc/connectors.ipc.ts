import type { LocalValedictorianClient } from '../runtime/local-valedictorian-client'

interface IpcMainLike {
  handle: (channel: string, handler: (_event: unknown, input?: unknown) => Promise<unknown>) => void
}

export function registerConnectorsIpc(
  connectors: LocalValedictorianClient['connectors'] | null,
  ipcMain: IpcMainLike,
) {
  ipcMain.handle('connectors:status:list', () =>
    connectors?.status.list() ?? Promise.resolve({ available: false, items: [] }),
  )
  ipcMain.handle('connectors:status:reconnect', (_event, input) => {
    assertConnectorsAvailable(connectors)
    return connectors.status.reconnect(parseConnectorStatusActionInput(input))
  })
  ipcMain.handle('connectors:status:skip', (_event, input) => {
    assertConnectorsAvailable(connectors)
    return connectors.status.skip(parseConnectorStatusActionInput(input))
  })
}

function assertConnectorsAvailable(
  connectors: LocalValedictorianClient['connectors'] | null,
): asserts connectors is LocalValedictorianClient['connectors'] {
  if (!connectors) {
    throw new Error('Connector status actions are unavailable for this runtime.')
  }
}

function parseConnectorStatusActionInput(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('connectorInstanceId is required for connector status actions.')
  }

  const record = input as Record<string, unknown>
  const connectorInstanceId = record.connectorInstanceId

  if (typeof connectorInstanceId !== 'string' || connectorInstanceId.trim().length === 0) {
    throw new Error('connectorInstanceId is required for connector status actions.')
  }

  return {
    connectorInstanceId: connectorInstanceId.trim(),
    ...(typeof record.reason === 'string' && record.reason.trim().length > 0
      ? { reason: record.reason.trim() }
      : {}),
  }
}
