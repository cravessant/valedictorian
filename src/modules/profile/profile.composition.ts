import fs from 'node:fs'
import {
  createDrizzleDatabase,
  createFileDatabase,
  migrateDatabase,
} from '../../db/sqlite'
import { resolveDatabaseFilePath } from '../../workspace/workspace.paths'
import type { SecretCodec } from '../secrets/secret.codec'
import { createSqliteSecretService } from '../secrets/secret.composition'
import { createWorkspaceSecretScope } from '../secrets/secret.scope'
import type { SecretService } from '../secrets/secret.service'
import { createProfileService, type ProfileService } from './profile.service'
import {
  createJsonProfileStore,
  type CreateJsonProfileStoreOptions,
} from './profile.json.store'
import { migrateLegacyProfileToJson } from './profile.migration'

export interface PreparedWorkspaceProfileCapabilities {
  dispose(): void
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
  const sqlite = createFileDatabase(databaseFilePath)
  try {
    migrateDatabase(sqlite)
    const secretService = createSqliteSecretService(
      createDrizzleDatabase(sqlite),
      options.secretCodec,
      createWorkspaceSecretScope(options.workspaceId),
    )
    await migrateLegacyProfileToJson({
      database: sqlite,
      profilePath: options.profilePath,
      secretCodec: options.secretCodec,
      secretService,
      databasePath: databaseFilePath,
    })
    const profileService = createJsonProfileService(options.profilePath)
    let disposed = false
    return {
      dispose() {
        if (disposed) return
        disposed = true
        profileService.dispose()
        sqlite.close()
      },
      profileService,
      secretService,
    }
  } catch (error) {
    sqlite.close()
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
