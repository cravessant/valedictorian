import { describe, expect, it } from 'vitest'
import { profileEducation, profileSecrets, profileSensitiveDetails } from '../../db/schema'
import {
  createDrizzleDatabase,
  createInMemoryDatabase,
  migrateDatabase,
} from '../../db/sqlite'
import { createSqliteProfileRepository, type ProfileSecretCodec } from './profile.repository'

const testCodec: ProfileSecretCodec = {
  decrypt(value) {
    return value.replace(/^enc:/, '')
  },
  encrypt(value) {
    return `enc:${value}`
  },
}

function createRepository() {
  const sqlite = createInMemoryDatabase()
  migrateDatabase(sqlite)
  const database = createDrizzleDatabase(sqlite)

  return {
    database,
    repository: createSqliteProfileRepository(database, testCodec),
  }
}

describe('SQLite profile repository', () => {
  it('persists profile basics and approved answer-bank entries for agent context', async () => {
    const { database, repository } = createRepository()

    await repository.updateProfile({
      answers: [
        {
          answer: 'LinkedIn',
          category: 'source',
          includeInAgentContext: true,
          key: 'how heard',
          label: 'How I heard about the role',
          questionPattern: 'How did you hear about us?',
        },
        {
          answer: 'Private answer.',
          includeInAgentContext: false,
          key: 'private',
          label: 'Private',
          questionPattern: 'Sensitive question',
        },
      ],
      addressLine1: '470 Mockingbird Lane',
      city: 'Southold',
      citizenship: 'US Citizen',
      country: 'US',
      coverLetterPath: '~/Downloads/Kenny_Lin_Cover_Letter.docx',
      education: [
        {
          classStanding: 'Senior',
          degree: 'BS Computer Science',
          educationType: 'College',
          graduationDate: 'December 2027',
          id: 'cu-boulder',
          major: 'Computer Science',
          school: 'University of Colorado Boulder',
          transcriptPath: 'transcripts/Kenny_Lin_S26_Transcript.pdf',
        },
        {
          educationType: 'High school',
          id: 'southold-high-school',
          notes: 'National Honor Society.',
          satScore: '1510',
          school: 'Southold JR/SR High School',
        },
      ],
      email: 'kenny@example.com',
      fullName: 'Kenny Lin',
      githubUrl: 'https://github.com/kenny',
      language: 'English',
      linkedinUrl: 'https://linkedin.com/in/kenny',
      phone: '555-0100',
      phoneDeviceType: 'Mobile',
      portfolioUrl: 'https://kennykeni.com',
      preferredName: 'Kenny',
      region: 'NY',
      relocationNotes: 'Open to NYC, Denver, or Bay Area roles.',
      requireSponsorship: 'No',
      requireSponsorshipFuture: 'No',
      travelNotes: 'Prefer under 25%.',
      willingToRelocate: true,
      willingToTravel: false,
      workAuthorization: 'Authorized to work in the US; does not require sponsorship.',
    })

    const profile = await repository.getProfile()
    expect(profile).toMatchObject({
      addressLine1: '470 Mockingbird Lane',
      email: 'kenny@example.com',
      fullName: 'Kenny Lin',
      phoneDeviceType: 'Mobile',
      requireSponsorship: 'No',
      willingToRelocate: true,
      willingToTravel: false,
    })
    expect(profile.education).toEqual([
      {
        classStanding: 'Senior',
        degree: 'BS Computer Science',
        educationType: 'College',
        graduationDate: 'December 2027',
        id: 'cu-boulder',
        major: 'Computer Science',
        notes: null,
        satScore: null,
        school: 'University of Colorado Boulder',
        transcriptPath: 'transcripts/Kenny_Lin_S26_Transcript.pdf',
      },
      {
        classStanding: null,
        degree: null,
        educationType: 'High school',
        graduationDate: null,
        id: 'southold-high-school',
        major: null,
        notes: 'National Honor Society.',
        satScore: '1510',
        school: 'Southold JR/SR High School',
        transcriptPath: null,
      },
    ])
    expect(profile.answers).toHaveLength(2)
    expect(profile.answers[0]).toMatchObject({
      answer: 'LinkedIn',
      includeInAgentContext: true,
      key: 'how_heard',
      label: 'How I heard about the role',
    })

    await expect(repository.getAgentContext()).resolves.toEqual({
      answers: [profile.answers[0]],
      basics: {
        addressLine1: '470 Mockingbird Lane',
        city: 'Southold',
        citizenship: 'US Citizen',
        country: 'US',
        coverLetterPath: '~/Downloads/Kenny_Lin_Cover_Letter.docx',
        email: 'kenny@example.com',
        fullName: 'Kenny Lin',
        githubUrl: 'https://github.com/kenny',
        language: 'English',
        linkedinUrl: 'https://linkedin.com/in/kenny',
        phone: '555-0100',
        phoneDeviceType: 'Mobile',
        portfolioUrl: 'https://kennykeni.com',
        preferredName: 'Kenny',
        region: 'NY',
        relocationNotes: 'Open to NYC, Denver, or Bay Area roles.',
        requireSponsorship: 'No',
        requireSponsorshipFuture: 'No',
        travelNotes: 'Prefer under 25%.',
        willingToRelocate: true,
        willingToTravel: false,
        workAuthorization: 'Authorized to work in the US; does not require sponsorship.',
      },
      education: profile.education,
    })

    expect(database.select().from(profileEducation).all()).toHaveLength(2)
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

  it('stores private identifiers and self-id details encrypted and keeps them out of agent context', async () => {
    const { database, repository } = createRepository()

    await repository.updateProfile({
      email: 'kenny@example.com',
      fullName: 'Kenny Lin',
    })
    const sensitive = await repository.updateSensitiveDetails({
      birthDay: '16',
      birthMonth: '03',
      birthYear: '2004',
      disabilityStatus: 'No',
      gender: 'Male',
      hispanicLatino: 'No',
      raceEthnicity: 'Asian',
      ssnLast4: '5125',
      veteranStatus: 'Not a protected veteran',
    } as never)

    expect(sensitive).toEqual({
      birthDay: '16',
      birthMonth: '03',
      birthYear: '2004',
      disabilityStatus: 'No',
      gender: 'Male',
      hispanicLatino: 'No',
      raceEthnicity: 'Asian',
      ssnLast4: '5125',
      veteranStatus: 'Not a protected veteran',
    })
    const row = database.select().from(profileSensitiveDetails).get() as
      | (typeof profileSensitiveDetails.$inferSelect & {
          birthDayEncrypted?: string | null
          birthMonthEncrypted?: string | null
          birthYearEncrypted?: string | null
        })
      | undefined
    expect(row?.birthDayEncrypted).toBe('enc:16')
    expect(row?.birthMonthEncrypted).toBe('enc:03')
    expect(row?.birthYearEncrypted).toBe('enc:2004')
    expect(row?.ssnLast4Encrypted).toBe('enc:5125')
    expect(row?.raceEthnicityEncrypted).toBe('enc:Asian')

    await expect(repository.getSensitiveDetails()).resolves.toEqual(sensitive)
    await expect(repository.getAgentContext()).resolves.toEqual({
      answers: [],
      basics: {
        email: 'kenny@example.com',
        fullName: 'Kenny Lin',
      },
      education: [],
    })
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

  it('stores secrets encrypted at rest and reveals them only through the secret API', async () => {
    const { database, repository } = createRepository()

    const secret = await repository.upsertSecret({
      key: 'greenhouse_password',
      kind: 'password',
      label: 'Greenhouse password',
      value: 'correct horse battery staple',
    })

    expect(secret).toMatchObject({
      key: 'greenhouse_password',
      kind: 'password',
      label: 'Greenhouse password',
    })
    expect(secret).not.toHaveProperty('value')

    const row = database.select().from(profileSecrets).get()
    expect(row?.encryptedValue).toBe('enc:correct horse battery staple')
    expect(row?.encryptedValue).not.toBe('correct horse battery staple')

    await expect(repository.listSecrets()).resolves.toEqual([secret])
    await expect(repository.revealSecret('greenhouse_password')).resolves.toEqual({
      ...secret,
      value: 'correct horse battery staple',
    })
  })
})
