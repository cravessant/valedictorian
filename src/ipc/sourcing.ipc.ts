import type {
  CreateSourcingFindingInput,
  JobAppClient,
  PromoteSourcingFindingInput,
  SetSourcingFindingDecisionInput,
  SourcingFindingsListInput,
  UpdateSourcingFindingInput,
} from 'sparxie'

interface IpcMainLike {
  handle: (channel: string, handler: (_event: unknown, input?: unknown) => Promise<unknown>) => void
}

export function registerSourcingIpc(client: JobAppClient, ipcMain: IpcMainLike) {
  ipcMain.handle('sourcing:findings:list', (_event, query) =>
    client.sourcing.findings.list(query as SourcingFindingsListInput | undefined),
  )
  ipcMain.handle('sourcing:findings:create', (_event, input) =>
    client.sourcing.findings.create(input as CreateSourcingFindingInput),
  )
  ipcMain.handle('sourcing:findings:update', (_event, input) =>
    client.sourcing.findings.update(input as UpdateSourcingFindingInput),
  )
  ipcMain.handle('sourcing:findings:decide', (_event, input) =>
    client.sourcing.findings.decide(input as SetSourcingFindingDecisionInput),
  )
  ipcMain.handle('sourcing:findings:promote', (_event, input) =>
    client.sourcing.findings.promote(input as PromoteSourcingFindingInput),
  )
}
