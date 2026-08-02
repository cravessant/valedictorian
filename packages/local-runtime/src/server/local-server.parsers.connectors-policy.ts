import {
  isPolicyEvidenceTag,
  isPolicySubjectType,
  isActionQueueBucket,
  connectorOverviewListQuerySchema,
  createConnectorInstanceInputSchema,
  triggerConnectorRunInputSchema,
  updateConnectorInstanceInputSchema,
  type CreateConnectorInstanceInput,
  type ConnectorOverviewListQuery,
  type EvaluateApplicationPolicyInput,
  type EvaluateOpportunityPolicyInput,
  type EvaluateRunWindowPolicyInput,
  type PolicyConfigPatch,
  type PolicyEvidenceInput,
  type PolicyEvidenceListInput,
  type ActionQueueListQuery,
  type TriggerConnectorRunInput,
  type UpdateConnectorInstanceInput
} from '@sparxie/sdk'
import {
  readOptionalNullableStringField,
  readOptionalStringField,
  readRecord,
  readStringField,
  localHttpValidationError,
  parseLocalHttpInput,
} from './local-server.http.js'
import {
  setNumberQuery,
  setStringQuery,
} from './local-server.parsers.query-primitives.js'
import { policyConfigPatchViolation } from '../modules/policy/public.js'

export function parseConnectorOverviewListQuery(requestUrl: URL): ConnectorOverviewListQuery {
  const query: Record<string, unknown> = {}
  setStringQuery(requestUrl, 'cursor', (value) => { query.cursor = value })
  setNumberQuery(requestUrl, 'limit', (value) => { query.limit = value })
  setStringQuery(requestUrl, 'enabled', (value) => {
    if (value !== 'true' && value !== 'false') throw localHttpValidationError(`Invalid enabled filter: ${value}`)
    query.enabled = value === 'true'
  })
  setStringQuery(requestUrl, 'severity', (value) => { query.severity = value })
  setStringQuery(requestUrl, 'status', (value) => { query.status = value })
  return parseLocalHttpInput(() => connectorOverviewListQuerySchema.parse(query))
}
export interface ConnectorRunsListQuery {
  connectorInstanceId: string
  status?: string
  mode?: string
  limit?: number
  offset?: number
}

export function parseCreateConnectorInstanceInput(body: unknown): CreateConnectorInstanceInput {
  return parseLocalHttpInput(() => createConnectorInstanceInputSchema.parse(body))
}

export function parseUpdateConnectorInstanceInput(
  connectorInstanceId: string,
  body: unknown,
): UpdateConnectorInstanceInput {
  // Path identity is applied last so a body-supplied connectorInstanceId cannot redirect the update.
  // Non-object bodies reach the schema unchanged: coercing them to `{}` would turn `null` into a
  // connectorInstanceId-only no-op update that still rewrites the instance timestamp.
  const hasObjectBody = typeof body === 'object' && body !== null && !Array.isArray(body)
  return parseLocalHttpInput(() => updateConnectorInstanceInputSchema.parse(
    hasObjectBody ? { ...body, connectorInstanceId } : body,
  ))
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
      throw localHttpValidationError(`Invalid action queue bucket: ${actionBucket}`)
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
): TriggerConnectorRunInput {
  const record = body === undefined || body === null ? {} : readRecord(body)
  return parseLocalHttpInput(() => triggerConnectorRunInputSchema.parse({
    ...record,
    connectorInstanceId,
  }))
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
      throw localHttpValidationError(`Invalid policy subject type: ${subjectType}`)
    }

    query.subjectType = subjectType
  }

  if (tag) {
    if (!isPolicyEvidenceTag(tag)) {
      throw localHttpValidationError(`Invalid policy evidence tag: ${tag}`)
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
  const record = readRecord(body)
  // Authoritative admission: an unknown key OR a known field whose value normalization would
  // discard is a request error here, never a silently unchanged (or default-reset) update.
  const violation = policyConfigPatchViolation(record)
  if (violation !== null) {
    throw localHttpValidationError(violation)
  }
  return record as PolicyConfigPatch
}

export function parsePolicyEvidenceInput(body: unknown): PolicyEvidenceInput {
  const record = readRecord(body)
  const subjectType = readStringField(record, 'subjectType')
  const tag = readStringField(record, 'tag')

  if (!isPolicySubjectType(subjectType)) {
    throw localHttpValidationError(`Invalid policy subject type: ${subjectType}`)
  }

  if (!isPolicyEvidenceTag(tag)) {
    throw localHttpValidationError(`Invalid policy evidence tag: ${tag}`)
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
  const outcome = readOptionalNullableStringField(record, 'outcome')

  if (outcome !== undefined && outcome !== null && !isPursuitApplicationStatus(outcome)) {
    throw localHttpValidationError(`Invalid application outcome: ${outcome}`)
  }

  return {
    applicationId: readStringField(record, 'applicationId'),
    attemptId: readOptionalNullableStringField(record, 'attemptId'),
    outcome,
  }
}

function isPursuitApplicationStatus(
  value: string,
): value is NonNullable<EvaluateApplicationPolicyInput['outcome']> {
  return ['active', 'submitted', 'interviewing', 'offered', 'withdrawn', 'rejected', 'accepted']
    .includes(value)
}

export function parseEvaluateOpportunityPolicyInput(
  body: unknown,
): EvaluateOpportunityPolicyInput {
  const record = readRecord(body)

  return {
    opportunityId: readStringField(record, 'opportunityId'),
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
