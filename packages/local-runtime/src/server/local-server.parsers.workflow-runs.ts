import { isRunStatus, isRunType, pursuitApplicationStatuses, type ValedictorianWorkspaceClient, type WorkflowRunsListInput } from '@sparxie/sdk'
import { localHttpValidationError, readOptionalNullableStringField, readOptionalStringField, readRecord, readStringField } from './local-server.http.js'
import { setNumberQuery, setStringQuery } from './local-server.parsers.query-primitives.js'

export function parseWorkflowRunsListQuery(requestUrl: URL): WorkflowRunsListInput {
  const query: WorkflowRunsListInput = {}
  const runType = requestUrl.searchParams.get('runType')
  const status = requestUrl.searchParams.get('status')

  if (runType) {
    if (!isRunType(runType)) {
      throw localHttpValidationError(`Invalid runType: ${runType}`)
    }

    query.runType = runType
  }

  if (status) {
    if (!isRunStatus(status)) {
      throw localHttpValidationError(`Invalid run status: ${status}`)
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


export function parseRunStartInput(
  body: unknown,
): Parameters<ValedictorianWorkspaceClient['runs']['start']>[0] {
  const record = readRecord(body)
  const runType = readStringField(record, 'runType')
  const actorType = readStringField(record, 'actorType')

  if (!isRunType(runType)) {
    throw localHttpValidationError(`Invalid runType: ${runType}`)
  }

  if (!isWorkflowActorType(actorType)) {
    throw localHttpValidationError(`Invalid actorType: ${actorType}`)
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
  const outcomeValue = readOptionalNullableStringField(record, 'outcome')
  let status: Parameters<ValedictorianWorkspaceClient['runs']['complete']>[0]['status']

  if (statusValue !== undefined) {
    if (!isRunStatus(statusValue)) {
      throw localHttpValidationError(`Invalid run status: ${statusValue}`)
    }

    status = statusValue
  }

  return {
    workflowRunId,
    status,
    outcome: outcomeValue === undefined || outcomeValue === null
      ? outcomeValue
      : isPursuitApplicationStatus(outcomeValue)
        ? outcomeValue
        : (() => { throw localHttpValidationError(`Invalid application outcome: ${outcomeValue}`) })(),
    summary: readOptionalNullableStringField(record, 'summary'),
    blocker: readOptionalNullableStringField(record, 'blocker'),
    metadata: 'metadata' in record ? record.metadata : undefined,
  }
}

function isWorkflowActorType(value: string): value is 'agent' | 'automation' | 'system' | 'user' {
  return value === 'agent' || value === 'automation' || value === 'system' || value === 'user'
}

function isPursuitApplicationStatus(
  value: string,
): value is (typeof pursuitApplicationStatuses)[number] {
  return (pursuitApplicationStatuses as readonly string[]).includes(value)
}
