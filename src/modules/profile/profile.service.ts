import {
  profileDocumentFormatInputSchema,
  profileDocumentRestoreInputSchema,
  profileDocumentSchema,
  profileDocumentSchemaVersion,
  profileDocumentUpdateInputSchema,
  toProfileAgentContext,
  type ProfileAgentContext,
  type ProfileDocument,
  type ProfileDocumentFormatInput,
  type ProfileDocumentRestoreInput,
  type ProfileDocumentUpdateInput,
  type ProfileDocumentValidateResult,
  type ProfileUpdateInput,
  type UserProfile,
} from 'sparxie'
import type {
  ProfileDocumentCapability,
  ProfileDocumentChangeEvent,
  ProfileLastKnownGoodPreview,
} from './profile.document.capability'
import {
  invalidProfileDocumentError,
  issuePath,
  profileDocumentError,
} from './profile.errors'
import { mergeProfile, normalizeProfilePatch } from './profile.normalize'
import type { ProfileStore } from './profile.store'

export interface ProfileService {
  dispose(): void
  formatDocument(input: ProfileDocumentFormatInput): Promise<ProfileDocument>
  get(): Promise<UserProfile>
  getAgentContext(): Promise<ProfileAgentContext>
  getDocument(): Promise<ProfileDocument>
  getLastKnownGoodPreview(): ProfileLastKnownGoodPreview | null
  restoreDocument(input: ProfileDocumentRestoreInput): Promise<ProfileDocument>
  subscribe(listener: (event: ProfileDocumentChangeEvent) => void): () => void
  update(input: ProfileUpdateInput): Promise<UserProfile>
  updateDocument(input: ProfileDocumentUpdateInput): Promise<ProfileDocument>
  validateDocument(): Promise<ProfileDocumentValidateResult>
}

export function createProfileService(options: {
  profileStore: ProfileStore
  documentCapability?: ProfileDocumentCapability
}): ProfileService {
  const { profileStore, documentCapability } = options
  let disposed = false

  return {
    async get() {
      assertNotDisposed()
      return (await readCurrentDocument()).profile
    },
    async update(input) {
      assertNotDisposed()
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const current = await readCurrentDocument()
        const patch = normalizeProfilePatch(input)
        const next = mergeProfile(current.profile, patch)
        const result = await profileStore.update({
          expectedRevision: current.revision,
          profile: next,
        })
        if (result.ok) {
          return parseDocument(result.document).profile
        }
      }

      throw profileDocumentError('profile_revision_conflict')
    },
    async getAgentContext() {
      assertNotDisposed()
      return toProfileAgentContext(await this.get())
    },
    async getDocument() {
      assertNotDisposed()
      return readCurrentDocument()
    },
    async updateDocument(input) {
      assertNotDisposed()
      const parsed = profileDocumentUpdateInputSchema.safeParse(input)
      if (!parsed.success) {
        const issue = parsed.error.issues[0]
        throw invalidProfileDocumentError(issuePath(issue?.path))
      }

      const current = await readCurrentDocument()
      if (current.revision !== parsed.data.expectedRevision) {
        throw profileDocumentError('profile_revision_conflict')
      }

      const patch = normalizeProfilePatch(parsed.data.profile, { pathPrefix: ['profile'] })
      const next = mergeProfile(current.profile, patch)
      const result = await profileStore.update({
        expectedRevision: parsed.data.expectedRevision,
        profile: next,
      })
      if (!result.ok) {
        throw profileDocumentError('profile_revision_conflict')
      }

      return parseDocument(result.document)
    },
    async validateDocument() {
      assertNotDisposed()
      const document = await readCurrentDocument()
      return {
        revision: document.revision,
        schemaVersion: document.schemaVersion,
      }
    },
    async formatDocument(input) {
      assertNotDisposed()
      const parsed = profileDocumentFormatInputSchema.safeParse(input)
      if (!parsed.success) {
        const issue = parsed.error.issues[0]
        throw invalidProfileDocumentError(issuePath(issue?.path))
      }

      if (documentCapability) {
        return parseDocument(await documentCapability.format(parsed.data))
      }

      const document = await readCurrentDocument()
      if (document.revision !== parsed.data.expectedRevision) {
        throw profileDocumentError('profile_revision_conflict')
      }
      return document
    },
    async restoreDocument(input) {
      assertNotDisposed()
      const parsed = profileDocumentRestoreInputSchema.safeParse(input)
      if (!parsed.success) {
        const issue = parsed.error.issues[0]
        throw invalidProfileDocumentError(issuePath(issue?.path))
      }

      if (documentCapability) {
        return parseDocument(await documentCapability.restore(parsed.data))
      }

      throw profileDocumentError('profile_backup_unavailable')
    },
    subscribe(listener) {
      assertNotDisposed()
      if (!documentCapability) return () => {}
      return documentCapability.subscribe(listener)
    },
    getLastKnownGoodPreview() {
      if (disposed) return null
      return documentCapability?.getLastKnownGoodPreview() ?? null
    },
    dispose() {
      if (disposed) return
      disposed = true
      documentCapability?.dispose()
    },
  }

  function assertNotDisposed() {
    if (disposed) {
      throw profileDocumentError('profile_document_unavailable')
    }
  }

  async function readCurrentDocument(): Promise<ProfileDocument> {
    return parseDocument(await profileStore.get())
  }
}

function parseDocument(document: ProfileDocument): ProfileDocument {
  if (
    document &&
    typeof document === 'object' &&
    'schemaVersion' in document &&
    typeof document.schemaVersion === 'number' &&
    document.schemaVersion !== profileDocumentSchemaVersion
  ) {
    throw profileDocumentError('unsupported_profile_schema_version')
  }

  const parsed = profileDocumentSchema.safeParse(document)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw invalidProfileDocumentError(issuePath(issue?.path))
  }
  return parsed.data
}
