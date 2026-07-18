import { boolean, index, integer, primaryKey, pgTable, text, unique, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

const timestamps = {
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
}

export const connectorInstances = pgTable(
  'connector_instances',
  {
    id: text('id').primaryKey(),
    executionScopeId: text('execution_scope_id').notNull(),
    connectorId: text('connector_id').notNull(),
    connectorVersion: text('connector_version').notNull(),
    displayName: text('display_name').notNull(),
    enabled: boolean('enabled').notNull(),
    configJson: text('config_json').notNull(),
    authJson: text('auth_json').notNull().default('[]'),
    filtersJson: text('filters_json').notNull().default('{}'),
    earliestBackfillDate: text('earliest_backfill_date'),
    ...timestamps,
  },
  (table) => ({
    connectorIdx: index('idx_connector_instances_connector').on(table.connectorId),
    enabledIdx: index('idx_connector_instances_enabled').on(table.enabled),
  }),
)

export const connectorRuns = pgTable(
  'connector_runs',
  {
    id: text('id').primaryKey(),
    executionScopeId: text('execution_scope_id').notNull(),
    connectorInstanceId: text('connector_instance_id')
      .notNull()
      .references(() => connectorInstances.id),
    mode: text('mode').notNull(),
    status: text('status').notNull(),
    startedAt: text('started_at').notNull(),
    completedAt: text('completed_at'),
    coverageStartedAt: text('coverage_started_at'),
    coverageEndedAt: text('coverage_ended_at'),
    configJson: text('config_json').notNull().default('{}'),
    filtersJson: text('filters_json').notNull().default('{}'),
    filterSignature: text('filter_signature').notNull().default('filters:{}'),
    observationCount: integer('observation_count').notNull(),
    warningCount: integer('warning_count').notNull(),
    statsJson: text('stats_json').notNull(),
    warningsJson: text('warnings_json').notNull(),
    retryHintsJson: text('retry_hints_json').notNull(),
    ...timestamps,
  },
  (table) => ({
    ownerIdx: unique('idx_connector_runs_id_instance').on(
      table.id,
      table.connectorInstanceId,
    ),
    instanceIdx: index('idx_connector_runs_instance').on(table.connectorInstanceId),
    instanceLatestIdx: index('idx_connector_runs_instance_latest').on(
      table.connectorInstanceId,
      table.startedAt,
      table.createdAt,
    ),
    instanceStatusStartedIdx: index('idx_connector_runs_instance_status_started').on(
      table.connectorInstanceId,
      table.status,
      table.startedAt,
    ),
  }),
)

export const connectorCheckpoints = pgTable(
  'connector_checkpoints',
  {
    connectorInstanceId: text('connector_instance_id')
      .notNull()
      .references(() => connectorInstances.id),
    filterSignature: text('filter_signature').notNull().default('filters:{}'),
    checkpointJson: text('checkpoint_json').notNull(),
    schemaVersion: text('schema_version').notNull(),
    coverageStartedAt: text('coverage_started_at'),
    coverageEndedAt: text('coverage_ended_at'),
    savedAt: text('saved_at').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.connectorInstanceId, table.filterSignature] }),
    instanceIdx: index('idx_connector_checkpoints_instance').on(table.connectorInstanceId),
  }),
)

export const connectorObservations = pgTable(
  'connector_observations',
  {
    id: text('id').primaryKey(),
    connectorInstanceId: text('connector_instance_id')
      .notNull()
      .references(() => connectorInstances.id),
    connectorRunId: text('connector_run_id')
      .notNull()
      .references(() => connectorRuns.id),
    connectorId: text('connector_id').notNull(),
    connectorVersion: text('connector_version').notNull(),
    parserVersion: text('parser_version'),
    observationSchemaVersion: text('observation_schema_version'),
    sourceRecordKey: text('source_record_key').notNull(),
    observedAt: text('observed_at').notNull(),
    companyName: text('company_name').notNull(),
    roleTitle: text('role_title').notNull(),
    locationRaw: text('location_raw'),
    descriptionText: text('description_text'),
    payJson: text('pay_json').notNull(),
    linksJson: text('links_json').notNull(),
    resolutionJson: text('resolution_json').notNull(),
    dedupeKeysJson: text('dedupe_keys_json').notNull(),
    sourceMetadataJson: text('source_metadata_json').notNull(),
    evidenceJson: text('evidence_json').notNull(),
    rawJson: text('raw_json').notNull(),
    ...timestamps,
  },
  (table) => ({
    instanceIdx: index('idx_connector_observations_instance').on(table.connectorInstanceId),
    runIdx: index('idx_connector_observations_run').on(table.connectorRunId),
    sourceRecordIdx: index('idx_connector_observations_source_record').on(
      table.connectorInstanceId,
      table.sourceRecordKey,
    ),
  }),
)

export const connectorSchedules = pgTable(
  'connector_schedules',
  {
    id: text('id').primaryKey(),
    connectorInstanceId: text('connector_instance_id')
      .notNull()
      .references(() => connectorInstances.id),
    revision: text('revision').notNull(),
    state: text('state').notNull(),
    cadenceJson: text('cadence_json').notNull(),
    timezone: text('timezone').notNull(),
    nextEligibleAt: text('next_eligible_at').notNull(),
    ...timestamps,
  },
  (table) => ({
    instanceIdx: uniqueIndex('idx_connector_schedules_instance')
      .on(table.connectorInstanceId)
      .where(sql`${table.deletedAt} is null`),
    nextEligibleIdx: index('idx_connector_schedules_next_eligible').on(table.nextEligibleAt),
  }),
)

/** Immutable configuration/state snapshots keyed by schedule revision identity. */
export const connectorScheduleRevisions = pgTable(
  'connector_schedule_revisions',
  {
    revision: text('revision').primaryKey(),
    scheduleId: text('schedule_id')
      .notNull()
      .references(() => connectorSchedules.id),
    state: text('state').notNull(),
    cadenceJson: text('cadence_json').notNull(),
    timezone: text('timezone').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    scheduleIdx: index('idx_connector_schedule_revisions_schedule').on(
      table.scheduleId,
      table.createdAt,
    ),
  }),
)

export const connectorScheduleEvents = pgTable(
  'connector_schedule_events',
  {
    id: text('id').primaryKey(),
    scheduleId: text('schedule_id')
      .notNull()
      .references(() => connectorSchedules.id),
    actorClass: text('actor_class').notNull(),
    action: text('action').notNull(),
    revision: text('revision').notNull(),
    at: text('at').notNull(),
  },
  (table) => ({
    scheduleIdx: index('idx_connector_schedule_events_schedule').on(table.scheduleId, table.at),
  }),
)

export const connectorScheduleOccurrences = pgTable(
  'connector_schedule_occurrences',
  {
    id: text('id').primaryKey(),
    scheduleId: text('schedule_id')
      .notNull()
      .references(() => connectorSchedules.id),
    scheduleRevision: text('schedule_revision').notNull(),
    nominalAt: text('nominal_at').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    admittedMode: text('admitted_mode').notNull(),
    outcome: text('outcome').notNull(),
    connectorRunId: text('connector_run_id').references(() => connectorRuns.id),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    idempotencyIdx: uniqueIndex('idx_connector_schedule_occurrences_idempotency').on(
      table.idempotencyKey,
    ),
    scheduleIdx: index('idx_connector_schedule_occurrences_schedule').on(
      table.scheduleId,
      table.createdAt,
    ),
    runIdx: index('idx_connector_schedule_occurrences_run').on(table.connectorRunId),
  }),
)
