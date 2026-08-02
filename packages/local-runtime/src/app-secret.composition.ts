import type { AppSecretCodec, AppSecretStore } from './app-secret.js'
import { createFileAppSecretStore, type FileAppSecretStoreOptions } from './app-secret.store.js'
import { createApplicationSecretScope } from './secret.scope.js'

/** Composition root for application-scoped file secret stores. */
export function createApplicationFileSecretStore(
  secretsPath: string,
  codec: AppSecretCodec,
  options: FileAppSecretStoreOptions = {},
): AppSecretStore {
  return createFileAppSecretStore(secretsPath, codec, createApplicationSecretScope(), options)
}
