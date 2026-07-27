/** Canonical PGlite schema; `drizzle/` holds one generated baseline for it. */
import { sql } from 'drizzle-orm'
import { check, index, integer, pgTable, text } from 'drizzle-orm/pg-core'
import {
  connectorCheckpoints, connectorInstances, connectorObservations, connectorRuns,
  connectorScheduleEvents, connectorScheduleOccurrences, connectorScheduleRevisions,
  connectorSchedules,
} from './schema.connectors'
import {
  captureEffectiveRevisionInputs, captureEvidenceItems, captureFieldOutcomes,
  captureMaterializationIssues, captureMaterializationState, captureOccurrences,
  captureResolutionCommandReceipts, captureResolutionGenerations,
  captureResolutionStageResults, captureRevisions, captures,
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
  captureDestinationResolutionWork, connectorCaptureWork, hostedResultPollingWork,
  hostedSubmissionWork, normalizationWork, providerUrlResolutionWork,
} from '../modules/scheduling/scheduling.schema'
import { sourceExecutionScopes, sourceExecutionSessions } from './source-execution.schema'
import { workspaces } from './workspaces.schema'
import {
  companyAliases, companyCommandReceipts,
  companyDuplicateCandidateReviews, companyDuplicateCandidates, companyDuplicateIndexState,
  companyDuplicateMaintenanceWork, companyHistory,
  jobCompanyAssignmentHistory, jobCompanyAssignments, workspaceCompanies,
} from '../modules/company/company.schema'

export {
  connectorCheckpoints, connectorInstances, connectorObservations, connectorRuns,
  connectorScheduleEvents, connectorScheduleOccurrences, connectorScheduleRevisions,
  connectorSchedules,
} from './schema.connectors'
export {
  captureEffectiveRevisionInputs, captureEvidenceItems, captureFieldOutcomes,
  captureMaterializationIssues, captureMaterializationState, captureOccurrences,
  captureResolutionCommandReceipts, captureResolutionGenerations,
  captureResolutionStageResults, captureRevisions, captures,
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
  captureDestinationResolutionWork, connectorCaptureWork, hostedResultPollingWork,
  hostedSubmissionWork, normalizationWork, providerUrlResolutionWork,
} from '../modules/scheduling/scheduling.schema'
export { sourceExecutionScopes, sourceExecutionSessions } from './source-execution.schema'
export { DEFAULT_WORKSPACE_ID, workspaces } from './workspaces.schema'
export {
  companyAliases, companyCommandReceipts,
  companyDuplicateCandidateReviews, companyDuplicateCandidates, companyDuplicateIndexState,
  companyDuplicateMaintenanceWork, companyHistory,
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

export const connectorRunSynchronizations = pgTable('connector_run_synchronizations', {
  connectorRunId: text('connector_run_id').primaryKey().references(() => connectorRuns.id),
  snapshotJson: text('snapshot_json').notNull(),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => ({
  snapshotLength: check('chk_connector_run_synchronizations_length', sql`length(${table.snapshotJson}) between 2 and 8192`),
}))

export const schema = {
  connectorCheckpoints, connectorInstances, connectorObservations, connectorRuns,
  connectorScheduleEvents, connectorScheduleOccurrences, connectorScheduleRevisions, connectorSchedules,
  sources, workflowRuns, workflowRunSteps, workspaceSecrets, policyConfig, policyEvidence,
  sourceExecutionScopes, connectorRunSynchronizations, sourceExecutionSessions,
  captures, captureRevisions, captureOccurrences, captureEvidenceItems, captureFieldOutcomes,
  captureEffectiveRevisionInputs, captureMaterializationIssues, captureMaterializationState,
  captureResolutionGenerations, captureResolutionStageResults,
  captureResolutionCommandReceipts,
  jobs, jobExternalIdentities, jobCaptureEvidenceReferences, jobHistory,
  opportunities, opportunityHistory,
  applications, pursuitLinks, applicationAttemptRecords, applicationEventRecords,
  applicationHistory, applicationScores, applicationWorkflowStates,
  connectorCaptureWork, normalizationWork, providerUrlResolutionWork,
  captureDestinationResolutionWork,
  hostedSubmissionWork, hostedResultPollingWork, workspaces,
  workspaceCompanies, companyAliases, companyHistory, companyCommandReceipts,
  jobCompanyAssignments,
  jobCompanyAssignmentHistory,
  companyDuplicateCandidates, companyDuplicateCandidateReviews,
  companyDuplicateMaintenanceWork, companyDuplicateIndexState,
}
