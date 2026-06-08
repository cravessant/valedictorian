import { eq } from 'drizzle-orm'
import {
  defaultUserProfile,
  normalizeProfileEducationInput,
  normalizeProfileAnswerInput,
  normalizeProfileEducationId,
  normalizeProfileAnswerKey,
  profileSecretKinds,
  toProfileAgentContext,
  type ProfileAgentContext,
  type ProfileAnswer,
  type ProfileEducation,
  type ProfileSecretKind,
  type ProfileUpdateInput,
  type UserProfile,
} from 'sparxie'
import {
  profileAnswers,
  profileEducation,
  profileSecrets,
  profileSensitiveDetails,
  userProfile,
} from '../../db/schema'
import type { DrizzleDatabase } from '../../db/sqlite'

const profileId = 'default'
const profileSensitiveDetailsId = 'default'

export interface ProfileSecretCodec {
  decrypt: (value: string) => string
  encrypt: (value: string) => string
}

export interface ProfileSecretSummary {
  key: string
  kind: ProfileSecretKind
  label: string
  updatedAt: string
}

export interface ProfileSecretValue extends ProfileSecretSummary {
  value: string
}

export interface UpsertProfileSecretInput {
  key: string
  kind: ProfileSecretKind
  label: string
  value: string
}

export interface ProfileSensitiveDetails {
  birthDay: string | null
  birthMonth: string | null
  birthYear: string | null
  dateOfBirth?: string | null
  disabilityStatus: string | null
  gender: string | null
  hispanicLatino: string | null
  raceEthnicity: string | null
  ssnLast4: string | null
  veteranStatus: string | null
}

export type ProfileSensitiveDetailsInput = Partial<ProfileSensitiveDetails>

export interface ProfileRepository {
  deleteSecret: (key: string) => Promise<void>
  getAgentContext: () => Promise<ProfileAgentContext>
  getProfile: () => Promise<UserProfile>
  getSensitiveDetails: () => Promise<ProfileSensitiveDetails>
  listSecrets: () => Promise<ProfileSecretSummary[]>
  revealSecret: (key: string) => Promise<ProfileSecretValue | null>
  updateSensitiveDetails: (input: ProfileSensitiveDetailsInput) => Promise<ProfileSensitiveDetails>
  updateProfile: (input: ProfileUpdateInput) => Promise<UserProfile>
  upsertSecret: (input: UpsertProfileSecretInput) => Promise<ProfileSecretSummary>
}

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

export function createSqliteProfileRepository(
  database: DrizzleDatabase,
  secretCodec: ProfileSecretCodec,
): ProfileRepository {
  return {
    async deleteSecret(key) {
      database.delete(profileSecrets).where(eq(profileSecrets.key, normalizeProfileAnswerKey(key))).run()
    },
    async getAgentContext() {
      return toProfileAgentContext(await this.getProfile())
    },
    async getProfile() {
      return selectProfile(database)
    },
    async getSensitiveDetails() {
      return selectSensitiveDetails(database, secretCodec)
    },
    async listSecrets() {
      return database
        .select()
        .from(profileSecrets)
        .all()
        .filter((row) => !row.deletedAt)
        .map(mapSecretSummary)
    },
    async revealSecret(key) {
      const row = database
        .select()
        .from(profileSecrets)
        .where(eq(profileSecrets.key, normalizeProfileAnswerKey(key)))
        .get()

      if (!row || row.deletedAt) {
        return null
      }

      return {
        ...mapSecretSummary(row),
        value: secretCodec.decrypt(row.encryptedValue),
      }
    },
    async updateProfile(input) {
      const now = new Date().toISOString()
      const existing = database.select().from(userProfile).where(eq(userProfile.id, profileId)).get()
      const nextProfile = {
        ...defaultUserProfile,
        ...(existing ? mapProfileRow(existing) : {}),
        ...normalizeProfilePatch(input),
      }
      const profileValues = profileRecordValues(nextProfile)

      if (existing) {
        database
          .update(userProfile)
          .set({
            ...profileValues,
            updatedAt: now,
          })
          .where(eq(userProfile.id, profileId))
          .run()
      } else {
        database
          .insert(userProfile)
          .values({
            ...profileValues,
            id: profileId,
            createdAt: now,
            deletedAt: null,
            updatedAt: now,
          })
          .run()
      }

      if (input.answers) {
        database.delete(profileAnswers).run()

        for (const answer of nextProfile.answers) {
          database
            .insert(profileAnswers)
            .values({
              answer: answer.answer,
              category: answer.category,
              createdAt: now,
              deletedAt: null,
              includeInAgentContext: answer.includeInAgentContext,
              key: answer.key,
              label: answer.label,
              questionPattern: answer.questionPattern,
              updatedAt: now,
            })
          .run()
        }
      }

      if (input.education) {
        database.delete(profileEducation).run()

        nextProfile.education.forEach((education, index) => {
          database
            .insert(profileEducation)
            .values({
              classStanding: education.classStanding,
              createdAt: now,
              degree: education.degree,
              deletedAt: null,
              educationType: education.educationType,
              graduationDate: education.graduationDate,
              id: education.id,
              major: education.major,
              notes: education.notes,
              satScore: education.satScore,
              school: education.school,
              sortOrder: index,
              transcriptPath: education.transcriptPath,
              updatedAt: now,
            })
            .run()
        })
      }

      return selectProfile(database)
    },
    async updateSensitiveDetails(input) {
      const now = new Date().toISOString()
      const existing = database
        .select()
        .from(profileSensitiveDetails)
        .where(eq(profileSensitiveDetails.id, profileSensitiveDetailsId))
        .get()
      const nextDetails = {
        ...defaultSensitiveDetails,
        ...(existing && !existing.deletedAt
          ? mapSensitiveDetailsRow(existing, secretCodec)
          : {}),
        ...normalizeSensitiveDetailsPatch(input),
      }
      const encryptedValues = sensitiveDetailsRecordValues(nextDetails, secretCodec)

      if (existing) {
        database
          .update(profileSensitiveDetails)
          .set({
            ...encryptedValues,
            deletedAt: null,
            updatedAt: now,
          })
          .where(eq(profileSensitiveDetails.id, profileSensitiveDetailsId))
          .run()
      } else {
        database
          .insert(profileSensitiveDetails)
          .values({
            ...encryptedValues,
            createdAt: now,
            deletedAt: null,
            id: profileSensitiveDetailsId,
            updatedAt: now,
          })
          .run()
      }

      return selectSensitiveDetails(database, secretCodec)
    },
    async upsertSecret(input) {
      const now = new Date().toISOString()
      const key = normalizeProfileAnswerKey(input.key)
      const kind = normalizeSecretKind(input.kind)
      const label = requiredText(input.label, 'secret label')
      const encryptedValue = secretCodec.encrypt(input.value)
      const existing = database.select().from(profileSecrets).where(eq(profileSecrets.key, key)).get()

      if (existing) {
        database
          .update(profileSecrets)
          .set({
            deletedAt: null,
            encryptedValue,
            kind,
            label,
            updatedAt: now,
          })
          .where(eq(profileSecrets.key, key))
          .run()
      } else {
        database
          .insert(profileSecrets)
          .values({
            createdAt: now,
            deletedAt: null,
            encryptedValue,
            key,
            kind,
            label,
            updatedAt: now,
          })
          .run()
      }

      const row = database.select().from(profileSecrets).where(eq(profileSecrets.key, key)).get()

      if (!row) {
        throw new Error(`Profile secret not found after save: ${key}`)
      }

      return mapSecretSummary(row)
    },
  }
}

function selectSensitiveDetails(
  database: DrizzleDatabase,
  secretCodec: ProfileSecretCodec,
): ProfileSensitiveDetails {
  const row = database
    .select()
    .from(profileSensitiveDetails)
    .where(eq(profileSensitiveDetails.id, profileSensitiveDetailsId))
    .get()

  if (!row || row.deletedAt) {
    return { ...defaultSensitiveDetails }
  }

  return mapSensitiveDetailsRow(row, secretCodec)
}

function selectProfile(database: DrizzleDatabase): UserProfile {
  const row = database.select().from(userProfile).where(eq(userProfile.id, profileId)).get()
  const answers = database
    .select()
    .from(profileAnswers)
    .all()
    .filter((answer) => !answer.deletedAt)
    .map(mapAnswerRow)
  const education = database
    .select()
    .from(profileEducation)
    .all()
    .filter((item) => !item.deletedAt)
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map(mapEducationRow)

  return {
    ...defaultUserProfile,
    ...(row && !row.deletedAt ? mapProfileRow(row) : {}),
    answers,
    education,
  }
}

function normalizeProfilePatch(input: ProfileUpdateInput): Partial<UserProfile> {
  return {
    ...(input.addressLine1 !== undefined ? { addressLine1: nullableText(input.addressLine1) } : {}),
    ...(input.addressLine2 !== undefined ? { addressLine2: nullableText(input.addressLine2) } : {}),
    ...(input.answers ? { answers: input.answers.map(normalizeProfileAnswerInput) } : {}),
    ...(input.city !== undefined ? { city: nullableText(input.city) } : {}),
    ...(input.country !== undefined ? { country: nullableText(input.country) } : {}),
    ...(input.citizenship !== undefined ? { citizenship: nullableText(input.citizenship) } : {}),
    ...(input.classStanding !== undefined
      ? { classStanding: nullableText(input.classStanding) }
      : {}),
    ...(input.coverLetterPath !== undefined
      ? { coverLetterPath: nullableText(input.coverLetterPath) }
      : {}),
    ...(input.degree !== undefined ? { degree: nullableText(input.degree) } : {}),
    ...(input.education ? { education: input.education.map(normalizeProfileEducationInput) } : {}),
    ...(input.email !== undefined ? { email: nullableText(input.email) } : {}),
    ...(input.fullName !== undefined ? { fullName: nullableText(input.fullName) } : {}),
    ...(input.githubUrl !== undefined ? { githubUrl: nullableText(input.githubUrl) } : {}),
    ...(input.graduationDate !== undefined
      ? { graduationDate: nullableText(input.graduationDate) }
      : {}),
    ...(input.highSchool !== undefined ? { highSchool: nullableText(input.highSchool) } : {}),
    ...(input.language !== undefined ? { language: nullableText(input.language) } : {}),
    ...(input.linkedinUrl !== undefined ? { linkedinUrl: nullableText(input.linkedinUrl) } : {}),
    ...(input.major !== undefined ? { major: nullableText(input.major) } : {}),
    ...(input.phone !== undefined ? { phone: nullableText(input.phone) } : {}),
    ...(input.phoneDeviceType !== undefined
      ? { phoneDeviceType: nullableText(input.phoneDeviceType) }
      : {}),
    ...(input.portfolioUrl !== undefined ? { portfolioUrl: nullableText(input.portfolioUrl) } : {}),
    ...(input.preferredName !== undefined ? { preferredName: nullableText(input.preferredName) } : {}),
    ...(input.region !== undefined ? { region: nullableText(input.region) } : {}),
    ...(input.relocation !== undefined ? { relocation: nullableText(input.relocation) } : {}),
    ...(input.relocationNotes !== undefined
      ? { relocationNotes: nullableText(input.relocationNotes) }
      : {}),
    ...(input.requireSponsorship !== undefined
      ? { requireSponsorship: nullableText(input.requireSponsorship) }
      : {}),
    ...(input.requireSponsorshipFuture !== undefined
      ? { requireSponsorshipFuture: nullableText(input.requireSponsorshipFuture) }
      : {}),
    ...(input.satScore !== undefined ? { satScore: nullableText(input.satScore) } : {}),
    ...(input.school !== undefined ? { school: nullableText(input.school) } : {}),
    ...(input.transcriptPath !== undefined
      ? { transcriptPath: nullableText(input.transcriptPath) }
      : {}),
    ...(input.travel !== undefined ? { travel: nullableText(input.travel) } : {}),
    ...(input.travelNotes !== undefined ? { travelNotes: nullableText(input.travelNotes) } : {}),
    ...(input.willingToRelocate !== undefined
      ? { willingToRelocate: normalizeNullableBoolean(input.willingToRelocate) }
      : {}),
    ...(input.willingToTravel !== undefined
      ? { willingToTravel: normalizeNullableBoolean(input.willingToTravel) }
      : {}),
    ...(input.workAuthorization !== undefined
      ? { workAuthorization: nullableText(input.workAuthorization) }
      : {}),
  }
}

function mapProfileRow(row: typeof userProfile.$inferSelect): Omit<UserProfile, 'answers'> {
  return {
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    country: row.country,
    citizenship: row.citizenship,
    classStanding: row.classStanding,
    coverLetterPath: row.coverLetterPath,
    degree: row.degree,
    education: [],
    email: row.email,
    fullName: row.fullName,
    githubUrl: row.githubUrl,
    graduationDate: row.graduationDate,
    highSchool: row.highSchool,
    language: row.language,
    linkedinUrl: row.linkedinUrl,
    major: row.major,
    phone: row.phone,
    phoneDeviceType: row.phoneDeviceType,
    portfolioUrl: row.portfolioUrl,
    preferredName: row.preferredName,
    region: row.region,
    relocation: row.relocation,
    relocationNotes: row.relocationNotes,
    requireSponsorship: row.requireSponsorship,
    requireSponsorshipFuture: row.requireSponsorshipFuture,
    satScore: row.satScore,
    school: row.school,
    transcriptPath: row.transcriptPath,
    travel: row.travel,
    travelNotes: row.travelNotes,
    willingToRelocate: row.willingToRelocate,
    willingToTravel: row.willingToTravel,
    workAuthorization: row.workAuthorization,
  }
}

function profileRecordValues(profile: UserProfile): Omit<
  typeof userProfile.$inferInsert,
  'createdAt' | 'deletedAt' | 'id' | 'updatedAt'
> {
  return {
    addressLine1: profile.addressLine1,
    addressLine2: profile.addressLine2,
    city: profile.city,
    country: profile.country,
    citizenship: profile.citizenship,
    classStanding: profile.classStanding,
    coverLetterPath: profile.coverLetterPath,
    degree: profile.degree,
    email: profile.email,
    fullName: profile.fullName,
    githubUrl: profile.githubUrl,
    graduationDate: profile.graduationDate,
    highSchool: profile.highSchool,
    language: profile.language,
    linkedinUrl: profile.linkedinUrl,
    major: profile.major,
    phone: profile.phone,
    phoneDeviceType: profile.phoneDeviceType,
    portfolioUrl: profile.portfolioUrl,
    preferredName: profile.preferredName,
    region: profile.region,
    relocation: profile.relocation,
    relocationNotes: profile.relocationNotes,
    requireSponsorship: profile.requireSponsorship,
    requireSponsorshipFuture: profile.requireSponsorshipFuture,
    satScore: profile.satScore,
    school: profile.school,
    transcriptPath: profile.transcriptPath,
    travel: profile.travel,
    travelNotes: profile.travelNotes,
    willingToRelocate: profile.willingToRelocate,
    willingToTravel: profile.willingToTravel,
    workAuthorization: profile.workAuthorization,
  }
}

function mapAnswerRow(row: typeof profileAnswers.$inferSelect): ProfileAnswer {
  return {
    answer: row.answer,
    category: row.category,
    includeInAgentContext: row.includeInAgentContext,
    key: row.key,
    label: row.label,
    questionPattern: row.questionPattern,
  }
}

function mapEducationRow(row: typeof profileEducation.$inferSelect): ProfileEducation {
  return {
    classStanding: row.classStanding,
    degree: row.degree,
    educationType: row.educationType,
    graduationDate: row.graduationDate,
    id: normalizeProfileEducationId(row.id),
    major: row.major,
    notes: row.notes,
    satScore: row.satScore,
    school: row.school,
    transcriptPath: row.transcriptPath,
  }
}

function mapSecretSummary(row: typeof profileSecrets.$inferSelect): ProfileSecretSummary {
  return {
    key: row.key,
    kind: normalizeSecretKind(row.kind),
    label: row.label,
    updatedAt: row.updatedAt,
  }
}

function mapSensitiveDetailsRow(
  row: typeof profileSensitiveDetails.$inferSelect,
  secretCodec: ProfileSecretCodec,
): ProfileSensitiveDetails {
  const legacyBirthDate = parseBirthDate(
    decryptNullableText(row.dateOfBirthEncrypted, secretCodec),
  )

  return {
    birthDay:
      decryptNullableText(row.birthDayEncrypted, secretCodec) ?? legacyBirthDate.birthDay,
    birthMonth:
      decryptNullableText(row.birthMonthEncrypted, secretCodec) ?? legacyBirthDate.birthMonth,
    birthYear:
      decryptNullableText(row.birthYearEncrypted, secretCodec) ?? legacyBirthDate.birthYear,
    disabilityStatus: decryptNullableText(row.disabilityStatusEncrypted, secretCodec),
    gender: decryptNullableText(row.genderEncrypted, secretCodec),
    hispanicLatino: decryptNullableText(row.hispanicLatinoEncrypted, secretCodec),
    raceEthnicity: decryptNullableText(row.raceEthnicityEncrypted, secretCodec),
    ssnLast4: decryptNullableText(row.ssnLast4Encrypted, secretCodec),
    veteranStatus: decryptNullableText(row.veteranStatusEncrypted, secretCodec),
  }
}

function normalizeSensitiveDetailsPatch(
  input: ProfileSensitiveDetailsInput,
): Partial<ProfileSensitiveDetails> {
  const legacyBirthDate =
    'dateOfBirth' in input
      ? parseBirthDate((input as { dateOfBirth?: string | null }).dateOfBirth ?? null)
      : null

  return {
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
}

function sensitiveDetailsRecordValues(
  details: ProfileSensitiveDetails,
  secretCodec: ProfileSecretCodec,
): Omit<typeof profileSensitiveDetails.$inferInsert, 'createdAt' | 'deletedAt' | 'id' | 'updatedAt'> {
  return {
    birthDayEncrypted: encryptNullableText(details.birthDay, secretCodec),
    birthMonthEncrypted: encryptNullableText(details.birthMonth, secretCodec),
    birthYearEncrypted: encryptNullableText(details.birthYear, secretCodec),
    dateOfBirthEncrypted: null,
    disabilityStatusEncrypted: encryptNullableText(details.disabilityStatus, secretCodec),
    genderEncrypted: encryptNullableText(details.gender, secretCodec),
    hispanicLatinoEncrypted: encryptNullableText(details.hispanicLatino, secretCodec),
    raceEthnicityEncrypted: encryptNullableText(details.raceEthnicity, secretCodec),
    ssnLast4Encrypted: encryptNullableText(details.ssnLast4, secretCodec),
    veteranStatusEncrypted: encryptNullableText(details.veteranStatus, secretCodec),
  }
}

function parseBirthDate(value: string | null | undefined): Pick<
  ProfileSensitiveDetails,
  'birthDay' | 'birthMonth' | 'birthYear'
> {
  const parts = value?.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)

  if (!parts) {
    return {
      birthDay: null,
      birthMonth: null,
      birthYear: null,
    }
  }

  return {
    birthDay: parts[3].padStart(2, '0'),
    birthMonth: parts[2].padStart(2, '0'),
    birthYear: parts[1],
  }
}

function normalizeSecretKind(value: string): ProfileSecretKind {
  if ((profileSecretKinds as readonly string[]).includes(value)) {
    return value as ProfileSecretKind
  }

  throw new Error(`Invalid profile secret kind: ${value}`)
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

function decryptNullableText(value: string | null, secretCodec: ProfileSecretCodec) {
  return value ? secretCodec.decrypt(value) : null
}

function encryptNullableText(value: string | null, secretCodec: ProfileSecretCodec) {
  return value ? secretCodec.encrypt(value) : null
}

function requiredText(value: string | null | undefined, field: string) {
  const trimmed = nullableText(value)

  if (!trimmed) {
    throw new Error(`${field} is required`)
  }

  return trimmed
}
