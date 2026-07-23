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
  type UserProfile,
} from '@sparxie/sdk'
import { invalidProfileDocumentError, issuePath } from './profile.errors'

export function normalizeProfilePatch(
  input: unknown,
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

export function assertNormalizedProfile(profile: UserProfile): UserProfile {
  const parsed = userProfileSchema.safeParse(profile)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw invalidProfileDocumentError(issuePath(issue?.path))
  }
  return parsed.data
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

function normalizeNullableBoolean(value: boolean | null | undefined) {
  return value === null || value === undefined ? null : value
}
