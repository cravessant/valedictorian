import type { ValedictorianWorkspaceClient, ActionQueueListQuery } from 'sparxie'

interface IpcMainLike {
  handle(
    channel: string,
    handler: (_event: unknown, query?: ActionQueueListQuery) => Promise<unknown>,
  ): void
}

export function registerActionQueueIpc(client: ValedictorianWorkspaceClient, ipcMain: IpcMainLike) {
  ipcMain.handle('action-queue:list', (_event, query) => client.actionQueue.list(query))
}
