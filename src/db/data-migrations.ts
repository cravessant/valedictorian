import { Umzug, type MigrationParams, type RunnableMigration, type UmzugStorage } from 'umzug'
import { z } from 'zod'
import { normalizeJobTimingInput, normalizePolicyConfig, stringifyJobTerms } from 'sparxie'
import type { SqliteDatabase } from './sqlite'

const DATA_MIGRATIONS_TABLE = '__valedictorian_data_migrations'
const CURRENT_POLICY_CONFIG_VERSION = 2

interface DataMigrationContext {
  database: SqliteDatabase
}

type SyncDataMigration = Omit<RunnableMigration<DataMigrationContext>, 'up' | 'down'> & {
  up: (params: MigrationParams<DataMigrationContext>) => void
}

const versionedConfigSchema = z.object({
  version: z.number().int().positive().optional(),
}).passthrough()

const dataMigrations: SyncDataMigration[] = [
  {
    name: '20260630000000_policy_config_v2',
    up({ context }) {
      migratePolicyConfigJson(context.database)
    },
  },
  {
    name: '20260702000000_job_timing_terms',
    up({ context }) {
      migrateJobTimingTerms(context.database)
    },
  },
]

export function runDataMigrations(database: SqliteDatabase) {
  const storage = new SqliteDataMigrationStorage(database)
  storage.ensureStorage()
  const executed = new Set(storage.executedSync())

  for (const migration of dataMigrations) {
    if (executed.has(migration.name)) {
      continue
    }

    migration.up({
      context: { database },
      name: migration.name,
    })
    storage.logMigrationSync(migration.name)
  }
}

export function createDataMigrationUmzug(database: SqliteDatabase) {
  return new Umzug<DataMigrationContext>({
    context: { database },
    logger: undefined,
    migrations: dataMigrations.map(toRunnableDataMigration),
    storage: new SqliteDataMigrationStorage(database),
  })
}

export function hasPendingDataMigrations(database: SqliteDatabase) {
  const executed = new Set(readDataMigrationNames(database))

  return dataMigrations.some((migration) => !executed.has(migration.name))
}

export function assertDataMigrationHistoryIsKnown(database: SqliteDatabase) {
  const known = new Set(dataMigrations.map((migration) => migration.name))
  const unknown = readDataMigrationNames(database).filter((name) => !known.has(name))

  if (unknown.length > 0) {
    throw new Error(
      `Workspace data migrations are newer than this app supports: ${unknown.join(', ')}`,
    )
  }
}

export function readDataMigrationNames(database: SqliteDatabase) {
  if (!tableExists(database, DATA_MIGRATIONS_TABLE)) {
    return []
  }

  return (
    database
      .prepare(`select name from ${DATA_MIGRATIONS_TABLE} order by created_at, name`)
      .all() as Array<{ name: string }>
  ).map((row) => row.name)
}

function toRunnableDataMigration(
  migration: SyncDataMigration,
): RunnableMigration<DataMigrationContext> {
  return {
    ...migration,
    async up(params) {
      migration.up(params)
    },
  }
}

class SqliteDataMigrationStorage implements UmzugStorage<DataMigrationContext> {
  constructor(private readonly database: SqliteDatabase) {}

  async logMigration(params: MigrationParams<DataMigrationContext>) {
    this.logMigrationSync(params.name)
  }

  async unlogMigration(params: MigrationParams<DataMigrationContext>) {
    this.unlogMigrationSync(params.name)
  }

  async executed() {
    return this.executedSync()
  }

  ensureStorage() {
    this.database.exec(`
      create table if not exists ${DATA_MIGRATIONS_TABLE} (
        name text primary key,
        created_at text not null
      );
    `)
  }

  logMigrationSync(name: string) {
    this.ensureStorage()
    this.database
      .prepare(`insert into ${DATA_MIGRATIONS_TABLE} (name, created_at) values (?, ?)`)
      .run(name, new Date().toISOString())
  }

  unlogMigrationSync(name: string) {
    this.ensureStorage()
    this.database.prepare(`delete from ${DATA_MIGRATIONS_TABLE} where name = ?`).run(name)
  }

  executedSync() {
    return readDataMigrationNames(this.database)
  }
}

function migratePolicyConfigJson(database: SqliteDatabase) {
  const rows = database.prepare('select id, config_json from policy_config').all() as Array<{
    id: string
    config_json: string
  }>
  const update = database.prepare('update policy_config set config_json = ? where id = ?')

  for (const row of rows) {
    let parsed: unknown

    try {
      parsed = JSON.parse(row.config_json) as unknown
    } catch {
      continue
    }

    const normalized = normalizePolicyConfig(readSupportedPolicyConfig(parsed))
    const nextJson = JSON.stringify(normalized)

    if (nextJson !== row.config_json) {
      update.run(nextJson, row.id)
    }
  }
}

function migrateJobTimingTerms(database: SqliteDatabase) {
  backfillTimingTerms(database, 'applications')
  backfillTimingTerms(database, 'sourcing_findings')
}

function backfillTimingTerms(database: SqliteDatabase, tableName: 'applications' | 'sourcing_findings') {
  if (!tableExists(database, tableName)) {
    return
  }

  const rows = database
    .prepare(`select id, term, timing_mode from ${tableName}`)
    .all() as Array<{ id: string; term: string | null; timing_mode: string | null }>
  const update = database.prepare(`
    update ${tableName}
    set timing_mode = ?, terms_json = ?, start_date = null, end_date = null
    where id = ?
  `)

  for (const row of rows) {
    if (row.timing_mode && row.timing_mode !== 'unknown') {
      continue
    }
    if (!row.term) {
      continue
    }

    const timing = normalizeJobTimingInput({ term: row.term })
    if (timing.timingMode !== 'terms') {
      continue
    }

    update.run(timing.timingMode, stringifyJobTerms(timing.terms), row.id)
  }
}

function readSupportedPolicyConfig(value: unknown) {
  const parsed = versionedConfigSchema.safeParse(value)

  if (!parsed.success) {
    return value
  }

  if (
    parsed.data.version !== undefined &&
    parsed.data.version > CURRENT_POLICY_CONFIG_VERSION
  ) {
    throw new Error(
      `Policy config version ${parsed.data.version} is newer than this app supports.`,
    )
  }

  return value
}

function tableExists(database: SqliteDatabase, tableName: string) {
  const row = database
    .prepare("select name from sqlite_master where type = 'table' and name = ?")
    .get(tableName)

  return Boolean(row)
}
