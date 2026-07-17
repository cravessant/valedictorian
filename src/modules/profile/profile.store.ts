import type {
  ProfileDocument,
  ProfileDocumentUpdateInput,
  UserProfile,
} from 'sparxie'

export type MovedSensitiveProfileField =
  | 'dateOfBirth'
  | 'disabilityStatus'
  | 'gender'
  | 'hispanicLatino'
  | 'raceEthnicity'
  | 'veteranStatus'

export type MovedSensitiveProfileChanges = Partial<
  Pick<UserProfile, MovedSensitiveProfileField>
>

export type ProfileStoreUpdateResult =
  | { ok: true; document: ProfileDocument }
  | { ok: false; code: 'profile_revision_conflict'; document: ProfileDocument }

export interface ProfileStore {
  get(): Promise<ProfileDocument>
  update(input: {
    expectedRevision: string
    profile: UserProfile
    movedSensitiveChanges?: MovedSensitiveProfileChanges
  }): Promise<ProfileStoreUpdateResult>
}

export type { ProfileDocument, ProfileDocumentUpdateInput, UserProfile }
