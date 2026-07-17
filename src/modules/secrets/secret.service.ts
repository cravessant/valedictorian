import {
  normalizeProfileAnswerKey,
  profileSecretKinds,
  type ProfileSecretKind,
  type ProfileSecretSummary,
  type ProfileSecretsListResult,
  type UpsertProfileSecretInput,
} from 'sparxie'
import type {
  NormalizedSecretKey,
  SecretStore,
  SecretValue,
  ValidatedUpsertSecretInput,
} from './secret.store'

export interface SecretService {
  delete(key: string): Promise<void>
  list(): Promise<ProfileSecretSummary[]>
  listResult(): Promise<ProfileSecretsListResult>
  resolve(key: string): Promise<SecretValue | null>
  upsert(input: UpsertProfileSecretInput): Promise<ProfileSecretSummary>
}

export function createSecretService(store: SecretStore): SecretService {
  return {
    async delete(key) {
      await store.delete(toNormalizedSecretKey(key))
    },
    async list() {
      return store.list()
    },
    async listResult() {
      return { items: await store.list() }
    },
    async resolve(key) {
      return store.resolve(toNormalizedSecretKey(key))
    },
    async upsert(input) {
      const validated: ValidatedUpsertSecretInput = {
        key: toNormalizedSecretKey(input.key),
        kind: normalizeSecretKind(input.kind),
        label: requiredText(input.label, 'secret label'),
        value: requireSecretValue(input.value),
      }

      return store.upsert(validated)
    },
  }
}

function toNormalizedSecretKey(key: string): NormalizedSecretKey {
  return normalizeProfileAnswerKey(key) as NormalizedSecretKey
}

function requireSecretValue(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('secret value is required')
  }
  return value
}

function normalizeSecretKind(value: string): ProfileSecretKind {
  if ((profileSecretKinds as readonly string[]).includes(value)) {
    return value as ProfileSecretKind
  }

  throw new Error(`Invalid profile secret kind: ${value}`)
}

function nullableText(value: string | null | undefined) {
  if (value === null || value === undefined) {
    return null
  }
  const trimmed = value.trim()
  return trimmed || null
}

function requiredText(value: string | null | undefined, field: string) {
  const trimmed = nullableText(value)
  if (!trimmed) {
    throw new Error(`${field} is required`)
  }
  return trimmed
}
