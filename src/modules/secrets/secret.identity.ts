import { createSecretReference, formatSecretReferenceUri } from 'sparxie'
import { normalizeSecretKey } from './secret.key'

/** Stable workspace identity-secret key for SSN last-four material (#249 migrates storage). */
export const identitySsnLast4SecretKey = 'identity_ssn_last4'

export const identitySsnLast4SecretReferenceUri = formatSecretReferenceUri(identitySsnLast4SecretKey)

export const identitySsnLast4SecretReference = createSecretReference(identitySsnLast4SecretKey)

export const identitySecretKind = 'identity' as const

export function isIdentitySecretKind(kind: string): boolean {
  return kind === identitySecretKind
}

export function isReservedIdentitySecretKey(key: string): boolean {
  return normalizeSecretKey(key) === identitySsnLast4SecretKey
}
