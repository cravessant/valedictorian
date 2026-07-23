import {
  defaultUserProfile,
  profileDocumentSchemaVersion,
  type ProfileDocument,
  type UserProfile,
} from '@sparxie/sdk'
import { computeProfileRevision } from './profile.revision'
import type { ProfileStore, ProfileStoreUpdateResult } from './profile.store'

export interface MemoryProfileStores {
  profileStore: ProfileStore
  getRevisionSnapshots: () => string[]
}

export function createMemoryProfileStores(
  initialProfile: UserProfile = { ...defaultUserProfile },
): MemoryProfileStores {
  let profile = {
    ...defaultUserProfile,
    ...initialProfile,
    answers: [...initialProfile.answers],
    education: [...initialProfile.education],
  }
  const revisions: string[] = []

  function currentDocument(): ProfileDocument {
    return {
      profile,
      revision: computeProfileRevision(profile),
      schemaVersion: profileDocumentSchemaVersion,
    }
  }

  const profileStore: ProfileStore = {
    async get() {
      return currentDocument()
    },
    async update(input): Promise<ProfileStoreUpdateResult> {
      const current = currentDocument()
      if (current.revision !== input.expectedRevision) {
        return { ok: false, code: 'profile_revision_conflict', document: current }
      }

      profile = {
        ...input.profile,
        answers: [...input.profile.answers],
        education: [...input.profile.education],
      }
      const document = currentDocument()
      revisions.push(document.revision)
      return { ok: true, document }
    },
  }

  return {
    profileStore,
    getRevisionSnapshots: () => [...revisions],
  }
}
