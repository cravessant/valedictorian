import type { AppSecretCodec, AppSecretStore } from './app-secret'
import { createFileAppSecretStore, type FileAppSecretStoreOptions } from './app-secret.store'
import { createApplicationSecretScope } from '../modules/secrets/secret.scope'

/** Composition root for application-scoped file secret stores. */
export function createApplicationFileSecretStore(
  secretsPath: string,
  codec: AppSecretCodec,
  options: FileAppSecretStoreOptions = {},
): AppSecretStore {
  return createFileAppSecretStore(secretsPath, codec, createApplicationSecretScope(), options)
}
