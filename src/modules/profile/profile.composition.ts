import type { DrizzleDatabase } from '../../db/sqlite'
import type { SecretCodec } from '../secrets/secret.codec'
import { createProfileService, type ProfileService } from './profile.service'
import { createMemoryProfileStores } from './profile.memory.store'
import type { SensitiveProfileStore } from './profile.sensitive-store'
import { createSqliteSensitiveProfileStore } from './profile.sqlite.sensitive-store'
import { createSqliteProfileStore } from './profile.sqlite.store'
import {
  createJsonProfileStore,
  type CreateJsonProfileStoreOptions,
} from './profile.json.store'

export function createSqliteProfileService(
  database: DrizzleDatabase,
  secretCodec: SecretCodec,
): ProfileService {
  return createProfileService({
    profileStore: createSqliteProfileStore(database, secretCodec),
    sensitiveStore: createSqliteSensitiveProfileStore(database, secretCodec),
  })
}

export function createJsonProfileService(
  profilePath: string,
  options: CreateJsonProfileStoreOptions & {
    sensitiveStore?: SensitiveProfileStore
  } = {},
): ProfileService {
  const { sensitiveStore, ...storeOptions } = options
  const adapter = createJsonProfileStore(profilePath, storeOptions)
  return createProfileService({
    profileStore: adapter,
    sensitiveStore: sensitiveStore ?? createMemoryProfileStores().sensitiveStore,
    documentCapability: adapter,
  })
}
