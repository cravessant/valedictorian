import {
  canonicalDateOnlySchema,
  defaultUserProfile,
  type ProfileAnswer,
  type ProfileEducation,
  type UserProfile,
} from 'sparxie'
import type { SecretCodec } from '../secrets/secret.codec'
import type { LegacySqliteDatabase } from './profile.legacy-sqlite'
import { mergeProfile, normalizeProfilePatch } from './profile.normalize'

export interface LegacyProfileSource {
  hasLegacyProfileData: boolean
  identitySsnLast4: string | null
  profile: UserProfile
}

interface LegacyProfileRow {
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  country: string | null
  citizenship: string | null
  classStanding: string | null
  coverLetterPath: string | null
  degree: string | null
  email: string | null
  fullName: string | null
  githubUrl: string | null
  graduationDate: string | null
  highSchool: string | null
  language: string | null
  linkedinUrl: string | null
  major: string | null
  phone: string | null
  phoneDeviceType: string | null
  portfolioUrl: string | null
  preferredName: string | null
  region: string | null
  relocation: string | null
  relocationNotes: string | null
  requireSponsorship: string | null
  requireSponsorshipFuture: string | null
  satScore: string | null
  school: string | null
  transcriptPath: string | null
  travel: string | null
  travelNotes: string | null
  willingToRelocate: unknown
  willingToTravel: unknown
  workAuthorization: string | null
}

interface LegacySensitiveRow {
  birthDayEncrypted: string | null
  birthMonthEncrypted: string | null
  birthYearEncrypted: string | null
  dateOfBirthEncrypted: string | null
  disabilityStatusEncrypted: string | null
  genderEncrypted: string | null
  hispanicLatinoEncrypted: string | null
  raceEthnicityEncrypted: string | null
  ssnLast4Encrypted: string | null
  veteranStatusEncrypted: string | null
}

export function legacyProfileSourceHasEncryptedMaterial(database: LegacySqliteDatabase): boolean {
  const row = database.prepare(`
    select exists(
      select 1 from profile_sensitive_details
      where deleted_at is null and (
        birth_day_encrypted is not null
        or birth_month_encrypted is not null
        or birth_year_encrypted is not null
        or date_of_birth_encrypted is not null
        or disability_status_encrypted is not null
        or gender_encrypted is not null
        or hispanic_latino_encrypted is not null
        or race_ethnicity_encrypted is not null
        or ssn_last_4_encrypted is not null
        or veteran_status_encrypted is not null
      )
    ) as present
  `).get() as { present: number }
  return row.present === 1
}

export function readLegacyProfileSource(
  database: LegacySqliteDatabase,
  secretCodec: SecretCodec,
): LegacyProfileSource {
  const profileRows = database.prepare(`
    select
      address_line_1 as addressLine1,
      address_line_2 as addressLine2,
      city,
      country,
      citizenship,
      class_standing as classStanding,
      cover_letter_path as coverLetterPath,
      degree,
      email,
      full_name as fullName,
      github_url as githubUrl,
      graduation_date as graduationDate,
      high_school as highSchool,
      language,
      linkedin_url as linkedinUrl,
      major,
      phone,
      phone_device_type as phoneDeviceType,
      portfolio_url as portfolioUrl,
      preferred_name as preferredName,
      region,
      relocation,
      relocation_notes as relocationNotes,
      require_sponsorship as requireSponsorship,
      require_sponsorship_future as requireSponsorshipFuture,
      sat_score as satScore,
      school,
      transcript_path as transcriptPath,
      travel,
      travel_notes as travelNotes,
      willing_to_relocate as willingToRelocate,
      willing_to_travel as willingToTravel,
      work_authorization as workAuthorization
    from user_profile
    where deleted_at is null
    order by id
  `).all() as LegacyProfileRow[]
  if (profileRows.length > 1) {
    throw new Error('Legacy profile source contains multiple active profile rows')
  }

  const education = database.prepare(`
    select
      id,
      education_type as educationType,
      school,
      degree,
      major,
      graduation_date as graduationDate,
      class_standing as classStanding,
      sat_score as satScore,
      transcript_path as transcriptPath,
      notes
    from profile_education
    where deleted_at is null
    order by sort_order, id
  `).all() as ProfileEducation[]
  const answers = database.prepare(`
    select
      key,
      label,
      question_pattern as questionPattern,
      answer,
      category,
      include_in_agent_context as includeInAgentContext
    from profile_answers
    where deleted_at is null
    order by key
  `).all().map((row) => ({
    ...(row as Omit<ProfileAnswer, 'includeInAgentContext'>),
    includeInAgentContext: legacyBoolean(
      (row as { includeInAgentContext: unknown }).includeInAgentContext,
      false,
    ),
  }))
  const sensitiveRows = database.prepare(`
    select
      birth_day_encrypted as birthDayEncrypted,
      birth_month_encrypted as birthMonthEncrypted,
      birth_year_encrypted as birthYearEncrypted,
      date_of_birth_encrypted as dateOfBirthEncrypted,
      disability_status_encrypted as disabilityStatusEncrypted,
      gender_encrypted as genderEncrypted,
      hispanic_latino_encrypted as hispanicLatinoEncrypted,
      race_ethnicity_encrypted as raceEthnicityEncrypted,
      ssn_last_4_encrypted as ssnLast4Encrypted,
      veteran_status_encrypted as veteranStatusEncrypted
    from profile_sensitive_details
    where deleted_at is null
    order by id
  `).all() as LegacySensitiveRow[]
  if (sensitiveRows.length > 1) {
    throw new Error('Legacy profile source contains multiple active sensitive rows')
  }

  const profileRow = profileRows[0]
  const sensitiveRow = sensitiveRows[0]
  const birthDay = decryptNullable(sensitiveRow?.birthDayEncrypted, secretCodec)
  const birthMonth = decryptNullable(sensitiveRow?.birthMonthEncrypted, secretCodec)
  const birthYear = decryptNullable(sensitiveRow?.birthYearEncrypted, secretCodec)
  const legacyDateOfBirth = decryptNullable(sensitiveRow?.dateOfBirthEncrypted, secretCodec)
  const dateOfBirth = legacyDateOfBirthFromSource({
    birthDay,
    birthMonth,
    birthYear,
    dateOfBirth: legacyDateOfBirth,
  })

  const patch = normalizeProfilePatch({
    ...profileRow,
    answers,
    dateOfBirth,
    disabilityStatus: decryptNullable(sensitiveRow?.disabilityStatusEncrypted, secretCodec),
    education,
    gender: decryptNullable(sensitiveRow?.genderEncrypted, secretCodec),
    hispanicLatino: decryptNullable(sensitiveRow?.hispanicLatinoEncrypted, secretCodec),
    raceEthnicity: decryptNullable(sensitiveRow?.raceEthnicityEncrypted, secretCodec),
    veteranStatus: decryptNullable(sensitiveRow?.veteranStatusEncrypted, secretCodec),
    ...(profileRow
      ? {
          willingToRelocate: nullableBoolean(profileRow.willingToRelocate),
          willingToTravel: nullableBoolean(profileRow.willingToTravel),
        }
      : {}),
  })

  return {
    hasLegacyProfileData:
      profileRows.length > 0 || education.length > 0 || answers.length > 0 || sensitiveRows.length > 0,
    identitySsnLast4: decryptNullable(sensitiveRow?.ssnLast4Encrypted, secretCodec),
    profile: mergeProfile(defaultUserProfile, patch),
  }
}

function decryptNullable(value: string | null | undefined, secretCodec: SecretCodec) {
  return value ? secretCodec.decrypt(value) : null
}

function nullableBoolean(value: unknown): boolean | null {
  return legacyBoolean(value, true)
}

function legacyBoolean(value: unknown, nullable: true): boolean | null
function legacyBoolean(value: unknown, nullable: false): boolean
function legacyBoolean(value: unknown, nullable: boolean): boolean | null {
  if (nullable && value === null) return null
  if (value === 0) return false
  if (value === 1) return true
  throw new Error('Legacy profile source contains a malformed boolean')
}

function legacyDateOfBirthFromSource(details: {
  birthDay: string | null
  birthMonth: string | null
  birthYear: string | null
  dateOfBirth: string | null
}): UserProfile['dateOfBirth'] {
  const parts = [details.birthYear, details.birthMonth, details.birthDay]
  if (parts.some(Boolean)) {
    if (!parts.every(Boolean)) {
      throw new Error('Legacy profile source contains an incomplete date of birth')
    }
    return parseLegacyDate(
      `${details.birthYear}-${details.birthMonth!.padStart(2, '0')}-${details.birthDay!.padStart(2, '0')}`,
    )
  }
  return details.dateOfBirth ? parseLegacyDate(details.dateOfBirth) : null
}

function parseLegacyDate(value: string): UserProfile['dateOfBirth'] {
  const parsed = canonicalDateOnlySchema.safeParse(value)
  if (!parsed.success) {
    throw new Error('Legacy profile source contains an invalid date of birth')
  }
  return parsed.data
}
