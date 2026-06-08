import type { ProfileAgentContext, ProfileUpdateInput, UserProfile } from 'sparxie'
import type {
  ProfileSensitiveDetails,
  ProfileSensitiveDetailsInput,
  ProfileSecretSummary,
  ProfileSecretValue,
  UpsertProfileSecretInput,
} from '../modules/profile/profile.repository'

interface IpcRendererLike {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>
}

export interface ProfilePreloadApi {
  agentContext: {
    get: () => Promise<ProfileAgentContext>
  }
  get: () => Promise<UserProfile>
  sensitive: {
    get: () => Promise<ProfileSensitiveDetails>
    update: (input: ProfileSensitiveDetailsInput) => Promise<ProfileSensitiveDetails>
  }
  secrets: {
    delete: (key: string) => Promise<void>
    list: () => Promise<ProfileSecretSummary[]>
    reveal: (key: string) => Promise<ProfileSecretValue | null>
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
    sensitive: {
      get: () => ipcRenderer.invoke('profile:sensitive:get') as Promise<ProfileSensitiveDetails>,
      update: (input) =>
        ipcRenderer.invoke('profile:sensitive:update', input) as Promise<ProfileSensitiveDetails>,
    },
    secrets: {
      delete: (key) => ipcRenderer.invoke('profile:secrets:delete', key) as Promise<void>,
      list: () => ipcRenderer.invoke('profile:secrets:list') as Promise<ProfileSecretSummary[]>,
      reveal: (key) =>
        ipcRenderer.invoke('profile:secrets:reveal', key) as Promise<ProfileSecretValue | null>,
      upsert: (input) =>
        ipcRenderer.invoke('profile:secrets:upsert', input) as Promise<ProfileSecretSummary>,
    },
    update: (input) => ipcRenderer.invoke('profile:update', input) as Promise<UserProfile>,
  }
}
