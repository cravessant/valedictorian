import { afterEach, describe, expect, it } from 'vitest'
import { createInMemoryDatabase, migrateDatabase, type SqliteDatabase } from '../../db/sqlite'
import type { SecretCodec } from '../secrets/secret.codec'
import { readLegacyProfileSource } from './profile.migration.source'

const syntheticCodec: SecretCodec = {
  decrypt: (value) => value.slice('fixture:'.length),
  encrypt: (value) => `fixture:${value}`,
  isAvailable: () => true,
}

describe('legacy profile migration source', () => {
  const databases: SqliteDatabase[] = []

  afterEach(() => {
    for (const database of databases.splice(0)) database.close()
  })

  it('normalizes every legacy profile class and keeps identity material separate', () => {
    const database = createInMemoryDatabase()
    databases.push(database)
    migrateDatabase(database)

    database.prepare(`
      insert into user_profile (
        id, full_name, email, willing_to_relocate, created_at, updated_at
      ) values ('default', '  Ada Example  ', ' ada@example.test ', 1, ?, ?)
    `).run('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
    database.prepare(`
      insert into profile_education (
        id, education_type, school, sort_order, created_at, updated_at
      ) values ('education-1', 'college', ' Example University ', 0, ?, ?)
    `).run('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
    database.prepare(`
      insert into profile_answers (
        key, label, question_pattern, answer, include_in_agent_context, created_at, updated_at
      ) values ('work_style', ' Work style ', ' collaboration ', ' Thoughtfully ', 1, ?, ?)
    `).run('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
    database.prepare(`
      insert into profile_sensitive_details (
        id, date_of_birth_encrypted, gender_encrypted, disability_status_encrypted,
        veteran_status_encrypted, ssn_last_4_encrypted, created_at, updated_at
      ) values ('default', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      syntheticCodec.encrypt('1990-02-03'),
      syntheticCodec.encrypt('Woman'),
      syntheticCodec.encrypt('Prefer not to answer'),
      syntheticCodec.encrypt('Not a protected veteran'),
      syntheticCodec.encrypt('0000'),
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    )

    const source = readLegacyProfileSource(database, syntheticCodec)

    expect(source.hasLegacyProfileData).toBe(true)
    expect(source.profile).toMatchObject({
      dateOfBirth: '1990-02-03',
      disabilityStatus: 'Prefer not to answer',
      email: 'ada@example.test',
      fullName: 'Ada Example',
      gender: 'Woman',
      veteranStatus: 'Not a protected veteran',
      willingToRelocate: true,
    })
    expect(source.profile.education).toHaveLength(1)
    expect(source.profile.education[0]?.school).toBe('Example University')
    expect(source.profile.answers).toHaveLength(1)
    expect(source.profile.answers[0]?.answer).toBe('Thoughtfully')
    expect(Object.keys(source.profile)).not.toContain('ssnLast4')
    expect(source.identitySsnLast4).toMatch(/^\d{4}$/)
  })
})
