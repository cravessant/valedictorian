import type {
  CreateSourcingFindingInput,
  PromoteSourcingFindingInput,
  SetSourcingFindingDecisionInput,
  SourcingFinding,
  SourcingFindingsListInput,
  SourcingFindingsListResult,
  UpdateSourcingFindingInput,
} from 'sparxie'

interface IpcRendererLike {
  invoke: (channel: string, input?: unknown) => Promise<unknown>
}

export interface SourcingPreloadApi {
  findings: {
    list: (query?: SourcingFindingsListInput) => Promise<SourcingFindingsListResult>
    create: (input: CreateSourcingFindingInput) => Promise<SourcingFinding>
    update: (input: UpdateSourcingFindingInput) => Promise<SourcingFinding>
    decide: (input: SetSourcingFindingDecisionInput) => Promise<SourcingFinding>
    promote: (input: PromoteSourcingFindingInput) => Promise<SourcingFinding>
  }
}

export function createSourcingPreloadApi(ipcRenderer: IpcRendererLike): SourcingPreloadApi {
  return {
    findings: {
      list(query) {
        return ipcRenderer.invoke('sourcing:findings:list', query) as Promise<SourcingFindingsListResult>
      },
      create(input) {
        return ipcRenderer.invoke('sourcing:findings:create', input) as Promise<SourcingFinding>
      },
      update(input) {
        return ipcRenderer.invoke('sourcing:findings:update', input) as Promise<SourcingFinding>
      },
      decide(input) {
        return ipcRenderer.invoke('sourcing:findings:decide', input) as Promise<SourcingFinding>
      },
      promote(input) {
        return ipcRenderer.invoke('sourcing:findings:promote', input) as Promise<SourcingFinding>
      },
    },
  }
}
