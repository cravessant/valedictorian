import {
  canonicalDateOnlySchema,
  defaultUserProfile,
  normalizeProfileAnswerInput,
  normalizeProfileEducationInput,
  profileGenderOptions,
  profileRaceEthnicityOptions,
  profileSelfIdResponseOptions,
  profileUpdateInputSchema,
  profileVeteranStatusOptions,
  userProfileSchema,
  type ProfileSensitiveDetails,
  type ProfileSensitiveDetailsInput,
  type ProfileUpdateInput,
  type UserProfile,
} from 'sparxie'
import { invalidProfileDocumentError, issuePath } from './profile.errors'

export function normalizeProfilePatch(
  input: ProfileUpdateInput,
  options: { pathPrefix?: ReadonlyArray<string | number> } = {},
): Partial<UserProfile> {
  const parsed = profileUpdateInputSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw invalidProfileDocumentError([
      ...(options.pathPrefix ?? []),
      ...issuePath(issue?.path),
    ])
  }

  const value = parsed.data
  const prefix = options.pathPrefix ?? []

  return {
    ...(value.addressLine1 !== undefined ? { addressLine1: nullableText(value.addressLine1) } : {}),
    ...(value.addressLine2 !== undefined ? { addressLine2: nullableText(value.addressLine2) } : {}),
    ...(value.answers
      ? {
          answers: value.answers.map((answer, index) =>
            normalizeAnswerAtPath(answer, [...prefix, 'answers', index]),
          ),
        }
      : {}),
    ...(value.city !== undefined ? { city: nullableText(value.city) } : {}),
    ...(value.country !== undefined ? { country: nullableText(value.country) } : {}),
    ...(value.citizenship !== undefined ? { citizenship: nullableText(value.citizenship) } : {}),
    ...(value.classStanding !== undefined
      ? { classStanding: nullableText(value.classStanding) }
      : {}),
    ...(value.coverLetterPath !== undefined
      ? { coverLetterPath: nullableText(value.coverLetterPath) }
      : {}),
    ...(value.dateOfBirth !== undefined
      ? { dateOfBirth: normalizeCanonicalDate(value.dateOfBirth) }
      : {}),
    ...(value.degree !== undefined ? { degree: nullableText(value.degree) } : {}),
    ...(value.disabilityStatus !== undefined
      ? { disabilityStatus: normalizeSelfId(value.disabilityStatus) }
      : {}),
    ...(value.education
      ? {
          education: value.education.map((item, index) =>
            normalizeEducationAtPath(item, [...prefix, 'education', index]),
          ),
        }
      : {}),
    ...(value.email !== undefined ? { email: nullableText(value.email) } : {}),
    ...(value.fullName !== undefined ? { fullName: nullableText(value.fullName) } : {}),
    ...(value.gender !== undefined ? { gender: normalizeGender(value.gender) } : {}),
    ...(value.githubUrl !== undefined ? { githubUrl: nullableText(value.githubUrl) } : {}),
    ...(value.graduationDate !== undefined
      ? { graduationDate: nullableText(value.graduationDate) }
      : {}),
    ...(value.highSchool !== undefined ? { highSchool: nullableText(value.highSchool) } : {}),
    ...(value.hispanicLatino !== undefined
      ? { hispanicLatino: normalizeSelfId(value.hispanicLatino) }
      : {}),
    ...(value.language !== undefined ? { language: nullableText(value.language) } : {}),
    ...(value.linkedinUrl !== undefined ? { linkedinUrl: nullableText(value.linkedinUrl) } : {}),
    ...(value.major !== undefined ? { major: nullableText(value.major) } : {}),
    ...(value.phone !== undefined ? { phone: nullableText(value.phone) } : {}),
    ...(value.phoneDeviceType !== undefined
      ? { phoneDeviceType: nullableText(value.phoneDeviceType) }
      : {}),
    ...(value.portfolioUrl !== undefined ? { portfolioUrl: nullableText(value.portfolioUrl) } : {}),
    ...(value.preferredName !== undefined ? { preferredName: nullableText(value.preferredName) } : {}),
    ...(value.raceEthnicity !== undefined
      ? { raceEthnicity: normalizeRaceEthnicity(value.raceEthnicity) }
      : {}),
    ...(value.region !== undefined ? { region: nullableText(value.region) } : {}),
    ...(value.relocation !== undefined ? { relocation: nullableText(value.relocation) } : {}),
    ...(value.relocationNotes !== undefined
      ? { relocationNotes: nullableText(value.relocationNotes) }
      : {}),
    ...(value.requireSponsorship !== undefined
      ? { requireSponsorship: nullableText(value.requireSponsorship) }
      : {}),
    ...(value.requireSponsorshipFuture !== undefined
      ? { requireSponsorshipFuture: nullableText(value.requireSponsorshipFuture) }
      : {}),
    ...(value.satScore !== undefined ? { satScore: nullableText(value.satScore) } : {}),
    ...(value.school !== undefined ? { school: nullableText(value.school) } : {}),
    ...(value.transcriptPath !== undefined
      ? { transcriptPath: nullableText(value.transcriptPath) }
      : {}),
    ...(value.travel !== undefined ? { travel: nullableText(value.travel) } : {}),
    ...(value.travelNotes !== undefined ? { travelNotes: nullableText(value.travelNotes) } : {}),
    ...(value.veteranStatus !== undefined
      ? { veteranStatus: normalizeVeteranStatus(value.veteranStatus) }
      : {}),
    ...(value.willingToRelocate !== undefined
      ? { willingToRelocate: normalizeNullableBoolean(value.willingToRelocate) }
      : {}),
    ...(value.willingToTravel !== undefined
      ? { willingToTravel: normalizeNullableBoolean(value.willingToTravel) }
      : {}),
    ...(value.workAuthorization !== undefined
      ? { workAuthorization: nullableText(value.workAuthorization) }
      : {}),
  }
}

function normalizeAnswerAtPath(
  answer: Parameters<typeof normalizeProfileAnswerInput>[0],
  path: ReadonlyArray<string | number>,
) {
  try {
    return normalizeProfileAnswerInput(answer)
  } catch (error) {
    throw invalidProfileDocumentError([...path, normalizerFieldSegment(error, 'label')])
  }
}

function normalizeEducationAtPath(
  education: Parameters<typeof normalizeProfileEducationInput>[0],
  path: ReadonlyArray<string | number>,
) {
  try {
    return normalizeProfileEducationInput(education)
  } catch (error) {
    throw invalidProfileDocumentError([...path, normalizerFieldSegment(error, 'educationType')])
  }
}

function normalizerFieldSegment(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback
  }

  const mapping: Record<string, string> = {
    'answer label is required': 'label',
    'answer is required': 'answer',
    'question pattern is required': 'questionPattern',
    'answer key is required': 'key',
    'education type is required': 'educationType',
    'school is required': 'school',
    'education id is required': 'id',
  }

  return mapping[error.message] ?? fallback
}

export function mergeProfile(
  current: UserProfile,
  patch: Partial<UserProfile>,
): UserProfile {
  const merged = {
    ...defaultUserProfile,
    ...current,
    ...patch,
    answers: patch.answers ?? current.answers,
    education: patch.education ?? current.education,
  }

  return assertNormalizedProfile(merged)
}

const movedSensitiveProfileFields = [
  'dateOfBirth',
  'disabilityStatus',
  'gender',
  'hispanicLatino',
  'raceEthnicity',
  'veteranStatus',
] as const satisfies ReadonlyArray<keyof UserProfile>

export function movedSensitiveChangesFromPatch(
  patch: Partial<UserProfile>,
): Partial<Pick<UserProfile, (typeof movedSensitiveProfileFields)[number]>> {
  const changes: Partial<Pick<UserProfile, (typeof movedSensitiveProfileFields)[number]>> = {}
  if (Object.prototype.hasOwnProperty.call(patch, 'dateOfBirth')) {
    changes.dateOfBirth = patch.dateOfBirth
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'disabilityStatus')) {
    changes.disabilityStatus = patch.disabilityStatus
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'gender')) {
    changes.gender = patch.gender
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'hispanicLatino')) {
    changes.hispanicLatino = patch.hispanicLatino
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'raceEthnicity')) {
    changes.raceEthnicity = patch.raceEthnicity
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'veteranStatus')) {
    changes.veteranStatus = patch.veteranStatus
  }
  return changes
}

export function sensitiveFieldsFromMovedChanges(
  changes: Partial<
    Pick<
      UserProfile,
      | 'dateOfBirth'
      | 'disabilityStatus'
      | 'gender'
      | 'hispanicLatino'
      | 'raceEthnicity'
      | 'veteranStatus'
    >
  >,
): Partial<
  Pick<
    ProfileSensitiveDetails,
    | 'birthDay'
    | 'birthMonth'
    | 'birthYear'
    | 'dateOfBirth'
    | 'disabilityStatus'
    | 'gender'
    | 'hispanicLatino'
    | 'raceEthnicity'
    | 'veteranStatus'
  >
> {
  const next: Partial<
    Pick<
      ProfileSensitiveDetails,
      | 'birthDay'
      | 'birthMonth'
      | 'birthYear'
      | 'dateOfBirth'
      | 'disabilityStatus'
      | 'gender'
      | 'hispanicLatino'
      | 'raceEthnicity'
      | 'veteranStatus'
    >
  > = {}

  if (Object.prototype.hasOwnProperty.call(changes, 'dateOfBirth')) {
    const parts = splitCanonicalDate(changes.dateOfBirth ?? null)
    next.dateOfBirth = changes.dateOfBirth ?? null
    next.birthDay = parts.birthDay
    next.birthMonth = parts.birthMonth
    next.birthYear = parts.birthYear
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'disabilityStatus')) {
    next.disabilityStatus = changes.disabilityStatus ?? null
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'gender')) {
    next.gender = changes.gender ?? null
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'hispanicLatino')) {
    next.hispanicLatino = changes.hispanicLatino ?? null
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'raceEthnicity')) {
    next.raceEthnicity = changes.raceEthnicity ?? null
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'veteranStatus')) {
    next.veteranStatus = changes.veteranStatus ?? null
  }

  return next
}

export function assertNormalizedProfile(profile: UserProfile): UserProfile {
  const parsed = userProfileSchema.safeParse(profile)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw invalidProfileDocumentError(issuePath(issue?.path))
  }
  return parsed.data
}

export function dateOfBirthFromSensitive(
  details: Pick<ProfileSensitiveDetails, 'birthDay' | 'birthMonth' | 'birthYear' | 'dateOfBirth'>,
): UserProfile['dateOfBirth'] {
  if (details.birthYear && details.birthMonth && details.birthDay) {
    const composed = `${details.birthYear}-${details.birthMonth.padStart(2, '0')}-${details.birthDay.padStart(2, '0')}`
    const fromParts = coerceCanonicalDate(composed)
    if (fromParts) {
      return fromParts
    }
  }

  return coerceCanonicalDate(details.dateOfBirth)
}

export function sensitiveFieldsFromProfile(profile: UserProfile): Pick<
  ProfileSensitiveDetails,
  | 'birthDay'
  | 'birthMonth'
  | 'birthYear'
  | 'dateOfBirth'
  | 'disabilityStatus'
  | 'gender'
  | 'hispanicLatino'
  | 'raceEthnicity'
  | 'veteranStatus'
> {
  const parts = splitCanonicalDate(profile.dateOfBirth)

  return {
    birthDay: parts.birthDay,
    birthMonth: parts.birthMonth,
    birthYear: parts.birthYear,
    dateOfBirth: profile.dateOfBirth,
    disabilityStatus: profile.disabilityStatus,
    gender: profile.gender,
    hispanicLatino: profile.hispanicLatino,
    raceEthnicity: profile.raceEthnicity,
    veteranStatus: profile.veteranStatus,
  }
}

export function unifySensitiveIntoProfile(
  profile: UserProfile,
  details: ProfileSensitiveDetails,
): UserProfile {
  const next: UserProfile = {
    ...profile,
    dateOfBirth: coerceCanonicalDate(dateOfBirthFromSensitive(details) ?? profile.dateOfBirth),
    disabilityStatus:
      coerceSelfId(details.disabilityStatus) ?? profile.disabilityStatus,
    gender: coerceGender(details.gender) ?? profile.gender,
    hispanicLatino: coerceSelfId(details.hispanicLatino) ?? profile.hispanicLatino,
    raceEthnicity: coerceRaceEthnicity(details.raceEthnicity) ?? profile.raceEthnicity,
    veteranStatus: coerceVeteranStatus(details.veteranStatus) ?? profile.veteranStatus,
  }

  return assertNormalizedProfile(next)
}

export function coerceCanonicalDate(
  value: string | null | undefined,
): UserProfile['dateOfBirth'] {
  if (value === null || value === undefined || value === '') {
    return null
  }
  const parsed = canonicalDateOnlySchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function coerceGender(value: string | null | undefined): UserProfile['gender'] {
  if (!value?.trim()) return null
  return (profileGenderOptions as readonly string[]).includes(value.trim())
    ? (value.trim() as UserProfile['gender'])
    : null
}

export function coerceSelfId(
  value: string | null | undefined,
): UserProfile['disabilityStatus'] {
  if (!value?.trim()) return null
  return (profileSelfIdResponseOptions as readonly string[]).includes(value.trim())
    ? (value.trim() as UserProfile['disabilityStatus'])
    : null
}

export function coerceRaceEthnicity(
  value: string | null | undefined,
): UserProfile['raceEthnicity'] {
  if (!value?.trim()) return null
  return (profileRaceEthnicityOptions as readonly string[]).includes(value.trim())
    ? (value.trim() as UserProfile['raceEthnicity'])
    : null
}

export function coerceVeteranStatus(
  value: string | null | undefined,
): UserProfile['veteranStatus'] {
  if (!value?.trim()) return null
  return (profileVeteranStatusOptions as readonly string[]).includes(value.trim())
    ? (value.trim() as UserProfile['veteranStatus'])
    : null
}

function splitCanonicalDate(value: UserProfile['dateOfBirth']): Pick<
  ProfileSensitiveDetails,
  'birthDay' | 'birthMonth' | 'birthYear'
> {
  if (!value) {
    return { birthDay: null, birthMonth: null, birthYear: null }
  }

  const [year, month, day] = value.split('-')
  return {
    birthDay: day ?? null,
    birthMonth: month ?? null,
    birthYear: year ?? null,
  }
}

function normalizeCanonicalDate(value: string | null | undefined): UserProfile['dateOfBirth'] {
  if (value === null || value === undefined) {
    return null
  }

  const parsed = canonicalDateOnlySchema.safeParse(value)
  if (!parsed.success) {
    throw invalidProfileDocumentError(['dateOfBirth'])
  }

  return parsed.data
}

function normalizeGender(value: string | null | undefined): UserProfile['gender'] {
  if (value === null || value === undefined) {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  if ((profileGenderOptions as readonly string[]).includes(trimmed)) {
    return trimmed as UserProfile['gender']
  }
  throw invalidProfileDocumentError(['gender'])
}

function normalizeSelfId(value: string | null | undefined): UserProfile['disabilityStatus'] {
  if (value === null || value === undefined) {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  if ((profileSelfIdResponseOptions as readonly string[]).includes(trimmed)) {
    return trimmed as UserProfile['disabilityStatus']
  }
  throw invalidProfileDocumentError(['disabilityStatus'])
}

function normalizeRaceEthnicity(value: string | null | undefined): UserProfile['raceEthnicity'] {
  if (value === null || value === undefined) {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  if ((profileRaceEthnicityOptions as readonly string[]).includes(trimmed)) {
    return trimmed as UserProfile['raceEthnicity']
  }
  throw invalidProfileDocumentError(['raceEthnicity'])
}

function normalizeVeteranStatus(value: string | null | undefined): UserProfile['veteranStatus'] {
  if (value === null || value === undefined) {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  if ((profileVeteranStatusOptions as readonly string[]).includes(trimmed)) {
    return trimmed as UserProfile['veteranStatus']
  }
  throw invalidProfileDocumentError(['veteranStatus'])
}

function nullableText(value: string | null | undefined) {
  if (value === null || value === undefined) {
    return null
  }
  const trimmed = value.trim()
  return trimmed || null
}

function nullableTwoDigitText(value: string | null | undefined) {
  const trimmed = nullableText(value)
  return trimmed ? trimmed.padStart(2, '0') : null
}

function normalizeNullableBoolean(value: boolean | null | undefined) {
  return value === null || value === undefined ? null : value
}

/**
 * Compatibility sensitive-profile policy: trims/pads legacy fields, validates
 * calendar dates, and returns a full normalized record for persistence.
 * Widened legacy enum strings are preserved after trim.
 */
export function normalizeSensitiveDetailsUpdate(
  current: ProfileSensitiveDetails,
  input: ProfileSensitiveDetailsInput,
): ProfileSensitiveDetails {
  const legacyBirthDate =
    'dateOfBirth' in input
      ? splitValidatedDateOfBirth((input as { dateOfBirth?: string | null }).dateOfBirth ?? null)
      : null

  const next: ProfileSensitiveDetails = {
    ...current,
    ...(input.birthDay !== undefined ? { birthDay: nullableTwoDigitText(input.birthDay) } : {}),
    ...(input.birthMonth !== undefined
      ? { birthMonth: nullableTwoDigitText(input.birthMonth) }
      : {}),
    ...(input.birthYear !== undefined ? { birthYear: nullableText(input.birthYear) } : {}),
    ...(legacyBirthDate ? legacyBirthDate : {}),
    ...(input.disabilityStatus !== undefined
      ? { disabilityStatus: nullableText(input.disabilityStatus) }
      : {}),
    ...(input.gender !== undefined ? { gender: nullableText(input.gender) } : {}),
    ...(input.hispanicLatino !== undefined
      ? { hispanicLatino: nullableText(input.hispanicLatino) }
      : {}),
    ...(input.raceEthnicity !== undefined
      ? { raceEthnicity: nullableText(input.raceEthnicity) }
      : {}),
    ...(input.ssnLast4 !== undefined ? { ssnLast4: nullableText(input.ssnLast4) } : {}),
    ...(input.veteranStatus !== undefined
      ? { veteranStatus: nullableText(input.veteranStatus) }
      : {}),
  }

  assertCompleteSensitiveBirthDate(next)
  return next
}

function splitValidatedDateOfBirth(
  value: string | null,
): Pick<ProfileSensitiveDetails, 'birthDay' | 'birthMonth' | 'birthYear'> {
  if (value === null || value === undefined) {
    return { birthDay: null, birthMonth: null, birthYear: null }
  }

  const canonical = normalizeCanonicalDate(value)
  if (!canonical) {
    return { birthDay: null, birthMonth: null, birthYear: null }
  }

  return splitCanonicalDate(canonical)
}

function assertCompleteSensitiveBirthDate(details: ProfileSensitiveDetails) {
  if (!details.birthYear || !details.birthMonth || !details.birthDay) {
    return
  }

  const composed = `${details.birthYear}-${details.birthMonth.padStart(2, '0')}-${details.birthDay.padStart(2, '0')}`
  normalizeCanonicalDate(composed)
}
