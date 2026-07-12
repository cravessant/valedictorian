import {
  isManualSourcingDecisionStatus,
  isSourcingMergeStatus,
  normalizeJobTimingInput,
  type JobTerm,
  type ValedictorianWorkspaceClient,
} from 'sparxie'
import {
  assertKnownOptions,
  assertMutationPatch,
  parseNullableDateStringOption,
  readOption,
  readRequiredArgument,
  readRequiredOption,
  setOptionalStringOption,
  validateLimit,
} from './valedictorian-cli.parser-options.js'

export function parseSourcingFindingsListQuery(
  argv: string[],
): NonNullable<Parameters<ValedictorianWorkspaceClient['sourcing']['findings']['list']>[0]> {
  const query: NonNullable<Parameters<ValedictorianWorkspaceClient['sourcing']['findings']['list']>[0]> = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--workflow-run-id') query.workflowRunId = readRequiredArgument(argv[++index], '--workflow-run-id value')
    else if (token === '--source') query.source = readRequiredArgument(argv[++index], '--source value')
    else if (token === '--source-id') query.sourceId = readRequiredArgument(argv[++index], '--source-id value')
    else if (token === '--merge-status') {
      const status = readRequiredArgument(argv[++index], '--merge-status value')
      if (!isSourcingMergeStatus(status)) throw new Error(`Invalid merge status: ${status}`)
      query.mergeStatus = status
    } else if (token === '--limit') {
      query.limit = Number(readRequiredArgument(argv[++index], '--limit value'))
      validateLimit(query.limit)
    } else if (token === '--offset') query.offset = Number(readRequiredArgument(argv[++index], '--offset value'))
    else if (token !== '--json') throw new Error(`Unknown option: ${token}`)
  }
  return query
}

export function parseSourcingFindingUpdate(
  findingId: string,
  argv: string[],
): Parameters<ValedictorianWorkspaceClient['sourcing']['findings']['update']>[0] {
  assertKnownOptions(argv, [
    '--blocker', '--disposition-reason', '--duplicate-notes', '--end-date', '--json', '--merge-notes',
    '--merge-status', '--policy-blocker', '--start-date', '--term', '--terms-json',
  ])
  const input: Parameters<ValedictorianWorkspaceClient['sourcing']['findings']['update']>[0] = { findingId }
  const mergeStatus = readOption(argv, '--merge-status')
  if (mergeStatus !== undefined) {
    assertWritableSourcingMergeStatus(mergeStatus)
    input.mergeStatus = mergeStatus
  }
  setOptionalStringOption(input, argv, '--term', 'term')
  setOptionalTimingOptions(input, argv)
  setOptionalStringOption(input, argv, '--duplicate-notes', 'duplicateNotes')
  setOptionalStringOption(input, argv, '--blocker', 'blocker')
  setOptionalStringOption(input, argv, '--merge-notes', 'mergeNotes')
  setOptionalStringOption(input, argv, '--policy-blocker', 'policyBlocker')
  setOptionalStringOption(input, argv, '--disposition-reason', 'dispositionReason')
  assertCompatibleDisposition(input)
  assertMutationPatch(input, ['findingId'], 'Sourcing finding update requires at least one field')
  return input
}

export function parseSourcingFindingDecision(
  findingId: string,
  argv: string[],
): Parameters<ValedictorianWorkspaceClient['sourcing']['findings']['decide']>[0] {
  assertKnownOptions(argv, ['--disposition-reason', '--json', '--merge-notes', '--merge-status', '--policy-blocker'])
  const mergeStatus = readRequiredOption(argv, '--merge-status')
  if (!isManualSourcingDecisionStatus(mergeStatus)) throw new Error(`Invalid manual sourcing decision: ${mergeStatus}`)
  const input: Parameters<ValedictorianWorkspaceClient['sourcing']['findings']['decide']>[0] = { findingId, mergeStatus }
  setOptionalStringOption(input, argv, '--merge-notes', 'mergeNotes')
  setOptionalStringOption(input, argv, '--policy-blocker', 'policyBlocker')
  setOptionalStringOption(input, argv, '--disposition-reason', 'dispositionReason')
  return input
}

function setOptionalTimingOptions(
  input: Parameters<ValedictorianWorkspaceClient['sourcing']['findings']['update']>[0],
  argv: string[],
) {
  const termsJson = readOption(argv, '--terms-json')
  const startDate = readOption(argv, '--start-date')
  const endDate = readOption(argv, '--end-date')
  if (termsJson !== undefined) input.terms = parseTermsJsonOption(termsJson)
  if (startDate !== undefined) input.startDate = parseNullableDateStringOption(startDate, 'startDate')
  if (endDate !== undefined) input.endDate = parseNullableDateStringOption(endDate, 'endDate')
  if (input.term !== undefined || input.terms !== undefined || input.startDate !== undefined || input.endDate !== undefined) normalizeJobTimingInput(input)
}

function parseTermsJsonOption(value: string): JobTerm[] {
  const parsed = JSON.parse(value) as unknown
  if (!Array.isArray(parsed)) throw new Error('--terms-json must be a JSON array')
  return parsed as JobTerm[]
}

function assertWritableSourcingMergeStatus(mergeStatus: string): asserts mergeStatus is Exclude<ReturnType<typeof writableStatus>, undefined> {
  if (!isSourcingMergeStatus(mergeStatus)) throw new Error(`Invalid merge status: ${mergeStatus}`)
  if (mergeStatus === 'merged') throw new Error('Sourcing findings can only be marked merged by promotion.')
}

function writableStatus() {
  return undefined as Parameters<ValedictorianWorkspaceClient['sourcing']['findings']['update']>[0]['mergeStatus']
}

function assertCompatibleDisposition(input: { blocker?: string | null; dispositionReason?: string | null; duplicateNotes?: string | null; mergeStatus?: string; policyBlocker?: string | null }) {
  if (input.duplicateNotes !== undefined) throw new Error('--duplicate-notes is generated by duplicate detection; use --disposition-reason or --merge-notes for manual notes.')
  if (input.blocker !== undefined && input.mergeStatus !== 'blocked') throw new Error('--blocker requires --merge-status blocked.')
  if (input.policyBlocker !== undefined && input.mergeStatus !== 'blocked') throw new Error('--policy-blocker requires --merge-status blocked.')
  if (input.dispositionReason !== undefined && (input.mergeStatus === undefined || !isManualSourcingDecisionStatus(input.mergeStatus))) throw new Error('--disposition-reason requires a manual --merge-status.')
}
