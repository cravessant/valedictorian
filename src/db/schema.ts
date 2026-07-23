/** Current PGlite schema after the final lifecycle cutover (#307). */
import { sql } from 'drizzle-orm'
import { check, index, integer, pgTable, text } from 'drizzle-orm/pg-core'
import {
  connectorCheckpoints, connectorInstances, connectorObservations, connectorRuns,
  connectorScheduleEvents, connectorScheduleOccurrences, connectorScheduleRevisions,
  connectorSchedules,
} from './schema.connectors'
import {
  captureEvidenceItems, captureFieldOutcomes, captureOccurrences, captureRevisions, captures,
} from '../modules/capture/capture.schema'
import {
  jobCaptureEvidenceReferences, jobExternalIdentities, jobHistory, jobs,
} from '../modules/job/job.schema'
import { opportunities, opportunityHistory } from '../modules/opportunity/opportunity.schema'
import {
  applicationAttemptRecords, applicationEventRecords, applicationHistory,
  applicationScores, applicationWorkflowStates, applications, pursuitLinks,
} from '../modules/application/application.schema'
import {
  connectorCaptureWork, hostedResultPollingWork, hostedSubmissionWork,
  normalizationWork, providerUrlResolutionWork,
} from '../modules/scheduling/scheduling.schema'
import { lifecycleMigrationReport, workspaces } from './workspaces.schema'
import {
  companyAliases, companyBackfillJournal, companyCapabilityState, companyCommandReceipts,
  companyHistory,
  jobCompanyAssignmentHistory, jobCompanyAssignments, workspaceCompanies,
} from '../modules/company/company.schema'

export {
  connectorCheckpoints, connectorInstances, connectorObservations, connectorRuns,
  connectorScheduleEvents, connectorScheduleOccurrences, connectorScheduleRevisions,
  connectorSchedules,
} from './schema.connectors'
export {
  captureEvidenceItems, captureFieldOutcomes, captureOccurrences, captureRevisions, captures,
} from '../modules/capture/capture.schema'
export {
  jobCaptureEvidenceReferences, jobExternalIdentities, jobHistory, jobs,
} from '../modules/job/job.schema'
export { opportunities, opportunityHistory } from '../modules/opportunity/opportunity.schema'
export {
  applicationAttemptRecords, applicationEventRecords, applicationHistory,
  applicationScores, applicationWorkflowStates, applications, pursuitLinks,
} from '../modules/application/application.schema'
export {
  connectorCaptureWork, hostedResultPollingWork, hostedSubmissionWork,
  normalizationWork, providerUrlResolutionWork,
} from '../modules/scheduling/scheduling.schema'
export { DEFAULT_WORKSPACE_ID, lifecycleMigrationReport, workspaces } from './workspaces.schema'
export {
  companyAliases, companyBackfillJournal, companyCapabilityState, companyCommandReceipts,
  companyHistory,
  jobCompanyAssignmentHistory, jobCompanyAssignments, workspaceCompanies,
} from '../modules/company/company.schema'

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

export const workspaceSecrets = pgTable('workspace_secrets', {
  key: text('key').primaryKey(), label: text('label').notNull(),
  kind: text('kind').notNull(), encryptedValue: text('encrypted_value').notNull(),
  ...timestamps,
})

export const policyConfig = pgTable('policy_config', {
  id: text('id').primaryKey(), configJson: text('config_json').notNull(),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
})

export const policyEvidence = pgTable('policy_evidence', {
  id: text('id').primaryKey(), subjectType: text('subject_type').notNull(),
  subjectId: text('subject_id').notNull(), tag: text('tag').notNull(),
  source: text('source').notNull(), note: text('note'),
  payloadJson: text('payload_json').notNull(), createdAt: text('created_at').notNull(),
}, (table) => ({
  subjectIdx: index('idx_policy_evidence_subject').on(table.subjectType, table.subjectId),
  subjectTagIdx: index('idx_policy_evidence_subject_tag').on(table.subjectType, table.subjectId, table.tag),
}))

export const sourceExecutionScopes = pgTable('source_execution_scopes', {
  id: text('id').primaryKey(),
  status: text('status').notNull().default('available'),
  blockedUntil: text('blocked_until'),
  backoffAttempt: integer('backoff_attempt').notNull().default(0),
  authGeneration: integer('auth_generation').notNull().default(0),
  refreshLeaseToken: text('refresh_lease_token'),
  refreshLeaseExpiresAt: text('refresh_lease_expires_at'),
  actionReason: text('action_reason'),
  ...timestamps,
}, (table) => ({
  availabilityIdx: index('idx_source_execution_scopes_availability').on(table.status, table.blockedUntil),
  statusCheck: check('chk_source_execution_scopes_status', sql`${table.status} in ('available','cooldown','refreshing','action_required')`),
  idCheck: check('chk_source_execution_scopes_id', sql`length(${table.id}) between 8 and 256 and ${table.id} ~ '^[A-Za-z0-9._~-]+$'`),
  backoffCheck: check('chk_source_execution_scopes_backoff', sql`${table.backoffAttempt} >= 0`),
  generationCheck: check('chk_source_execution_scopes_generation', sql`${table.authGeneration} >= 0`),
  actionReasonCheck: check('chk_source_execution_scopes_action_reason', sql`${table.actionReason} is null or ${table.actionReason} ~ '^[a-z0-9_]{1,64}$'`),
}))

export const connectorRunSynchronizations = pgTable('connector_run_synchronizations', {
  connectorRunId: text('connector_run_id').primaryKey().references(() => connectorRuns.id),
  snapshotJson: text('snapshot_json').notNull(),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => ({
  snapshotLength: check('chk_connector_run_synchronizations_length', sql`length(${table.snapshotJson}) between 2 and 8192`),
}))

export const sourceExecutionSessions = pgTable('source_execution_sessions', {
  executionScopeId: text('execution_scope_id').primaryKey().references(() => sourceExecutionScopes.id),
  encryptedSession: text('encrypted_session').notNull(),
  authGeneration: integer('auth_generation').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => ({
  sessionLength: check('chk_source_execution_sessions_length', sql`length(${table.encryptedSession}) between 1 and 1048576`),
  generationCheck: check('chk_source_execution_sessions_generation', sql`${table.authGeneration} >= 1`),
}))

export const schema = {
  connectorCheckpoints, connectorInstances, connectorObservations, connectorRuns,
  connectorScheduleEvents, connectorScheduleOccurrences, connectorScheduleRevisions, connectorSchedules,
  sources, workflowRuns, workflowRunSteps, workspaceSecrets, policyConfig, policyEvidence,
  sourceExecutionScopes, connectorRunSynchronizations, sourceExecutionSessions,
  captures, captureRevisions, captureOccurrences, captureEvidenceItems, captureFieldOutcomes,
  jobs, jobExternalIdentities, jobCaptureEvidenceReferences, jobHistory,
  opportunities, opportunityHistory,
  applications, pursuitLinks, applicationAttemptRecords, applicationEventRecords,
  applicationHistory, applicationScores, applicationWorkflowStates,
  connectorCaptureWork, normalizationWork, providerUrlResolutionWork,
  hostedSubmissionWork, hostedResultPollingWork, workspaces, lifecycleMigrationReport,
  workspaceCompanies, companyAliases, companyHistory, companyCommandReceipts,
  jobCompanyAssignments,
  jobCompanyAssignmentHistory, companyCapabilityState, companyBackfillJournal,
}
