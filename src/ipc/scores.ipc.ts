import type { ValedictorianClient, ScoreInput } from 'sparxie'

interface IpcMainLike {
  handle: (channel: string, handler: (_event: unknown, input?: unknown) => Promise<unknown>) => void
}

export function registerScoresIpc(client: ValedictorianClient, ipcMain: IpcMainLike) {
  ipcMain.handle('scores:record', (_event, input) => client.scores.record(input as ScoreInput))
}
