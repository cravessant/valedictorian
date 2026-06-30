import type { ScoreInput, ScoreRecord } from 'sparxie'

interface IpcRendererLike {
  invoke: (channel: string, input?: unknown) => Promise<unknown>
}

export interface ScoresPreloadApi {
  record: (input: ScoreInput) => Promise<ScoreRecord>
}

export function createScoresPreloadApi(ipcRenderer: IpcRendererLike): ScoresPreloadApi {
  return {
    record(input) {
      return ipcRenderer.invoke('scores:record', input) as Promise<ScoreRecord>
    },
  }
}
