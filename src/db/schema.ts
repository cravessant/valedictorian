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
} from '../modules/connectors/adapters/persistence/connector.schema'
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
  captureDestinationResolutionWork, hostedResultPollingWork,
  hostedSubmissionWork, normalizationWork, providerUrlResolutionWork,
} from '../modules/scheduling/scheduling.schema'
import { policyConfig, policyEvidence } from '../modules/policy/policy.schema'
import { workspaceSecrets } from '../modules/secrets/secret.schema'
import {
  sourceExecutionScopes, sourceExecutionSessions,
} from '../modules/source-execution/source-execution.schema'
import {
  sources, workflowRunSteps, workflowRuns,
} from '../modules/workflow-runs/workflow-run.schema'
import { workspaces } from './workspaces.schema'
import {
  companyAliases, companyCommandReceipts,
  companyDuplicateCandidateReviews, companyDuplicateCandidates, companyDuplicateIndexState,
  companyDuplicateMaintenanceWork, companyHistory,
  jobCompanyAssignmentHistory, jobCompanyAssignments, workspaceCompanies,
} from '../modules/company/company.schema'

export {
  connectorCaptureWork, connectorCheckpoints, connectorInstances, connectorObservations,
  connectorRunSynchronizations, connectorRuns, connectorScheduleEvents,
  connectorScheduleOccurrences, connectorScheduleRevisions, connectorSchedules,
} from '../modules/connectors/adapters/persistence/connector.schema'
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
  captureDestinationResolutionWork, hostedResultPollingWork,
  hostedSubmissionWork, normalizationWork, providerUrlResolutionWork,
} from '../modules/scheduling/scheduling.schema'
export { policyConfig, policyEvidence } from '../modules/policy/policy.schema'
export { workspaceSecrets } from '../modules/secrets/secret.schema'
export {
  sourceExecutionScopes, sourceExecutionSessions,
} from '../modules/source-execution/source-execution.schema'
export {
  sources, workflowRunSteps, workflowRuns,
} from '../modules/workflow-runs/workflow-run.schema'
export { DEFAULT_WORKSPACE_ID, workspaces } from './workspaces.schema'
export {
  companyAliases, companyCommandReceipts,
  companyDuplicateCandidateReviews, companyDuplicateCandidates, companyDuplicateIndexState,
  companyDuplicateMaintenanceWork, companyHistory,
  jobCompanyAssignmentHistory, jobCompanyAssignments, workspaceCompanies,
} from '../modules/company/company.schema'

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
