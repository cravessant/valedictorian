import { isApplicationAttemptActorType, isApplicationAttemptStepType, isApplicationStatus, isManualReviewKind, type ValedictorianWorkspaceClient } from 'sparxie'
import { readOptionalNullableStringField, readOptionalStringField, readRecord, readStringField } from './local-server.http'
import { hasText, setNumberQuery } from './local-server.parsers.query-primitives'

const attemptBlockerOutcomes = new Set([
  'manual_captcha',
  'security_gate',
  'login_needed',
  'platform_error',
  'closed',
  'not_fit',
  'not_pursued',
])

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
