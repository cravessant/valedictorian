import type { ProfileDocument, ProfileDocumentFormatInput, ProfileDocumentRestoreInput } from '@sparxie/sdk'
import type { ProfileCapabilityError } from './profile.errors.js'
import type { ProfileStore } from './profile.store.js'

export type ProfileDocumentChangeEvent =
  | { kind: 'valid'; document: ProfileDocument }
  | { kind: 'invalid'; error: ProfileCapabilityError }

export type ProfileLastKnownGoodPreview = {
  document: ProfileDocument
  stale: true
  readOnly: true
}

export interface ProfileDocumentCapability {
  dispose(): void
  format(input: ProfileDocumentFormatInput): Promise<ProfileDocument>
  getLastKnownGoodPreview(): ProfileLastKnownGoodPreview | null
  restore(input: ProfileDocumentRestoreInput): Promise<ProfileDocument>
  subscribe(listener: (event: ProfileDocumentChangeEvent) => void): () => void
}

export type JsonProfileAdapter = ProfileStore & ProfileDocumentCapability
