import { normalizeProfileAnswerKey } from 'sparxie'
import type { NormalizedSecretKey } from './secret.store'

export function normalizeSecretKey(key: string): NormalizedSecretKey {
  return normalizeProfileAnswerKey(key) as NormalizedSecretKey
}
