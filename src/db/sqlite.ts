import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { normalizePolicyConfig } from 'sparxie'
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

    create table if not exists application_workflow_states (
      application_id text primary key references applications(id),
      lock_started_at text,
      hold_started_at text,
      manual_review_kind text,
      missing_user_info text,
      blocker_reason text,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists application_events (
      id text primary key,
      application_id text not null references applications(id),
      type text not null,
      message text not null,
      payload_json text not null,
      actor text not null,
      created_at text not null
    );

    create table if not exists application_attempts (
      id text primary key,
      application_id text not null references applications(id),
      status text not null,
      outcome text,
      actor_type text not null,
      actor_name text,
      entry_url text,
      resume_variant text,
      resume_artifact_path text,
      summary text,
      stop_reason text,
      confirmation_url text,
      confirmation_text text,
      started_at text not null,
      completed_at text,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists application_attempt_steps (
      id text primary key,
      attempt_id text not null references application_attempts(id),
      application_id text not null references applications(id),
      sequence integer not null,
      type text not null,
      message text not null,
      payload_json text not null,
      actor text not null,
      created_at text not null
    );

    create table if not exists workflow_runs (
      id text primary key,
      run_type text not null,
      status text not null,
      actor_type text not null,
      actor_name text,
      source_id text references sources(id),
      subject_application_id text references applications(id),
      started_at text not null,
      completed_at text,
      coverage_started_at text,
      coverage_ended_at text,
      timezone text,
      input_json text not null,
      summary text,
      outcome text,
      blocker text,
      metadata_json text not null,
      created_at text not null,
      updated_at text not null,
      deleted_at text
    );

    create table if not exists workflow_run_steps (
      id text primary key,
      workflow_run_id text not null references workflow_runs(id),
      sequence integer not null,
      type text not null,
      message text not null,
      payload_json text not null,
      actor text not null,
      created_at text not null
    );

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

    create table if not exists profile_secrets (
      key text primary key,
      label text not null,
      kind text not null,
      encrypted_value text not null,
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

    create table if not exists policy_config (
      id text primary key,
      config_json text not null,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists policy_evidence (
      id text primary key,
      subject_type text not null,
      subject_id text not null,
      tag text not null,
      source text not null,
      note text,
      payload_json text not null,
      created_at text not null
    );

    create table if not exists sourcing_findings (
      id text primary key,
      workflow_run_id text not null references workflow_runs(id),
      source_id text not null references sources(id),
      company_name text not null,
      role_title text not null,
      role_kind text not null,
      term text,
      city text,
      region text,
      country text not null,
      work_mode text not null,
      location_raw text,
      official_url text,
      source_url text,
      posted_age text,
      priority_score integer,
      priority_band text,
      fit_notes text,
      duplicate_notes text,
      blocker text,
      merge_status text not null,
      merged_application_id text references applications(id),
      merge_notes text,
      discovered_at text not null,
      created_at text not null,
      updated_at text not null,
      deleted_at text
    );

    create index if not exists idx_sources_name on sources(name);
    create index if not exists idx_workflow_runs_source_id on workflow_runs(source_id);
    create index if not exists idx_workflow_runs_source_type_status_started
      on workflow_runs(source_id, run_type, status, started_at);
    create index if not exists idx_sourcing_findings_source_id on sourcing_findings(source_id);
    create index if not exists idx_sourcing_findings_source_status_discovered
      on sourcing_findings(source_id, merge_status, discovered_at);
    create index if not exists idx_policy_evidence_subject
      on policy_evidence(subject_type, subject_id);
    create index if not exists idx_policy_evidence_subject_tag
      on policy_evidence(subject_type, subject_id, tag);
  `)

  ensureColumns(database, 'user_profile', [
    ['address_line_1', 'text'],
    ['address_line_2', 'text'],
    ['citizenship', 'text'],
    ['class_standing', 'text'],
    ['cover_letter_path', 'text'],
    ['degree', 'text'],
    ['high_school', 'text'],
    ['language', 'text'],
    ['major', 'text'],
    ['phone_device_type', 'text'],
    ['relocation', 'text'],
    ['relocation_notes', 'text'],
    ['require_sponsorship', 'text'],
    ['require_sponsorship_future', 'text'],
    ['sat_score', 'text'],
    ['transcript_path', 'text'],
    ['travel', 'text'],
    ['travel_notes', 'text'],
    ['willing_to_relocate', 'integer'],
    ['willing_to_travel', 'integer'],
  ])
  ensureColumns(database, 'profile_sensitive_details', [
    ['birth_day_encrypted', 'text'],
    ['birth_month_encrypted', 'text'],
    ['birth_year_encrypted', 'text'],
    ['date_of_birth_encrypted', 'text'],
    ['disability_status_encrypted', 'text'],
    ['gender_encrypted', 'text'],
    ['hispanic_latino_encrypted', 'text'],
    ['race_ethnicity_encrypted', 'text'],
    ['ssn_last_4_encrypted', 'text'],
    ['veteran_status_encrypted', 'text'],
  ])
  migratePolicyConfigJson(database)
}

function ensureColumns(database: SqliteDatabase, tableName: string, columns: Array<[string, string]>) {
  const existingColumns = new Set(
    (database.prepare(`pragma table_info(${tableName})`).all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  )

  for (const [name, definition] of columns) {
    if (!existingColumns.has(name)) {
      database.exec(`alter table ${tableName} add column ${name} ${definition}`)
    }
  }
}

function migratePolicyConfigJson(database: SqliteDatabase) {
  const rows = database.prepare('select id, config_json from policy_config').all() as Array<{
    id: string
    config_json: string
  }>
  const update = database.prepare('update policy_config set config_json = ? where id = ?')

  for (const row of rows) {
    try {
      const normalized = normalizePolicyConfig(JSON.parse(row.config_json) as unknown)
      const nextJson = JSON.stringify(normalized)

      if (nextJson !== row.config_json) {
        update.run(nextJson, row.id)
      }
    } catch {
      // Leave unreadable JSON for repository-level fallback handling.
    }
  }
}
