import type {
  EvaluateApplicationPolicyInput,
  EvaluateOpportunityPolicyInput,
  EvaluateRunWindowPolicyInput,
  PolicyConfig,
  PolicyConfigPatch,
  PolicyDecision,
  PolicyEvidenceInput,
  PolicyEvidenceListInput,
  PolicyEvidenceRecord,
  PolicyRunWindowDecision,
} from '@sparxie/sdk'

interface IpcRendererLike {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>
}

export interface PolicyPreloadApi {
  config: {
    get: () => Promise<PolicyConfig>
    reset: () => Promise<PolicyConfig>
    update: (patch: PolicyConfigPatch) => Promise<PolicyConfig>
  }
  evidence: {
    list: (query?: PolicyEvidenceListInput) => Promise<PolicyEvidenceRecord[]>
    record: (input: PolicyEvidenceInput) => Promise<PolicyEvidenceRecord>
  }
  evaluate: {
    application: (input: EvaluateApplicationPolicyInput) => Promise<PolicyDecision>
    opportunity: (input: EvaluateOpportunityPolicyInput) => Promise<PolicyDecision>
    runWindow: (input: EvaluateRunWindowPolicyInput) => Promise<PolicyRunWindowDecision>
  }
}

export function createPolicyPreloadApi(ipcRenderer: IpcRendererLike): PolicyPreloadApi {
  return {
    config: {
      get: () => ipcRenderer.invoke('policy:config:get') as Promise<PolicyConfig>,
      reset: () => ipcRenderer.invoke('policy:config:reset') as Promise<PolicyConfig>,
      update: (patch) =>
        ipcRenderer.invoke('policy:config:update', patch) as Promise<PolicyConfig>,
    },
    evidence: {
      list: (query) =>
        ipcRenderer.invoke('policy:evidence:list', query) as Promise<PolicyEvidenceRecord[]>,
      record: (input) =>
        ipcRenderer.invoke('policy:evidence:record', input) as Promise<PolicyEvidenceRecord>,
    },
    evaluate: {
      application: (input) =>
        ipcRenderer.invoke('policy:evaluate:application', input) as Promise<PolicyDecision>,
      opportunity: (input) =>
        ipcRenderer.invoke('policy:evaluate:opportunity', input) as Promise<PolicyDecision>,
      runWindow: (input) =>
        ipcRenderer.invoke('policy:evaluate:run-window', input) as Promise<PolicyRunWindowDecision>,
    },
  }
}
