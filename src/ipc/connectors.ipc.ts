import type { LocalValedictorianClient } from '../runtime/local-valedictorian-client'

interface IpcMainLike {
  handle: (channel: string, handler: (_event: unknown) => Promise<unknown>) => void
}

export function registerConnectorsIpc(
  connectors: LocalValedictorianClient['connectors'] | null,
  ipcMain: IpcMainLike,
) {
  ipcMain.handle('connectors:status:list', () =>
    connectors?.status.list() ?? Promise.resolve({ available: false, items: [] }),
  )
}
