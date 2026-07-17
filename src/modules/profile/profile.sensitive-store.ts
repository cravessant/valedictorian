import type {
  ProfileSensitiveDetails,
  ProfileSensitiveDetailsInput,
} from 'sparxie'

/**
 * @deprecated Compatibility sensitive-profile port for the cutover window.
 * Non-secret application facts belong on ProfileStore / UserProfile.
 *
 * `update` persists an already-normalized full sensitive record produced by
 * ProfileService policy. Adapters must not trim, pad, or validate dates.
 */
export interface SensitiveProfileStore {
  get(): Promise<ProfileSensitiveDetails>
  update(normalized: ProfileSensitiveDetails): Promise<ProfileSensitiveDetails>
}

export type { ProfileSensitiveDetails, ProfileSensitiveDetailsInput }
