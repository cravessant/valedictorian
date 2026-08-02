import type { ApplicationSecretScope } from './secret.scope.js'

export interface AppSecretCodec {
  decrypt: (value: string) => string
  encrypt: (value: string) => string
}

export interface AppSecretStore {
  readonly scope: ApplicationSecretScope
  delete: (reference: string) => Promise<void>
  get: (reference: string) => Promise<string | null>
  /** True when encrypted ciphertext exists for the reference; never decrypts. */
  has: (reference: string) => Promise<boolean>
  set: (reference: string, value: string) => Promise<void>
}
