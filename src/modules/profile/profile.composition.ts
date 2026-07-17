import type { DrizzleDatabase } from '../../db/sqlite'
import type { SecretCodec } from '../secrets/secret.codec'
import { createProfileService, type ProfileService } from './profile.service'
import { createSqliteSensitiveProfileStore } from './profile.sqlite.sensitive-store'
import { createSqliteProfileStore } from './profile.sqlite.store'

export function createSqliteProfileService(
  database: DrizzleDatabase,
  secretCodec: SecretCodec,
): ProfileService {
  return createProfileService({
    profileStore: createSqliteProfileStore(database, secretCodec),
    sensitiveStore: createSqliteSensitiveProfileStore(database, secretCodec),
  })
}
