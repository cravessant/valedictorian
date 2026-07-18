import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import type { LegacySqliteDatabase } from './profile.legacy-sqlite'

/**
 * Creates only the four retired profile tables required by one-time legacy
 * profile migration evidence. Does not create operational schema or secrets tables.
 */
const legacyProfileTablesSql = `
  create table if not exists user_profile (
    id text primary key,
    address_line_1 text,
    address_line_2 text,
    city text,
    country text,
    citizenship text,
    class_standing text,
    cover_letter_path text,
    degree text,
    email text,
    full_name text,
    github_url text,
    graduation_date text,
    high_school text,
    language text,
    linkedin_url text,
    major text,
    phone text,
    phone_device_type text,
    portfolio_url text,
    preferred_name text,
    region text,
    relocation text,
    relocation_notes text,
    require_sponsorship text,
    require_sponsorship_future text,
    sat_score text,
    school text,
    transcript_path text,
    travel text,
    travel_notes text,
    willing_to_relocate integer,
    willing_to_travel integer,
    work_authorization text,
    created_at text not null,
    updated_at text not null,
    deleted_at text
  );

  create table if not exists profile_education (
    id text primary key,
    education_type text not null,
    school text not null,
    degree text,
    major text,
    graduation_date text,
    class_standing text,
    sat_score text,
    transcript_path text,
    notes text,
    sort_order integer not null,
    created_at text not null,
    updated_at text not null,
    deleted_at text
  );

  create table if not exists profile_answers (
    key text primary key,
    label text not null,
    question_pattern text not null,
    answer text not null,
    category text,
    include_in_agent_context integer not null,
    created_at text not null,
    updated_at text not null,
    deleted_at text
  );

  create table if not exists profile_sensitive_details (
    id text primary key,
    birth_day_encrypted text,
    birth_month_encrypted text,
    birth_year_encrypted text,
    date_of_birth_encrypted text,
    disability_status_encrypted text,
    gender_encrypted text,
    hispanic_latino_encrypted text,
    race_ethnicity_encrypted text,
    ssn_last_4_encrypted text,
    veteran_status_encrypted text,
    created_at text not null,
    updated_at text not null,
    deleted_at text
  );
`

export function applyLegacyProfileTables(database: LegacySqliteDatabase): void {
  database.exec(legacyProfileTablesSql)
}

export function createInMemoryLegacyProfileSqliteDatabase(): LegacySqliteDatabase {
  const database = new Database(':memory:')
  applyLegacyProfileTables(database)
  return database
}

export function createFileLegacyProfileSqliteDatabase(databasePath: string): LegacySqliteDatabase {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true })
  const database = new Database(databasePath)
  database.pragma('foreign_keys = on')
  database.pragma('journal_mode = wal')
  database.pragma('busy_timeout = 5000')
  applyLegacyProfileTables(database)
  return database
}

export function resolveLegacyProfileSqlitePath(dataPath: string): string {
  return path.join(dataPath, 'legacy-profile-source.sqlite')
}
