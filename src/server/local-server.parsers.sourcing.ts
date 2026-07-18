import { isManualSourcingDecisionStatus, isRoleKind, isSourcingDestinationClass, isSourcingMergeStatus, isSourcingUsability, isWorkMode, normalizeJobTimingInput, rawSourceRecordsListQueryParamKeys, rawSourceRecordsListQuerySchema, type RawSourceRecordsListQuery, type SourcingFindingsListInput, type ValedictorianWorkspaceClient } from 'sparxie'
import { localHttpValidationError, parseLocalHttpInput, readNumberField, readOptionalNullableStringField, readOptionalNumberField, readOptionalStringField, readRecord, readStringField } from './local-server.http'
import { setNumberQuery, setStringQuery } from './local-server.parsers.query-primitives'
import { readOptionalJobTermsField, readOptionalJobTimingModeField } from './local-server.parsers.job-timing'

export function parseRawSourceRecordsListQuery(requestUrl: URL): RawSourceRecordsListQuery {
  const allowed = new Set<string>(rawSourceRecordsListQueryParamKeys)
  const query: Record<string, unknown> = {}

  for (const key of requestUrl.searchParams.keys()) {
    if (!allowed.has(key)) throw localHttpValidationError(`Invalid raw source list query parameter: ${key}`)
    if (requestUrl.searchParams.getAll(key).length !== 1) {
      throw localHttpValidationError(`Duplicate raw source list query parameter: ${key}`)
    }
  }
  for (const key of rawSourceRecordsListQueryParamKeys) {
    const value = requestUrl.searchParams.get(key)
    if (value === null) continue
    query[key] = key === 'limit' && /^\d+$/.test(value) ? Number(value) : value
  }

  return parseLocalHttpInput(() => rawSourceRecordsListQuerySchema.parse(query))
}

export function parseSourcingFindingsListQuery(requestUrl: URL): SourcingFindingsListInput {
  const query: SourcingFindingsListInput = {}
  const mergeStatus = requestUrl.searchParams.get('mergeStatus')

  if (mergeStatus) {
    if (!isSourcingMergeStatus(mergeStatus)) {
      throw localHttpValidationError(`Invalid sourcing merge status: ${mergeStatus}`)
    }

    query.mergeStatus = mergeStatus
  }

  const destinationClass = requestUrl.searchParams.get('destinationClass')
  if (destinationClass) {
    if (!isSourcingDestinationClass(destinationClass)) {
      throw localHttpValidationError(`Invalid sourcing destination class: ${destinationClass}`)
    }
    query.destinationClass = destinationClass
  }

  const usability = requestUrl.searchParams.get('usability')
  if (usability) {
    if (!isSourcingUsability(usability)) {
      throw localHttpValidationError(`Invalid sourcing usability: ${usability}`)
    }
    query.usability = usability
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


export function parseSourcingFindingCreateInput(
  body: unknown,
): Parameters<ValedictorianWorkspaceClient['sourcing']['findings']['create']>[0] {
  const record = readRecord(body)
  const roleKind = readStringField(record, 'roleKind')
  const workMode = readStringField(record, 'workMode')
  const mergeStatusValue = readOptionalStringField(record, 'mergeStatus')
  let mergeStatus: Parameters<ValedictorianWorkspaceClient['sourcing']['findings']['create']>[0]['mergeStatus']

  if (!isRoleKind(roleKind)) {
    throw localHttpValidationError(`Invalid roleKind: ${roleKind}`)
  }

  if (!isWorkMode(workMode)) {
    throw localHttpValidationError(`Invalid workMode: ${workMode}`)
  }

  if (mergeStatusValue !== undefined) {
    assertWritableSourcingMergeStatus(mergeStatusValue)
    mergeStatus = mergeStatusValue
  }

  const input = {
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
  parseLocalHttpInput(() => normalizeJobTimingInput(input))
  return input
}

export function parseSourcingCandidateProcessInput(
  body: unknown,
): Parameters<ValedictorianWorkspaceClient['sourcing']['candidates']['process']>[0] {
  const record = readRecord(body)
  const roleKind = readStringField(record, 'roleKind')
  const workMode = readStringField(record, 'workMode')

  if (!isRoleKind(roleKind)) {
    throw localHttpValidationError(`Invalid roleKind: ${roleKind}`)
  }

  if (!isWorkMode(workMode)) {
    throw localHttpValidationError(`Invalid workMode: ${workMode}`)
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
    throw localHttpValidationError('Invalid score penalties')
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
    throw localHttpValidationError(`Invalid roleKind: ${roleKind}`)
  }

  if (workMode !== undefined && !isWorkMode(workMode)) {
    throw localHttpValidationError(`Invalid workMode: ${workMode}`)
  }

  if (mergeStatusValue !== undefined) {
    assertWritableSourcingMergeStatus(mergeStatusValue)
    mergeStatus = mergeStatusValue
  }

  if ('duplicateNotes' in record) {
    throw localHttpValidationError('duplicateNotes cannot be supplied manually')
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
    throw localHttpValidationError(`Invalid manual sourcing decision: ${mergeStatus}`)
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
    throw localHttpValidationError(`Invalid sourcing merge status: ${mergeStatus}`)
  }

  if (mergeStatus === 'merged') {
    throw localHttpValidationError('Sourcing findings can only be marked merged by promotion.')
  }
}
