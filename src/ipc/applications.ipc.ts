import type { JobAppClient } from 'job-app-sdk'
import type { ApplicationListQuery } from '../modules/applications/application.types'

interface IpcMainLike {
  handle(
    channel: string,
    handler: (_event: unknown, query?: ApplicationListQuery) => Promise<unknown>,
  ): void
}

export function registerApplicationIpc(client: JobAppClient, ipcMain: IpcMainLike) {
  ipcMain.handle('applications:list', (_event, query) => client.applications.list(query))
}
