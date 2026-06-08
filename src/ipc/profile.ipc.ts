import type { ProfileUpdateInput } from 'sparxie'
import type {
  ProfileRepository,
  ProfileSensitiveDetailsInput,
  UpsertProfileSecretInput,
} from '../modules/profile/profile.repository'

interface IpcMainLike {
  handle(
    channel: string,
    handler: (event: unknown, payload?: unknown) => Promise<unknown> | unknown,
  ): void
}

export function registerProfileIpc(repository: ProfileRepository, ipcMain: IpcMainLike) {
  ipcMain.handle('profile:get', () => repository.getProfile())
  ipcMain.handle('profile:update', (_event, input) =>
    repository.updateProfile(input as ProfileUpdateInput),
  )
  ipcMain.handle('profile:agent-context:get', () => repository.getAgentContext())
  ipcMain.handle('profile:sensitive:get', () => repository.getSensitiveDetails())
  ipcMain.handle('profile:sensitive:update', (_event, input) =>
    repository.updateSensitiveDetails(input as ProfileSensitiveDetailsInput),
  )
  ipcMain.handle('profile:secrets:list', () => repository.listSecrets())
  ipcMain.handle('profile:secrets:upsert', (_event, input) =>
    repository.upsertSecret(input as UpsertProfileSecretInput),
  )
  ipcMain.handle('profile:secrets:reveal', (_event, key) => repository.revealSecret(key as string))
  ipcMain.handle('profile:secrets:delete', (_event, key) => repository.deleteSecret(key as string))
}
