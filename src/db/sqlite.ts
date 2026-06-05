import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { schema } from './schema'

export type SqliteDatabase = Database.Database
export type DrizzleDatabase = ReturnType<typeof createDrizzleDatabase>

export function createInMemoryDatabase() {
  return new Database(':memory:')
}

export function createFileDatabase(databasePath: string) {
  const database = new Database(databasePath)
  database.pragma('foreign_keys = on')
  database.pragma('journal_mode = wal')
  database.pragma('busy_timeout = 5000')
  return database
}

export function createDrizzleDatabase(database: SqliteDatabase) {
  return drizzle(database, { schema })
}

export function migrateDatabase(database: SqliteDatabase) {
  database.exec(`
    pragma foreign_keys = on;

    create table if not exists companies (
      id text primary key,
      name text not null,
      normalized_name text not null,
      website_url text,
      created_at text not null,
      updated_at text not null,
      deleted_at text
    );

    create table if not exists sources (
      id text primary key,
      name text not null,
      account_hint text,
      created_at text not null,
      updated_at text not null,
      deleted_at text
    );

    create table if not exists applications (
      id text primary key,
      company_id text not null references companies(id),
      source_id text not null references sources(id),
      role_title text not null,
      role_kind text not null,
      term text,
      city text,
      region text,
      country text not null,
      work_mode text not null,
      location_raw text,
      status text not null,
      has_applied integer not null,
      current_priority_score integer,
      current_priority_band text,
      current_resume_variant text,
      notes text,
      created_at text not null,
      updated_at text not null,
      deleted_at text
    );

    create table if not exists application_links (
      id text primary key,
      application_id text not null references applications(id),
      kind text not null,
      label text not null,
      url text not null,
      external_id text,
      is_primary integer not null,
      discovered_at text not null,
      created_at text not null,
      updated_at text not null,
      deleted_at text
    );

    create table if not exists application_scores (
      id text primary key,
      application_id text not null references applications(id),
      score integer not null,
      band text not null,
      role_relevance integer not null,
      career_signal integer not null,
      city_work_mode integer not null,
      compensation_logistics integer not null,
      penalties_json text not null,
      rationale text not null,
      rubric_version text not null,
      created_at text not null
    );
  `)
}
