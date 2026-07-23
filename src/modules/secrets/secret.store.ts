import type {
  ProfileSecretKind,
  ProfileSecretSummary,
} from '@sparxie/sdk'
import type { WorkspaceSecretScope } from './secret.scope'

declare const normalizedSecretKeyBrand: unique symbol

/** Opaque key that has already been normalized by SecretService policy. */
export type NormalizedSecretKey = string & {
  readonly [normalizedSecretKeyBrand]: void
}

/** Store-port upsert input: validated metadata + byte-exact secret plaintext. */
export interface ValidatedUpsertSecretInput {
  key: NormalizedSecretKey
  kind: ProfileSecretKind
  label: string
  value: string
}

export interface SecretValue extends ProfileSecretSummary {
  value: string
}

export interface SecretStore {
  readonly scope: WorkspaceSecretScope
  delete(key: NormalizedSecretKey): Promise<void>
  list(): Promise<ProfileSecretSummary[]>
  resolve(key: NormalizedSecretKey): Promise<SecretValue | null>
  upsert(input: ValidatedUpsertSecretInput): Promise<ProfileSecretSummary>
}

export type { ProfileSecretKind, ProfileSecretSummary }
