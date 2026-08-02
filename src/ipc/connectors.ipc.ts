import type { LocalValedictorianClient } from '@sparxie/valedictorian-local-runtime/local-client'
import {
  removeConnectorInstanceInputSchema,
  triggerConnectorRunInputSchema,
} from '@sparxie/sdk'
import {
  connectorRetirementIpcConflict,
  connectorRetirementIpcSuccess,
  publicConnectorRunsListResult,
  publicConnectorRunSummary,
  publicConnectorSkipActionResult,
} from '@sparxie/valedictorian-local-runtime/connectors'
import { publicConnectorStatusSummary } from '@sparxie/valedictorian-local-runtime/runtime'
interface IpcMainLike {
  handle: (channel: string, handler: (_event: unknown, input?: unknown) => Promise<unknown>) => void
}

export function registerConnectorsIpc(
  connectors: LocalValedictorianClient['connectors'] | null,
  ipcMain: IpcMainLike,
) {
  ipcMain.handle('connectors:list', () =>
    connectors?.list() ?? Promise.resolve({ items: [] }),
  )
  ipcMain.handle('connectors:create', (_event, input) => {
    assertConnectorsAvailable(connectors)
    return connectors.create(input as Parameters<typeof connectors.create>[0])
  })
  ipcMain.handle('connectors:update', (_event, input) => {
    assertConnectorsAvailable(connectors)
    return connectors.update(input as Parameters<typeof connectors.update>[0])
  })
  ipcMain.handle('connectors:remove', (_event, input) => {
    assertConnectorsAvailable(connectors)
    return connectors.remove(removeConnectorInstanceInputSchema.parse(input))
      .then(connectorRetirementIpcSuccess)
      .catch((error: unknown) => {
        const conflict = connectorRetirementIpcConflict(error)
        if (conflict) return conflict
        throw error
      })
  })
  ipcMain.handle('connectors:inspect', (_event, connectorInstanceId) => {
    assertConnectorsAvailable(connectors)
    return connectors.inspect(parseConnectorInstanceId(connectorInstanceId))
      .then(publicConnectorStatusSummary)
  })
  ipcMain.handle('connectors:runs:list', (_event, input) => {
    assertConnectorsAvailable(connectors)
    return connectors.runs.list(input as Parameters<typeof connectors.runs.list>[0])
      .then(publicConnectorRunsListResult)
  })
  ipcMain.handle('connectors:runs:trigger', async (_event, input) => {
    assertConnectorsAvailable(connectors)
    const parsed = triggerConnectorRunInputSchema.parse(input)
    const run = await connectors.runs.trigger(parsed)
    return publicConnectorRunSummary(run)
  })
  ipcMain.handle('connectors:status:reconnect', (_event, input) => {
    assertConnectorsAvailable(connectors)
    return connectors.status.reconnect(parseConnectorStatusActionInput(input))
  })
  ipcMain.handle('connectors:status:skip', (_event, input) => {
    assertConnectorsAvailable(connectors)
    return connectors.status.skip(parseConnectorStatusActionInput(input))
      .then(publicConnectorSkipActionResult)
  })
}

function assertConnectorsAvailable(
  connectors: LocalValedictorianClient['connectors'] | null,
): asserts connectors is LocalValedictorianClient['connectors'] {
  if (!connectors) {
    throw new Error('Connector status actions are unavailable for this runtime.')
  }
}

function parseConnectorInstanceId(input: unknown) {
  if (typeof input !== 'string' || input.trim().length === 0) {
    throw new Error('connectorInstanceId is required for connector inspection.')
  }

  return input.trim()
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
