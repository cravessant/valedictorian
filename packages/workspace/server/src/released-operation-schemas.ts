/**
 * Exact @sparxie/sdk@0.36.0 operation-to-schema migration map.
 *
 * Schema values name immutable entries in released-sdk-schemas.json. Omitted
 * keys are path/workspace correlation fields carried outside the JSON body or
 * query string by the released HTTP client.
 */
export type ReleasedRequestSchema = Readonly<{
  location: 'body' | 'query'
  omit?: readonly string[]
  schema: string
}>

export type ReleasedOperationSchema = Readonly<{
  request?: ReleasedRequestSchema
  response?: string
  responseNullable?: boolean
}>

const body = (schema: string, ...omit: string[]): ReleasedRequestSchema => ({
  location: 'body',
  schema,
  ...(omit.length ? { omit } : {}),
})
const query = (schema: string, ...omit: string[]): ReleasedRequestSchema => ({
  location: 'query',
  schema,
  ...(omit.length ? { omit } : {}),
})
const op = (
  response: string | undefined,
  request?: ReleasedRequestSchema,
  responseNullable = false,
): ReleasedOperationSchema => ({
  ...(request ? { request } : {}),
  ...(response ? { response } : {}),
  ...(responseNullable ? { responseNullable: true } : {}),
})

export const releasedOperationSchemas = {
  'health.get': op('valedictorianHealthSchema'),
  'capabilities.get': op('valedictorianCapabilitiesSchema'),
  'workspaces.list': op('workspaceListResultSchema'),
  'workspaces.open': op('workspaceListItemSchema', body('workspaceOpenInputSchema')),
  'workspaces.create': op('workspaceListItemSchema', body('workspaceCreateInputSchema')),

  'captures.list': op('captureListResultSchema', query('captureListInputSchema')),
  'captures.create': op('captureMutationResultSchema', body('createCaptureInputSchema')),
  'captures.get': op('captureSchema', undefined, true),
  'captures.correct': op('captureMutationResultSchema', body('correctCaptureInputSchema', 'captureId')),
  'captures.remove': op('removalResultSchema', body('removalInputSchema', 'id')),
  'captures.restore': op('restoreResultSchema', body('restoreInputSchema', 'id')),
  'captures.history': op('captureHistoryResultSchema', query('captureHistoryInputSchema', 'id')),
  'captures.promoteToJob': op('promoteCaptureToJobResultSchema', body('promoteCaptureToJobInputSchema', 'captureId')),

  'captureResolution.list': op('captureResolutionListResultSchema', query('captureResolutionListInputSchema')),
  'captureResolution.get': op('captureCompletionDetailSchema'),
  'captureResolution.retry': op('captureProcessingStartResultSchema', body('retryCaptureProcessingInputSchema', 'captureId')),
  'captureResolution.replay': op('captureProcessingStartResultSchema', body('replayCaptureRevisionInputSchema', 'captureId')),
  'captureResolution.correct': op('correctCaptureResolutionResultSchema', body('correctCaptureResolutionInputSchema', 'captureId')),
  'captureResolution.complete': op('completeCaptureManuallyResultSchema', body('completeCaptureManuallyInputSchema', 'captureId')),
  'captureResolutionV2.list': op('captureResolutionListResultV2Schema', query('captureResolutionListInputSchema')),
  'captureResolutionV2.get': op('captureCompletionDetailV2Schema'),
  'captureResolutionV2.complete': op('completeCaptureManuallyV2ResultSchema', body('completeCaptureManuallyV2InputSchema', 'captureId')),

  'jobs.list': op('jobListResultSchema', query('jobListInputSchema')),
  'jobs.create': op('jobMutationResultSchema', body('createJobInputSchema')),
  'jobs.get': op('jobSchema', undefined, true),
  'jobs.correctFacts': op('jobMutationResultSchema', body('correctJobFactsInputSchema', 'jobId')),
  'jobs.updateAvailability': op('jobMutationResultSchema', body('updateJobAvailabilityInputSchema', 'jobId')),
  'jobs.externalIdentities.add': op('jobMutationResultSchema', body('addJobExternalIdentityInputSchema', 'jobId')),
  'jobs.externalIdentities.remove': op('jobMutationResultSchema', body('removeJobExternalIdentityInputSchema', 'jobId')),
  'jobs.remove': op('removalResultSchema', body('removeJobInputSchema', 'id')),
  'jobs.restore': op('restoreResultSchema', body('restoreJobInputSchema', 'id')),
  'jobs.history': op('jobHistoryResultSchema', query('jobHistoryInputSchema', 'id')),
  'jobs.promoteToOpportunity': op('promoteJobToOpportunityResultSchema', body('promoteJobToOpportunityInputSchema', 'jobId')),

  'opportunities.list': op('opportunityListResultSchema', query('opportunityListInputSchema')),
  'opportunities.create': op('opportunityMutationResultSchema', body('createOpportunityInputSchema')),
  'opportunities.get': op('opportunitySchema', undefined, true),
  'opportunities.updateEvaluation': op('opportunityMutationResultSchema', body('updateOpportunityEvaluationInputSchema', 'opportunityId')),
  'opportunities.updateDisposition': op('opportunityMutationResultSchema', body('updateOpportunityDispositionInputSchema', 'opportunityId')),
  'opportunities.remove': op('removalResultSchema', body('removalInputSchema', 'id')),
  'opportunities.restore': op('restoreResultSchema', body('restoreInputSchema', 'id')),
  'opportunities.history': op('opportunityHistoryResultSchema', query('opportunityHistoryInputSchema', 'id')),
  'opportunities.promoteToApplication': op('promoteOpportunityToApplicationResultSchema', body('promoteOpportunityToApplicationInputSchema', 'opportunityId')),

  'applications.list': op('lifecycleApplicationListResultSchema', query('lifecycleApplicationListInputSchema')),
  'applications.create': op('applicationMutationResultSchema', body('createApplicationInputSchema')),
  'applications.get': op('applicationSchema', undefined, true),
  'applications.updateStatus': op('applicationMutationResultSchema', body('updatePursuitApplicationStatusInputSchema', 'applicationId')),
  'applications.updateCompany': op('applicationMutationResultSchema', body('updateApplicationCompanyInputSchema', 'applicationId')),
  'applications.updateSource': op('applicationMutationResultSchema', body('updateApplicationSourceInputSchema', 'applicationId')),
  'applications.links.create': op('applicationMutationResultSchema', body('createPursuitLinkInputSchema', 'applicationId')),
  'applications.links.update': op('applicationMutationResultSchema', body('updatePursuitLinkInputSchema', 'applicationId', 'linkId')),
  'applications.links.remove': op('applicationMutationResultSchema', body('removePursuitLinkInputSchema', 'applicationId', 'linkId')),
  'applications.refreshSnapshot': op('applicationMutationResultSchema', body('refreshApplicationSnapshotInputSchema', 'applicationId')),
  'applications.remove': op('removalResultSchema', body('removalInputSchema', 'id')),
  'applications.restore': op('restoreResultSchema', body('restoreInputSchema', 'id')),
  'applications.history': op('lifecycleApplicationHistoryResultSchema', query('lifecycleApplicationHistoryInputSchema', 'id')),
  'applications.attempts.list': op('applicationAttemptsListResultSchema', query('applicationTechnicalListInputSchema', 'applicationId')),
  'applications.events.list': op('applicationEventsListResultSchema', query('applicationTechnicalListInputSchema', 'applicationId')),

  'companies.directory.list': op('companyDirectoryPageSchema', query('companyDirectoryListInputSchema')),
  'companies.create': op('createCompanyResultSchema', body('createCompanyInputSchema', 'workspaceId')),
  'companies.search': op('companySearchPageSchema', query('companySearchInputSchema')),
  'companies.previewMatches': op('companyMatchPreviewPageSchema', body('companyMatchPreviewInputSchema')),
  'companies.duplicates.list': op('companyDuplicatePageSchema', query('companyDuplicateListInputSchema')),
  'companies.duplicates.get': op('companyDuplicateCandidateRowSchema'),
  'companies.duplicates.markDistinct': op('markCompaniesDistinctResultSchema', body('markCompaniesDistinctInputSchema', 'workspaceId', 'candidateId')),
  'companies.duplicates.merge': op('mergeCompaniesResultSchema', body('mergeCompaniesInputSchema', 'workspaceId')),
  'companies.get': op('companyDetailSchema'),
  'companies.update': op('updateCompanyResultSchema', body('updateCompanyInputSchema', 'workspaceId', 'companyId')),
  'companies.lookup': op('workspaceCompanyLookupSchema'),
  'companies.notes.update': op('updateCompanyNotesResultSchema', body('updateCompanyNotesInputSchema', 'workspaceId', 'companyId')),
  'companies.aliases.add': op('updateCompanyResultSchema', body('addCompanyAliasInputSchema', 'workspaceId', 'companyId')),
  'companies.aliases.update': op('updateCompanyResultSchema', body('updateCompanyAliasInputSchema', 'workspaceId', 'companyId', 'aliasId')),
  'companies.aliases.remove': op('updateCompanyResultSchema', body('removeCompanyAliasInputSchema', 'workspaceId', 'companyId', 'aliasId')),
  'companies.archive': op('archiveCompanyResultSchema', body('archiveCompanyInputSchema', 'workspaceId', 'companyId')),
  'companies.restore': op('restoreCompanyResultSchema', body('restoreCompanyInputSchema', 'workspaceId', 'companyId')),
  'companies.assignedJobs.list': op('companyAssignedJobPageSchema', query('companyAssignedJobListInputSchema')),
  'companies.history.list': op('companyHistoryPageSchema', query('companyHistoryListInputSchema')),
  'companyAssignments.get': op('jobCompanyAssignmentPresentationSchema'),
  'companyAssignments.reassign': op('reassignJobCompanyResultSchema', body('reassignJobCompanyInputSchema', 'workspaceId', 'jobId')),

  'actionQueue.list': op('actionQueueListResultSchema', query('actionQueueListQuerySchema')),
  'receipts.getByIdempotencyKey': op('workspaceReceiptSchema', query('workspaceReceiptLookupSchema')),
  'scores.record': op('scoreRecordSchema', body('scoreInputSchema')),
  'runs.list': op('workflowRunsListResultSchema', query('workflowRunsListInputSchema')),
  'runs.start': op('workflowRunSchema', body('startWorkflowRunInputSchema')),
  'runs.step': op('workflowRunStepSchema', body('createWorkflowRunStepInputSchema', 'workflowRunId')),
  'runs.complete': op('workflowRunSchema', body('completeWorkflowRunInputSchema', 'workflowRunId')),

  'connectors.list': op('connectorInstancesListResultSchema'),
  'connectors.create': op('connectorInstanceSummarySchema', body('createConnectorInstanceInputSchema')),
  'connectors.overview.list': op('connectorOverviewListResultSchema', query('connectorOverviewListQuerySchema')),
  'connectors.inspect': op('connectorStatusSummarySchema'),
  'connectors.update': op('connectorInstanceSummarySchema', body('updateConnectorInstanceInputSchema', 'connectorInstanceId')),
  'connectors.remove': op('connectorRetirementResultSchema', body('removeConnectorInstanceInputSchema', 'connectorInstanceId')),
  'connectors.runs.list': op('connectorRunsListResultSchema', query('connectorRunsListInputSchema', 'connectorInstanceId')),
  'connectors.runs.trigger': op('connectorRunSummarySchema', body('triggerConnectorRunInputSchema', 'connectorInstanceId')),
  'connectors.checkpoints.list': op('connectorCheckpointsListResultSchema', query('connectorCheckpointsListInputSchema', 'connectorInstanceId')),
  'connectors.observations.list': op('connectorObservationsListResultSchema', query('connectorObservationsListInputSchema', 'connectorInstanceId')),
  'connectors.options.query': op('connectorOptionQueryResultSchema', body('connectorOptionQueryBodySchema')),
  'connectors.descriptors.list': op('installedConnectorDescriptorsListResultSchema'),
  'connectors.descriptors.get': op('installedConnectorDescriptorSchema'),
  'connectors.schedules.get': op('connectorScheduleSummarySchema', undefined, true),
  'connectors.schedules.upsert': op('connectorScheduleSummarySchema', body('upsertConnectorScheduleInputSchema', 'connectorInstanceId')),
  'connectors.schedules.delete': op(undefined, body('deleteConnectorScheduleInputSchema', 'connectorInstanceId')),
  'connectors.schedules.pause': op('connectorScheduleSummarySchema', body('pauseConnectorScheduleInputSchema', 'connectorInstanceId')),
  'connectors.schedules.resume': op('connectorScheduleSummarySchema', body('resumeConnectorScheduleInputSchema', 'connectorInstanceId')),
  'connectors.schedules.listAudit': op('connectorScheduleAuditListResultSchema', query('connectorScheduleHistoryListInputSchema', 'connectorInstanceId')),
  'connectors.schedules.listOccurrences': op('connectorScheduleOccurrenceListResultSchema', query('connectorScheduleHistoryListInputSchema', 'connectorInstanceId')),
  'connectors.schedules.dispatchDue': op('dispatchConnectorScheduleDueResultSchema', body('dispatchConnectorScheduleDueInputSchema', 'connectorInstanceId')),

  'policy.config.get': op('policyConfigSchema'),
  'policy.config.update': op('policyConfigSchema', body('policyConfigPatchSchema')),
  'policy.config.reset': op('policyConfigSchema', body('emptyObjectSchema')),
  'policy.evidence.list': op('policyEvidenceListResultSchema', query('policyEvidenceListInputSchema')),
  'policy.evidence.record': op('policyEvidenceRecordSchema', body('policyEvidenceInputSchema')),
  'policy.evaluate.application': op('policyDecisionSchema', body('evaluateApplicationPolicyInputSchema')),
  'policy.evaluate.opportunity': op('policyDecisionSchema', body('evaluateOpportunityPolicyInputSchema')),
  'policy.evaluate.runWindow': op('policyRunWindowDecisionSchema', body('evaluateRunWindowPolicyInputSchema')),

  'profile.get': op('userProfileSchema'),
  'profile.update': op('userProfileSchema', body('profileUpdateInputSchema')),
  'profile.agentContext.get': op('profileAgentContextSchema'),
  'profile.document.get': op('profileDocumentSchema'),
  'profile.document.update': op('profileDocumentSchema', body('profileDocumentUpdateInputSchema')),
  'profile.document.validate': op('profileDocumentValidateResultSchema'),
  'profile.document.format': op('profileDocumentSchema', body('profileDocumentFormatInputSchema')),
  'profile.document.restore': op('profileDocumentSchema', body('profileDocumentRestoreInputSchema')),
  'secrets.list': op('profileSecretsListResultSchema'),
  'secrets.upsert': op('profileSecretSummarySchema', body('upsertProfileSecretInputSchema', 'key')),
  'secrets.delete': op('valedictorianHealthSchema'),
  'secrets.local.resolve': op('localSecretResolutionResultSchema', body('localSecretResolutionInputSchema')),
} as const satisfies Readonly<Record<string, ReleasedOperationSchema>>
