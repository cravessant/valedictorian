import { describe, expect, it } from 'vitest'
import {
  createDrizzleDatabase,
  createInMemoryDatabase,
  migrateDatabase,
} from '../../db/sqlite'
import { profileSensitiveDetails } from '../../db/schema'
import type { SecretCodec } from '../secrets/secret.codec'
import { createSqliteProfileService } from './profile.composition'
import { defineProfileStoreContract } from './profile.store.contract'
import { createSqliteProfileStore } from './profile.sqlite.store'

const testCodec: SecretCodec = {
  decrypt(value) {
    return value.replace(/^enc:/, '')
  },
  encrypt(value) {
    if (value === 'trigger-unavailable') {
      throw Object.assign(new Error('Secure storage is unavailable'), {
        code: 'secure_storage_unavailable',
      })
    }
    return `enc:${value}`
  },
}

function createStores() {
  const sqlite = createInMemoryDatabase()
  migrateDatabase(sqlite)
  const database = createDrizzleDatabase(sqlite)
  return {
    database,
    profileStore: createSqliteProfileStore(database, testCodec),
    service: createSqliteProfileService(database, testCodec),
  }
}

defineProfileStoreContract(() => {
  const { profileStore } = createStores()
  return { store: profileStore }
})

describe('SQLite profile compatibility adapter', () => {
  it('unifies moved sensitive fields, excludes SSN, and keeps encryption at rest', async () => {
    const { database, service } = createStores()

    await service.update({
      email: 'kenny@example.com',
      fullName: 'Kenny Lin',
    })
    const sensitive = await service.updateSensitiveDetails({
      birthDay: '16',
      birthMonth: '03',
      birthYear: '2004',
      disabilityStatus: 'No',
      gender: 'Man',
      hispanicLatino: 'No',
      raceEthnicity: 'Asian',
      ssnLast4: '5125',
      veteranStatus: 'Not a protected veteran',
    })

    expect(sensitive.ssnLast4).toBe('5125')
    const profile = await service.get()
    expect(profile).toMatchObject({
      dateOfBirth: '2004-03-16',
      disabilityStatus: 'No',
      email: 'kenny@example.com',
      gender: 'Man',
      hispanicLatino: 'No',
      raceEthnicity: 'Asian',
      veteranStatus: 'Not a protected veteran',
    })
    expect(JSON.stringify(profile)).not.toContain('5125')
    expect(JSON.stringify(await service.getAgentContext())).not.toContain('5125')

    const row = database.select().from(profileSensitiveDetails).get()
    expect(row?.ssnLast4Encrypted).toBe('enc:5125')
    expect(row?.birthDayEncrypted).toBe('enc:16')
  })

  it('returns closed conflict results atomically and propagates codec failures', async () => {
    const { profileStore, service } = createStores()
    const first = await profileStore.get()
    await profileStore.update({
      expectedRevision: first.revision,
      profile: {
        ...first.profile,
        email: 'one@example.com',
      },
    })

    const conflict = await profileStore.update({
      expectedRevision: first.revision,
      profile: {
        ...first.profile,
        email: 'two@example.com',
      },
    })
    expect(conflict.ok).toBe(false)
    if (!conflict.ok) {
      expect(conflict.code).toBe('profile_revision_conflict')
      expect(conflict.document.profile.email).toBe('one@example.com')
    }

    await expect(
      service.updateSensitiveDetails({
        ssnLast4: 'trigger-unavailable',
      }),
    ).rejects.toMatchObject({ code: 'secure_storage_unavailable' })
  })

  it('adds expanded profile columns and education table during migration', () => {
    const sqlite = createInMemoryDatabase()
    sqlite
      .prepare(
        `
          create table user_profile (
            id text primary key,
            email text,
            full_name text,
            school text,
            work_authorization text,
            created_at text not null,
            updated_at text not null,
            deleted_at text
          )
        `,
      )
      .run()

    migrateDatabase(sqlite)

    const columns = sqlite.prepare(`pragma table_info(user_profile)`).all() as Array<{ name: string }>
    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'address_line_1',
        'degree',
        'major',
        'phone_device_type',
        'require_sponsorship',
        'transcript_path',
        'willing_to_relocate',
        'willing_to_travel',
      ]),
    )

    const tables = sqlite
      .prepare(`select name from sqlite_master where type = 'table' order by name`)
      .all() as Array<{ name: string }>
    expect(tables.map((table) => table.name)).toContain('profile_education')
  })

  it('adds split birth date columns to existing sensitive details tables', () => {
    const sqlite = createInMemoryDatabase()
    sqlite
      .prepare(
        `
          create table profile_sensitive_details (
            id text primary key,
            date_of_birth_encrypted text,
            ssn_last_4_encrypted text,
            created_at text not null,
            updated_at text not null,
            deleted_at text
          )
        `,
      )
      .run()

    migrateDatabase(sqlite)

    const columns = sqlite.prepare(`pragma table_info(profile_sensitive_details)`).all() as Array<{
      name: string
    }>
    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'birth_day_encrypted',
        'birth_month_encrypted',
        'birth_year_encrypted',
      ]),
    )
  })

  it('never decrypts or rewrites SSN ciphertext on ordinary profile/document paths', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const seededSsnCiphertext = 'enc:ssn-seed-5125'
    const now = '2026-01-01T00:00:00.000Z'
    database.insert(profileSensitiveDetails).values({
      id: 'default',
      birthDayEncrypted: 'enc:16',
      birthMonthEncrypted: 'enc:03',
      birthYearEncrypted: 'enc:2004',
      dateOfBirthEncrypted: null,
      disabilityStatusEncrypted: 'enc:No',
      genderEncrypted: 'enc:Man',
      hispanicLatinoEncrypted: 'enc:No',
      raceEthnicityEncrypted: 'enc:Asian',
      ssnLast4Encrypted: seededSsnCiphertext,
      veteranStatusEncrypted: 'enc:Not a protected veteran',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }).run()

    const guardedCodec: SecretCodec = {
      decrypt(value) {
        if (value === seededSsnCiphertext) {
          throw new Error('SSN ciphertext must not be decrypted on ordinary profile paths')
        }
        return value.replace(/^enc:/, '')
      },
      encrypt(value) {
        if (value === '5125' || value === 'ssn-seed-5125') {
          throw new Error('SSN plaintext must not be encrypted on ordinary profile paths')
        }
        return `enc:${value}`
      },
    }

    const service = createSqliteProfileService(database, guardedCodec)

    const profile = await service.get()
    expect(profile).toMatchObject({
      dateOfBirth: '2004-03-16',
      gender: 'Man',
    })
    expect(JSON.stringify(profile)).not.toContain('5125')
    expect(JSON.stringify(profile)).not.toContain('ssn')

    const document = await service.getDocument()
    expect(document.profile.dateOfBirth).toBe('2004-03-16')
    expect(JSON.stringify(document)).not.toContain('5125')

    await service.update({ email: 'kenny@example.com', gender: 'Woman' })
    expect(await service.get()).toMatchObject({
      email: 'kenny@example.com',
      gender: 'Woman',
      dateOfBirth: '2004-03-16',
    })

    const row = database.select().from(profileSensitiveDetails).get()
    expect(row?.ssnLast4Encrypted).toBe(seededSsnCiphertext)
    expect(row?.genderEncrypted).toBe('enc:Woman')
  })

  it('preserves widened legacy sensitive ciphertext across unrelated ordinary updates', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const now = '2026-01-01T00:00:00.000Z'
    const seededGenderCiphertext = 'enc:Male'
    const seededRaceCiphertext = 'enc:Hispanic'
    database.insert(profileSensitiveDetails).values({
      id: 'default',
      birthDayEncrypted: 'enc:16',
      birthMonthEncrypted: 'enc:03',
      birthYearEncrypted: 'enc:2004',
      dateOfBirthEncrypted: null,
      disabilityStatusEncrypted: 'enc:No',
      genderEncrypted: seededGenderCiphertext,
      hispanicLatinoEncrypted: 'enc:No',
      raceEthnicityEncrypted: seededRaceCiphertext,
      ssnLast4Encrypted: 'enc:5125',
      veteranStatusEncrypted: 'enc:Not a protected veteran',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }).run()

    const service = createSqliteProfileService(database, testCodec)

    const before = await service.get()
    expect(before.gender).toBeNull()
    expect(before.raceEthnicity).toBeNull()
    expect(before.dateOfBirth).toBe('2004-03-16')

    await service.update({ email: 'kenny@example.com' })
    expect(await service.get()).toMatchObject({
      email: 'kenny@example.com',
      gender: null,
      raceEthnicity: null,
      dateOfBirth: '2004-03-16',
      disabilityStatus: 'No',
    })

    const afterEmail = database.select().from(profileSensitiveDetails).get()
    expect(afterEmail?.genderEncrypted).toBe(seededGenderCiphertext)
    expect(afterEmail?.raceEthnicityEncrypted).toBe(seededRaceCiphertext)
    expect(afterEmail?.ssnLast4Encrypted).toBe('enc:5125')
    expect(afterEmail?.birthDayEncrypted).toBe('enc:16')

    await service.update({ gender: 'Man' })
    expect(await service.get()).toMatchObject({ gender: 'Man' })
    expect(database.select().from(profileSensitiveDetails).get()?.genderEncrypted).toBe('enc:Man')
    expect(database.select().from(profileSensitiveDetails).get()?.raceEthnicityEncrypted).toBe(
      seededRaceCiphertext,
    )

    const sensitive = await service.getSensitiveDetails()
    expect(sensitive).toMatchObject({
      gender: 'Man',
      raceEthnicity: 'Hispanic',
      ssnLast4: '5125',
    })
  })
})
