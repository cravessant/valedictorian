import fs from 'node:fs'
import {
  createPgliteClient,
  migratePgliteDatabase,
  type PgliteClient,
  type PgliteDatabase,
} from '../../db/pglite'
import type { SecretCodec } from '../secrets/secret.codec'
import { createPgliteSecretService } from '../secrets/secret.composition'
import { createWorkspaceSecretScope } from '../secrets/secret.scope'
import type { SecretService } from '../secrets/secret.service'
import { createProfileService, type ProfileService } from './profile.service'
import {
  createJsonProfileStore,
  type CreateJsonProfileStoreOptions,
} from './profile.json.store'
import { assertSupportedProfileUpgrade } from './profile.upgrade-policy'

export interface PreparedWorkspaceProfileCapabilities {
  database: PgliteDatabase
  dispose(): Promise<void>
  pgliteClient: PgliteClient
  profileService: ProfileService
  secretService: SecretService
}

export async function prepareWorkspaceProfileCapabilities(options: {
  profilePath: string
  secretCodec: SecretCodec
  pgliteDataPath: string
  workspaceId: string
}): Promise<PreparedWorkspaceProfileCapabilities> {
  assertSupportedProfileUpgrade({ profilePath: options.profilePath })
  fs.mkdirSync(options.pgliteDataPath, { recursive: true })
  const pgliteClient = await createPgliteClient({ dataDir: options.pgliteDataPath })
  try {
    const database = await migratePgliteDatabase(pgliteClient)
    const secretService = createPgliteSecretService(
      database,
      options.secretCodec,
      createWorkspaceSecretScope(options.workspaceId),
    )
    const profileService = createJsonProfileService(options.profilePath)
    let disposeInflight: Promise<void> | null = null
    return {
      database,
      dispose() {
        if (disposeInflight) return disposeInflight
        disposeInflight = (async () => {
          try {
            profileService.dispose()
          } finally {
            await pgliteClient.close()
          }
        })()
        return disposeInflight
      },
      pgliteClient,
      profileService,
      secretService,
    }
  } catch (error) {
    await pgliteClient.close()
    throw error
  }
}

export function createJsonProfileService(
  profilePath: string,
  options: CreateJsonProfileStoreOptions = {},
): ProfileService {
  const adapter = createJsonProfileStore(profilePath, options)
  return createProfileService({
    profileStore: adapter,
    documentCapability: adapter,
  })
}
