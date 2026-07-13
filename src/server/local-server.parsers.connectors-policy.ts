import {
  isPolicyEvidenceTag,
  isPolicySubjectType,
  isActionQueueBucket,
  canonicalDateOnlySchema,
  connectorOverviewListQuerySchema,
  type CreateConnectorInstanceInput,
  type ConnectorOverviewListQuery,
  type EvaluateApplicationPolicyInput,
  type EvaluateRunWindowPolicyInput,
  type EvaluateSourcingCandidatePolicyInput,
  type PolicyConfigPatch,
  type PolicyEvidenceInput,
  type PolicyEvidenceListInput,
  type ActionQueueListQuery,
  type UpdateConnectorInstanceInput
} from 'sparxie'
import {
  readOptionalBooleanField,
  readOptionalNullableStringField,
  readOptionalNumberField,
  readOptionalStringField,
  readRecord,
  readStringField
} from './local-server.http'


import {
  readBooleanField,
  readOptionalConnectorAuthReferences,
  readOptionalRecordField,
  validateConnectorTimestamp
} from './local-server.parsers.connector-body-primitives'
import {
  setNumberQuery,
  setStringQuery,
} from './local-server.parsers.query-primitives'

const connectorRunModes = new Set(['manual'])

export function parseConnectorOverviewListQuery(requestUrl: URL): ConnectorOverviewListQuery {
  const query: Record<string, unknown> = {}
  setStringQuery(requestUrl, 'cursor', (value) => { query.cursor = value })
  setNumberQuery(requestUrl, 'limit', (value) => { query.limit = value })
  setStringQuery(requestUrl, 'enabled', (value) => {
    if (value !== 'true' && value !== 'false') throw new Error(`Invalid enabled filter: ${value}`)
    query.enabled = value === 'true'
  })
  setStringQuery(requestUrl, 'severity', (value) => { query.severity = value })
  setStringQuery(requestUrl, 'status', (value) => { query.status = value })
  return connectorOverviewListQuerySchema.parse(query)
}
export interface ConnectorRunsListQuery {
  connectorInstanceId: string
  status?: string
  mode?: string
  limit?: number
  offset?: number
}

export interface ConnectorRunTriggerInput {
  connectorInstanceId: string
  mode?: 'manual'
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

  const earliestBackfillDate = readOptionalCanonicalDateOnlyField(record, 'earliestBackfillDate')
  if (earliestBackfillDate !== undefined) {
    input.earliestBackfillDate = earliestBackfillDate
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

  const earliestBackfillDate = readOptionalCanonicalDateOnlyField(record, 'earliestBackfillDate')
  if (earliestBackfillDate !== undefined) {
    input.earliestBackfillDate = earliestBackfillDate
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

function readOptionalCanonicalDateOnlyField(
  record: Record<string, unknown>,
  field: string,
): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(record, field) || record[field] === undefined) {
    return undefined
  }
  const parsed = canonicalDateOnlySchema.safeParse(record[field])
  if (!parsed.success) {
    throw new Error(`Invalid ${field}`)
  }
  return parsed.data
}
