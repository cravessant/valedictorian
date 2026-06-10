import {
  isRoleKind,
  isSourcingMergeStatus,
  isWorkMode,
  type ValedictorianClient,
} from 'sparxie'
import {
  assertKnownOptions,
  assertMutationPatch,
  parseNullableApplicationUrlOption,
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
): NonNullable<Parameters<ValedictorianClient['sourcing']['findings']['list']>[0]> {
  const query: NonNullable<Parameters<ValedictorianClient['sourcing']['findings']['list']>[0]> = {}

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
  candidates: Array<Parameters<ValedictorianClient['sourcing']['candidates']['process']>[0]>
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
): Array<Parameters<ValedictorianClient['sourcing']['candidates']['process']>[0]> {
  const parsed = JSON.parse(text) as unknown

  if (!Array.isArray(parsed)) {
    throw new Error('--candidates-json must be a JSON array')
  }

  return parsed as Array<Parameters<ValedictorianClient['sourcing']['candidates']['process']>[0]>
}

export async function runSourcingBatch(client: ValedictorianClient, input: ParsedSourcingRun) {
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

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function parseSourcingFindingCreate(
  argv: string[],
): Parameters<ValedictorianClient['sourcing']['findings']['create']>[0] {
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
    '--priority-band',
    '--priority-score',
    '--region',
    '--role-kind',
    '--role-title',
    '--source-name',
    '--source-url',
    '--term',
    '--work-mode',
    '--workflow-run-id',
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
  } as Parameters<ValedictorianClient['sourcing']['findings']['create']>[0]
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
    input.sourceUrl = parseNullableApplicationUrlOption(sourceUrl, 'sourceUrl')
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

  if (mergeStatus !== undefined) {
    if (!isSourcingMergeStatus(mergeStatus)) {
      throw new Error(`Invalid merge status: ${mergeStatus}`)
    }

    input.mergeStatus = mergeStatus
  }

  if (discoveredAt !== undefined) {
    input.discoveredAt = parseNullableTimestampOption(discoveredAt, 'discoveredAt')
  }

  return input
}

export function parseSourcingFindingUpdate(
  findingId: string,
  argv: string[],
): Parameters<ValedictorianClient['sourcing']['findings']['update']>[0] {
  assertKnownOptions(argv, [
    '--blocker',
    '--duplicate-notes',
    '--json',
    '--merge-notes',
    '--merge-status',
  ])
  const input: Parameters<ValedictorianClient['sourcing']['findings']['update']>[0] = { findingId }
  const mergeStatus = readOption(argv, '--merge-status')

  if (mergeStatus !== undefined) {
    if (!isSourcingMergeStatus(mergeStatus)) {
      throw new Error(`Invalid merge status: ${mergeStatus}`)
    }

    input.mergeStatus = mergeStatus
  }

  setOptionalStringOption(input, argv, '--duplicate-notes', 'duplicateNotes')
  setOptionalStringOption(input, argv, '--blocker', 'blocker')
  setOptionalStringOption(input, argv, '--merge-notes', 'mergeNotes')

  assertMutationPatch(input, ['findingId'], 'Sourcing finding update requires at least one field')

  return input
}
