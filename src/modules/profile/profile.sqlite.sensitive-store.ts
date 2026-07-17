import { eq } from 'drizzle-orm'
import type { ProfileSensitiveDetails } from 'sparxie'
import { profileSensitiveDetails } from '../../db/schema'
import type { DrizzleDatabase } from '../../db/sqlite'
import type { SecretCodec } from '../secrets/secret.codec'
import type { SensitiveProfileStore } from './profile.sensitive-store'

const profileSensitiveDetailsId = 'default'

export function createSqliteSensitiveProfileStore(
  database: DrizzleDatabase,
  secretCodec: SecretCodec,
): SensitiveProfileStore {
  return {
    async get() {
      return readSensitiveDetails(database, secretCodec)
    },
    async update(normalized: ProfileSensitiveDetails) {
      const now = new Date().toISOString()
      const existing = database
        .select()
        .from(profileSensitiveDetails)
        .where(eq(profileSensitiveDetails.id, profileSensitiveDetailsId))
        .get()
      const encryptedValues = sensitiveDetailsRecordValues(normalized, secretCodec)

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

      return readSensitiveDetails(database, secretCodec)
    },
  }
}

function readSensitiveDetails(
  database: DrizzleDatabase,
  secretCodec: SecretCodec,
): ProfileSensitiveDetails {
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
      ssnLast4: null,
      veteranStatus: null,
    }
  }

  return mapSensitiveDetailsRow(row, secretCodec)
}

function mapSensitiveDetailsRow(
  row: typeof profileSensitiveDetails.$inferSelect,
  secretCodec: SecretCodec,
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

function sensitiveDetailsRecordValues(
  details: ProfileSensitiveDetails,
  secretCodec: SecretCodec,
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
