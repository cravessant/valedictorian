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
  {
    name: '20260710000000_sourcing_destination_projection',
    up({ context }) {
      migrateLegacyConnectorDestinationProjection(context.database)
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

function migrateLegacyConnectorDestinationProjection(database: SqliteDatabase) {
  if (!tableExists(database, 'connector_observations') || !tableExists(database, 'sourcing_findings')) {
    return
  }

  const observationColumns = tableColumnNames(database, 'connector_observations')
  const findingColumns = tableColumnNames(database, 'sourcing_findings')
  const requiredObservationColumns = [
    'connector_id',
    'connector_version',
    'deleted_at',
    'id',
    'links_json',
    'observed_at',
    'sourcing_finding_id',
  ]
  const requiredFindingColumns = [
    'blocker',
    'destination_class',
    'destination_url',
    'intermediary_url',
    'merge_notes',
    'merge_status',
    'official_url',
    'source_url',
    'usability',
  ]

  if (
    requiredObservationColumns.some((column) => !observationColumns.has(column))
    || requiredFindingColumns.some((column) => !findingColumns.has(column))
  ) {
    return
  }

  const rows = database.prepare(`
    select sourcing_finding_id, connector_version, links_json
    from connector_observations
    where connector_id = 'jobright.resolver'
      and sourcing_finding_id is not null
      and deleted_at is null
    order by observed_at desc, id desc
  `).all() as Array<{
    connector_version: string
    links_json: string
    sourcing_finding_id: string
  }>
  const migratedFindingIds = new Set<string>()
  const update = database.prepare(`
    update sourcing_findings
    set destination_class = null,
      destination_url = null,
      intermediary_url = ?,
      usability = 'review_only',
      official_url = null,
      source_url = ?,
      blocker = case
        when merge_status = 'merged' then blocker
        else 'No verified usable application destination; retained for review.'
      end,
      merge_status = case when merge_status = 'merged' then merge_status else 'blocked' end,
      merge_notes = case
        when merge_status = 'merged' then merge_notes
        else 'No verified usable application destination; retained for review.'
      end
    where id = ?
  `)

  for (const row of rows) {
    if (migratedFindingIds.has(row.sourcing_finding_id)) {
      continue
    }
    migratedFindingIds.add(row.sourcing_finding_id)

    if (!isConnectorVersionBefore(row.connector_version, [0, 4, 3])) {
      continue
    }

    const links = readLegacyObservationLinks(row.links_json)
    const intermediaryUrl = safeObservedJobrightUrl(links?.intermediary ?? links?.source ?? null)
    update.run(intermediaryUrl, intermediaryUrl, row.sourcing_finding_id)
  }
}

function readLegacyObservationLinks(value: string): { intermediary?: unknown; source?: unknown } | null {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object'
      ? parsed as { intermediary?: unknown; source?: unknown }
      : null
  } catch {
    return null
  }
}

function safeObservedJobrightUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  try {
    const url = new URL(value)
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
    const isJobrightHostname = hostname === 'jobright.ai' || hostname.endsWith('.jobright.ai')

    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:')
      || !isJobrightHostname
      || url.username.length > 0
      || url.password.length > 0
      || url.port.length > 0
    ) {
      return null
    }

    return url.toString()
  } catch {
    return null
  }
}

function isConnectorVersionBefore(value: string, target: [number, number, number]): boolean {
  const match = value.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)

  if (!match) {
    return true
  }

  const current = match.slice(1).map(Number)

  for (const [index, part] of current.entries()) {
    if (part < target[index]) {
      return true
    }
    if (part > target[index]) {
      return false
    }
  }

  return false
}

function tableColumnNames(database: SqliteDatabase, tableName: string): Set<string> {
  return new Set(
    (database.prepare(`pragma table_info(${tableName})`).all() as Array<{ name: string }>)
      .map((row) => row.name),
  )
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
