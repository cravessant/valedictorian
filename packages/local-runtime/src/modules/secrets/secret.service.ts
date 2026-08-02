import {
  profileSecretKinds,
  type ProfileSecretKind,
  type ProfileSecretSummary,
  type ProfileSecretsListResult,
  type UpsertProfileSecretInput,
} from '@sparxie/sdk'
import type { WorkspaceSecretScope } from '../../protected-secrets.js'
import {
  identitySecretKind,
  identitySsnLast4SecretKey,
  isIdentitySecretKind,
} from './secret.identity.js'
import { normalizeSecretKey } from './secret.key.js'
import type {
  NormalizedSecretKey,
  SecretStore,
  SecretValue,
  ValidatedUpsertSecretInput,
} from './secret.store.js'

export interface SecretService {
  readonly scope: WorkspaceSecretScope
  delete(key: string): Promise<void>
  hasTrustedIdentitySsnLast4(): Promise<boolean>
  list(): Promise<ProfileSecretSummary[]>
  listResult(): Promise<ProfileSecretsListResult>
  resolve(key: string): Promise<SecretValue | null>
  upsert(input: UpsertProfileSecretInput): Promise<ProfileSecretSummary>
  /** Trusted #249 identity destination: stores reserved SSN last4 without returning summary/value. */
  upsertTrustedIdentitySsnLast4(value: string): Promise<void>
}

export function createSecretService(store: SecretStore): SecretService {
  return {
    scope: store.scope,
    async delete(key) {
      const normalized = normalizeSecretKey(key)
      assertOrdinaryIdentityAdministrationAllowed(normalized)
      await store.delete(normalized)
    },
    async hasTrustedIdentitySsnLast4() {
      return (await store.resolve(identitySsnLast4SecretKey as NormalizedSecretKey)) !== null
    },
    async list() {
      return (await store.list()).filter(isOrdinarySecretSummary)
    },
    async listResult() {
      const items = (await store.list()).filter(isOrdinarySecretSummary)
      return { items }
    },
    async resolve(key) {
      return store.resolve(normalizeSecretKey(key))
    },
    async upsert(input) {
      const key = normalizeSecretKey(input.key)
      assertOrdinaryIdentityAdministrationAllowed(key, input.kind)

      const validated: ValidatedUpsertSecretInput = {
        key,
        kind: normalizeSecretKind(input.kind),
        label: requiredText(input.label, 'secret label'),
        value: requireSecretValue(input.value),
      }

      return store.upsert(validated)
    },
    async upsertTrustedIdentitySsnLast4(value) {
      if (typeof value !== 'string' || !/^[0-9]{4}$/.test(value)) {
        throw new Error('Trusted identity SSN last4 must be exactly four ASCII digits')
      }
      await store.upsert({
        key: identitySsnLast4SecretKey as NormalizedSecretKey,
        kind: identitySecretKind as ProfileSecretKind,
        label: 'SSN last four',
        value,
      })
    },
  }
}

function isOrdinarySecretSummary(item: ProfileSecretSummary) {
  return item.key !== identitySsnLast4SecretKey && !isIdentitySecretKind(item.kind)
}

function assertOrdinaryIdentityAdministrationAllowed(key: string, kind?: string) {
  if (key === identitySsnLast4SecretKey || (kind !== undefined && isIdentitySecretKind(kind))) {
    throw new Error('Identity secrets cannot be managed through ordinary secret administration')
  }
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
