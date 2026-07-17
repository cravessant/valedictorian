import type { DrizzleDatabase } from '../../db/sqlite'
import type { SecretCodec } from './secret.codec'
import type { WorkspaceSecretScope } from './secret.scope'
import { createSecretService, type SecretService } from './secret.service'
import { createSqliteSecretStore } from './secret.sqlite.store'

export function createSqliteSecretService(
  database: DrizzleDatabase,
  secretCodec: SecretCodec,
  scope: WorkspaceSecretScope,
): SecretService {
  return createSecretService(createSqliteSecretStore(database, secretCodec, scope))
}
