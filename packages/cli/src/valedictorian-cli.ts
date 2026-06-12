import fs from 'node:fs'
import {
  buildApplication,
  buildCommand,
  buildRouteMap,
  type CommandBuilderArguments,
  type CommandContext,
  type CommandFunction,
  type StricliProcess,
} from '@stricli/core'
import {
  createHttpValedictorianClient,
  defaultValedictorianApiBaseUrl,
  isApplicationStatus,
  type ValedictorianClient,
} from 'sparxie'

import {
  parseApplicationAttemptsQuery,
  parseApplicationEventsQuery,
  parseApplicationListQuery,
  parseAttemptComplete,
  parseAttemptStart,
  parseAttemptStep,
  parseCreateApplication,
  parseCreateApplicationLink,
  parseQueueListQuery,
  parseRunComplete,
  parseRunStart,
  parseRunStep,
  parseSourcingFindingCreate,
  parseSourcingFindingsListQuery,
  parseSourcingFindingUpdate,
  parseSourcingRun,
  parseUpdateApplication,
  parseUpdateApplicationLink,
  parseWorkflowRunsListQuery,
  parseWorkflowUpdate,
  readOptionalText,
  readRequiredText,
  runSourcingBatch,
} from './valedictorian-cli.parsers.js'

export interface RunValedictorianCliOptions {
  argv: string[]
  env?: Record<string, string | undefined>
  stdout?: (value: string) => void
  stderr?: (value: string) => void
}

interface ValedictorianCliContext extends CommandContext {
  readonly client: ValedictorianClient
}

export async function runValedictorianCli({
  argv,
  env = process.env,
  stdout = (value) => process.stdout.write(value),
  stderr = (value) => process.stderr.write(value),
}: RunValedictorianCliOptions): Promise<number> {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv
  const processLike: StricliProcess = {
    env: definedEnv(env),
    stdout: { write: stdout },
    stderr: { write: stderr },
  }
  const context: ValedictorianCliContext = {
    client: createClient(env),
    process: processLike,
  }

  await runValedictorianApp(normalizedArgv, context)

  const exitCode = Number(processLike.exitCode ?? 0)
  return exitCode < 0 ? 1 : exitCode
}

function createClient(env: Record<string, string | undefined>): ValedictorianClient {
  return createHttpValedictorianClient({
    baseUrl: env.VALEDICTORIAN_API_URL ?? defaultValedictorianApiBaseUrl,
    token: env.VALEDICTORIAN_API_TOKEN,
  })
}

const stringParser = (input: string) => input

const jsonFlag = {
  brief: 'Accepted for compatibility; output is always JSON.',
  hidden: true,
  kind: 'boolean',
  optional: true,
} as const

const application = buildApplication(
  buildRouteMap({
    docs: { brief: 'Valedictorian resources' },
    routes: {
      applications: buildApplicationsRoute(),
      queue: buildRouteMap({
        docs: { brief: 'Inspect application queues' },
        routes: {
          list: makeCommand({
            docs: { brief: 'List queue items' },
            flags: optionFlags(['bucket', 'limit', 'offset']),
            run: async (context, flags) => {
              writeJson(context, await context.client.queue.list(parseQueueListQuery(toArgv(flags))))
            },
          }),
        },
      }),
      runs: buildRunsRoute(),
      scores: buildRouteMap({
        docs: { brief: 'Record application scores' },
        routes: {
          record: makeCommand({
            docs: { brief: 'Record an application score' },
            flags: {
              ...optionFlags([], [
                'score',
                'band',
                'role-relevance',
                'career-signal',
                'city-work-mode',
                'compensation-logistics',
                'rationale',
              ]),
              ...optionFlags(['rubric-version']),
            },
            positionalCount: 1,
            run: async (context, flags, applicationId) => {
              await context.client.scores.record({
                applicationId,
                score: Number(requiredOption(flags, 'score', '--score value')),
                band: requiredOption(flags, 'band', '--band value'),
                roleRelevance: Number(requiredOption(flags, 'role-relevance', '--role-relevance value')),
                careerSignal: Number(requiredOption(flags, 'career-signal', '--career-signal value')),
                cityWorkMode: Number(requiredOption(flags, 'city-work-mode', '--city-work-mode value')),
                compensationLogistics: Number(
                  requiredOption(flags, 'compensation-logistics', '--compensation-logistics value'),
                ),
                penalties: [],
                rationale: requiredOption(flags, 'rationale', '--rationale value'),
                rubricVersion: optionValue(flags, 'rubric-version') ?? 'valedictorian-cli',
              })

              writeJson(context, { ok: true }, false)
            },
          }),
        },
      }),
      sourcing: buildSourcingRoute(),
    },
  }),
  {
    name: 'valedictorian-cli',
    scanner: { allowArgumentEscapeSequence: true },
    documentation: { disableAnsiColor: true, onlyRequiredInUsageLine: true },
    versionInfo: { getCurrentVersion: readPackageVersion },
  },
)

async function runValedictorianApp(argv: string[], context: ValedictorianCliContext) {
  const { run } = await import('@stricli/core')
  await run(application, argv, context)
}

function buildApplicationsRoute() {
  return buildRouteMap({
    docs: { brief: 'Manage applications' },
    routes: {
      archive: makeCommand({
        docs: { brief: 'Archive an application' },
        flags: optionFlags(['note']),
        positionalCount: 1,
        run: async (context, flags, applicationId) => {
          await context.client.applications.archive({
            applicationId,
            note: readOptionalText(optionValue(flags, 'note'), 'archive note'),
          })

          writeJson(context, { ok: true })
        },
      }),
      attempts: buildApplicationAttemptsRoute(),
      create: makeCommand({
        docs: { brief: 'Create an application' },
        flags: {
          ...optionFlags([
            'city',
            'current-resume-variant',
            'has-applied',
            'initial-note',
            'location-raw',
            'primary-external-id',
            'primary-kind',
            'primary-label',
            'primary-url',
            'region',
            'source-external-id',
            'source-kind',
            'source-label',
            'source-link-url',
            'term',
          ]),
          ...optionFlags([], [
            'company-name',
            'country',
            'role-kind',
            'role-title',
            'source-name',
            'status',
            'work-mode',
          ]),
        },
        run: async (context, flags) => {
          writeJson(context, await context.client.applications.create(parseCreateApplication(toArgv(flags))))
        },
      }),
      events: makeCommand({
        docs: { brief: 'List application events' },
        flags: optionFlags(['limit', 'offset']),
        positionalCount: 1,
        run: async (context, flags, applicationId) => {
          writeJson(
            context,
            await context.client.applications.events.list(
              parseApplicationEventsQuery(applicationId, toArgv(flags)),
            ),
          )
        },
      }),
      get: makeCommand({
        docs: { brief: 'Get application details' },
        positionalCount: 1,
        run: async (context, _flags, applicationId) => {
          const applicationDetail = await context.client.applications.get(applicationId)

          if (!applicationDetail) {
            throw new Error(`Application not found: ${applicationId}`)
          }

          writeJson(context, applicationDetail)
        },
      }),
      link: buildApplicationLinksRoute(),
      list: makeCommand({
        docs: { brief: 'List applications' },
        flags: optionFlags([
          'company',
          'created-from',
          'created-to',
          'has-applied',
          'limit',
          'max-score',
          'min-score',
          'name',
          'offset',
          'priority-band',
          'role',
          'search',
          'sort',
          'source',
          'status',
          'updated-from',
          'updated-to',
          'work-mode',
        ]),
        run: async (context, flags) => {
          writeJson(
            context,
            await context.client.applications.list(parseApplicationListQuery(toArgv(flags))),
          )
        },
      }),
      note: makeCommand({
        docs: { brief: 'Append an application note' },
        flags: optionFlags([], ['message']),
        positionalCount: 1,
        run: async (context, flags, applicationId) => {
          writeJson(
            context,
            await context.client.applications.notes.append({
              applicationId,
              message: readRequiredText(optionValue(flags, 'message'), 'note message'),
            }),
          )
        },
      }),
      status: makeCommand({
        docs: { brief: 'Update application status' },
        flags: optionFlags(['notes']),
        positionalCount: 2,
        run: async (context, flags, applicationId, status) => {
          if (!isApplicationStatus(status)) {
            throw new Error(`Invalid application status: ${status}`)
          }

          writeJson(
            context,
            await context.client.applications.updateStatus({
              applicationId,
              status,
              notes: optionValue(flags, 'notes'),
            }),
          )
        },
      }),
      update: makeCommand({
        docs: { brief: 'Update application metadata' },
        flags: optionFlags([
          'city',
          'country',
          'current-resume-variant',
          'has-applied',
          'location-raw',
          'region',
          'role-kind',
          'role-title',
          'term',
          'work-mode',
        ]),
        positionalCount: 1,
        run: async (context, flags, applicationId) => {
          writeJson(
            context,
            await context.client.applications.update(
              parseUpdateApplication(applicationId, toArgv(flags)),
            ),
          )
        },
      }),
      workflow: makeCommand({
        docs: { brief: 'Update application workflow state' },
        flags: optionFlags([
          'blocker-reason',
          'hold-started-at',
          'lock-started-at',
          'manual-review-kind',
          'missing-user-info',
        ]),
        positionalCount: 1,
        run: async (context, flags, applicationId) => {
          writeJson(
            context,
            await context.client.applications.workflow.update(
              parseWorkflowUpdate(applicationId, toArgv(flags)),
            ),
          )
        },
      }),
    },
  })
}

function buildApplicationLinksRoute() {
  return buildRouteMap({
    docs: { brief: 'Manage application links' },
    routes: {
      add: makeCommand({
        docs: { brief: 'Add an application link' },
        flags: {
          ...optionFlags(['external-id']),
          ...optionFlags([], ['kind', 'label', 'url']),
          ...booleanFlags(['primary']),
        },
        positionalCount: 1,
        run: async (context, flags, applicationId) => {
          writeJson(
            context,
            await context.client.applications.links.create(
              parseCreateApplicationLink(applicationId, toArgv(flags)),
            ),
          )
        },
      }),
      update: makeCommand({
        docs: { brief: 'Update an application link' },
        flags: {
          ...optionFlags(['archived', 'external-id', 'kind', 'label', 'url']),
          ...booleanFlags(['archive', 'primary']),
        },
        positionalCount: 2,
        run: async (context, flags, applicationId, linkId) => {
          writeJson(
            context,
            await context.client.applications.links.update(
              parseUpdateApplicationLink(applicationId, linkId, toArgv(flags)),
            ),
          )
        },
      }),
    },
  })
}

function buildApplicationAttemptsRoute() {
  return buildRouteMap({
    docs: { brief: 'Track application attempts' },
    routes: {
      complete: makeCommand({
        docs: { brief: 'Complete an application attempt' },
        flags: optionFlags(
          [
            'blocker-reason',
            'confirmation-text',
            'confirmation-url',
            'hold-started-at',
            'manual-review-kind',
            'missing-user-info',
            'stop-reason',
            'summary',
          ],
          ['outcome'],
        ),
        positionalCount: 2,
        run: async (context, flags, applicationId, attemptId) => {
          writeJson(
            context,
            await context.client.applications.attempts.complete(
              parseAttemptComplete(applicationId, attemptId, toArgv(flags)),
            ),
          )
        },
      }),
      list: makeCommand({
        docs: { brief: 'List application attempts' },
        flags: optionFlags(['limit', 'offset']),
        positionalCount: 1,
        run: async (context, flags, applicationId) => {
          writeJson(
            context,
            await context.client.applications.attempts.list(
              parseApplicationAttemptsQuery(applicationId, toArgv(flags)),
            ),
          )
        },
      }),
      start: makeCommand({
        docs: { brief: 'Start an application attempt' },
        flags: optionFlags(
          ['actor-name', 'entry-url', 'resume-artifact-path', 'resume-variant', 'summary'],
          ['actor-type'],
        ),
        positionalCount: 1,
        run: async (context, flags, applicationId) => {
          writeJson(
            context,
            await context.client.applications.attempts.start(
              parseAttemptStart(applicationId, toArgv(flags)),
            ),
          )
        },
      }),
      step: makeCommand({
        docs: { brief: 'Record an application attempt step' },
        flags: optionFlags(['actor', 'payload-json'], ['message', 'type']),
        positionalCount: 2,
        run: async (context, flags, applicationId, attemptId) => {
          writeJson(
            context,
            await context.client.applications.attempts.step(
              parseAttemptStep(applicationId, attemptId, toArgv(flags)),
            ),
          )
        },
      }),
    },
  })
}

function buildRunsRoute() {
  return buildRouteMap({
    docs: { brief: 'Track workflow runs' },
    routes: {
      complete: makeCommand({
        docs: { brief: 'Complete a workflow run' },
        flags: optionFlags(['blocker', 'metadata-json', 'outcome', 'status', 'summary']),
        positionalCount: 1,
        run: async (context, flags, workflowRunId) => {
          writeJson(
            context,
            await context.client.runs.complete(parseRunComplete(workflowRunId, toArgv(flags))),
          )
        },
      }),
      list: makeCommand({
        docs: { brief: 'List workflow runs' },
        flags: optionFlags([
          'limit',
          'offset',
          'run-type',
          'source',
          'source-id',
          'status',
          'subject-application-id',
        ]),
        run: async (context, flags) => {
          writeJson(
            context,
            await context.client.runs.list(parseWorkflowRunsListQuery(toArgv(flags))),
          )
        },
      }),
      start: makeCommand({
        docs: { brief: 'Start a workflow run' },
        flags: optionFlags(
          [
            'actor-name',
            'coverage-ended-at',
            'coverage-started-at',
            'input-json',
            'metadata-json',
            'source-id',
            'source-name',
            'subject-application-id',
            'summary',
            'timezone',
          ],
          ['actor-type', 'run-type'],
        ),
        run: async (context, flags) => {
          writeJson(context, await context.client.runs.start(parseRunStart(toArgv(flags))))
        },
      }),
      step: makeCommand({
        docs: { brief: 'Record a workflow run step' },
        flags: optionFlags(['actor', 'payload-json'], ['message', 'type']),
        positionalCount: 1,
        run: async (context, flags, workflowRunId) => {
          writeJson(context, await context.client.runs.step(parseRunStep(workflowRunId, toArgv(flags))))
        },
      }),
    },
  })
}

function buildSourcingRoute() {
  return buildRouteMap({
    docs: { brief: 'Manage sourcing runs and findings' },
    routes: {
      findings: buildRouteMap({
        docs: { brief: 'Manage sourcing findings' },
        routes: {
          create: makeCommand({
            docs: { brief: 'Create a sourcing finding' },
            flags: optionFlags(
              [
                'blocker',
                'city',
                'country',
                'discovered-at',
                'duplicate-notes',
                'fit-notes',
                'location-raw',
                'merge-status',
                'official-url',
                'posted-age',
                'priority-band',
                'priority-score',
                'region',
                'source-name',
                'source-url',
                'term',
              ],
              ['company-name', 'role-kind', 'role-title', 'work-mode', 'workflow-run-id'],
            ),
            run: async (context, flags) => {
              writeJson(
                context,
                await context.client.sourcing.findings.create(
                  parseSourcingFindingCreate(toArgv(flags)),
                ),
              )
            },
          }),
          list: makeCommand({
            docs: { brief: 'List sourcing findings' },
            flags: optionFlags(['limit', 'merge-status', 'offset', 'source', 'source-id', 'workflow-run-id']),
            run: async (context, flags) => {
              writeJson(
                context,
                await context.client.sourcing.findings.list(
                  parseSourcingFindingsListQuery(toArgv(flags)),
                ),
              )
            },
          }),
          promote: makeCommand({
            docs: { brief: 'Promote a sourcing finding into an application' },
            positionalCount: 1,
            run: async (context, _flags, findingId) => {
              writeJson(context, await context.client.sourcing.findings.promote({ findingId }))
            },
          }),
          update: makeCommand({
            docs: { brief: 'Update a sourcing finding' },
            flags: optionFlags(['blocker', 'duplicate-notes', 'merge-notes', 'merge-status']),
            positionalCount: 1,
            run: async (context, flags, findingId) => {
              writeJson(
                context,
                await context.client.sourcing.findings.update(
                  parseSourcingFindingUpdate(findingId, toArgv(flags)),
                ),
              )
            },
          }),
        },
      }),
      run: makeCommand({
        docs: { brief: 'Run a sourcing batch' },
        flags: {
          ...optionFlags(['actor-name', 'candidates-json', 'source-id', 'source-name']),
          ...booleanFlags(['auto-promote']),
        },
        run: async (context, flags) => {
          writeJson(context, await runSourcingBatch(context.client, parseSourcingRun(toArgv(flags))))
        },
      }),
    },
  })
}

type RawFlagValue = string | boolean | readonly string[] | undefined
type RawFlags = Readonly<Record<string, RawFlagValue>>
type CommandRunner = (
  context: ValedictorianCliContext,
  flags: RawFlags,
  ...args: string[]
) => Promise<void> | void

function makeCommand({
  docs,
  flags = {},
  positionalCount = 0,
  run,
}: {
  docs: { brief: string; fullDescription?: string }
  flags?: Record<string, unknown>
  positionalCount?: number
  run: CommandRunner
}) {
  const parameters = {
    flags: {
      json: jsonFlag,
      ...flags,
    },
    ...(positionalCount > 0
      ? {
          positional: {
            kind: 'array',
            maximum: positionalCount,
            minimum: positionalCount,
            parameter: {
              brief: 'Command argument',
              parse: stringParser,
              placeholder: 'argument',
            },
          },
        }
      : {}),
  } as const

  return buildCommand<RawFlags, string[], ValedictorianCliContext>({
    docs,
    parameters,
    func: async function command(flags, ...args) {
      try {
        await run(this, flags, ...args)
      } catch (error) {
        return toError(error)
      }
    } satisfies CommandFunction<RawFlags, string[], ValedictorianCliContext>,
  } as unknown as CommandBuilderArguments<RawFlags, string[], ValedictorianCliContext>)
}

function optionFlags(optional: string[] = [], required: string[] = []) {
  const result: Record<string, unknown> = {}

  for (const name of optional) {
    result[name] = {
      brief: readableOptionName(name),
      kind: 'parsed',
      optional: true,
      parse: stringParser,
    }
  }

  for (const name of required) {
    result[name] = {
      brief: readableOptionName(name),
      kind: 'parsed',
      parse: stringParser,
    }
  }

  return result
}

function booleanFlags(names: string[]) {
  const result: Record<string, unknown> = {}

  for (const name of names) {
    result[name] = {
      brief: readableOptionName(name),
      kind: 'boolean',
      optional: true,
    }
  }

  return result
}

function toArgv(flags: RawFlags) {
  const argv: string[] = []

  for (const [name, value] of Object.entries(flags)) {
    if (name === 'json' || value === undefined || value === false) {
      continue
    }

    const option = `--${name}`

    if (value === true) {
      argv.push(option)
      continue
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        argv.push(option, String(item))
      }
      continue
    }

    argv.push(option, String(value))
  }

  return argv
}

function optionValue(flags: RawFlags, name: string) {
  const value = flags[name]
  return typeof value === 'string' ? value : undefined
}

function requiredOption(flags: RawFlags, name: string, label: string) {
  return readRequiredText(optionValue(flags, name), label)
}

function writeJson(context: ValedictorianCliContext, value: unknown, pretty = true) {
  context.process.stdout.write(`${JSON.stringify(value, null, pretty ? 2 : 0)}\n`)
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error))
}

function readableOptionName(name: string) {
  return name.replace(/-/g, ' ')
}

function definedEnv(env: Record<string, string | undefined>) {
  const output: Record<string, string> = {}

  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined) {
      output[name] = value
    }
  }

  return output
}

async function readPackageVersion() {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version?: string }

    return packageJson.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}
