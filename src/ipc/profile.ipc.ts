import type {
  ProfileUpdateInput,
  UpsertProfileSecretInput,
} from '@sparxie/sdk'
import type { ProfileService } from '@sparxie/valedictorian-local-runtime/profile'
import type { SecretService } from '@sparxie/valedictorian-local-runtime/secrets'

interface IpcMainLike {
  handle(
    channel: string,
    handler: (event: unknown, payload?: unknown) => unknown,
  ): void
}

export function registerProfileIpc(
  profileService: ProfileService,
  secretService: SecretService,
  ipcMain: IpcMainLike,
) {
  ipcMain.handle('profile:get', () => profileService.get())
  ipcMain.handle('profile:update', (_event, input) =>
    profileService.update(input as ProfileUpdateInput),
  )
  ipcMain.handle('profile:agent-context:get', () => profileService.getAgentContext())
  ipcMain.handle('profile:identity:status', () => secretService.hasTrustedIdentitySsnLast4())
  ipcMain.handle('profile:identity:set', (_event, value) =>
    secretService.upsertTrustedIdentitySsnLast4(value as string),
  )
  ipcMain.handle('profile:secrets:list', () => secretService.list())
  ipcMain.handle('profile:secrets:upsert', (_event, input) =>
    secretService.upsert(input as UpsertProfileSecretInput),
  )
  ipcMain.handle('profile:secrets:delete', (_event, key) => secretService.delete(key as string))
}
