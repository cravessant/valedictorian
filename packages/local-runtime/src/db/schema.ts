/**
 * Canonical PGlite schema; `drizzle/` holds one generated baseline for it.
 *
 * This file declares no table. Every capability-owned definition lives in its
 * owning module schema slice and platform-owned `workspaces` lives beside this
 * file; the aggregate below is the one composition surface Drizzle tooling and
 * runtime registration read.
 */
import {
  connectorCaptureWork, connectorCheckpoints, connectorInstances, connectorObservations,
  connectorRunSynchronizations, connectorRuns, connectorScheduleEvents,
  connectorScheduleOccurrences, connectorScheduleRevisions, connectorSchedules,
} from '../modules/connectors/adapters/persistence/connector.schema.js'
import {
  captureEffectiveRevisionInputs, captureEvidenceItems, captureFieldOutcomes,
  captureMaterializationIssues, captureMaterializationState, captureOccurrences,
  captureResolutionCommandReceipts, captureResolutionGenerations,
  captureResolutionStageResults, captureRevisions, captures,
} from '../modules/capture/capture.schema.js'
import {
  jobCaptureEvidenceReferences, jobExternalIdentities, jobHistory, jobs,
} from '../modules/job/job.schema.js'
import { opportunities, opportunityHistory } from '../modules/opportunity/opportunity.schema.js'
import {
  applicationAttemptRecords, applicationEventRecords, applicationHistory,
  applicationScores, applicationWorkflowStates, applications, pursuitLinks,
} from '../modules/application/application.schema.js'
import {
  captureDestinationResolutionWork, hostedResultPollingWork,
  hostedSubmissionWork, normalizationWork, providerUrlResolutionWork,
} from '../modules/scheduling/scheduling.schema.js'
import { policyConfig, policyEvidence } from '../modules/policy/policy.schema.js'
import { workspaceSecrets } from '../modules/secrets/secret.schema.js'
import {
  sourceExecutionScopes, sourceExecutionSessions,
} from '../modules/source-execution/source-execution.schema.js'
import {
  sources, workflowRunSteps, workflowRuns,
} from '../modules/workflow-runs/workflow-run.schema.js'
import { workspaces } from './workspaces.schema.js'
import {
  companyAliases, companyCommandReceipts,
  companyDuplicateCandidateReviews, companyDuplicateCandidates, companyDuplicateIndexState,
  companyDuplicateMaintenanceWork, companyHistory,
  jobCompanyAssignmentHistory, jobCompanyAssignments, workspaceCompanies,
} from '../modules/company/company.schema.js'

export {
  connectorCaptureWork, connectorCheckpoints, connectorInstances, connectorObservations,
  connectorRunSynchronizations, connectorRuns, connectorScheduleEvents,
  connectorScheduleOccurrences, connectorScheduleRevisions, connectorSchedules,
} from '../modules/connectors/adapters/persistence/connector.schema.js'
export {
  captureEffectiveRevisionInputs, captureEvidenceItems, captureFieldOutcomes,
  captureMaterializationIssues, captureMaterializationState, captureOccurrences,
  captureResolutionCommandReceipts, captureResolutionGenerations,
  captureResolutionStageResults, captureRevisions, captures,
} from '../modules/capture/capture.schema.js'
export {
  jobCaptureEvidenceReferences, jobExternalIdentities, jobHistory, jobs,
} from '../modules/job/job.schema.js'
export { opportunities, opportunityHistory } from '../modules/opportunity/opportunity.schema.js'
export {
  applicationAttemptRecords, applicationEventRecords, applicationHistory,
  applicationScores, applicationWorkflowStates, applications, pursuitLinks,
} from '../modules/application/application.schema.js'
export {
  captureDestinationResolutionWork, hostedResultPollingWork,
  hostedSubmissionWork, normalizationWork, providerUrlResolutionWork,
} from '../modules/scheduling/scheduling.schema.js'
export { policyConfig, policyEvidence } from '../modules/policy/policy.schema.js'
export { workspaceSecrets } from '../modules/secrets/secret.schema.js'
export {
  sourceExecutionScopes, sourceExecutionSessions,
} from '../modules/source-execution/source-execution.schema.js'
export {
  sources, workflowRunSteps, workflowRuns,
} from '../modules/workflow-runs/workflow-run.schema.js'
export { DEFAULT_WORKSPACE_ID, workspaces } from './workspaces.schema.js'
export {
  companyAliases, companyCommandReceipts,
  companyDuplicateCandidateReviews, companyDuplicateCandidates, companyDuplicateIndexState,
  companyDuplicateMaintenanceWork, companyHistory,
  jobCompanyAssignmentHistory, jobCompanyAssignments, workspaceCompanies,
} from '../modules/company/company.schema.js'

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
