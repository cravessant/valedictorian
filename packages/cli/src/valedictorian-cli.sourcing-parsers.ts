import {
  isManualSourcingDecisionStatus,
  isJobTimingMode,
  isRoleKind,
  isSourcingMergeStatus,
  isWorkMode,
  normalizeJobTimingInput,
  type JobTerm,
  type ValedictorianWorkspaceClient,
} from 'sparxie'
import {
  assertKnownOptions,
  assertMutationPatch,
  parseNullableApplicationUrlOption,
  parseNullableDateStringOption,
  parseNullableSourceUrlOption,
  parseNullableStringOption,
  parseNullableTimestampOption,
  parseNumberOption,
  readOption,
  readRequiredArgument,
  readRequiredOption,
  readRequiredText,
  setOptionalStringOption,
  validateLimit,
} from './valedictorian-cli.parser-options.js'

export function parseSourcingFindingsListQuery(
  argv: string[],
): NonNullable<Parameters<ValedictorianWorkspaceClient['sourcing']['findings']['list']>[0]> {
  const query: NonNullable<Parameters<ValedictorianWorkspaceClient['sourcing']['findings']['list']>[0]> = {}

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]

    if (token === '--workflow-run-id') {
      query.workflowRunId = readRequiredArgument(argv[index + 1], '--workflow-run-id value')
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

    if (token === '--merge-status') {
      const mergeStatus = readRequiredArgument(argv[index + 1], '--merge-status value')

      if (!isSourcingMergeStatus(mergeStatus)) {
        throw new Error(`Invalid merge status: ${mergeStatus}`)
      }

      query.mergeStatus = mergeStatus
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

export interface ParsedSourcingRun {
  actorName?: string
  autoPromote: boolean
  candidates: Array<Parameters<ValedictorianWorkspaceClient['sourcing']['candidates']['process']>[0]>
  sourceId?: string
  sourceName?: string
}

export function parseSourcingRun(argv: string[]): ParsedSourcingRun {
  const input: ParsedSourcingRun = {
    autoPromote: false,
    candidates: [],
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]

    if (token === '--source-id') {
      input.sourceId = readRequiredArgument(argv[index + 1], '--source-id value')
      index += 1
      continue
    }

    if (token === '--source-name') {
      input.sourceName = readRequiredArgument(argv[index + 1], '--source-name value')
      index += 1
      continue
    }

    if (token === '--actor-name') {
      input.actorName = readRequiredArgument(argv[index + 1], '--actor-name value')
      index += 1
      continue
    }

    if (token === '--auto-promote') {
      input.autoPromote = true
      continue
    }

    if (token === '--candidates-json') {
      input.candidates = parseSourcingCandidatesJson(
        readRequiredArgument(argv[index + 1], '--candidates-json value'),
      )
      index += 1
      continue
    }

    if (token === '--json') {
      continue
    }

    throw new Error(`Unknown option: ${token}`)
  }

  if (!input.sourceId && !input.sourceName) {
    throw new Error('sourcing run requires --source-id or --source-name')
  }

  return input
}

export function parseSourcingCandidatesJson(
  text: string,
): Array<Parameters<ValedictorianWorkspaceClient['sourcing']['candidates']['process']>[0]> {
  const parsed = JSON.parse(text) as unknown

  if (!Array.isArray(parsed)) {
    throw new Error('--candidates-json must be a JSON array')
  }

  return parsed as Array<Parameters<ValedictorianWorkspaceClient['sourcing']['candidates']['process']>[0]>
}

export async function runSourcingBatch(client: ValedictorianWorkspaceClient, input: ParsedSourcingRun) {
  const run = await client.runs.start({
    runType: 'sourcing',
    actorType: 'agent',
    actorName: input.actorName ?? 'codex',
    sourceId: input.sourceId,
    sourceName: input.sourceName,
    summary: 'Started sourcing run.',
    input: {
      autoPromote: input.autoPromote,
      candidateCount: input.candidates.length,
    },
  })
  const findings = []
  let failureCount = 0

  for (const candidate of input.candidates) {
    try {
      findings.push(
        await client.sourcing.candidates.process({
          ...candidate,
          workflowRunId: run.id,
          sourceId: candidate.sourceId ?? input.sourceId,
          sourceName: candidate.sourceName ?? input.sourceName,
        }),
      )
    } catch (error) {
      failureCount += 1
      await client.runs.step({
        workflowRunId: run.id,
        type: 'sourcing_candidate_failed',
        message: errorMessage(error),
        payload: { candidate, error: errorMessage(error) },
        actor: 'agent:sourcing',
      })
    }
  }

  const processedCount = findings.length
  const completed = await client.runs.complete({
    workflowRunId: run.id,
    ...(failureCount > 0
      ? {
          status: 'failed' as const,
          blocker: `${failureCount} sourcing candidates failed.`,
        }
      : {}),
    outcome: `processed_${processedCount}_candidates`,
    summary:
      failureCount > 0
        ? `Processed ${processedCount} sourcing candidates with ${failureCount} failures.`
        : `Processed ${processedCount} sourcing candidates.`,
  })

  return {
    run: completed,
    findings,
    processedCount,
    failureCount,
  }
}

type CreateSourcingFindingInput = Parameters<
  ValedictorianWorkspaceClient['sourcing']['findings']['create']
>[0]

export interface ParsedSourcingFindingImport {
  findings: CreateSourcingFindingInput[]
}

export interface SourcingFindingImportFailure {
  companyName?: string
  index: number
  message: string
  roleTitle?: string
}

export function parseSourcingFindingImportJson(text: string): ParsedSourcingFindingImport {
  const parsed = JSON.parse(text) as unknown
  const { defaults, findings } = readImportEnvelope(parsed)

  return {
    findings: findings.map((finding, index) =>
      normalizeImportFinding(mergeImportFinding(defaults, finding), index),
    ),
  }
}

export async function runSourcingFindingImport(
  client: ValedictorianWorkspaceClient,
  input: ParsedSourcingFindingImport,
) {
  const findings = []
  const failures: SourcingFindingImportFailure[] = []

  for (const [index, finding] of input.findings.entries()) {
    try {
      findings.push(await client.sourcing.findings.create(finding))
    } catch (error) {
      failures.push({
        companyName: finding.companyName,
        index,
        message: errorMessage(error),
        roleTitle: finding.roleTitle,
      })
    }
  }

  return {
    importedCount: findings.length,
    failureCount: failures.length,
    findings,
    failures,
  }
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function setOptionalTimingOptions(
  input: CreateSourcingFindingInput | Parameters<ValedictorianWorkspaceClient['sourcing']['findings']['update']>[0],
  argv: string[],
) {
  const termsJson = readOption(argv, '--terms-json')
  const startDate = readOption(argv, '--start-date')
  const endDate = readOption(argv, '--end-date')

  if (termsJson !== undefined) {
    input.terms = parseTermsJsonOption(termsJson)
  }
  if (startDate !== undefined) {
    input.startDate = parseNullableDateStringOption(startDate, 'startDate')
  }
  if (endDate !== undefined) {
    input.endDate = parseNullableDateStringOption(endDate, 'endDate')
  }

  if (
    input.term !== undefined ||
    input.terms !== undefined ||
    input.startDate !== undefined ||
    input.endDate !== undefined
  ) {
    normalizeJobTimingInput(input)
  }
}

function parseTermsJsonOption(value: string): JobTerm[] {
  const parsed = JSON.parse(value) as unknown
  if (!Array.isArray(parsed)) {
    throw new Error('--terms-json must be a JSON array')
  }

  return parsed as JobTerm[]
}

export function parseSourcingFindingCreate(
  argv: string[],
): Parameters<ValedictorianWorkspaceClient['sourcing']['findings']['create']>[0] {
  assertKnownOptions(argv, [
    '--blocker',
    '--city',
    '--company-name',
    '--country',
    '--discovered-at',
    '--duplicate-notes',
    '--fit-notes',
    '--json',
    '--location-raw',
    '--merge-status',
    '--official-url',
    '--posted-age',
    '--policy-blocker',
    '--priority-band',
    '--priority-score',
    '--region',
    '--role-kind',
    '--role-title',
    '--source-name',
    '--source-url',
    '--term',
    '--terms-json',
    '--start-date',
    '--end-date',
    '--work-mode',
    '--workflow-run-id',
    '--disposition-reason',
  ])
  const roleKind = readRequiredOption(argv, '--role-kind')
  const workMode = readRequiredOption(argv, '--work-mode')

  if (!isRoleKind(roleKind)) {
    throw new Error(`Invalid roleKind: ${roleKind}`)
  }

  if (!isWorkMode(workMode)) {
    throw new Error(`Invalid workMode: ${workMode}`)
  }

  const input = {
    workflowRunId: readRequiredOption(argv, '--workflow-run-id'),
  } as Parameters<ValedictorianWorkspaceClient['sourcing']['findings']['create']>[0]
  const sourceName = readOption(argv, '--source-name')
  const country = readOption(argv, '--country')
  const officialUrl = readOption(argv, '--official-url')
  const sourceUrl = readOption(argv, '--source-url')
  const priorityScore = readOption(argv, '--priority-score')
  const priorityBand = readOption(argv, '--priority-band')
  const mergeStatus = readOption(argv, '--merge-status')
  const discoveredAt = readOption(argv, '--discovered-at')

  if (sourceName !== undefined) {
    input.sourceName = parseNullableStringOption(sourceName, 'sourceName')
  }

  input.companyName = readRequiredOption(argv, '--company-name')
  input.roleTitle = readRequiredOption(argv, '--role-title')
  input.roleKind = roleKind

  setOptionalStringOption(input, argv, '--term', 'term')
  setOptionalTimingOptions(input, argv)
  setOptionalStringOption(input, argv, '--city', 'city')
  setOptionalStringOption(input, argv, '--region', 'region')

  if (country !== undefined) {
    input.country = readRequiredText(country, 'country')
  }

  input.workMode = workMode
  setOptionalStringOption(input, argv, '--location-raw', 'locationRaw')

  if (officialUrl !== undefined) {
    input.officialUrl = parseNullableApplicationUrlOption(officialUrl, 'officialUrl')
  }

  if (sourceUrl !== undefined) {
    input.sourceUrl = parseNullableSourceUrlOption(sourceUrl, 'sourceUrl')
  }

  setOptionalStringOption(input, argv, '--posted-age', 'postedAge')

  if (priorityScore !== undefined) {
    input.priorityScore = parseNumberOption(priorityScore, '--priority-score')
  }

  if (priorityBand !== undefined) {
    input.priorityBand = parseNullableStringOption(priorityBand, 'priorityBand')
  }

  setOptionalStringOption(input, argv, '--fit-notes', 'fitNotes')
  setOptionalStringOption(input, argv, '--duplicate-notes', 'duplicateNotes')
  setOptionalStringOption(input, argv, '--blocker', 'blocker')
  setOptionalStringOption(input, argv, '--policy-blocker', 'policyBlocker')
  setOptionalStringOption(input, argv, '--disposition-reason', 'dispositionReason')

  if (mergeStatus !== undefined) {
    assertWritableSourcingMergeStatus(mergeStatus)
    input.mergeStatus = mergeStatus
  }

  assertCompatibleSourcingDispositionFields(input)

  if (discoveredAt !== undefined) {
    input.discoveredAt = parseNullableTimestampOption(discoveredAt, 'discoveredAt')
  }

  return input
}

export function parseSourcingFindingUpdate(
  findingId: string,
  argv: string[],
): Parameters<ValedictorianWorkspaceClient['sourcing']['findings']['update']>[0] {
  assertKnownOptions(argv, [
    '--blocker',
    '--duplicate-notes',
    '--disposition-reason',
    '--json',
    '--merge-notes',
    '--merge-status',
    '--policy-blocker',
    '--term',
    '--terms-json',
    '--start-date',
    '--end-date',
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

  assertCompatibleSourcingDispositionFields(input)
  assertMutationPatch(input, ['findingId'], 'Sourcing finding update requires at least one field')

  return input
}

function assertWritableSourcingMergeStatus(
  mergeStatus: string,
): asserts mergeStatus is NonNullable<
  Parameters<ValedictorianWorkspaceClient['sourcing']['findings']['create']>[0]['mergeStatus']
> {
  if (!isSourcingMergeStatus(mergeStatus)) {
    throw new Error(`Invalid merge status: ${mergeStatus}`)
  }

  if (mergeStatus === 'merged') {
    throw new Error('Sourcing findings can only be marked merged by promotion.')
  }
}

function assertCompatibleSourcingDispositionFields(input: {
  blocker?: string | null
  dispositionReason?: string | null
  duplicateNotes?: string | null
  mergeStatus?: string
  policyBlocker?: string | null
}) {
  if (input.duplicateNotes !== undefined) {
    throw new Error(
      '--duplicate-notes is generated by duplicate detection; use --disposition-reason or --merge-notes for manual notes.',
    )
  }

  if (input.blocker !== undefined && input.mergeStatus !== 'blocked') {
    throw new Error('--blocker requires --merge-status blocked.')
  }

  if (input.policyBlocker !== undefined && input.mergeStatus !== 'blocked') {
    throw new Error('--policy-blocker requires --merge-status blocked.')
  }

  if (
    input.dispositionReason !== undefined &&
    (input.mergeStatus === undefined || !isManualSourcingDecisionStatus(input.mergeStatus))
  ) {
    throw new Error('--disposition-reason requires a manual --merge-status.')
  }
}

function readImportEnvelope(value: unknown): {
  defaults: Partial<CreateSourcingFindingInput>
  findings: unknown[]
} {
  if (Array.isArray(value)) {
    return { defaults: {}, findings: value }
  }

  if (!isRecord(value)) {
    throw new Error('--input-json must contain a JSON array or an object with a findings array')
  }

  const findings = value.findings

  if (!Array.isArray(findings)) {
    throw new Error('--input-json object requires a findings array')
  }

  return {
    defaults: value.defaults === undefined ? {} : normalizeImportDefaults(value.defaults),
    findings,
  }
}

function normalizeImportDefaults(value: unknown): Partial<CreateSourcingFindingInput> {
  if (!isRecord(value)) {
    throw new Error('--input-json defaults must be an object')
  }

  return normalizeImportFinding(value, -1, { partial: true })
}

function mergeImportFinding(
  defaults: Partial<CreateSourcingFindingInput>,
  finding: unknown,
): unknown {
  if (!isRecord(finding)) {
    return finding
  }

  return {
    ...defaults,
    ...finding,
  }
}

function normalizeImportFinding(
  value: unknown,
  index: number,
  options: { partial?: boolean } = {},
): CreateSourcingFindingInput {
  const label = index >= 0 ? `finding at index ${index}` : 'defaults'

  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`)
  }

  const input = {} as CreateSourcingFindingInput

  assignStringField(input, value, 'workflowRunId', label, { required: !options.partial })
  assignNullableStringField(input, value, 'sourceId', label)
  assignNullableStringField(input, value, 'sourceName', label)
  assignStringField(input, value, 'companyName', label, { required: !options.partial })
  assignStringField(input, value, 'roleTitle', label, { required: !options.partial })
  assignStringField(input, value, 'roleKind', label, { required: !options.partial })
  assignNullableStringField(input, value, 'term', label)
  assignJobTermsField(input, value, label)
  assignTimingModeField(input, value, label)
  assignNullableDateField(input, value, 'startDate', label)
  assignNullableDateField(input, value, 'endDate', label)
  assignNullableStringField(input, value, 'city', label)
  assignNullableStringField(input, value, 'region', label)
  assignStringField(input, value, 'country', label)
  assignStringField(input, value, 'workMode', label, { required: !options.partial })
  assignNullableStringField(input, value, 'locationRaw', label)
  assignNullableStringField(input, value, 'postedAge', label)
  assignNullableStringField(input, value, 'priorityBand', label)
  assignNullableStringField(input, value, 'fitNotes', label)
  assignNullableStringField(input, value, 'duplicateNotes', label)
  assignNullableStringField(input, value, 'blocker', label)
  assignNullableStringField(input, value, 'policyBlocker', label)
  assignNullableStringField(input, value, 'dispositionReason', label)

  if ('officialUrl' in value) {
    input.officialUrl =
      value.officialUrl === null
        ? null
        : parseNullableApplicationUrlOption(
            readStringValue(value.officialUrl, `${label}.officialUrl`),
            'officialUrl',
          )
  }

  if ('sourceUrl' in value) {
    input.sourceUrl =
      value.sourceUrl === null
        ? null
        : parseNullableSourceUrlOption(readStringValue(value.sourceUrl, `${label}.sourceUrl`), 'sourceUrl')
  }

  if ('priorityScore' in value) {
    input.priorityScore =
      value.priorityScore === null ? null : readNumberValue(value.priorityScore, `${label}.priorityScore`)
  }

  if ('mergeStatus' in value) {
    const mergeStatus =
      value.mergeStatus === null ? null : readStringValue(value.mergeStatus, `${label}.mergeStatus`)

    if (mergeStatus !== null) {
      assertWritableSourcingMergeStatus(mergeStatus)
      input.mergeStatus = mergeStatus
    }
  }

  if ('discoveredAt' in value) {
    input.discoveredAt =
      value.discoveredAt === null
        ? null
        : parseNullableTimestampOption(
            readStringValue(value.discoveredAt, `${label}.discoveredAt`),
            'discoveredAt',
          )
  }

  if (input.roleKind !== undefined && !isRoleKind(input.roleKind)) {
    throw new Error(`Invalid roleKind for ${label}: ${input.roleKind}`)
  }

  if (input.workMode !== undefined && !isWorkMode(input.workMode)) {
    throw new Error(`Invalid workMode for ${label}: ${input.workMode}`)
  }

  if (
    input.term !== undefined ||
    input.terms !== undefined ||
    input.startDate !== undefined ||
    input.endDate !== undefined
  ) {
    normalizeJobTimingInput(input)
  }

  assertCompatibleSourcingDispositionFields(input)

  return input
}

function assignStringField(
  input: CreateSourcingFindingInput,
  record: Record<string, unknown>,
  fieldName: keyof CreateSourcingFindingInput,
  label: string,
  options: { required?: boolean } = {},
) {
  if (!(fieldName in record)) {
    if (options.required) {
      throw new Error(`${label}.${String(fieldName)} is required`)
    }

    return
  }

  ;(input as unknown as Record<string, unknown>)[fieldName] = readStringValue(
    record[fieldName],
    `${label}.${String(fieldName)}`,
  )
}

function assignNullableStringField(
  input: CreateSourcingFindingInput,
  record: Record<string, unknown>,
  fieldName: keyof CreateSourcingFindingInput,
  label: string,
) {
  if (!(fieldName in record)) {
    return
  }

  ;(input as unknown as Record<string, unknown>)[fieldName] =
    record[fieldName] === null
      ? null
      : parseNullableStringOption(
          readStringValue(record[fieldName], `${label}.${String(fieldName)}`),
          String(fieldName),
        )
}

function assignJobTermsField(
  input: CreateSourcingFindingInput,
  record: Record<string, unknown>,
  label: string,
) {
  if (!('terms' in record)) {
    return
  }

  const value = record.terms
  if (value === null) {
    input.terms = null
    return
  }

  if (!Array.isArray(value)) {
    throw new Error(`${label}.terms must be an array`)
  }

  input.terms = value as JobTerm[]
}

function assignTimingModeField(
  input: CreateSourcingFindingInput,
  record: Record<string, unknown>,
  label: string,
) {
  if (!('timingMode' in record)) {
    return
  }

  const value = record.timingMode
  if (value === null) {
    return
  }

  const timingMode = readStringValue(value, `${label}.timingMode`)
  if (!isJobTimingMode(timingMode)) {
    throw new Error(`Invalid timingMode for ${label}: ${timingMode}`)
  }

  input.timingMode = timingMode
}

function assignNullableDateField(
  input: CreateSourcingFindingInput,
  record: Record<string, unknown>,
  fieldName: 'startDate' | 'endDate',
  label: string,
) {
  if (!(fieldName in record)) {
    return
  }

  input[fieldName] =
    record[fieldName] === null
      ? null
      : parseNullableDateStringOption(
          readStringValue(record[fieldName], `${label}.${fieldName}`),
          fieldName,
        )
}

function readStringValue(value: unknown, label: string) {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string`)
  }

  return value
}

function readNumberValue(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`)
  }

  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseSourcingFindingDecision(
  findingId: string,
  argv: string[],
): Parameters<ValedictorianWorkspaceClient['sourcing']['findings']['decide']>[0] {
  assertKnownOptions(argv, [
    '--disposition-reason',
    '--json',
    '--merge-notes',
    '--merge-status',
    '--policy-blocker',
  ])
  const mergeStatus = readRequiredOption(argv, '--merge-status')

  if (!isManualSourcingDecisionStatus(mergeStatus)) {
    throw new Error(`Invalid manual sourcing decision: ${mergeStatus}`)
  }

  const input: Parameters<ValedictorianWorkspaceClient['sourcing']['findings']['decide']>[0] = {
    findingId,
    mergeStatus,
  }

  setOptionalStringOption(input, argv, '--merge-notes', 'mergeNotes')
  setOptionalStringOption(input, argv, '--policy-blocker', 'policyBlocker')
  setOptionalStringOption(input, argv, '--disposition-reason', 'dispositionReason')

  return input
}
