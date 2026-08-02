/**
 * Workflow-run state owned by the workflow-runs module: the run source lookup, the
 * runs themselves, and their ordered steps.
 */
import { index, integer, pgTable, text } from 'drizzle-orm/pg-core'
import { applications } from '../application/application.schema.js'

const timestamps = {
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
}

/** Workflow-run source lookup; unrelated to retired sourcing findings. */
export const sources = pgTable('sources', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  accountHint: text('account_hint'),
  ...timestamps,
}, (table) => ({ nameIdx: index('idx_sources_name').on(table.name) }))

export const workflowRuns = pgTable('workflow_runs', {
  id: text('id').primaryKey(),
  runType: text('run_type').notNull(),
  status: text('status').notNull(),
  actorType: text('actor_type').notNull(),
  actorName: text('actor_name'),
  sourceId: text('source_id').references(() => sources.id),
  subjectApplicationId: text('subject_application_id').references(() => applications.id),
  startedAt: text('started_at').notNull(),
  completedAt: text('completed_at'),
  coverageStartedAt: text('coverage_started_at'),
  coverageEndedAt: text('coverage_ended_at'),
  timezone: text('timezone'),
  inputJson: text('input_json').notNull(),
  summary: text('summary'),
  outcome: text('outcome'),
  blocker: text('blocker'),
  metadataJson: text('metadata_json').notNull(),
  ...timestamps,
}, (table) => ({
  sourceIdx: index('idx_workflow_runs_source_id').on(table.sourceId),
  sourceTypeStatusStartedIdx: index('idx_workflow_runs_source_type_status_started')
    .on(table.sourceId, table.runType, table.status, table.startedAt),
}))

export const workflowRunSteps = pgTable('workflow_run_steps', {
  id: text('id').primaryKey(),
  workflowRunId: text('workflow_run_id').notNull().references(() => workflowRuns.id),
  sequence: integer('sequence').notNull(),
  type: text('type').notNull(),
  message: text('message').notNull(),
  payloadJson: text('payload_json').notNull(),
  actor: text('actor').notNull(),
  createdAt: text('created_at').notNull(),
})
