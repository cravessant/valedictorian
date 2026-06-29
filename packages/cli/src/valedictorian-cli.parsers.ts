import {
  canonicalizeApplicationUrl,
  isApplicationAttemptActorType,
  isApplicationAttemptStepType,
  isApplicationListSort,
  isApplicationStatus,
  isManualReviewKind,
  isActionQueueBucket,
  isRoleKind,
  isRunStatus,
  isRunType,
  isWorkMode,
  normalizeApplicationLinkKind,
  type ApplicationListQuery,
  type ValedictorianWorkspaceClient,
  type ActionQueueListQuery,
} from 'sparxie'
import {
  assertKnownOptions,
  assertMutationPatch,
  hasFlag,
  hasTextValue,
  parseDateOption,
  parseNullableStringOption,
  parseNullableTimestampOption,
  readOption,
  readOptionalText,
  readRequiredArgument,
  readRequiredOption,
  readRequiredText,
  setOptionalBooleanOption,
  setOptionalStringOption,
  validateLimit,
} from './valedictorian-cli.parser-options.js'

export {
  assertKnownOptions,
  hasFlag,
  parseNullableStringOption,
  readOption,
  readOptionalText,
  readRequiredArgument,
  readRequiredOption,
  readRequiredText,
} from './valedictorian-cli.parser-options.js'
export {
  parseSourcingFindingCreate,
  parseSourcingFindingDecision,
  parseSourcingFindingImportJson,
  parseSourcingFindingsListQuery,
  parseSourcingFindingUpdate,
  parseSourcingRun,
  runSourcingFindingImport,
  runSourcingBatch,
} from './valedictorian-cli.sourcing-parsers.js'

const attemptBlockerOutcomes = new Set([
  'manual_captcha',
  'security_gate',
  'login_needed',
  'platform_error',
  'closed',
  'not_fit',
  'not_pursued',
])

export function parseCreateApplication(argv: string[]): Parameters<ValedictorianWorkspaceClient['applications']['create']>[0] {
  assertKnownOptions(argv, [
    '--city',
    '--company-name',
    '--country',
    '--current-resume-variant',
    '--has-applied',
    '--initial-note',
    '--json',
    '--location-raw',
    '--primary-external-id',
    '--primary-kind',
    '--primary-label',
    '--primary-url',
    '--region',
    '--role-kind',
    '--role-title',
    '--source-external-id',
    '--source-kind',
    '--source-label',
    '--source-link-url',
    '--source-name',
    '--status',
    '--term',
    '--work-mode',
  ])
  const status = readRequiredOption(argv, '--status')

  if (!isApplicationStatus(status)) {
    throw new Error(`Invalid application status: ${status}`)
  }

  const roleKind = readRequiredOption(argv, '--role-kind')
  const workMode = readRequiredOption(argv, '--work-mode')

  if (!isRoleKind(roleKind)) {
    throw new Error(`Invalid roleKind: ${roleKind}`)
  }

  if (!isWorkMode(workMode)) {
    throw new Error(`Invalid workMode: ${workMode}`)
  }

  const input: Parameters<ValedictorianWorkspaceClient['applications']['create']>[0] = {
    companyName: readRequiredOption(argv, '--company-name'),
    roleTitle: readRequiredOption(argv, '--role-title'),
    sourceName: readRequiredOption(argv, '--source-name'),
    roleKind,
    country: readRequiredOption(argv, '--country'),
    workMode,
    status,
  }

  setOptionalStringOption(input, argv, '--term', 'term')
  setOptionalStringOption(input, argv, '--city', 'city')
  setOptionalStringOption(input, argv, '--region', 'region')
  setOptionalStringOption(input, argv, '--location-raw', 'locationRaw')
  setOptionalBooleanOption(input, argv, '--has-applied', 'hasApplied')
  setOptionalStringOption(input, argv, '--current-resume-variant', 'currentResumeVariant')

  const primaryUrl = readOption(argv, '--primary-url')

  if (primaryUrl) {
    input.primaryLink = {
      kind: normalizeApplicationLinkKind(readOption(argv, '--primary-kind') ?? 'official'),
      label: readOptionalText(readOption(argv, '--primary-label'), 'link label') ?? 'official',
      url: canonicalizeApplicationUrl(primaryUrl),
      externalId: readOption(argv, '--primary-external-id'),
    }
  }

  const sourceUrl = readOption(argv, '--source-link-url')

  if (sourceUrl) {
    input.sourceLink = {
      kind: normalizeApplicationLinkKind(readOption(argv, '--source-kind') ?? 'source'),
      label: readOptionalText(readOption(argv, '--source-label'), 'link label') ?? 'source',
      url: canonicalizeApplicationUrl(sourceUrl),
      externalId: readOption(argv, '--source-external-id'),
    }
  }

  if (!input.primaryLink && !input.sourceLink) {
    throw new Error('Application creation requires a primaryLink or sourceLink')
  }

  setOptionalStringOption(input, argv, '--initial-note', 'initialNote')

  return input
}

export function parseUpdateApplication(
  applicationId: string,
  argv: string[],
): Parameters<ValedictorianWorkspaceClient['applications']['update']>[0] {
  assertKnownOptions(argv, [
    '--city',
    '--country',
    '--current-resume-variant',
    '--has-applied',
    '--json',
    '--location-raw',
    '--region',
    '--role-kind',
    '--role-title',
    '--term',
    '--work-mode',
  ])
  const input: Parameters<ValedictorianWorkspaceClient['applications']['update']>[0] = { applicationId }

  setOptionalStringOption(input, argv, '--role-title', 'roleTitle')
  setOptionalStringOption(input, argv, '--role-kind', 'roleKind')
  setOptionalStringOption(input, argv, '--term', 'term')
  setOptionalStringOption(input, argv, '--city', 'city')
  setOptionalStringOption(input, argv, '--region', 'region')
  setOptionalStringOption(input, argv, '--country', 'country')
  setOptionalStringOption(input, argv, '--work-mode', 'workMode')
  setOptionalStringOption(input, argv, '--location-raw', 'locationRaw')
  setOptionalBooleanOption(input, argv, '--has-applied', 'hasApplied')
  setOptionalStringOption(input, argv, '--current-resume-variant', 'currentResumeVariant')

  if (input.roleKind !== undefined && !isRoleKind(input.roleKind)) {
    throw new Error(`Invalid roleKind: ${input.roleKind}`)
  }

  if (input.workMode !== undefined && !isWorkMode(input.workMode)) {
    throw new Error(`Invalid workMode: ${input.workMode}`)
  }

  assertMutationPatch(input, ['applicationId'], 'Application metadata update requires at least one field')

  return input
}

export function parseWorkflowUpdate(
  applicationId: string,
  argv: string[],
): Parameters<ValedictorianWorkspaceClient['applications']['workflow']['update']>[0] {
  assertKnownOptions(argv, [
    '--blocker-reason',
    '--hold-started-at',
    '--json',
    '--lock-started-at',
    '--manual-review-kind',
    '--missing-user-info',
  ])
  const input: Parameters<ValedictorianWorkspaceClient['applications']['workflow']['update']>[0] = {
    applicationId,
  }
  const lockStartedAt = readOption(argv, '--lock-started-at')
  const holdStartedAt = readOption(argv, '--hold-started-at')
  const manualReviewKind = readOption(argv, '--manual-review-kind')
  const missingUserInfo = readOption(argv, '--missing-user-info')
  const blockerReason = readOption(argv, '--blocker-reason')

  if (lockStartedAt !== undefined) {
    input.lockStartedAt = parseNullableTimestampOption(lockStartedAt, 'lockStartedAt')
  }

  if (holdStartedAt !== undefined) {
    input.holdStartedAt = parseNullableTimestampOption(holdStartedAt, 'holdStartedAt')
  }

  if (manualReviewKind !== undefined) {
    const parsedManualReviewKind = parseNullableStringOption(manualReviewKind, 'manualReviewKind')

    if (parsedManualReviewKind !== null && !isManualReviewKind(parsedManualReviewKind)) {
      throw new Error(`Invalid manualReviewKind: ${parsedManualReviewKind}`)
    }

    input.manualReviewKind = parsedManualReviewKind as typeof input.manualReviewKind
  }

  if (missingUserInfo !== undefined) {
    input.missingUserInfo = parseNullableStringOption(missingUserInfo, 'missingUserInfo')
  }

  if (blockerReason !== undefined) {
    input.blockerReason = parseNullableStringOption(blockerReason, 'blockerReason')
  }

  assertMutationPatch(input, ['applicationId'], 'Workflow update requires at least one field')

  return input
}

export function parseCreateApplicationLink(
  applicationId: string,
  argv: string[],
): Parameters<ValedictorianWorkspaceClient['applications']['links']['create']>[0] {
  assertKnownOptions(argv, ['--external-id', '--json', '--kind', '--label', '--primary', '--url'])

  return {
    applicationId,
    kind: normalizeApplicationLinkKind(readRequiredOption(argv, '--kind')),
    label: readRequiredOption(argv, '--label'),
    url: canonicalizeApplicationUrl(readRequiredOption(argv, '--url')),
    externalId: readOption(argv, '--external-id'),
    ...(hasFlag(argv, '--primary') ? { isPrimary: true } : {}),
  }
}

export function parseUpdateApplicationLink(
  applicationId: string,
  linkId: string,
  argv: string[],
): Parameters<ValedictorianWorkspaceClient['applications']['links']['update']>[0] {
  assertKnownOptions(argv, [
    '--archive',
    '--archived',
    '--external-id',
    '--json',
    '--kind',
    '--label',
    '--primary',
    '--url',
  ])
  const input: Parameters<ValedictorianWorkspaceClient['applications']['links']['update']>[0] = {
    applicationId,
    linkId,
  }

  const kind = readOption(argv, '--kind')
  const url = readOption(argv, '--url')

  if (kind !== undefined) {
    input.kind = normalizeApplicationLinkKind(kind)
  }

  setOptionalStringOption(input, argv, '--label', 'label')

  if (url !== undefined) {
    input.url = canonicalizeApplicationUrl(url)
  }

  setOptionalStringOption(input, argv, '--external-id', 'externalId')

  if (hasFlag(argv, '--primary')) {
    input.isPrimary = true
  }

  if (hasFlag(argv, '--archive')) {
    input.archived = true
  }

  setOptionalBooleanOption(input, argv, '--archived', 'archived')

  assertMutationPatch(
    input,
    ['applicationId', 'linkId'],
    'Application link update requires at least one field',
  )

  return input
}

export function parseApplicationEventsQuery(
  applicationId: string,
  argv: string[],
): Parameters<ValedictorianWorkspaceClient['applications']['events']['list']>[0] {
  assertKnownOptions(argv, ['--json', '--limit', '--offset'])
  const query: Parameters<ValedictorianWorkspaceClient['applications']['events']['list']>[0] = { applicationId }
  const limit = readOption(argv, '--limit')
  const offset = readOption(argv, '--offset')

  if (limit !== undefined) {
    query.limit = Number(limit)
    validateLimit(query.limit)
  }

  if (offset !== undefined) {
    query.offset = Number(offset)
  }

  return query
}

export function parseApplicationAttemptsQuery(
  applicationId: string,
  argv: string[],
): Parameters<ValedictorianWorkspaceClient['applications']['attempts']['list']>[0] {
  assertKnownOptions(argv, ['--json', '--limit', '--offset'])
  const query: Parameters<ValedictorianWorkspaceClient['applications']['attempts']['list']>[0] = { applicationId }
  const limit = readOption(argv, '--limit')
  const offset = readOption(argv, '--offset')

  if (limit !== undefined) {
    query.limit = Number(limit)
    validateLimit(query.limit)
  }

  if (offset !== undefined) {
    query.offset = Number(offset)
  }

  return query
}

export function parseAttemptStart(
  applicationId: string,
  argv: string[],
): Parameters<ValedictorianWorkspaceClient['applications']['attempts']['start']>[0] {
  assertKnownOptions(argv, [
    '--actor-name',
    '--actor-type',
    '--entry-url',
    '--json',
    '--resume-artifact-path',
    '--resume-variant',
    '--summary',
  ])
  const actorType = readRequiredOption(argv, '--actor-type')

  if (!isApplicationAttemptActorType(actorType)) {
    throw new Error(`Invalid actorType: ${actorType}`)
  }

  const input: Parameters<ValedictorianWorkspaceClient['applications']['attempts']['start']>[0] = {
    applicationId,
    actorType,
  }

  setOptionalStringOption(input, argv, '--actor-name', 'actorName')
  setOptionalStringOption(input, argv, '--entry-url', 'entryUrl')
  setOptionalStringOption(input, argv, '--resume-variant', 'resumeVariant')
  setOptionalStringOption(input, argv, '--resume-artifact-path', 'resumeArtifactPath')
  setOptionalStringOption(input, argv, '--summary', 'summary')

  return input
}

export function parseAttemptStep(
  applicationId: string,
  attemptId: string,
  argv: string[],
): Parameters<ValedictorianWorkspaceClient['applications']['attempts']['step']>[0] {
  assertKnownOptions(argv, ['--actor', '--json', '--message', '--payload-json', '--type'])
  const type = readRequiredOption(argv, '--type')

  if (!isApplicationAttemptStepType(type)) {
    throw new Error(`Invalid attempt step type: ${type}`)
  }

  const input: Parameters<ValedictorianWorkspaceClient['applications']['attempts']['step']>[0] = {
    applicationId,
    attemptId,
    type,
    message: readRequiredText(readOption(argv, '--message'), 'attempt step message'),
  }

  setOptionalStringOption(input, argv, '--actor', 'actor')

  const payloadJson = readOption(argv, '--payload-json')

  if (payloadJson !== undefined) {
    input.payload = JSON.parse(payloadJson) as unknown
  }

  return input
}

export function parseAttemptComplete(
  applicationId: string,
  attemptId: string,
  argv: string[],
): Parameters<ValedictorianWorkspaceClient['applications']['attempts']['complete']>[0] {
  assertKnownOptions(argv, [
    '--blocker-reason',
    '--confirmation-text',
    '--confirmation-url',
    '--hold-started-at',
    '--json',
    '--manual-review-kind',
    '--missing-user-info',
    '--outcome',
    '--stop-reason',
    '--summary',
  ])
  const outcome = readRequiredOption(argv, '--outcome')

  if (!isApplicationStatus(outcome)) {
    throw new Error(`Invalid application status: ${outcome}`)
  }

  const input: Parameters<ValedictorianWorkspaceClient['applications']['attempts']['complete']>[0] = {
    applicationId,
    attemptId,
    outcome,
  }

  setOptionalStringOption(input, argv, '--summary', 'summary')
  setOptionalStringOption(input, argv, '--stop-reason', 'stopReason')
  setOptionalStringOption(input, argv, '--confirmation-url', 'confirmationUrl')
  setOptionalStringOption(input, argv, '--confirmation-text', 'confirmationText')
  setOptionalStringOption(input, argv, '--missing-user-info', 'missingUserInfo')
  setOptionalStringOption(input, argv, '--blocker-reason', 'blockerReason')

  const holdStartedAt = readOption(argv, '--hold-started-at')
  const manualReviewKind = readOption(argv, '--manual-review-kind')

  if (holdStartedAt !== undefined) {
    input.holdStartedAt = parseNullableTimestampOption(holdStartedAt, 'holdStartedAt')
  }

  if (manualReviewKind !== undefined) {
    const parsedManualReviewKind = parseNullableStringOption(manualReviewKind, 'manualReviewKind')

    if (parsedManualReviewKind !== null && !isManualReviewKind(parsedManualReviewKind)) {
      throw new Error(`Invalid manualReviewKind: ${parsedManualReviewKind}`)
    }

    input.manualReviewKind = parsedManualReviewKind as typeof input.manualReviewKind
  }

  if (outcome === 'ready_for_review') {
    if (!hasTextValue(input.holdStartedAt)) {
      throw new Error('holdStartedAt is required for ready_for_review attempts')
    }

    if (!hasTextValue(input.manualReviewKind)) {
      throw new Error('manualReviewKind is required for ready_for_review attempts')
    }
  }

  if (outcome === 'needs_user_info' && !hasTextValue(input.missingUserInfo)) {
    throw new Error('missingUserInfo is required for needs_user_info attempts')
  }

  if (attemptBlockerOutcomes.has(outcome) && !hasTextValue(input.blockerReason)) {
    throw new Error(`blockerReason is required for ${outcome} attempts`)
  }

  return input
}

export function parseActionQueueListQuery(argv: string[]): ActionQueueListQuery {
  const query: ActionQueueListQuery = {}

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]

    if (token === '--action-bucket') {
      const actionBucket = readRequiredArgument(argv[index + 1], '--action-bucket value')

      if (!isActionQueueBucket(actionBucket)) {
        throw new Error(`Invalid action queue bucket: ${actionBucket}`)
      }

      query.actionBucket = actionBucket
      index += 1
      continue
    }

    if (token === '--limit') {
      query.limit = Number(readRequiredArgument(argv[index + 1], '--limit value'))
      validateLimit(query.limit)
      index += 1
      continue
    }

    if (token === '--offset') {
      query.offset = Number(readRequiredArgument(argv[index + 1], '--offset value'))
      index += 1
      continue
    }

    if (token === '--json') {
      continue
    }

    throw new Error(`Unknown option: ${token}`)
  }

  return query
}

export function parseWorkflowRunsListQuery(argv: string[]): NonNullable<Parameters<ValedictorianWorkspaceClient['runs']['list']>[0]> {
  const query: NonNullable<Parameters<ValedictorianWorkspaceClient['runs']['list']>[0]> = {}

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]

    if (token === '--run-type') {
      const runType = readRequiredArgument(argv[index + 1], '--run-type value')

      if (!isRunType(runType)) {
        throw new Error(`Invalid run type: ${runType}`)
      }

      query.runType = runType
      index += 1
      continue
    }

    if (token === '--status') {
      const status = readRequiredArgument(argv[index + 1], '--status value')

      if (!isRunStatus(status)) {
        throw new Error(`Invalid run status: ${status}`)
      }

      query.status = status
      index += 1
      continue
    }

    if (token === '--source') {
      query.source = readRequiredArgument(argv[index + 1], '--source value')
      index += 1
      continue
    }

    if (token === '--source-id') {
      query.sourceId = readRequiredArgument(argv[index + 1], '--source-id value')
      index += 1
      continue
    }

    if (token === '--subject-application-id') {
      query.subjectApplicationId = readRequiredArgument(
        argv[index + 1],
        '--subject-application-id value',
      )
      index += 1
      continue
    }

    if (token === '--limit') {
      query.limit = Number(readRequiredArgument(argv[index + 1], '--limit value'))
      validateLimit(query.limit)
      index += 1
      continue
    }

    if (token === '--offset') {
      query.offset = Number(readRequiredArgument(argv[index + 1], '--offset value'))
      index += 1
      continue
    }

    if (token === '--json') {
      continue
    }

    throw new Error(`Unknown option: ${token}`)
  }

  return query
}

export function parseRunStart(argv: string[]): Parameters<ValedictorianWorkspaceClient['runs']['start']>[0] {
  assertKnownOptions(argv, [
    '--actor-name',
    '--actor-type',
    '--coverage-ended-at',
    '--coverage-started-at',
    '--input-json',
    '--json',
    '--metadata-json',
    '--run-type',
    '--source-id',
    '--source-name',
    '--subject-application-id',
    '--summary',
    '--timezone',
  ])
  const runType = readRequiredOption(argv, '--run-type')
  const actorType = readRequiredOption(argv, '--actor-type')

  if (!isRunType(runType)) {
    throw new Error(`Invalid run type: ${runType}`)
  }

  if (!isApplicationAttemptActorType(actorType)) {
    throw new Error(`Invalid actorType: ${actorType}`)
  }

  const input: Parameters<ValedictorianWorkspaceClient['runs']['start']>[0] = {
    runType,
    actorType,
  }

  setOptionalStringOption(input, argv, '--actor-name', 'actorName')
  setOptionalStringOption(input, argv, '--source-id', 'sourceId')
  setOptionalStringOption(input, argv, '--source-name', 'sourceName')
  setOptionalStringOption(input, argv, '--subject-application-id', 'subjectApplicationId')
  setOptionalStringOption(input, argv, '--timezone', 'timezone')
  setOptionalStringOption(input, argv, '--summary', 'summary')

  const coverageStartedAt = readOption(argv, '--coverage-started-at')
  const coverageEndedAt = readOption(argv, '--coverage-ended-at')
  const inputJson = readOption(argv, '--input-json')
  const metadataJson = readOption(argv, '--metadata-json')

  if (coverageStartedAt !== undefined) {
    input.coverageStartedAt = parseNullableTimestampOption(coverageStartedAt, 'coverageStartedAt')
  }

  if (coverageEndedAt !== undefined) {
    input.coverageEndedAt = parseNullableTimestampOption(coverageEndedAt, 'coverageEndedAt')
  }

  if (inputJson !== undefined) {
    input.input = JSON.parse(inputJson) as unknown
  }

  if (metadataJson !== undefined) {
    input.metadata = JSON.parse(metadataJson) as unknown
  }

  return input
}

export function parseRunStep(
  workflowRunId: string,
  argv: string[],
): Parameters<ValedictorianWorkspaceClient['runs']['step']>[0] {
  assertKnownOptions(argv, ['--actor', '--json', '--message', '--payload-json', '--type'])
  const input: Parameters<ValedictorianWorkspaceClient['runs']['step']>[0] = {
    workflowRunId,
    type: readRequiredOption(argv, '--type'),
    message: readRequiredText(readOption(argv, '--message'), 'run step message'),
  }

  setOptionalStringOption(input, argv, '--actor', 'actor')

  const payloadJson = readOption(argv, '--payload-json')

  if (payloadJson !== undefined) {
    input.payload = JSON.parse(payloadJson) as unknown
  }

  return input
}

export function parseRunComplete(
  workflowRunId: string,
  argv: string[],
): Parameters<ValedictorianWorkspaceClient['runs']['complete']>[0] {
  assertKnownOptions(argv, [
    '--blocker',
    '--json',
    '--metadata-json',
    '--outcome',
    '--status',
    '--summary',
  ])
  const input: Parameters<ValedictorianWorkspaceClient['runs']['complete']>[0] = { workflowRunId }
  const status = readOption(argv, '--status')
  const metadataJson = readOption(argv, '--metadata-json')

  if (status !== undefined) {
    if (!isRunStatus(status)) {
      throw new Error(`Invalid run status: ${status}`)
    }

    input.status = status
  }

  setOptionalStringOption(input, argv, '--outcome', 'outcome')
  setOptionalStringOption(input, argv, '--summary', 'summary')
  setOptionalStringOption(input, argv, '--blocker', 'blocker')

  if (metadataJson !== undefined) {
    input.metadata = JSON.parse(metadataJson) as unknown
  }

  return input
}


export function parseApplicationListQuery(argv: string[]): ApplicationListQuery {
  const query: ApplicationListQuery = {}

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]

    if (token === '--limit') {
      query.limit = Number(readRequiredArgument(argv[index + 1], '--limit value'))
      validateLimit(query.limit)
      index += 1
      continue
    }

    if (token === '--offset') {
      query.offset = Number(readRequiredArgument(argv[index + 1], '--offset value'))
      index += 1
      continue
    }

    if (token === '--status') {
      const status = readRequiredArgument(argv[index + 1], '--status value')

      if (!isApplicationStatus(status)) {
        throw new Error(`Invalid application status: ${status}`)
      }

      query.status = status
      index += 1
      continue
    }

    if (token === '--min-score') {
      query.minScore = Number(readRequiredArgument(argv[index + 1], '--min-score value'))
      index += 1
      continue
    }

    if (token === '--source') {
      query.source = readRequiredArgument(argv[index + 1], '--source value')
      index += 1
      continue
    }

    if (token === '--company') {
      query.company = readRequiredArgument(argv[index + 1], '--company value')
      index += 1
      continue
    }

    if (token === '--role') {
      query.role = readRequiredArgument(argv[index + 1], '--role value')
      index += 1
      continue
    }

    if (token === '--name') {
      throw new Error(
        'The --name filter was removed. Use --search for broad text search or --role for role titles.',
      )
    }

    if (token === '--priority-band') {
      query.priorityBand = readRequiredArgument(argv[index + 1], '--priority-band value')
      index += 1
      continue
    }

    if (token === '--max-score') {
      query.maxScore = Number(readRequiredArgument(argv[index + 1], '--max-score value'))
      index += 1
      continue
    }

    if (token === '--work-mode') {
      query.workMode = readRequiredArgument(
        argv[index + 1],
        '--work-mode value',
      ) as ApplicationListQuery['workMode']
      index += 1
      continue
    }

    if (token === '--search') {
      query.search = readRequiredArgument(argv[index + 1], '--search value')
      index += 1
      continue
    }

    if (token === '--has-applied') {
      query.hasApplied = readRequiredArgument(argv[index + 1], '--has-applied value') === 'true'
      index += 1
      continue
    }

    if (token === '--sort') {
      const sort = readRequiredArgument(argv[index + 1], '--sort value')

      if (!isApplicationListSort(sort)) {
        throw new Error(`Invalid application list sort: ${sort}`)
      }

      query.sort = sort
      index += 1
      continue
    }

    if (token === '--created-from') {
      query.createdFrom = parseDateOption(token, argv[index + 1], 'start')
      index += 1
      continue
    }

    if (token === '--created-to') {
      query.createdTo = parseDateOption(token, argv[index + 1], 'end')
      index += 1
      continue
    }

    if (token === '--updated-from') {
      query.updatedFrom = parseDateOption(token, argv[index + 1], 'start')
      index += 1
      continue
    }

    if (token === '--updated-to') {
      query.updatedTo = parseDateOption(token, argv[index + 1], 'end')
      index += 1
      continue
    }

    if (token === '--json') {
      continue
    }

    throw new Error(`Unknown option: ${token}`)
  }

  return query
}
