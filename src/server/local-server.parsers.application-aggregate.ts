import { canonicalizeApplicationUrl, isApplicationListSort, isApplicationStatus, isManualReviewKind, isRoleKind, isWorkMode, normalizeApplicationLinkKind, normalizeJobTimingInput, type ApplicationLinkInput, type ApplicationListQuery, type ValedictorianWorkspaceClient, type WorkMode } from 'sparxie'
import { copyOptionalBooleanField, copyOptionalNullableStringField, copyOptionalStringField, localHttpValidationError, parseLocalHttpInput, readOptionalBooleanField, readOptionalNullableStringField, readOptionalStringField, readRecord, readStringField, validateWorkflowTimestampInput } from './local-server.http'
import { setNumberQuery, setStringQuery } from './local-server.parsers.query-primitives'
import { readOptionalJobTermsField, readOptionalJobTimingModeField } from './local-server.parsers.job-timing'

export function parseCreateApplicationInput(
  body: unknown,
): Parameters<ValedictorianWorkspaceClient['applications']['create']>[0] {
  const record = readRecord(body)
  const status = readStringField(body, 'status')
  const roleKind = readStringField(body, 'roleKind')
  const workMode = readStringField(body, 'workMode')

  if (!isApplicationStatus(status)) {
    throw localHttpValidationError(`Invalid application status: ${status}`)
  }

  if (!isRoleKind(roleKind)) {
    throw localHttpValidationError(`Invalid roleKind: ${roleKind}`)
  }

  if (!isWorkMode(workMode)) {
    throw localHttpValidationError(`Invalid workMode: ${workMode}`)
  }

  const primaryLink = readOptionalLinkField(body, 'primaryLink')
  const sourceLink = readOptionalLinkField(body, 'sourceLink')

  if (!primaryLink && !sourceLink) {
    throw localHttpValidationError('Application creation requires a primaryLink or sourceLink')
  }

  const input = {
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
  parseLocalHttpInput(() => normalizeJobTimingInput(input))
  return input
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
    throw localHttpValidationError(`Invalid manualReviewKind: ${JSON.stringify(manualReviewKind)}`)
  }

  return input as unknown as Parameters<ValedictorianWorkspaceClient['applications']['workflow']['update']>[0]
}

export function parseLinkCreateInput(
  applicationId: string,
  body: unknown,
): Parameters<ValedictorianWorkspaceClient['applications']['links']['create']>[0] {
  return {
    applicationId,
    kind: parseLocalHttpInput(() => normalizeApplicationLinkKind(readStringField(body, 'kind'))),
    label: readStringField(body, 'label'),
    url: parseLocalHttpInput(() => canonicalizeApplicationUrl(readStringField(body, 'url'))),
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
    input.kind = parseLocalHttpInput(() => normalizeApplicationLinkKind(readStringField(record, 'kind')))
  }
  copyOptionalStringField(record, input, 'label')
  if ('url' in record) {
    input.url = parseLocalHttpInput(() => canonicalizeApplicationUrl(readStringField(record, 'url')))
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
    kind: parseLocalHttpInput(() => normalizeApplicationLinkKind(readStringField(value, 'kind'))),
    label: readStringField(value, 'label'),
    url: parseLocalHttpInput(() => canonicalizeApplicationUrl(readStringField(value, 'url'))),
    externalId: readOptionalNullableStringField(value, 'externalId'),
  }
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
      throw localHttpValidationError(`Invalid application status: ${status}`)
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
      throw localHttpValidationError(`Invalid application list sort: ${sort}`)
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
