import type {
  ProfileAgentContext,
  ProfileSecretSummary,
  ProfileUpdateInput,
  UpsertProfileSecretInput,
  UserProfile,
} from '@sparxie/sdk'

interface IpcRendererLike {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>
}

export interface ProfilePreloadApi {
  agentContext: {
    get: () => Promise<ProfileAgentContext>
  }
  get: () => Promise<UserProfile>
  identity: {
    set: (value: string) => Promise<void>
    status: () => Promise<boolean>
  }
  secrets: {
    delete: (key: string) => Promise<void>
    list: () => Promise<ProfileSecretSummary[]>
    upsert: (input: UpsertProfileSecretInput) => Promise<ProfileSecretSummary>
  }
  update: (input: ProfileUpdateInput) => Promise<UserProfile>
}

export function createProfilePreloadApi(ipcRenderer: IpcRendererLike): ProfilePreloadApi {
  return {
    agentContext: {
      get: () => ipcRenderer.invoke('profile:agent-context:get') as Promise<ProfileAgentContext>,
    },
    get: () => ipcRenderer.invoke('profile:get') as Promise<UserProfile>,
    identity: {
      set: (value) => ipcRenderer.invoke('profile:identity:set', value) as Promise<void>,
      status: () => ipcRenderer.invoke('profile:identity:status') as Promise<boolean>,
    },
    secrets: {
      delete: (key) => ipcRenderer.invoke('profile:secrets:delete', key) as Promise<void>,
      list: () => ipcRenderer.invoke('profile:secrets:list') as Promise<ProfileSecretSummary[]>,
      upsert: (input) =>
        ipcRenderer.invoke('profile:secrets:upsert', input) as Promise<ProfileSecretSummary>,
    },
    update: (input) => ipcRenderer.invoke('profile:update', input) as Promise<UserProfile>,
  }
}
