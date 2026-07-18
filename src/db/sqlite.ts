import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import {
  assertDataMigrationHistoryIsKnown,
  hasPendingDataMigrations,
  runDataMigrations,
} from './data-migrations'
import { migrateLegacyDatabaseSchema } from './sqlite.legacy-schema'
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
  sql: string[]
  tag: string
  when: number
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DRIZZLE_MIGRATIONS_TABLE = '__drizzle_migrations'
const LEGACY_PARTIAL_RUN_STATUS = ['partial', 'success'].join('_')
/** Static legacy schema matches bundled migrations through 0017; 0018+ run via Drizzle. */
const LEGACY_STATIC_SCHEMA_BASELINE_WHEN = 1783785250659
export function createInMemoryDatabase() {
  return new Database(':memory:')
}

export function createFileDatabase(databasePath: string) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true })
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

  database.transaction(() => {
    if (isLegacyUnmanagedDatabase(database)) {
      migrateLegacyDatabaseSchema(database)
      stampDrizzleMigrations(
        database,
        drizzleMigrations.filter((migration) => migration.when <= LEGACY_STATIC_SCHEMA_BASELINE_WHEN),
      )
    }

    preparePendingDrizzleMigrations(database, drizzleMigrations)
    migratePendingDrizzleMigrations(database, drizzleMigrations)
    canonicalizeLifecyclePhysicalObjects(database)
  })()

  runDataMigrations(database)
}

function migratePendingDrizzleMigrations(
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
  const latestAppliedMigration = readLatestAppliedDrizzleMigrationMillis(database)
  const insert = database.prepare(
    `insert into ${DRIZZLE_MIGRATIONS_TABLE} (hash, created_at) values (?, ?)`,
  )

  for (const migration of drizzleMigrations) {
    if (latestAppliedMigration !== null && latestAppliedMigration >= migration.when) continue
    for (const statement of migration.sql) database.exec(statement)
    insert.run(migration.hash, migration.when)
  }
}

/**
 * SQLite updates table/column references when an object is renamed, but it
 * deliberately keeps index and trigger names unchanged.  Keep those physical
 * names aligned with the lifecycle vocabulary as part of the same transaction
 * as the forward migration.  This also makes the operation idempotent for a
 * workspace reopened after a partially completed migration.
 */
function canonicalizeLifecyclePhysicalObjects(database: SqliteDatabase) {
  if (!tableExists(database, 'jobs') || !tableExists(database, 'captures') || !tableExists(database, 'opportunities')) {
    return
  }

  const replacements: Array<[string, string]> = [
    ['idx_raw_source_occurrences_connector_lineage', 'idx_captures_connector_lineage'],
    ['idx_raw_source_occurrences_record_chronology', 'idx_captures_lineage_chronology'],
    ['idx_raw_source_occurrences_connector_run', 'idx_captures_connector_run'],
    ['idx_raw_source_occurrences_revision', 'idx_captures_evidence_version'],
    ['idx_raw_source_occurrences_lineage', 'idx_captures_lineage'],
    ['idx_raw_source_revisions_provider_current', 'idx_capture_evidence_versions_provider_current'],
    ['idx_raw_source_revisions_record_revision', 'idx_capture_evidence_versions_lineage_revision'],
    ['idx_raw_source_revisions_record_hash', 'idx_capture_evidence_versions_lineage_hash'],
    ['idx_raw_source_revisions_id_record', 'idx_capture_evidence_versions_id_lineage'],
    ['idx_raw_source_records_source_entity', 'idx_capture_lineages_job'],
    ['idx_source_entity_identities_entity_chronology', 'idx_job_identities_job_chronology'],
    ['idx_source_entity_identities_identity', 'idx_job_identities_identity'],
    ['idx_source_identity_conflicts_occurrence', 'idx_job_identity_conflicts_capture'],
    ['idx_canonical_source_candidates_revision_schema', 'idx_job_fact_versions_evidence_version_schema'],
    ['idx_canonical_source_candidates_lineage', 'idx_job_fact_versions_lineage'],
    ['idx_canonical_source_candidates_run', 'idx_job_fact_versions_run'],
    ['idx_sourcing_findings_source_status_discovered', 'idx_opportunities_source_status_discovered'],
    ['idx_sourcing_findings_projection_identity', 'idx_opportunities_projection_identity'],
    ['idx_sourcing_findings_source_entity', 'idx_opportunities_job'],
    ['idx_sourcing_findings_canonical_candidate', 'idx_opportunities_job_fact_version'],
    ['idx_sourcing_findings_source_id', 'idx_opportunities_source_id'],
    ['idx_sourcing_projection_outcomes_candidate', 'idx_sourcing_projection_outcomes_job_fact_version'],
    ['idx_sourcing_projection_outcomes_revision', 'idx_sourcing_projection_outcomes_evidence_version'],
    ['idx_normalization_runs_raw_record', 'idx_normalization_runs_capture_lineage'],
    ['idx_normalization_replay_items_revision', 'idx_normalization_replay_items_evidence_version'],
    ['trg_raw_source_occurrences_normalization_lineage_update', 'trg_captures_normalization_lineage_update'],
    ['trg_raw_source_occurrences_normalization_lineage_delete', 'trg_captures_normalization_lineage_delete'],
    ['raw_source_occurrences_scope_owner_insert', 'captures_scope_owner_insert'],
    ['raw_source_occurrences_scope_owner_update', 'captures_scope_owner_update'],
    ['trg_source_entity_identities_', 'trg_job_identities_'],
    ['trg_source_identity_conflicts_', 'trg_job_identity_conflicts_'],
    ['trg_sourcing_findings_', 'trg_opportunities_'],
    ['raw_source_occurrences', 'captures'],
    ['raw_source_revisions', 'capture_evidence_versions'],
    ['raw_source_records', 'capture_lineages'],
    ['source_entity_identities', 'job_identities'],
    ['source_identity_conflicts', 'job_identity_conflicts'],
    ['source_entities', 'jobs'],
    ['canonical_source_candidates', 'job_fact_versions'],
    ['sourcing_findings', 'opportunities'],
    ['conflicting_source_entity_id', 'conflicting_job_id'],
    ['source_entity_id', 'job_id'],
    ['raw_record_id', 'capture_lineage_id'],
    ['raw_revision_id', 'capture_evidence_version_id'],
    ['trigger_occurrence_id', 'trigger_capture_id'],
    ['canonical_candidate_id', 'job_fact_version_id'],
    ['candidate_json', 'job_fact_version_json'],
    ['candidate_id', 'job_fact_version_id'],
    ['fk_sourcing_projection_outcomes_candidate_lineage', 'fk_sourcing_projection_outcomes_job_fact_version_lineage'],
    ['chk_normalization_gates_candidate', 'chk_normalization_gates_job_fact_version'],
    ['finding_id', 'opportunity_id'],
    ['merged_application_id', 'application_id'],
    ['idx_raw_source', 'idx_capture'],
    ['chk_raw_source', 'chk_capture'],
    ['fk_raw_source', 'fk_capture'],
    ['idx_source_entity', 'idx_job'],
    ['chk_source_entity', 'chk_job'],
    ['idx_source_identity', 'idx_job_identity'],
    ['chk_source_identity', 'chk_job_identity'],
    ['idx_canonical_source', 'idx_job_fact'],
    ['chk_canonical_source', 'chk_job_fact'],
    ['idx_sourcing_finding', 'idx_opportunity'],
    ['chk_sourcing_finding', 'chk_opportunity'],
    ['trg_source_entity', 'trg_job'],
    ['trg_source_identity', 'trg_job_identity'],
    ['trg_sourcing_finding', 'trg_opportunity'],
  ]

  const objects = database
    .prepare(
      `select type, name, sql
       from sqlite_master
       where type in ('index', 'trigger')
         and sql is not null
         and name not like 'sqlite_autoindex_%'`,
    )
    .all() as Array<{ type: 'index' | 'trigger'; name: string; sql: string }>

  for (const object of objects) {
    const canonicalName = replaceLifecycleTerms(object.name, replacements)
    if (canonicalName === object.name || !canonicalName) continue
    if (database
      .prepare("select 1 from sqlite_master where name = ? and type = ?")
      .get(canonicalName, object.type)) {
      database.exec(`drop ${object.type} if exists ${quoteIdentifier(object.name)}`)
      continue
    }

    const canonicalSql = replaceLifecycleTerms(object.sql, replacements)
    database.exec(canonicalSql)
    database.exec(`drop ${object.type} if exists ${quoteIdentifier(object.name)}`)
  }
}

function replaceLifecycleTerms(value: string, replacements: Array<[string, string]>) {
  return replacements.reduce((result, [legacy, canonical]) => result.split(legacy).join(canonical), value)
}

function quoteIdentifier(value: string) {
  return `"${value.split('"').join('""')}"`
}

function preparePendingDrizzleMigrations(
  database: SqliteDatabase,
  drizzleMigrations: DrizzleMigrationEntry[],
) {
  const partialRunCleanup = drizzleMigrations.find(
    (migration) => migration.tag === '0023_supreme_lenny_balinger',
  )
  if (!partialRunCleanup) return

  const appliedMigrationKeys = new Set(
    readAppliedDrizzleMigrations(database).map((migration) => formatDrizzleMigrationKey(migration)),
  )
  if (appliedMigrationKeys.has(formatDrizzleMigrationKey(partialRunCleanup))) return
  if (!hasLegacyPartialRunNormalizationShape(database)) return

  database.prepare(`
    update normalization_runs
    set trigger_occurrence_id = null,
      trigger_connector_instance_id = null,
      trigger_connector_run_id = null
    where trigger_connector_run_id in (
      select id from connector_runs where status = ?
    )
    and exists (
      select 1 from canonical_source_candidates candidate
      join sourcing_findings finding on finding.canonical_candidate_id = candidate.id
      where candidate.run_id = normalization_runs.id
    );
  `).run(LEGACY_PARTIAL_RUN_STATUS)
}

function hasLegacyPartialRunNormalizationShape(database: SqliteDatabase) {
  return ['connector_runs', 'normalization_runs', 'canonical_source_candidates', 'sourcing_findings']
    .every((tableName) => tableExists(database, tableName))
    && ['trigger_occurrence_id', 'trigger_connector_instance_id', 'trigger_connector_run_id']
      .every((columnName) => tableHasColumn(database, 'normalization_runs', columnName))
    && tableHasColumn(database, 'sourcing_findings', 'canonical_candidate_id')
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
    sql: [],
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
    'opportunities',
    'captures',
    'capture_lineages',
    'capture_evidence_versions',
    'jobs',
    'job_identities',
    'job_identity_conflicts',
    'job_fact_versions',
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
      sql: sql.split('--> statement-breakpoint'),
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

function tableHasColumn(database: SqliteDatabase, tableName: string, columnName: string) {
  const row = database
    .prepare(`select name from pragma_table_info(?) where name = ?`)
    .get(tableName, columnName)

  return Boolean(row)
}
