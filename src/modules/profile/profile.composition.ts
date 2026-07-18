import fs from 'node:fs'
import { createFileDatabase } from '../../db/sqlite'
import {
  createPgliteClient,
  migratePgliteDatabase,
  type PgliteClient,
  type PgliteDatabase,
} from '../../db/pglite'
import { resolveDatabaseFilePath } from '../../workspace/workspace.paths'
import type { SecretCodec } from '../secrets/secret.codec'
import { createPgliteSecretService } from '../secrets/secret.composition'
import { createWorkspaceSecretScope } from '../secrets/secret.scope'
import type { SecretService } from '../secrets/secret.service'
import { createProfileService, type ProfileService } from './profile.service'
import {
  createJsonProfileStore,
  type CreateJsonProfileStoreOptions,
} from './profile.json.store'
import { migrateLegacyProfileToJson } from './profile.migration'

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
  const databaseFilePath = resolveDatabaseFilePath(options.pgliteDataPath)
  fs.mkdirSync(options.pgliteDataPath, { recursive: true })
  const pgliteClient = await createPgliteClient({ dataDir: options.pgliteDataPath })
  let sqlite: ReturnType<typeof createFileDatabase> | null = null
  try {
    const database = await migratePgliteDatabase(pgliteClient)
    const secretService = createPgliteSecretService(
      database,
      options.secretCodec,
      createWorkspaceSecretScope(options.workspaceId),
    )
    if (fs.existsSync(databaseFilePath)) {
      sqlite = createFileDatabase(databaseFilePath)
      await migrateLegacyProfileToJson({
        database: sqlite,
        profilePath: options.profilePath,
        secretCodec: options.secretCodec,
        secretService,
        databasePath: databaseFilePath,
      })
      sqlite.close()
      sqlite = null
    }
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
    sqlite?.close()
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
