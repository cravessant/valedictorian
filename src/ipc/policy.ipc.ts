import type {
  EvaluateApplicationPolicyInput,
  EvaluateRunWindowPolicyInput,
  EvaluateSourcingCandidatePolicyInput,
  JobAppClient,
  PolicyConfigPatch,
  PolicyEvidenceInput,
  PolicyEvidenceListInput,
} from 'sparxie'

interface IpcMainLike {
  handle(
    channel: string,
    handler: (_event: unknown, payload?: unknown) => Promise<unknown>,
  ): void
}

export function registerPolicyIpc(client: JobAppClient, ipcMain: IpcMainLike) {
  ipcMain.handle('policy:config:get', () => client.policy.config.get())
  ipcMain.handle('policy:config:update', (_event, patch) =>
    client.policy.config.update(patch as PolicyConfigPatch),
  )
  ipcMain.handle('policy:config:reset', () => client.policy.config.reset())
  ipcMain.handle('policy:evidence:list', (_event, query) =>
    client.policy.evidence.list(query as PolicyEvidenceListInput | undefined),
  )
  ipcMain.handle('policy:evidence:record', (_event, input) =>
    client.policy.evidence.record(input as PolicyEvidenceInput),
  )
  ipcMain.handle('policy:evaluate:application', (_event, input) =>
    client.policy.evaluate.application(input as EvaluateApplicationPolicyInput),
  )
  ipcMain.handle('policy:evaluate:sourcing-candidate', (_event, input) =>
    client.policy.evaluate.sourcingCandidate(input as EvaluateSourcingCandidatePolicyInput),
  )
  ipcMain.handle('policy:evaluate:run-window', (_event, input) =>
    client.policy.evaluate.runWindow(input as EvaluateRunWindowPolicyInput),
  )
}
