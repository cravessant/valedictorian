import type { PgliteDatabase } from '../../db/pglite.js'
import type {
  SecretCodec,
  WorkspaceSecretScope,
} from '../../protected-secrets.js'
import { createSecretService, type SecretService } from './secret.service.js'
import { createPgliteSecretStore } from './secret.pglite.store.js'

export function createPgliteSecretService(
  database: PgliteDatabase,
  secretCodec: SecretCodec,
  scope: WorkspaceSecretScope,
): SecretService {
  return createSecretService(createPgliteSecretStore(database, secretCodec, scope))
}
