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
  type ProfileSensitiveDetails,
  type ProfileSensitiveDetailsInput,
  type ProfileUpdateInput,
  type UserProfile,
} from 'sparxie'
import {
  invalidProfileDocumentError,
  issuePath,
  profileDocumentError,
} from './profile.errors'
import { mergeProfile, normalizeProfilePatch, normalizeSensitiveDetailsUpdate, movedSensitiveChangesFromPatch } from './profile.normalize'
import type { SensitiveProfileStore } from './profile.sensitive-store'
import type { ProfileStore } from './profile.store'

export interface ProfileService {
  formatDocument(input: ProfileDocumentFormatInput): Promise<ProfileDocument>
  get(): Promise<UserProfile>
  getAgentContext(): Promise<ProfileAgentContext>
  getDocument(): Promise<ProfileDocument>
  getSensitiveDetails(): Promise<ProfileSensitiveDetails>
  restoreDocument(input: ProfileDocumentRestoreInput): Promise<ProfileDocument>
  update(input: ProfileUpdateInput): Promise<UserProfile>
  updateDocument(input: ProfileDocumentUpdateInput): Promise<ProfileDocument>
  updateSensitiveDetails(input: ProfileSensitiveDetailsInput): Promise<ProfileSensitiveDetails>
  validateDocument(): Promise<ProfileDocumentValidateResult>
}

export function createProfileService(options: {
  profileStore: ProfileStore
  sensitiveStore: SensitiveProfileStore
}): ProfileService {
  const { profileStore, sensitiveStore } = options

  return {
    async get() {
      return (await readCurrentDocument()).profile
    },
    async update(input) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const current = await readCurrentDocument()
        const patch = normalizeProfilePatch(input)
        const next = mergeProfile(current.profile, patch)
        const result = await profileStore.update({
          expectedRevision: current.revision,
          profile: next,
          movedSensitiveChanges: movedSensitiveChangesFromPatch(patch),
        })
        if (result.ok) {
          return parseDocument(result.document).profile
        }
      }

      throw profileDocumentError('profile_revision_conflict')
    },
    async getAgentContext() {
      return toProfileAgentContext(await this.get())
    },
    async getDocument() {
      return readCurrentDocument()
    },
    async updateDocument(input) {
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
        movedSensitiveChanges: movedSensitiveChangesFromPatch(patch),
      })
      if (!result.ok) {
        throw profileDocumentError('profile_revision_conflict')
      }

      return parseDocument(result.document)
    },
    async validateDocument() {
      const document = await readCurrentDocument()
      return {
        revision: document.revision,
        schemaVersion: document.schemaVersion,
      }
    },
    async formatDocument(input) {
      const parsed = profileDocumentFormatInputSchema.safeParse(input)
      if (!parsed.success) {
        const issue = parsed.error.issues[0]
        throw invalidProfileDocumentError(issuePath(issue?.path))
      }

      const document = await readCurrentDocument()
      if (document.revision !== parsed.data.expectedRevision) {
        throw profileDocumentError('profile_revision_conflict')
      }
      return document
    },
    async restoreDocument(input) {
      const parsed = profileDocumentRestoreInputSchema.safeParse(input)
      if (!parsed.success) {
        const issue = parsed.error.issues[0]
        throw invalidProfileDocumentError(issuePath(issue?.path))
      }
      throw profileDocumentError('profile_backup_unavailable')
    },
    async getSensitiveDetails() {
      return sensitiveStore.get()
    },
    async updateSensitiveDetails(input) {
      const current = await sensitiveStore.get()
      const normalized = normalizeSensitiveDetailsUpdate(current, input)
      return sensitiveStore.update(normalized)
    },
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
