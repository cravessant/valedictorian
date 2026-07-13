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
