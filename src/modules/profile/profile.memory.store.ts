import {
  defaultUserProfile,
  profileDocumentSchemaVersion,
  type ProfileDocument,
  type ProfileSensitiveDetails,
  type UserProfile,
} from 'sparxie'
import { computeProfileRevision } from './profile.revision'
import type { SensitiveProfileStore } from './profile.sensitive-store'
import type { ProfileStore, ProfileStoreUpdateResult } from './profile.store'
import { sensitiveFieldsFromMovedChanges, unifySensitiveIntoProfile } from './profile.normalize'

const defaultSensitiveDetails: ProfileSensitiveDetails = {
  birthDay: null,
  birthMonth: null,
  birthYear: null,
  disabilityStatus: null,
  gender: null,
  hispanicLatino: null,
  raceEthnicity: null,
  ssnLast4: null,
  veteranStatus: null,
}

export interface MemoryProfileStores {
  profileStore: ProfileStore
  sensitiveStore: SensitiveProfileStore
  getRevisionSnapshots: () => string[]
}

export function createMemoryProfileStores(
  initialProfile: UserProfile = { ...defaultUserProfile },
): MemoryProfileStores {
  let sensitive: ProfileSensitiveDetails = { ...defaultSensitiveDetails }
  let profile = unifySensitiveIntoProfile(
    { ...defaultUserProfile, ...initialProfile, answers: [...initialProfile.answers], education: [...initialProfile.education] },
    sensitive,
  )
  const revisions: string[] = []

  function currentDocument(): ProfileDocument {
    const unified = unifySensitiveIntoProfile(profile, sensitive)
    return {
      profile: unified,
      revision: computeProfileRevision(unified),
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
      if (input.movedSensitiveChanges && Object.keys(input.movedSensitiveChanges).length > 0) {
        sensitive = {
          ...sensitive,
          ...sensitiveFieldsFromMovedChanges(input.movedSensitiveChanges),
        }
      }
      const document = currentDocument()
      revisions.push(document.revision)
      return { ok: true, document }
    },
  }

  const sensitiveStore: SensitiveProfileStore = {
    async get() {
      return { ...sensitive }
    },
    async update(normalized) {
      sensitive = { ...normalized }
      return { ...sensitive }
    },
  }

  return {
    profileStore,
    sensitiveStore,
    getRevisionSnapshots: () => [...revisions],
  }
}
