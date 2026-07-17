import type { DrizzleDatabase } from '../../db/sqlite'
import type { SecretCodec } from './secret.codec'
import { createSecretService, type SecretService } from './secret.service'
import { createSqliteSecretStore } from './secret.sqlite.store'

export function createSqliteSecretService(
  database: DrizzleDatabase,
  secretCodec: SecretCodec,
): SecretService {
  return createSecretService(createSqliteSecretStore(database, secretCodec))
}
