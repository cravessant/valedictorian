import { eq } from 'drizzle-orm'
import {
  defaultUserProfile,
  normalizeProfileEducationId,
  profileDocumentSchemaVersion,
  type ProfileAnswer,
  type ProfileDocument,
  type ProfileEducation,
  type ProfileSensitiveDetails,
  type UserProfile,
} from 'sparxie'
import {
  profileAnswers,
  profileEducation,
  profileSensitiveDetails,
  userProfile,
} from '../../db/schema'
import type { DrizzleDatabase } from '../../db/sqlite'
import type { SecretCodec } from '../secrets/secret.codec'
import { sensitiveFieldsFromMovedChanges, unifySensitiveIntoProfile } from './profile.normalize'
import { computeProfileRevision } from './profile.revision'
import type {
  MovedSensitiveProfileChanges,
  ProfileStore,
  ProfileStoreUpdateResult,
} from './profile.store'

const profileId = 'default'
const profileSensitiveDetailsId = 'default'

export function createSqliteProfileStore(
  database: DrizzleDatabase,
  secretCodec: SecretCodec,
): ProfileStore {
  return {
    async get() {
      return readDocument(database, secretCodec)
    },
    async update(input): Promise<ProfileStoreUpdateResult> {
      return database.transaction((tx) => {
        const db = tx as unknown as DrizzleDatabase
        const current = readDocument(db, secretCodec)
        if (current.revision !== input.expectedRevision) {
          return {
            ok: false as const,
            code: 'profile_revision_conflict' as const,
            document: current,
          }
        }

        const now = new Date().toISOString()
        writeOrdinaryProfile(db, input.profile, now)
        writeMovedSensitiveFields(db, secretCodec, input.movedSensitiveChanges ?? {}, now)
        return {
          ok: true as const,
          document: readDocument(db, secretCodec),
        }
      })
    },
  }
}

function readDocument(
  database: DrizzleDatabase,
  secretCodec: SecretCodec,
): ProfileDocument {
  const ordinary = selectOrdinaryProfile(database)
  const moved = selectMovedSensitiveFields(database, secretCodec)
  const profile = unifySensitiveIntoProfile(ordinary, {
    ...moved,
    ssnLast4: null,
  })
  return {
    profile,
    revision: computeProfileRevision(profile),
    schemaVersion: profileDocumentSchemaVersion,
  }
}

function selectOrdinaryProfile(database: DrizzleDatabase): UserProfile {
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

function writeOrdinaryProfile(
  database: DrizzleDatabase,
  profile: UserProfile,
  now: string,
) {
  const existing = database.select().from(userProfile).where(eq(userProfile.id, profileId)).get()
  const profileValues = profileRecordValues(profile)

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

  database.delete(profileAnswers).run()
  for (const answer of profile.answers) {
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

  database.delete(profileEducation).run()
  profile.education.forEach((education, index) => {
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

function writeMovedSensitiveFields(
  database: DrizzleDatabase,
  secretCodec: SecretCodec,
  changes: MovedSensitiveProfileChanges,
  now: string,
) {
  const moved = sensitiveFieldsFromMovedChanges(changes)
  if (Object.keys(moved).length === 0) {
    return
  }

  const existing = database
    .select()
    .from(profileSensitiveDetails)
    .where(eq(profileSensitiveDetails.id, profileSensitiveDetailsId))
    .get()

  const encryptedMoved: Partial<{
    birthDayEncrypted: string | null
    birthMonthEncrypted: string | null
    birthYearEncrypted: string | null
    dateOfBirthEncrypted: string | null
    disabilityStatusEncrypted: string | null
    genderEncrypted: string | null
    hispanicLatinoEncrypted: string | null
    raceEthnicityEncrypted: string | null
    veteranStatusEncrypted: string | null
  }> = {}

  if (Object.prototype.hasOwnProperty.call(moved, 'birthDay')) {
    encryptedMoved.birthDayEncrypted = encryptNullableText(moved.birthDay ?? null, secretCodec)
    encryptedMoved.birthMonthEncrypted = encryptNullableText(moved.birthMonth ?? null, secretCodec)
    encryptedMoved.birthYearEncrypted = encryptNullableText(moved.birthYear ?? null, secretCodec)
    encryptedMoved.dateOfBirthEncrypted = null
  }
  if (Object.prototype.hasOwnProperty.call(moved, 'disabilityStatus')) {
    encryptedMoved.disabilityStatusEncrypted = encryptNullableText(
      moved.disabilityStatus ?? null,
      secretCodec,
    )
  }
  if (Object.prototype.hasOwnProperty.call(moved, 'gender')) {
    encryptedMoved.genderEncrypted = encryptNullableText(moved.gender ?? null, secretCodec)
  }
  if (Object.prototype.hasOwnProperty.call(moved, 'hispanicLatino')) {
    encryptedMoved.hispanicLatinoEncrypted = encryptNullableText(
      moved.hispanicLatino ?? null,
      secretCodec,
    )
  }
  if (Object.prototype.hasOwnProperty.call(moved, 'raceEthnicity')) {
    encryptedMoved.raceEthnicityEncrypted = encryptNullableText(
      moved.raceEthnicity ?? null,
      secretCodec,
    )
  }
  if (Object.prototype.hasOwnProperty.call(moved, 'veteranStatus')) {
    encryptedMoved.veteranStatusEncrypted = encryptNullableText(
      moved.veteranStatus ?? null,
      secretCodec,
    )
  }

  if (existing) {
    database
      .update(profileSensitiveDetails)
      .set({
        ...encryptedMoved,
        deletedAt: null,
        updatedAt: now,
      })
      .where(eq(profileSensitiveDetails.id, profileSensitiveDetailsId))
      .run()
    return
  }

  database
    .insert(profileSensitiveDetails)
    .values({
      birthDayEncrypted: encryptedMoved.birthDayEncrypted ?? null,
      birthMonthEncrypted: encryptedMoved.birthMonthEncrypted ?? null,
      birthYearEncrypted: encryptedMoved.birthYearEncrypted ?? null,
      dateOfBirthEncrypted: null,
      disabilityStatusEncrypted: encryptedMoved.disabilityStatusEncrypted ?? null,
      genderEncrypted: encryptedMoved.genderEncrypted ?? null,
      hispanicLatinoEncrypted: encryptedMoved.hispanicLatinoEncrypted ?? null,
      raceEthnicityEncrypted: encryptedMoved.raceEthnicityEncrypted ?? null,
      veteranStatusEncrypted: encryptedMoved.veteranStatusEncrypted ?? null,
      createdAt: now,
      deletedAt: null,
      id: profileSensitiveDetailsId,
      updatedAt: now,
    })
    .run()
}

function selectMovedSensitiveFields(
  database: DrizzleDatabase,
  secretCodec: SecretCodec,
): Omit<ProfileSensitiveDetails, 'ssnLast4'> {
  const row = database
    .select()
    .from(profileSensitiveDetails)
    .where(eq(profileSensitiveDetails.id, profileSensitiveDetailsId))
    .get()

  if (!row || row.deletedAt) {
    return {
      birthDay: null,
      birthMonth: null,
      birthYear: null,
      disabilityStatus: null,
      gender: null,
      hispanicLatino: null,
      raceEthnicity: null,
      veteranStatus: null,
    }
  }

  return mapMovedSensitiveDetailsRow(row, secretCodec)
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
    dateOfBirth: null,
    degree: row.degree,
    disabilityStatus: null,
    education: [],
    email: row.email,
    fullName: row.fullName,
    gender: null,
    githubUrl: row.githubUrl,
    graduationDate: row.graduationDate,
    highSchool: row.highSchool,
    hispanicLatino: null,
    language: row.language,
    linkedinUrl: row.linkedinUrl,
    major: row.major,
    phone: row.phone,
    phoneDeviceType: row.phoneDeviceType,
    portfolioUrl: row.portfolioUrl,
    preferredName: row.preferredName,
    raceEthnicity: null,
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
    veteranStatus: null,
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

function mapMovedSensitiveDetailsRow(
  row: typeof profileSensitiveDetails.$inferSelect,
  secretCodec: SecretCodec,
): Omit<ProfileSensitiveDetails, 'ssnLast4'> {
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
    veteranStatus: decryptNullableText(row.veteranStatusEncrypted, secretCodec),
  }
}

function parseBirthDate(value: string | null | undefined): Pick<
  ProfileSensitiveDetails,
  'birthDay' | 'birthMonth' | 'birthYear'
> {
  const parts = value?.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!parts) {
    return { birthDay: null, birthMonth: null, birthYear: null }
  }

  return {
    birthDay: parts[3].padStart(2, '0'),
    birthMonth: parts[2].padStart(2, '0'),
    birthYear: parts[1],
  }
}

function decryptNullableText(value: string | null, secretCodec: SecretCodec) {
  return value ? secretCodec.decrypt(value) : null
}

function encryptNullableText(value: string | null, secretCodec: SecretCodec) {
  return value ? secretCodec.encrypt(value) : null
}
