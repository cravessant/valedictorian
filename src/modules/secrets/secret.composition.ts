import type { PgliteDatabase } from '../../db/pglite'
import type { SecretCodec } from './secret.codec'
import type { WorkspaceSecretScope } from './secret.scope'
import { createSecretService, type SecretService } from './secret.service'
import { createPgliteSecretStore } from './secret.pglite.store'

export function createPgliteSecretService(
  database: PgliteDatabase,
  secretCodec: SecretCodec,
  scope: WorkspaceSecretScope,
): SecretService {
  return createSecretService(createPgliteSecretStore(database, secretCodec, scope))
}
