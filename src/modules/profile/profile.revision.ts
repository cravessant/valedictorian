import { createHash } from 'node:crypto'
import {
  defaultUserProfile,
  profileDocumentSchemaVersion,
  type UserProfile,
} from 'sparxie'

export function computeProfileRevision(profile: UserProfile): string {
  const payload = JSON.stringify({
    profile: sortValue(profile),
    schemaVersion: profileDocumentSchemaVersion,
  })

  return createHash('sha256').update(payload).digest('hex')
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue)
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortValue(entry)]),
    )
  }

  return value
}

export function emptyProfileDocument() {
  const profile = { ...defaultUserProfile, answers: [], education: [] }
  return {
    profile,
    revision: computeProfileRevision(profile),
    schemaVersion: profileDocumentSchemaVersion,
  }
}
