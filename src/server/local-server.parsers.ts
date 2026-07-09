import {
  canonicalizeApplicationUrl,
  isApplicationAttemptActorType,
  isApplicationAttemptStepType,
  isApplicationListSort,
  isApplicationStatus,
  isManualReviewKind,
  isJobTimingMode,
  isPolicyEvidenceTag,
  isPolicySubjectType,
  isActionQueueBucket,
  isRoleKind,
  isRunStatus,
  isRunType,
  isManualSourcingDecisionStatus,
  isSourcingMergeStatus,
  isWorkMode,
  connectorAuthModes,
  normalizeApplicationLinkKind,
  type ApplicationLinkInput,
  type ApplicationListQuery,
  type CreateConnectorInstanceInput,
  type EvaluateApplicationPolicyInput,
  type EvaluateRunWindowPolicyInput,
  type EvaluateSourcingCandidatePolicyInput,
  type ValedictorianWorkspaceClient,
  type PolicyConfigPatch,
  type PolicyEvidenceInput,
  type PolicyEvidenceListInput,
  type ActionQueueListQuery,
  type JobTerm,
  type JobTimingMode,
  type SourcingFindingsListInput,
  type UpdateConnectorInstanceInput,
  type WorkflowRunsListInput,
  type WorkMode,
} from 'sparxie'
import {
  copyOptionalBooleanField,
  copyOptionalNullableStringField,
  copyOptionalStringField,
  readNumberField,
  readOptionalBooleanField,
  readOptionalNullableStringField,
  readOptionalNumberField,
  readOptionalStringField,
  readRecord,
  readStringField,
  validateWorkflowTimestampInput,
} from './local-server.http'

const attemptBlockerOutcomes = new Set([
  'manual_captcha',
  'security_gate',
  'login_needed',
  'platform_error',
  'closed',
  'not_fit',
  'not_pursued',
])

const connectorRunModes = new Set(['manual', 'scheduled', 'catch_up'])
const connectorAuthModeSet = new Set(connectorAuthModes)

export interface ConnectorRunsListQuery {
  connectorInstanceId: string
  status?: string
  mode?: string
  limit?: number
  offset?: number
}

export interface ConnectorRunTriggerInput {
  connectorInstanceId: string
  mode?: 'manual' | 'scheduled' | 'catch_up'
  coverageStartedAt?: string | null
  coverageEndedAt?: string | null
  filterSignature?: string | null
  filters?: unknown
  reason?: string | null
  dryRun?: boolean
}

export function parseCreateConnectorInstanceInput(body: unknown): CreateConnectorInstanceInput {
  const record = readRecord(body)
  const input: CreateConnectorInstanceInput = {
    id: readStringField(record, 'id'),
    connectorId: readStringField(record, 'connectorId'),
    connectorVersion: readStringField(record, 'connectorVersion'),
    displayName: readStringField(record, 'displayName'),
    enabled: readBooleanField(record, 'enabled'),
  }
  const auth = readOptionalConnectorAuthReferences(record)
  const config = readOptionalRecordField(record, 'config')
  const filters = readOptionalRecordField(record, 'filters')

  if (auth !== undefined) {
    input.auth = auth
  }

  if (config !== undefined) {
    input.config = config
  }

  if (filters !== undefined) {
    input.filters = filters
  }

  return input
}

export function parseUpdateConnectorInstanceInput(
  connectorInstanceId: string,
  body: unknown,
): UpdateConnectorInstanceInput {
  const record = readRecord(body)
  const input: UpdateConnectorInstanceInput = { connectorInstanceId }
  const connectorVersion = readOptionalStringField(record, 'connectorVersion')
  const displayName = readOptionalStringField(record, 'displayName')
  const enabled = readOptionalBooleanField(record, 'enabled')
  const auth = readOptionalConnectorAuthReferences(record)
  const config = readOptionalRecordField(record, 'config')
  const filters = readOptionalRecordField(record, 'filters')

  if (connectorVersion !== undefined) {
    input.connectorVersion = connectorVersion
  }

  if (displayName !== undefined) {
    input.displayName = displayName
  }

  if (enabled !== undefined) {
    input.enabled = enabled
  }

  if (auth !== undefined) {
    input.auth = auth
  }

  if (config !== undefined) {
    input.config = config
  }

  if (filters !== undefined) {
    input.filters = filters
  }

  return input
}

export interface ConnectorCheckpointsListQuery {
  connectorInstanceId: string
  filterSignature?: string
}

export interface ConnectorObservationsListQuery {
  connectorInstanceId: string
  connectorRunId?: string
  limit?: number
  offset?: number
}

export function parseActionQueueListQuery(requestUrl: URL): ActionQueueListQuery {
  const query: ActionQueueListQuery = {}

  const actionBucket = requestUrl.searchParams.get('actionBucket')

  if (actionBucket) {
    if (!isActionQueueBucket(actionBucket)) {
      throw new Error(`Invalid action queue bucket: ${actionBucket}`)
    }

    query.actionBucket = actionBucket
  }

  setNumberQuery(requestUrl, 'limit', (value) => {
    query.limit = value
  })
  setNumberQuery(requestUrl, 'offset', (value) => {
    query.offset = value
  })

  return query
}

export function parseConnectorRunsListQuery(
  connectorInstanceId: string,
  requestUrl: URL,
): ConnectorRunsListQuery {
  const query: ConnectorRunsListQuery = { connectorInstanceId }

  setStringQuery(requestUrl, 'status', (value) => {
    query.status = value
  })
  setStringQuery(requestUrl, 'mode', (value) => {
    query.mode = value
  })
  setNumberQuery(requestUrl, 'limit', (value) => {
    query.limit = value
  })
  setNumberQuery(requestUrl, 'offset', (value) => {
    query.offset = value
  })

  return query
}

export function parseConnectorRunTriggerInput(
  connectorInstanceId: string,
  body: unknown,
): ConnectorRunTriggerInput {
  const record = readRecord(body)
  const mode = readOptionalStringField(record, 'mode')
  const input: ConnectorRunTriggerInput = {
    connectorInstanceId,
  }

  if (mode !== undefined) {
    if (!connectorRunModes.has(mode)) {
      throw new Error(`Invalid connector run mode: ${mode}`)
    }

    input.mode = mode as ConnectorRunTriggerInput['mode']
  }

  const coverageStartedAt = readOptionalNullableStringField(record, 'coverageStartedAt')
  const coverageEndedAt = readOptionalNullableStringField(record, 'coverageEndedAt')
  const filterSignature = readOptionalNullableStringField(record, 'filterSignature')
  const reason = readOptionalNullableStringField(record, 'reason')
  const dryRun = readOptionalBooleanField(record, 'dryRun')

  if (coverageStartedAt !== undefined) {
    input.coverageStartedAt = coverageStartedAt
  }

  if (coverageEndedAt !== undefined) {
    input.coverageEndedAt = coverageEndedAt
  }

  if (filterSignature !== undefined) {
    input.filterSignature = filterSignature
  }

  if (reason !== undefined) {
    input.reason = reason
  }

  if (dryRun !== undefined) {
    input.dryRun = dryRun
  }

  if ('filters' in record) {
    input.filters = record.filters
  }

  validateConnectorTimestamp(input.coverageStartedAt, 'coverageStartedAt')
  validateConnectorTimestamp(input.coverageEndedAt, 'coverageEndedAt')

  return input
}

export function parseConnectorCheckpointsListQuery(
  connectorInstanceId: string,
  requestUrl: URL,
): ConnectorCheckpointsListQuery {
  const query: ConnectorCheckpointsListQuery = { connectorInstanceId }

  setStringQuery(requestUrl, 'filterSignature', (value) => {
    query.filterSignature = value
  })

  return query
}

export function parseConnectorObservationsListQuery(
  connectorInstanceId: string,
  requestUrl: URL,
): ConnectorObservationsListQuery {
  const query: ConnectorObservationsListQuery = { connectorInstanceId }

  setStringQuery(requestUrl, 'connectorRunId', (value) => {
    query.connectorRunId = value
  })
  setNumberQuery(requestUrl, 'limit', (value) => {
    query.limit = value
  })
  setNumberQuery(requestUrl, 'offset', (value) => {
    query.offset = value
  })

  return query
}

export function parsePolicyEvidenceListQuery(requestUrl: URL): PolicyEvidenceListInput {
  const query: PolicyEvidenceListInput = {}
  const subjectType = requestUrl.searchParams.get('subjectType')
  const tag = requestUrl.searchParams.get('tag')

  if (subjectType) {
    if (!isPolicySubjectType(subjectType)) {
      throw new Error(`Invalid policy subject type: ${subjectType}`)
    }

    query.subjectType = subjectType
  }

  if (tag) {
    if (!isPolicyEvidenceTag(tag)) {
      throw new Error(`Invalid policy evidence tag: ${tag}`)
    }

    query.tag = tag
  }

  setStringQuery(requestUrl, 'subjectId', (value) => {
    query.subjectId = value
  })
  setNumberQuery(requestUrl, 'limit', (value) => {
    query.limit = value
  })
  setNumberQuery(requestUrl, 'offset', (value) => {
    query.offset = value
  })

  return query
}

export function parsePolicyConfigPatch(body: unknown): PolicyConfigPatch {
  return readRecord(body) as PolicyConfigPatch
}

export function parsePolicyEvidenceInput(body: unknown): PolicyEvidenceInput {
  const record = readRecord(body)
  const subjectType = readStringField(record, 'subjectType')
  const tag = readStringField(record, 'tag')

  if (!isPolicySubjectType(subjectType)) {
    throw new Error(`Invalid policy subject type: ${subjectType}`)
  }

  if (!isPolicyEvidenceTag(tag)) {
    throw new Error(`Invalid policy evidence tag: ${tag}`)
  }

  return {
    subjectType,
    subjectId: readStringField(record, 'subjectId'),
    tag,
    source: readOptionalStringField(record, 'source'),
    note: readOptionalNullableStringField(record, 'note'),
    payload: 'payload' in record ? record.payload : undefined,
  }
}

export function parseEvaluateApplicationPolicyInput(
  body: unknown,
): EvaluateApplicationPolicyInput {
  const record = readRecord(body)

  return {
    applicationId: readStringField(record, 'applicationId'),
    attemptId: readOptionalNullableStringField(record, 'attemptId'),
    outcome: readOptionalNullableStringField(record, 'outcome'),
  }
}

export function parseEvaluateSourcingCandidatePolicyInput(
  body: unknown,
): EvaluateSourcingCandidatePolicyInput {
  const record = readRecord(body)

  return {
    findingId: readOptionalNullableStringField(record, 'findingId'),
    companyName: readOptionalNullableStringField(record, 'companyName'),
    roleTitle: readOptionalNullableStringField(record, 'roleTitle'),
    officialUrl: readOptionalNullableStringField(record, 'officialUrl'),
    sourceUrl: readOptionalNullableStringField(record, 'sourceUrl'),
    priorityScore: readOptionalNumberField(record, 'priorityScore'),
  }
}

export function parseEvaluateRunWindowPolicyInput(
  body: unknown,
): EvaluateRunWindowPolicyInput {
  const record = readRecord(body)

  return {
    sourceId: readOptionalNullableStringField(record, 'sourceId'),
    sourceName: readOptionalNullableStringField(record, 'sourceName'),
    now: readOptionalNullableStringField(record, 'now'),
    previousRunCompletedAt: readOptionalNullableStringField(record, 'previousRunCompletedAt'),
    timezone: readOptionalNullableStringField(record, 'timezone'),
  }
}

export function parseWorkflowRunsListQuery(requestUrl: URL): WorkflowRunsListInput {
  const query: WorkflowRunsListInput = {}
  const runType = requestUrl.searchParams.get('runType')
  const status = requestUrl.searchParams.get('status')

  if (runType) {
    if (!isRunType(runType)) {
      throw new Error(`Invalid runType: ${runType}`)
    }

    query.runType = runType
  }

  if (status) {
    if (!isRunStatus(status)) {
      throw new Error(`Invalid run status: ${status}`)
    }

    query.status = status
  }

  setStringQuery(requestUrl, 'source', (value) => {
    query.source = value
  })
  setStringQuery(requestUrl, 'sourceId', (value) => {
    query.sourceId = value
  })
  setStringQuery(requestUrl, 'subjectApplicationId', (value) => {
    query.subjectApplicationId = value
  })
  setNumberQuery(requestUrl, 'limit', (value) => {
    query.limit = value
  })
  setNumberQuery(requestUrl, 'offset', (value) => {
    query.offset = value
  })

  return query
}

export function parseSourcingFindingsListQuery(requestUrl: URL): SourcingFindingsListInput {
  const query: SourcingFindingsListInput = {}
  const mergeStatus = requestUrl.searchParams.get('mergeStatus')

  if (mergeStatus) {
    if (!isSourcingMergeStatus(mergeStatus)) {
      throw new Error(`Invalid sourcing merge status: ${mergeStatus}`)
    }

    query.mergeStatus = mergeStatus
  }

  setStringQuery(requestUrl, 'workflowRunId', (value) => {
    query.workflowRunId = value
  })
  setStringQuery(requestUrl, 'sourceId', (value) => {
    query.sourceId = value
  })
  setStringQuery(requestUrl, 'source', (value) => {
    query.source = value
  })
  setNumberQuery(requestUrl, 'limit', (value) => {
    query.limit = value
  })
  setNumberQuery(requestUrl, 'offset', (value) => {
    query.offset = value
  })

  return query
}

export function parseRunStartInput(
  body: unknown,
): Parameters<ValedictorianWorkspaceClient['runs']['start']>[0] {
  const record = readRecord(body)
  const runType = readStringField(record, 'runType')
  const actorType = readStringField(record, 'actorType')

  if (!isRunType(runType)) {
    throw new Error(`Invalid runType: ${runType}`)
  }

  if (!isApplicationAttemptActorType(actorType)) {
    throw new Error(`Invalid actorType: ${actorType}`)
  }

  return {
    runType,
    actorType,
    actorName: readOptionalNullableStringField(record, 'actorName'),
    sourceId: readOptionalNullableStringField(record, 'sourceId'),
    sourceName: readOptionalNullableStringField(record, 'sourceName'),
    subjectApplicationId: readOptionalNullableStringField(record, 'subjectApplicationId'),
    coverageStartedAt: readOptionalNullableStringField(record, 'coverageStartedAt'),
    coverageEndedAt: readOptionalNullableStringField(record, 'coverageEndedAt'),
    timezone: readOptionalNullableStringField(record, 'timezone'),
    input: 'input' in record ? record.input : undefined,
    summary: readOptionalNullableStringField(record, 'summary'),
    metadata: 'metadata' in record ? record.metadata : undefined,
  }
}

export function parseRunStepInput(
  workflowRunId: string,
  body: unknown,
): Parameters<ValedictorianWorkspaceClient['runs']['step']>[0] {
  const record = readRecord(body)

  return {
    workflowRunId,
    type: readStringField(record, 'type'),
    message: readStringField(record, 'message'),
    payload: 'payload' in record ? record.payload : undefined,
    actor: readOptionalStringField(record, 'actor'),
  }
}

export function parseRunCompleteInput(
  workflowRunId: string,
  body: unknown,
): Parameters<ValedictorianWorkspaceClient['runs']['complete']>[0] {
  const record = readRecord(body)
  const statusValue = readOptionalStringField(record, 'status')
  let status: Parameters<ValedictorianWorkspaceClient['runs']['complete']>[0]['status']

  if (statusValue !== undefined) {
    if (!isRunStatus(statusValue)) {
      throw new Error(`Invalid run status: ${statusValue}`)
    }

    status = statusValue
  }

  return {
    workflowRunId,
    status,
    outcome: readOptionalNullableStringField(record, 'outcome'),
    summary: readOptionalNullableStringField(record, 'summary'),
    blocker: readOptionalNullableStringField(record, 'blocker'),
    metadata: 'metadata' in record ? record.metadata : undefined,
  }
}

export function parseSourcingFindingCreateInput(
  body: unknown,
): Parameters<ValedictorianWorkspaceClient['sourcing']['findings']['create']>[0] {
  const record = readRecord(body)
  const roleKind = readStringField(record, 'roleKind')
  const workMode = readStringField(record, 'workMode')
  const mergeStatusValue = readOptionalStringField(record, 'mergeStatus')
  let mergeStatus: Parameters<ValedictorianWorkspaceClient['sourcing']['findings']['create']>[0]['mergeStatus']

  if (!isRoleKind(roleKind)) {
    throw new Error(`Invalid roleKind: ${roleKind}`)
  }

  if (!isWorkMode(workMode)) {
    throw new Error(`Invalid workMode: ${workMode}`)
  }

  if (mergeStatusValue !== undefined) {
    assertWritableSourcingMergeStatus(mergeStatusValue)
    mergeStatus = mergeStatusValue
  }

  return {
    workflowRunId: readStringField(record, 'workflowRunId'),
    sourceId: readOptionalNullableStringField(record, 'sourceId'),
    sourceName: readOptionalNullableStringField(record, 'sourceName'),
    companyName: readStringField(record, 'companyName'),
    roleTitle: readStringField(record, 'roleTitle'),
    roleKind,
    term: readOptionalNullableStringField(record, 'term'),
    terms: readOptionalJobTermsField(record),
    timingMode: readOptionalJobTimingModeField(record),
    startDate: readOptionalNullableStringField(record, 'startDate'),
    endDate: readOptionalNullableStringField(record, 'endDate'),
    city: readOptionalNullableStringField(record, 'city'),
    region: readOptionalNullableStringField(record, 'region'),
    country: readOptionalStringField(record, 'country'),
    workMode,
    locationRaw: readOptionalNullableStringField(record, 'locationRaw'),
    officialUrl: readOptionalNullableStringField(record, 'officialUrl'),
    sourceUrl: readOptionalNullableStringField(record, 'sourceUrl'),
    postedAge: readOptionalNullableStringField(record, 'postedAge'),
    priorityScore: readOptionalNumberField(record, 'priorityScore'),
    priorityBand: readOptionalNullableStringField(record, 'priorityBand'),
    fitNotes: readOptionalNullableStringField(record, 'fitNotes'),
    duplicateNotes: readOptionalNullableStringField(record, 'duplicateNotes'),
    blocker: readOptionalNullableStringField(record, 'blocker'),
    policyBlocker: readOptionalNullableStringField(record, 'policyBlocker'),
    dispositionReason: readOptionalNullableStringField(record, 'dispositionReason'),
    mergeStatus,
    discoveredAt: readOptionalNullableStringField(record, 'discoveredAt'),
  }
}

export function parseSourcingCandidateProcessInput(
  body: unknown,
): Parameters<ValedictorianWorkspaceClient['sourcing']['candidates']['process']>[0] {
  const record = readRecord(body)
  const roleKind = readStringField(record, 'roleKind')
  const workMode = readStringField(record, 'workMode')

  if (!isRoleKind(roleKind)) {
    throw new Error(`Invalid roleKind: ${roleKind}`)
  }

  if (!isWorkMode(workMode)) {
    throw new Error(`Invalid workMode: ${workMode}`)
  }

  return {
    workflowRunId: readStringField(record, 'workflowRunId'),
    sourceId: readOptionalNullableStringField(record, 'sourceId'),
    sourceName: readOptionalNullableStringField(record, 'sourceName'),
    companyName: readStringField(record, 'companyName'),
    roleTitle: readStringField(record, 'roleTitle'),
    roleKind,
    term: readOptionalNullableStringField(record, 'term'),
    terms: readOptionalJobTermsField(record),
    timingMode: readOptionalJobTimingModeField(record),
    startDate: readOptionalNullableStringField(record, 'startDate'),
    endDate: readOptionalNullableStringField(record, 'endDate'),
    city: readOptionalNullableStringField(record, 'city'),
    region: readOptionalNullableStringField(record, 'region'),
    country: readOptionalStringField(record, 'country'),
    workMode,
    locationRaw: readOptionalNullableStringField(record, 'locationRaw'),
    officialUrl: readOptionalNullableStringField(record, 'officialUrl'),
    sourceUrl: readOptionalNullableStringField(record, 'sourceUrl'),
    postedAge: readOptionalNullableStringField(record, 'postedAge'),
    rawMetadata: 'rawMetadata' in record ? record.rawMetadata : undefined,
    score: parseCandidateScore(record.score),
    cutoffScore: readOptionalNumberField(record, 'cutoffScore'),
  }
}

export function parseCandidateScore(value: unknown) {
  if (value === undefined || value === null) {
    return value
  }

  const record = readRecord(value)
  const penalties = record.penalties

  if (!Array.isArray(penalties) || !penalties.every((penalty) => typeof penalty === 'number')) {
    throw new Error('Invalid score penalties')
  }

  return {
    score: readNumberField(record, 'score'),
    band: readStringField(record, 'band'),
    roleRelevance: readNumberField(record, 'roleRelevance'),
    careerSignal: readNumberField(record, 'careerSignal'),
    cityWorkMode: readNumberField(record, 'cityWorkMode'),
    compensationLogistics: readNumberField(record, 'compensationLogistics'),
    penalties,
    rationale: readStringField(record, 'rationale'),
    rubricVersion: readStringField(record, 'rubricVersion'),
  }
}

export function parseSourcingFindingUpdateInput(
  findingId: string,
  body: unknown,
): Parameters<ValedictorianWorkspaceClient['sourcing']['findings']['update']>[0] {
  const record = readRecord(body)
  const roleKind = readOptionalStringField(record, 'roleKind')
  const workMode = readOptionalStringField(record, 'workMode')
  const mergeStatusValue = readOptionalStringField(record, 'mergeStatus')
  let mergeStatus: Parameters<ValedictorianWorkspaceClient['sourcing']['findings']['update']>[0]['mergeStatus']

  if (roleKind !== undefined && !isRoleKind(roleKind)) {
    throw new Error(`Invalid roleKind: ${roleKind}`)
  }

  if (workMode !== undefined && !isWorkMode(workMode)) {
    throw new Error(`Invalid workMode: ${workMode}`)
  }

  if (mergeStatusValue !== undefined) {
    assertWritableSourcingMergeStatus(mergeStatusValue)
    mergeStatus = mergeStatusValue
  }

  return {
    findingId,
    sourceId: readOptionalNullableStringField(record, 'sourceId'),
    sourceName: readOptionalNullableStringField(record, 'sourceName'),
    companyName: readOptionalStringField(record, 'companyName'),
    roleTitle: readOptionalStringField(record, 'roleTitle'),
    roleKind,
    term: readOptionalNullableStringField(record, 'term'),
    terms: readOptionalJobTermsField(record),
    timingMode: readOptionalJobTimingModeField(record),
    startDate: readOptionalNullableStringField(record, 'startDate'),
    endDate: readOptionalNullableStringField(record, 'endDate'),
    city: readOptionalNullableStringField(record, 'city'),
    region: readOptionalNullableStringField(record, 'region'),
    country: readOptionalStringField(record, 'country'),
    workMode,
    locationRaw: readOptionalNullableStringField(record, 'locationRaw'),
    officialUrl: readOptionalNullableStringField(record, 'officialUrl'),
    sourceUrl: readOptionalNullableStringField(record, 'sourceUrl'),
    postedAge: readOptionalNullableStringField(record, 'postedAge'),
    priorityScore: readOptionalNumberField(record, 'priorityScore'),
    priorityBand: readOptionalNullableStringField(record, 'priorityBand'),
    fitNotes: readOptionalNullableStringField(record, 'fitNotes'),
    duplicateNotes: readOptionalNullableStringField(record, 'duplicateNotes'),
    blocker: readOptionalNullableStringField(record, 'blocker'),
    policyBlocker: readOptionalNullableStringField(record, 'policyBlocker'),
    dispositionReason: readOptionalNullableStringField(record, 'dispositionReason'),
    mergeStatus,
    mergeNotes: readOptionalNullableStringField(record, 'mergeNotes'),
  }
}

export function parseSourcingFindingDecisionInput(
  findingId: string,
  body: unknown,
): Parameters<ValedictorianWorkspaceClient['sourcing']['findings']['decide']>[0] {
  const record = readRecord(body)
  const mergeStatus = readStringField(record, 'mergeStatus')

  if (!isManualSourcingDecisionStatus(mergeStatus)) {
    throw new Error(`Invalid manual sourcing decision: ${mergeStatus}`)
  }

  return {
    findingId,
    mergeStatus,
    mergeNotes: readOptionalNullableStringField(record, 'mergeNotes'),
    policyBlocker: readOptionalNullableStringField(record, 'policyBlocker'),
    dispositionReason: readOptionalNullableStringField(record, 'dispositionReason'),
  }
}

function assertWritableSourcingMergeStatus(
  mergeStatus: string,
): asserts mergeStatus is NonNullable<
  Parameters<ValedictorianWorkspaceClient['sourcing']['findings']['create']>[0]['mergeStatus']
> {
  if (!isSourcingMergeStatus(mergeStatus)) {
    throw new Error(`Invalid sourcing merge status: ${mergeStatus}`)
  }

  if (mergeStatus === 'merged') {
    throw new Error('Sourcing findings can only be marked merged by promotion.')
  }
}

export function parseApplicationEventsQuery(
  applicationId: string,
  requestUrl: URL,
): Parameters<ValedictorianWorkspaceClient['applications']['events']['list']>[0] {
  const query: Parameters<ValedictorianWorkspaceClient['applications']['events']['list']>[0] = {
    applicationId,
  }

  setNumberQuery(requestUrl, 'limit', (value) => {
    query.limit = value
  })
  setNumberQuery(requestUrl, 'offset', (value) => {
    query.offset = value
  })

  return query
}

export function parseApplicationLinksQuery(
  applicationId: string,
  requestUrl: URL,
): Parameters<ValedictorianWorkspaceClient['applications']['links']['list']>[0] {
  const query: Parameters<ValedictorianWorkspaceClient['applications']['links']['list']>[0] = {
    applicationId,
  }

  setNumberQuery(requestUrl, 'limit', (value) => {
    query.limit = value
  })
  setNumberQuery(requestUrl, 'offset', (value) => {
    query.offset = value
  })

  return query
}

export function parseApplicationAttemptsQuery(
  applicationId: string,
  requestUrl: URL,
): Parameters<ValedictorianWorkspaceClient['applications']['attempts']['list']>[0] {
  const query: Parameters<ValedictorianWorkspaceClient['applications']['attempts']['list']>[0] = {
    applicationId,
  }

  setNumberQuery(requestUrl, 'limit', (value) => {
    query.limit = value
  })
  setNumberQuery(requestUrl, 'offset', (value) => {
    query.offset = value
  })

  return query
}

export function parseAttemptStartInput(
  applicationId: string,
  body: unknown,
): Parameters<ValedictorianWorkspaceClient['applications']['attempts']['start']>[0] {
  const actorType = readStringField(body, 'actorType')

  if (!isApplicationAttemptActorType(actorType)) {
    throw new Error(`Invalid actorType: ${actorType}`)
  }

  return {
    applicationId,
    actorType,
    actorName: readOptionalNullableStringField(body, 'actorName'),
    entryUrl: readOptionalNullableStringField(body, 'entryUrl'),
    resumeVariant: readOptionalNullableStringField(body, 'resumeVariant'),
    resumeArtifactPath: readOptionalNullableStringField(body, 'resumeArtifactPath'),
    summary: readOptionalNullableStringField(body, 'summary'),
  }
}

export function parseAttemptStepInput(
  applicationId: string,
  attemptId: string,
  body: unknown,
): Parameters<ValedictorianWorkspaceClient['applications']['attempts']['step']>[0] {
  const record = readRecord(body)
  const type = readStringField(record, 'type')

  if (!isApplicationAttemptStepType(type)) {
    throw new Error(`Invalid attempt step type: ${type}`)
  }

  return {
    applicationId,
    attemptId,
    type,
    message: readStringField(record, 'message'),
    payload: 'payload' in record ? record.payload : undefined,
    actor: readOptionalStringField(record, 'actor'),
  }
}

export function parseAttemptCompleteInput(
  applicationId: string,
  attemptId: string,
  body: unknown,
): Parameters<ValedictorianWorkspaceClient['applications']['attempts']['complete']>[0] {
  const outcome = readStringField(body, 'outcome')

  if (!isApplicationStatus(outcome)) {
    throw new Error(`Invalid application status: ${outcome}`)
  }

  const holdStartedAt = readOptionalNullableStringField(body, 'holdStartedAt')
  const manualReviewKind = readOptionalNullableStringField(body, 'manualReviewKind')
  const missingUserInfo = readOptionalNullableStringField(body, 'missingUserInfo')
  const blockerReason = readOptionalNullableStringField(body, 'blockerReason')

  if (outcome === 'ready_for_review') {
    if (!hasText(holdStartedAt)) {
      throw new Error('holdStartedAt is required for ready_for_review attempts')
    }

    if (!hasText(manualReviewKind)) {
      throw new Error('manualReviewKind is required for ready_for_review attempts')
    }
  }

  if (outcome === 'needs_user_info' && !hasText(missingUserInfo)) {
    throw new Error('missingUserInfo is required for needs_user_info attempts')
  }

  if (attemptBlockerOutcomes.has(outcome) && !hasText(blockerReason)) {
    throw new Error(`blockerReason is required for ${outcome} attempts`)
  }

  if (manualReviewKind !== undefined && manualReviewKind !== null && !isManualReviewKind(manualReviewKind)) {
    throw new Error(`Invalid manualReviewKind: ${manualReviewKind}`)
  }

  return {
    applicationId,
    attemptId,
    outcome,
    summary: readOptionalNullableStringField(body, 'summary'),
    stopReason: readOptionalNullableStringField(body, 'stopReason'),
    confirmationUrl: readOptionalNullableStringField(body, 'confirmationUrl'),
    confirmationText: readOptionalNullableStringField(body, 'confirmationText'),
    holdStartedAt,
    manualReviewKind,
    missingUserInfo,
    blockerReason,
  }
}

export function parseCreateApplicationInput(
  body: unknown,
): Parameters<ValedictorianWorkspaceClient['applications']['create']>[0] {
  const record = readRecord(body)
  const status = readStringField(body, 'status')
  const roleKind = readStringField(body, 'roleKind')
  const workMode = readStringField(body, 'workMode')

  if (!isApplicationStatus(status)) {
    throw new Error(`Invalid application status: ${status}`)
  }

  if (!isRoleKind(roleKind)) {
    throw new Error(`Invalid roleKind: ${roleKind}`)
  }

  if (!isWorkMode(workMode)) {
    throw new Error(`Invalid workMode: ${workMode}`)
  }

  const primaryLink = readOptionalLinkField(body, 'primaryLink')
  const sourceLink = readOptionalLinkField(body, 'sourceLink')

  if (!primaryLink && !sourceLink) {
    throw new Error('Application creation requires a primaryLink or sourceLink')
  }

  return {
    companyName: readStringField(body, 'companyName'),
    roleTitle: readStringField(body, 'roleTitle'),
    sourceName: readStringField(body, 'sourceName'),
    roleKind,
    country: readStringField(body, 'country'),
    workMode,
    status,
    term: readOptionalNullableStringField(body, 'term'),
    terms: readOptionalJobTermsField(record),
    timingMode: readOptionalJobTimingModeField(record),
    startDate: readOptionalNullableStringField(body, 'startDate'),
    endDate: readOptionalNullableStringField(body, 'endDate'),
    city: readOptionalNullableStringField(body, 'city'),
    region: readOptionalNullableStringField(body, 'region'),
    locationRaw: readOptionalNullableStringField(body, 'locationRaw'),
    hasApplied: readOptionalBooleanField(body, 'hasApplied'),
    currentResumeVariant: readOptionalNullableStringField(body, 'currentResumeVariant'),
    primaryLink,
    sourceLink,
    initialNote: readOptionalStringField(body, 'initialNote'),
  }
}

export function parseApplicationUpdateInput(
  applicationId: string,
  body: unknown,
): Parameters<ValedictorianWorkspaceClient['applications']['update']>[0] {
  const record = readRecord(body)
  const input: Record<string, unknown> = { applicationId }

  copyOptionalStringField(record, input, 'roleTitle')
  copyOptionalStringField(record, input, 'roleKind')
  copyOptionalNullableStringField(record, input, 'term')
  copyOptionalJobTermsField(record, input)
  const timingMode = readOptionalJobTimingModeField(record)
  if (timingMode !== undefined) {
    input.timingMode = timingMode
  }
  copyOptionalNullableStringField(record, input, 'startDate')
  copyOptionalNullableStringField(record, input, 'endDate')
  copyOptionalNullableStringField(record, input, 'city')
  copyOptionalNullableStringField(record, input, 'region')
  copyOptionalStringField(record, input, 'country')
  copyOptionalStringField(record, input, 'workMode')
  copyOptionalNullableStringField(record, input, 'locationRaw')
  copyOptionalBooleanField(record, input, 'hasApplied')
  copyOptionalNullableStringField(record, input, 'currentResumeVariant')

  return input as unknown as Parameters<ValedictorianWorkspaceClient['applications']['update']>[0]
}

export function parseWorkflowUpdateInput(
  applicationId: string,
  body: unknown,
): Parameters<ValedictorianWorkspaceClient['applications']['workflow']['update']>[0] {
  const record = readRecord(body)
  const input: Record<string, unknown> = { applicationId }

  copyOptionalNullableStringField(record, input, 'lockStartedAt')
  copyOptionalNullableStringField(record, input, 'holdStartedAt')
  copyOptionalNullableStringField(record, input, 'manualReviewKind')
  copyOptionalNullableStringField(record, input, 'missingUserInfo')
  copyOptionalNullableStringField(record, input, 'blockerReason')

  validateWorkflowTimestampInput(input, 'lockStartedAt')
  validateWorkflowTimestampInput(input, 'holdStartedAt')

  const manualReviewKind = input.manualReviewKind

  if (
    manualReviewKind !== undefined &&
    manualReviewKind !== null &&
    (typeof manualReviewKind !== 'string' || !isManualReviewKind(manualReviewKind))
  ) {
    throw new Error(`Invalid manualReviewKind: ${JSON.stringify(manualReviewKind)}`)
  }

  return input as unknown as Parameters<ValedictorianWorkspaceClient['applications']['workflow']['update']>[0]
}

export function parseLinkCreateInput(
  applicationId: string,
  body: unknown,
): Parameters<ValedictorianWorkspaceClient['applications']['links']['create']>[0] {
  return {
    applicationId,
    kind: normalizeApplicationLinkKind(readStringField(body, 'kind')),
    label: readStringField(body, 'label'),
    url: canonicalizeApplicationUrl(readStringField(body, 'url')),
    externalId: readOptionalNullableStringField(body, 'externalId'),
    isPrimary: readOptionalBooleanField(body, 'isPrimary'),
  }
}

export function parseLinkUpdateInput(
  applicationId: string,
  linkId: string,
  body: unknown,
): Parameters<ValedictorianWorkspaceClient['applications']['links']['update']>[0] {
  const record = readRecord(body)
  const input: Record<string, unknown> = { applicationId, linkId }

  if ('kind' in record) {
    input.kind = normalizeApplicationLinkKind(readStringField(record, 'kind'))
  }
  copyOptionalStringField(record, input, 'label')
  if ('url' in record) {
    input.url = canonicalizeApplicationUrl(readStringField(record, 'url'))
  }
  copyOptionalNullableStringField(record, input, 'externalId')
  copyOptionalBooleanField(record, input, 'isPrimary')
  copyOptionalBooleanField(record, input, 'archived')

  return input as unknown as Parameters<ValedictorianWorkspaceClient['applications']['links']['update']>[0]
}

export function readOptionalLinkField(
  body: unknown,
  field: string,
): ApplicationLinkInput | undefined {
  const record = readRecord(body)
  const value = record[field]

  if (value === undefined) {
    return undefined
  }

  return {
    kind: normalizeApplicationLinkKind(readStringField(value, 'kind')),
    label: readStringField(value, 'label'),
    url: canonicalizeApplicationUrl(readStringField(value, 'url')),
    externalId: readOptionalNullableStringField(value, 'externalId'),
  }
}

function readOptionalJobTermsField(
  record: Record<string, unknown>,
): JobTerm[] | null | undefined {
  if (!('terms' in record)) {
    return undefined
  }

  const value = record.terms
  if (value === null) {
    return null
  }

  if (!Array.isArray(value)) {
    throw new Error('terms must be an array.')
  }

  return value as JobTerm[]
}

function readOptionalJobTimingModeField(
  record: Record<string, unknown>,
): JobTimingMode | undefined {
  const value = readOptionalStringField(record, 'timingMode')
  if (value === undefined) {
    return undefined
  }

  if (!isJobTimingMode(value)) {
    throw new Error(`Invalid timingMode: ${value}`)
  }

  return value
}

function copyOptionalJobTermsField(record: Record<string, unknown>, input: Record<string, unknown>) {
  const value = readOptionalJobTermsField(record)
  if (value !== undefined) {
    input.terms = value
  }
}

export function parseApplicationListQuery(requestUrl: URL): ApplicationListQuery {
  const query: ApplicationListQuery = {}

  setStringQuery(requestUrl, 'priorityBand', (value) => {
    query.priorityBand = value
  })
  setStringQuery(requestUrl, 'company', (value) => {
    query.company = value
  })
  setStringQuery(requestUrl, 'role', (value) => {
    query.role = value
  })
  setStringQuery(requestUrl, 'source', (value) => {
    query.source = value
  })
  setStringQuery(requestUrl, 'search', (value) => {
    query.search = value
  })
  setStringQuery(requestUrl, 'createdFrom', (value) => {
    query.createdFrom = value
  })
  setStringQuery(requestUrl, 'createdTo', (value) => {
    query.createdTo = value
  })
  setStringQuery(requestUrl, 'updatedFrom', (value) => {
    query.updatedFrom = value
  })
  setStringQuery(requestUrl, 'updatedTo', (value) => {
    query.updatedTo = value
  })

  const status = requestUrl.searchParams.get('status')

  if (status) {
    if (!isApplicationStatus(status)) {
      throw new Error(`Invalid application status: ${status}`)
    }

    query.status = status
  }

  const workMode = requestUrl.searchParams.get('workMode')

  if (workMode) {
    query.workMode = workMode as WorkMode
  }

  const sort = requestUrl.searchParams.get('sort')

  if (sort) {
    if (!isApplicationListSort(sort)) {
      throw new Error(`Invalid application list sort: ${sort}`)
    }

    query.sort = sort
  }

  setNumberQuery(requestUrl, 'minScore', (value) => {
    query.minScore = value
  })
  setNumberQuery(requestUrl, 'maxScore', (value) => {
    query.maxScore = value
  })
  setNumberQuery(requestUrl, 'limit', (value) => {
    query.limit = value
  })
  setNumberQuery(requestUrl, 'offset', (value) => {
    query.offset = value
  })

  const hasApplied = requestUrl.searchParams.get('hasApplied')

  if (hasApplied !== null) {
    query.hasApplied = hasApplied === 'true'
  }

  return query
}

export function setStringQuery(requestUrl: URL, key: string, setter: (value: string) => void) {
  const value = requestUrl.searchParams.get(key)

  if (value !== null) {
    setter(value)
  }
}

export function setNumberQuery(requestUrl: URL, key: string, setter: (value: number) => void) {
  const value = requestUrl.searchParams.get(key)

  if (value !== null) {
    setter(Number(value))
  }
}

export function hasText(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().length > 0
}

function readBooleanField(record: Record<string, unknown>, field: string) {
  const value = record[field]

  if (typeof value === 'boolean') {
    return value
  }

  throw new Error(`Missing ${field}`)
}

function readOptionalRecordField(record: Record<string, unknown>, field: string) {
  if (!(field in record)) {
    return undefined
  }

  const value = record[field]

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  throw new Error(`Invalid ${field}`)
}

function readOptionalConnectorAuthReferences(record: Record<string, unknown>) {
  if (!('auth' in record)) {
    return undefined
  }

  const value = record.auth

  if (!Array.isArray(value)) {
    throw new Error('Invalid auth')
  }

  return value.map((entry, index) => {
    const authRecord = readRecord(entry)
    const mode = readStringField(authRecord, 'mode')

    if (!connectorAuthModeSet.has(mode as never)) {
      throw new Error(`Invalid auth[${index}].mode: ${mode}`)
    }

    const reference = {
      id: readStringField(authRecord, 'id'),
      mode: mode as (typeof connectorAuthModes)[number],
    } as {
      id: string
      mode: (typeof connectorAuthModes)[number]
      label?: string | null
      secretKey?: string
      sessionKey?: string
    }
    const label = readOptionalNullableStringField(authRecord, 'label')
    const secretKey = readOptionalStringField(authRecord, 'secretKey')
    const sessionKey = readOptionalStringField(authRecord, 'sessionKey')

    if (label !== undefined) {
      reference.label = label
    }

    if (secretKey !== undefined) {
      reference.secretKey = secretKey
    }

    if (sessionKey !== undefined) {
      reference.sessionKey = sessionKey
    }

    return reference
  })
}

function validateConnectorTimestamp(value: string | null | undefined, fieldName: string) {
  if (value === undefined || value === null) {
    return
  }

  if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(new Date(value).getTime())) {
    throw new Error(`Invalid ${fieldName}: ${value}`)
  }
}
