import type { ValedictorianWorkspaceClient, ScoreInput } from '@sparxie/sdk'

interface IpcMainLike {
  handle: (channel: string, handler: (_event: unknown, input?: unknown) => Promise<unknown>) => void
}

export function registerScoresIpc(client: Pick<ValedictorianWorkspaceClient, 'scores'>, ipcMain: IpcMainLike) {
  ipcMain.handle('scores:record', (_event, input) => client.scores.record(input as ScoreInput))
}
