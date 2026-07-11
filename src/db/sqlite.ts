import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { migrate as migrateDrizzle } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import {
  assertDataMigrationHistoryIsKnown,
  hasPendingDataMigrations,
  runDataMigrations,
} from './data-migrations'
import { schema } from './schema'

export type SqliteDatabase = Database.Database
export type DrizzleDatabase = ReturnType<typeof createDrizzleDatabase>

interface DatabaseMigrationOptions {
  backupDirectory?: string
  createBackup?: boolean
  migrationsFolder?: string
  now?: () => Date
}

interface DrizzleMigrationEntry {
  hash: string
  tag: string
  when: number
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DRIZZLE_MIGRATIONS_TABLE = '__drizzle_migrations'

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

export function migrateDatabase(database: SqliteDatabase, options: DatabaseMigrationOptions = {}) {
  database.exec('pragma foreign_keys = on;')

  const migrationsFolder = resolveDrizzleMigrationsFolder(options.migrationsFolder)
  const drizzleMigrations = readDrizzleMigrations(migrationsFolder)

  assertDrizzleMigrationHistoryIsKnown(database, drizzleMigrations)
  assertDataMigrationHistoryIsKnown(database)

  if (databaseHasPendingMigrations(database, drizzleMigrations)) {
    backupDatabaseIfNeeded(database, options)
  }

  if (isLegacyUnmanagedDatabase(database)) {
    migrateLegacyDatabaseSchema(database)
    stampDrizzleMigrations(database, drizzleMigrations)
  } else {
    migrateDrizzle(createDrizzleDatabase(database), { migrationsFolder })
  }

  runDataMigrations(database)
}

function databaseHasPendingMigrations(
  database: SqliteDatabase,
  drizzleMigrations: DrizzleMigrationEntry[],
) {
  return hasPendingDrizzleMigrations(database, drizzleMigrations) || hasPendingDataMigrations(database)
}

function hasPendingDrizzleMigrations(
  database: SqliteDatabase,
  drizzleMigrations: DrizzleMigrationEntry[],
) {
  const latestBundledMigration = readLatestDrizzleMigrationMillis(drizzleMigrations)
  const latestAppliedMigration = readLatestAppliedDrizzleMigrationMillis(database)

  if (latestAppliedMigration === null) {
    return drizzleMigrations.length > 0
  }

  return latestAppliedMigration < latestBundledMigration
}

function assertDrizzleMigrationHistoryIsKnown(
  database: SqliteDatabase,
  drizzleMigrations: DrizzleMigrationEntry[],
) {
  const latestBundledMigration = readLatestDrizzleMigrationMillis(drizzleMigrations)
  const bundledMigrationKeys = new Set(
    drizzleMigrations.map((migration) => formatDrizzleMigrationKey(migration)),
  )
  const appliedMigrations = readAppliedDrizzleMigrations(database)

  for (const appliedMigration of appliedMigrations) {
    if (appliedMigration.when > latestBundledMigration) {
      throw new Error('Workspace schema is newer than this app supports.')
    }

    if (!bundledMigrationKeys.has(formatDrizzleMigrationKey(appliedMigration))) {
      throw new Error('Workspace schema migration history is not recognized by this app.')
    }
  }
}

function readLatestAppliedDrizzleMigrationMillis(database: SqliteDatabase) {
  const appliedMigrations = readAppliedDrizzleMigrations(database)

  if (appliedMigrations.length === 0) {
    return null
  }

  return Math.max(...appliedMigrations.map((migration) => migration.when))
}

function readAppliedDrizzleMigrations(database: SqliteDatabase): DrizzleMigrationEntry[] {
  if (!tableExists(database, DRIZZLE_MIGRATIONS_TABLE)) {
    return []
  }

  return (
    database
      .prepare(`select hash, created_at from ${DRIZZLE_MIGRATIONS_TABLE} order by created_at`)
      .all() as Array<{ created_at: number | string; hash: string }>
  ).map((row) => ({
    hash: row.hash,
    tag: '',
    when: Number(row.created_at),
  }))
}

function readLatestDrizzleMigrationMillis(drizzleMigrations: DrizzleMigrationEntry[]) {
  return Math.max(0, ...drizzleMigrations.map((migration) => migration.when))
}

function isLegacyUnmanagedDatabase(database: SqliteDatabase) {
  return readAppliedDrizzleMigrations(database).length === 0 && hasApplicationTables(database)
}

function hasApplicationTables(database: SqliteDatabase) {
  return [
    'application_attempt_steps',
    'application_attempts',
    'application_events',
    'application_links',
    'application_scores',
    'application_workflow_states',
    'applications',
    'companies',
    'connector_checkpoints',
    'connector_instances',
    'connector_observations',
    'connector_projection_keys',
    'connector_runs',
    'policy_config',
    'policy_evidence',
    'profile_answers',
    'profile_education',
    'profile_secrets',
    'profile_sensitive_details',
    'sources',
    'sourcing_findings',
    'user_profile',
    'workflow_run_steps',
    'workflow_runs',
  ].some((tableName) => tableExists(database, tableName))
}

function formatDrizzleMigrationKey(migration: DrizzleMigrationEntry) {
  return `${migration.when}:${migration.hash}`
}

function stampDrizzleMigrations(
  database: SqliteDatabase,
  drizzleMigrations: DrizzleMigrationEntry[],
) {
  database.exec(`
    create table if not exists ${DRIZZLE_MIGRATIONS_TABLE} (
      id SERIAL PRIMARY KEY,
      hash text not null,
      created_at numeric
    );
  `)

  const applied = new Set(
    (
      database
        .prepare(`select created_at from ${DRIZZLE_MIGRATIONS_TABLE}`)
        .all() as Array<{ created_at: number | string }>
    ).map((row) => Number(row.created_at)),
  )
  const insert = database.prepare(
    `insert into ${DRIZZLE_MIGRATIONS_TABLE} ("hash", "created_at") values (?, ?)`,
  )

  for (const migration of drizzleMigrations) {
    if (!applied.has(migration.when)) {
      insert.run(migration.hash, migration.when)
    }
  }
}

function backupDatabaseIfNeeded(database: SqliteDatabase, options: DatabaseMigrationOptions) {
  if (options.createBackup === false || database.memory || database.readonly) {
    return
  }

  if (!databaseHasUserObjects(database)) {
    return
  }

  const databasePath = database.name

  if (!databasePath || databasePath === ':memory:') {
    return
  }

  const backupDirectory = options.backupDirectory ?? path.join(path.dirname(databasePath), 'backups')
  const backupPath = path.join(
    backupDirectory,
    `${path.basename(databasePath)}.${formatBackupTimestamp(options.now?.() ?? new Date())}.bak`,
  )

  fs.mkdirSync(backupDirectory, { recursive: true })
  database.prepare('vacuum into ?').run(backupPath)
}

function databaseHasUserObjects(database: SqliteDatabase) {
  const row = database
    .prepare(
      `
        select count(*) as count
        from sqlite_master
        where name not like 'sqlite_%'
          and type in ('index', 'table', 'trigger', 'view')
      `,
    )
    .get() as { count: number }

  return row.count > 0
}

function formatBackupTimestamp(date: Date) {
  return date.toISOString().replace(/[:.]/g, '-')
}

function resolveDrizzleMigrationsFolder(configuredFolder: string | undefined) {
  const candidates = [
    configuredFolder,
    process.env.VALEDICTORIAN_DRIZZLE_MIGRATIONS_PATH,
    process.env.APP_ROOT ? path.join(process.env.APP_ROOT, 'drizzle') : undefined,
    path.resolve(__dirname, '../../drizzle'),
    path.resolve(process.cwd(), 'drizzle'),
  ].filter((candidate): candidate is string => Boolean(candidate))

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'meta', '_journal.json'))) {
      return candidate
    }
  }

  throw new Error('Unable to locate Drizzle migrations folder.')
}

function readDrizzleMigrations(migrationsFolder: string): DrizzleMigrationEntry[] {
  const journal = JSON.parse(
    fs.readFileSync(path.join(migrationsFolder, 'meta', '_journal.json'), 'utf8'),
  ) as {
    entries: Array<{
      tag: string
      when: number
    }>
  }

  return journal.entries.map((entry) => {
    const sql = fs.readFileSync(path.join(migrationsFolder, `${entry.tag}.sql`), 'utf8')

    return {
      hash: crypto.createHash('sha256').update(sql).digest('hex'),
      tag: entry.tag,
      when: entry.when,
    }
  })
}

function tableExists(database: SqliteDatabase, tableName: string) {
  const row = database
    .prepare("select name from sqlite_master where type = 'table' and name = ?")
    .get(tableName)

  return Boolean(row)
}

function migrateLegacyDatabaseSchema(database: SqliteDatabase) {
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
      timing_mode text not null default 'unknown',
      terms_json text not null default '[]',
      start_date text,
      end_date text,
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

    create table if not exists connector_instances (
      id text primary key,
      connector_id text not null,
      connector_version text not null,
      display_name text not null,
      enabled integer not null,
      config_json text not null,
      auth_json text not null default '[]',
      filters_json text not null default '{}',
      created_at text not null,
      updated_at text not null,
      deleted_at text
    );

    create table if not exists connector_runs (
      id text primary key,
      connector_instance_id text not null references connector_instances(id),
      mode text not null,
      status text not null,
      started_at text not null,
      completed_at text,
      coverage_started_at text,
      coverage_ended_at text,
      config_json text not null default '{}',
      filters_json text not null default '{}',
      filter_signature text not null default 'filters:{}',
      observation_count integer not null,
      warning_count integer not null,
      stats_json text not null,
      warnings_json text not null,
      retry_hints_json text not null,
      created_at text not null,
      updated_at text not null,
      deleted_at text
    );

    create table if not exists connector_checkpoints (
      connector_instance_id text not null references connector_instances(id),
      filter_signature text not null default 'filters:{}',
      checkpoint_json text not null,
      schema_version text not null,
      coverage_started_at text,
      coverage_ended_at text,
      saved_at text not null,
      created_at text not null,
      updated_at text not null,
      deleted_at text,
      primary key (connector_instance_id, filter_signature)
    );

    create table if not exists connector_observations (
      id text primary key,
      connector_instance_id text not null references connector_instances(id),
      connector_run_id text not null references connector_runs(id),
      connector_id text not null,
      connector_version text not null,
      parser_version text,
      observation_schema_version text,
      source_record_key text not null,
      observed_at text not null,
      company_name text not null,
      role_title text not null,
      location_raw text,
      description_text text,
      pay_json text not null,
      links_json text not null,
      resolution_json text not null,
      dedupe_keys_json text not null,
      source_metadata_json text not null,
      evidence_json text not null,
      raw_json text not null,
      sourcing_finding_id text,
      created_at text not null,
      updated_at text not null,
      deleted_at text
    );

    create table if not exists source_entities (
      id text primary key not null,
      identity_kind text not null,
      identity_namespace text not null,
      identity_value text not null,
      created_at text not null,
      constraint chk_source_entities_identity_kind_length
        check (length(identity_kind) between 1 and 64),
      constraint chk_source_entities_identity_namespace_length
        check (length(identity_namespace) between 1 and 4096),
      constraint chk_source_entities_identity_value_length
        check (length(identity_value) between 1 and 2048)
    );

    create table if not exists raw_source_records (
      id text primary key not null,
      source_entity_id text references source_entities(id),
      created_at text not null
    );

    create table if not exists raw_source_revisions (
      id text primary key not null,
      raw_record_id text not null references raw_source_records(id),
      revision integer not null,
      content_hash text not null,
      adapter_id text not null,
      adapter_kind text not null,
      adapter_version text not null,
      reported_origin_kind text,
      reported_origin_name text,
      reported_origin_provider_id text,
      reported_origin_url text,
      observed_at text not null,
      provider_record_id text,
      provider_schema text,
      payload_json text,
      evidence_json text not null,
      created_at text not null
    );

    create table if not exists raw_source_occurrences (
      id text primary key not null,
      raw_record_id text not null references raw_source_records(id),
      raw_revision_id text not null references raw_source_revisions(id),
      observed_at text not null,
      received_at text not null
    );

    create table if not exists normalization_runs (
      id text primary key not null,
      raw_record_id text not null references raw_source_records(id),
      raw_revision_id text not null references raw_source_revisions(id),
      input_hash text not null,
      resolver_set_hash text not null,
      canonical_schema_version text not null,
      gate_policy_version text not null,
      trigger_kind text not null default 'intake',
      trigger_id text,
      status text not null,
      created_at text not null,
      updated_at text not null,
      constraint chk_normalization_runs_status check(status in ('pending','in_progress','completed','blocked','failed')),
      constraint chk_normalization_runs_trigger_kind check(trigger_kind in ('intake'))
    );

    create table if not exists normalization_attempts (
      id text primary key not null,
      run_id text not null references normalization_runs(id),
      raw_revision_id text not null references raw_source_revisions(id),
      sequence integer not null,
      resolver_id text not null,
      resolver_version text not null,
      input_hash text not null,
      declaration_json text not null,
      applicability_json text not null,
      status text not null,
      started_at text not null,
      completed_at text
    );

    create table if not exists normalization_field_outcomes (
      id text primary key not null,
      run_id text not null references normalization_runs(id),
      attempt_id text not null references normalization_attempts(id),
      sequence integer not null,
      attempt_sequence integer not null,
      outcome_index integer not null,
      field text not null,
      status text not null,
      resolver_id text not null,
      resolver_version text not null,
      input_hash text not null,
      outcome_json text not null
    );

    create table if not exists canonical_source_candidates (
      id text primary key not null,
      run_id text not null references normalization_runs(id),
      source_entity_id text not null references source_entities(id),
      raw_record_id text not null references raw_source_records(id),
      raw_revision_id text not null references raw_source_revisions(id),
      schema_version text not null,
      candidate_json text not null,
      created_at text not null
    );

    create table if not exists normalization_gates (
      id text primary key not null,
      run_id text not null references normalization_runs(id),
      policy_version text not null,
      status text not null,
      candidate_id text references canonical_source_candidates(id),
      gate_json text not null,
      evaluated_at text not null,
      constraint chk_normalization_gates_status check(status in ('passed','needs_enrichment','rejected','failed')),
      constraint chk_normalization_gates_candidate check((status = 'passed' and candidate_id is not null) or (status <> 'passed' and candidate_id is null))
    );

    create table if not exists sourcing_findings (
      id text primary key,
      workflow_run_id text not null references workflow_runs(id),
      source_id text not null references sources(id),
      company_name text not null,
      role_title text not null,
      role_kind text not null,
      term text,
      timing_mode text not null default 'unknown',
      terms_json text not null default '[]',
      start_date text,
      end_date text,
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
      policy_blocker text,
      disposition_reason text,
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
    create index if not exists idx_connector_instances_connector
      on connector_instances(connector_id);
    create index if not exists idx_connector_instances_enabled
      on connector_instances(enabled);
    create index if not exists idx_connector_runs_instance
      on connector_runs(connector_instance_id);
    create index if not exists idx_connector_runs_instance_status_started
      on connector_runs(connector_instance_id, status, started_at);
    create index if not exists idx_connector_checkpoints_instance
      on connector_checkpoints(connector_instance_id);
    create index if not exists idx_connector_observations_instance
      on connector_observations(connector_instance_id);
    create index if not exists idx_connector_observations_run
      on connector_observations(connector_run_id);
    create index if not exists idx_connector_observations_source_record
      on connector_observations(connector_instance_id, source_record_key);
    create unique index if not exists idx_source_entities_identity
      on source_entities(identity_kind, identity_namespace, identity_value);
    create unique index if not exists idx_raw_source_records_source_entity
      on raw_source_records(source_entity_id);
    create unique index if not exists idx_raw_source_revisions_record_revision
      on raw_source_revisions(raw_record_id, revision);
    create unique index if not exists idx_raw_source_revisions_record_hash
      on raw_source_revisions(raw_record_id, content_hash);
    create index if not exists idx_raw_source_occurrences_record_chronology
      on raw_source_occurrences(raw_record_id, observed_at, received_at, id);
    create unique index if not exists idx_normalization_runs_cache
      on normalization_runs(raw_revision_id, input_hash, resolver_set_hash, canonical_schema_version, gate_policy_version);
    create index if not exists idx_normalization_runs_raw_record
      on normalization_runs(raw_record_id, created_at);
    create unique index if not exists idx_normalization_attempts_run_sequence
      on normalization_attempts(run_id, sequence);
    create index if not exists idx_normalization_attempts_resolver
      on normalization_attempts(resolver_id, resolver_version, input_hash);
    create unique index if not exists idx_normalization_field_outcomes_run_sequence
      on normalization_field_outcomes(run_id, sequence);
    create index if not exists idx_normalization_field_outcomes_selector
      on normalization_field_outcomes(run_id, field, attempt_sequence, outcome_index);
    create index if not exists idx_normalization_field_outcomes_resolver
      on normalization_field_outcomes(resolver_id, resolver_version, input_hash);
    create unique index if not exists idx_canonical_source_candidates_run
      on canonical_source_candidates(run_id);
    create index if not exists idx_canonical_source_candidates_revision_schema
      on canonical_source_candidates(raw_revision_id, schema_version);
    create unique index if not exists idx_normalization_gates_run
      on normalization_gates(run_id);
    create index if not exists idx_normalization_gates_policy
      on normalization_gates(policy_version, status);
    create index if not exists idx_raw_source_occurrences_revision
      on raw_source_occurrences(raw_revision_id);

    create table if not exists connector_projection_keys (
      dedupe_key text primary key,
      sourcing_finding_id text not null references sourcing_findings(id),
      created_at text not null,
      updated_at text not null,
      deleted_at text
    );
    create index if not exists idx_connector_projection_keys_sourcing_finding
      on connector_projection_keys(sourcing_finding_id);
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
  ensureColumns(database, 'applications', [
    ['timing_mode', "text not null default 'unknown'"],
    ['terms_json', "text not null default '[]'"],
    ['start_date', 'text'],
    ['end_date', 'text'],
  ])
  ensureColumns(database, 'sourcing_findings', [
    ['timing_mode', "text not null default 'unknown'"],
    ['terms_json', "text not null default '[]'"],
    ['start_date', 'text'],
    ['end_date', 'text'],
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
  ensureColumns(database, 'sourcing_findings', [
    ['policy_blocker', 'text'],
    ['disposition_reason', 'text'],
  ])
  ensureColumns(database, 'connector_instances', [
    ['auth_json', "text not null default '[]'"],
    ['filters_json', "text not null default '{}'"],
  ])
  ensureColumns(database, 'connector_runs', [
    ['config_json', "text not null default '{}'"],
    ['filters_json', "text not null default '{}'"],
    ['filter_signature', "text not null default 'filters:{}'"],
  ])
  ensureConnectorCheckpointFilterScope(database)
  ensureColumns(database, 'connector_observations', [
    ['sourcing_finding_id', 'text'],
    ['parser_version', 'text'],
    ['observation_schema_version', 'text'],
  ])
  database.exec(`
    create index if not exists idx_connector_observations_sourcing_finding
      on connector_observations(sourcing_finding_id);
  `)
}

function ensureConnectorCheckpointFilterScope(database: SqliteDatabase) {
  if (!tableExists(database, 'connector_checkpoints')) {
    return
  }

  const tableInfo = database.prepare('pragma table_info(connector_checkpoints)').all() as Array<{
    name: string
    pk: number
  }>
  const existingColumns = new Set(tableInfo.map((column) => column.name))
  const primaryKeyColumns = tableInfo
    .filter((column) => column.pk > 0)
    .sort((left, right) => left.pk - right.pk)
    .map((column) => column.name)

  if (
    existingColumns.has('filter_signature') &&
    primaryKeyColumns.join(',') === 'connector_instance_id,filter_signature'
  ) {
    database.exec(`
      create index if not exists idx_connector_checkpoints_instance
        on connector_checkpoints(connector_instance_id);
    `)
    return
  }

  const filterSignatureExpression = existingColumns.has('filter_signature')
    ? "coalesce(filter_signature, 'filters:{}')"
    : "'filters:{}'"

  database.exec(`
    pragma foreign_keys = off;

    create table connector_checkpoints_next (
      connector_instance_id text not null references connector_instances(id),
      filter_signature text not null default 'filters:{}',
      checkpoint_json text not null,
      schema_version text not null,
      coverage_started_at text,
      coverage_ended_at text,
      saved_at text not null,
      created_at text not null,
      updated_at text not null,
      deleted_at text,
      primary key (connector_instance_id, filter_signature)
    );

    insert into connector_checkpoints_next (
      connector_instance_id,
      filter_signature,
      checkpoint_json,
      schema_version,
      coverage_started_at,
      coverage_ended_at,
      saved_at,
      created_at,
      updated_at,
      deleted_at
    )
    select
      connector_instance_id,
      ${filterSignatureExpression},
      checkpoint_json,
      schema_version,
      coverage_started_at,
      coverage_ended_at,
      saved_at,
      created_at,
      updated_at,
      deleted_at
    from connector_checkpoints;

    drop table connector_checkpoints;
    alter table connector_checkpoints_next rename to connector_checkpoints;

    create index if not exists idx_connector_checkpoints_instance
      on connector_checkpoints(connector_instance_id);

    pragma foreign_keys = on;
  `)
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
