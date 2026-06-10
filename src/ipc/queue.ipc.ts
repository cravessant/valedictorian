import type { ValedictorianClient, QueueListQuery } from 'sparxie'

interface IpcMainLike {
  handle(
    channel: string,
    handler: (_event: unknown, query?: QueueListQuery) => Promise<unknown>,
  ): void
}

export function registerQueueIpc(client: ValedictorianClient, ipcMain: IpcMainLike) {
  ipcMain.handle('queue:list', (_event, query) => client.queue.list(query))
}
