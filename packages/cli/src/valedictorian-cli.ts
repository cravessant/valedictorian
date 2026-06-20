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
  type ValedictorianWorkspaceClient,
} from 'sparxie'

import { formatDoctorText, runContext, runDoctor } from './valedictorian-cli.doctor.js'
import { formatHumanOutput } from './valedictorian-cli.output.js'
import {
  parseApplicationAttemptsQuery,
  parseApplicationEventsQuery,
  parseApplicationListQuery,
  parseAttemptComplete,
  parseAttemptStart,
  parseAttemptStep,
  parseCreateApplication,
  parseCreateApplicationLink,
  parseActionQueueListQuery,
  parseRunComplete,
  parseRunStart,
  parseRunStep,
  parseSourcingFindingCreate,
  parseSourcingFindingDecision,
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
  readonly apiBaseUrl: string
  readonly apiToken?: string
  readonly client: ValedictorianClient
  readonly env: Record<string, string | undefined>
  outputJson?: boolean
  readonly process: StricliProcess
}

export async function runValedictorianCli({
  argv,
  env = process.env,
  stdout = (value) => process.stdout.write(value),
  stderr = (value) => process.stderr.write(value),
}: RunValedictorianCliOptions): Promise<number> {
  const normalizedArgv = normalizeArgv(argv)
  const processLike: StricliProcess = {
    env: definedEnv(env),
    stdout: { write: stdout },
    stderr: { write: stderr },
  }
  const apiBaseUrl = env.VALEDICTORIAN_API_URL ?? defaultValedictorianApiBaseUrl
  const context: ValedictorianCliContext = {
    apiBaseUrl,
    apiToken: env.VALEDICTORIAN_API_TOKEN,
    client: createClient(env),
    env,
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
  brief: 'Output as JSON.',
  kind: 'boolean',
  optional: true,
} as const

const application = buildApplication(
  buildRouteMap({
    docs: { brief: 'Valedictorian resources' },
    routes: {
      applications: buildApplicationsRoute(),
      context: makeCommand({
        docs: { brief: 'Print current CLI target context' },
        flags: {
          ...optionFlags(['timeout-ms', 'workspace']),
          ...booleanFlags(['skip-network']),
        },
        run: async (context, flags) => {
          writeJson(
            context,
            await runContext({
              env: context.env,
              skipNetwork: flags['skip-network'] === true,
              timeoutMs: parseTimeoutMs(optionValue(flags, 'timeout-ms')),
              workspaceSelector: optionValue(flags, 'workspace'),
            }),
          )
        },
      }),
      doctor: makeCommand({
        docs: { brief: 'Run read-only CLI diagnostics' },
        flags: {
          ...optionFlags(['timeout-ms', 'workspace']),
          ...booleanFlags(['skip-network']),
        },
        run: async (context, flags) => {
          const report = await runDoctor({
            cliVersion: await readPackageVersion(),
            env: context.env,
            skipNetwork: flags['skip-network'] === true,
            timeoutMs: parseTimeoutMs(optionValue(flags, 'timeout-ms')),
            workspaceSelector: optionValue(flags, 'workspace'),
          })

          if (flags.json === true) {
            writeJson(context, report)
          } else {
            context.process.stdout.write(formatDoctorText(report))
          }

          if (!report.ok) {
            context.process.exitCode = 1
          }
        },
      }),
      examples: buildExamplesRoute(),
      workspaces: buildRouteMap({
        docs: { brief: 'Manage local workspaces' },
        routes: {
          create: makeCommand({
            docs: { brief: 'Create a workspace at a path' },
            positionalCount: 1,
            run: async (context, _flags, workspacePath) => {
              writeJson(context, await createWorkspace(context, workspacePath))
            },
          }),
          list: makeCommand({
            docs: { brief: 'List registered workspaces' },
            run: async (context) => {
              writeJson(context, await listWorkspaces(context))
            },
          }),
          open: makeCommand({
            docs: { brief: 'Open a folder as a workspace' },
            flags: booleanFlags(['rekey']),
            positionalCount: 1,
            run: async (context, flags, workspacePath) => {
              writeJson(context, await openWorkspace(context, workspacePath, flags.rekey === true))
            },
          }),
        },
      }),
      'action-queue': buildRouteMap({
        docs: { brief: 'Inspect action queue items' },
        routes: {
          list: makeCommand({
            docs: { brief: 'List action queue items' },
            flags: optionFlags(['action-bucket', 'limit', 'offset', 'workspace']),
            run: async (context, flags) => {
              const client = await workspaceClient(context, flags)

              writeJson(
                context,
                await client.actionQueue.list(parseActionQueueListQuery(toArgvWithoutWorkspace(flags))),
              )
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
              ...optionFlags(['workspace']),
            },
            positionalCount: 1,
            run: async (context, flags, applicationId) => {
              const client = await workspaceClient(context, flags)

              await client.scores.record({
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
        flags: optionFlags(['note', 'workspace']),
        positionalCount: 1,
        run: async (context, flags, applicationId) => {
          const client = await workspaceClient(context, flags)

          await client.applications.archive({
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
            'workspace',
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
          const client = await workspaceClient(context, flags)

          writeJson(
            context,
            await client.applications.create(parseCreateApplication(toArgvWithoutWorkspace(flags))),
          )
        },
      }),
      events: makeCommand({
        docs: { brief: 'List application events' },
        flags: optionFlags(['limit', 'offset', 'workspace']),
        positionalCount: 1,
        run: async (context, flags, applicationId) => {
          const client = await workspaceClient(context, flags)

          writeJson(
            context,
            await client.applications.events.list(
              parseApplicationEventsQuery(applicationId, toArgvWithoutWorkspace(flags)),
            ),
          )
        },
      }),
      get: makeCommand({
        docs: { brief: 'Get application details' },
        flags: optionFlags(['workspace']),
        positionalCount: 1,
        run: async (context, flags, applicationId) => {
          const client = await workspaceClient(context, flags)
          const applicationDetail = await client.applications.get(applicationId)

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
          'workspace',
        ]),
        run: async (context, flags) => {
          const query = parseApplicationListQuery(toArgvWithoutWorkspace(flags))
          const client = await workspaceClient(context, flags)

          writeJson(context, await client.applications.list(query))
        },
      }),
      note: makeCommand({
        docs: { brief: 'Append an application note' },
        flags: optionFlags(['workspace'], ['message']),
        positionalCount: 1,
        run: async (context, flags, applicationId) => {
          const client = await workspaceClient(context, flags)

          writeJson(
            context,
            await client.applications.notes.append({
              applicationId,
              message: readRequiredText(optionValue(flags, 'message'), 'note message'),
            }),
          )
        },
      }),
      status: makeCommand({
        docs: { brief: 'Update application status' },
        flags: optionFlags(['notes', 'workspace']),
        positionalCount: 2,
        run: async (context, flags, applicationId, status) => {
          if (!isApplicationStatus(status)) {
            throw new Error(`Invalid application status: ${status}`)
          }

          const client = await workspaceClient(context, flags)

          writeJson(
            context,
            await client.applications.updateStatus({
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
          'workspace',
        ]),
        positionalCount: 1,
        run: async (context, flags, applicationId) => {
          const client = await workspaceClient(context, flags)

          writeJson(
            context,
            await client.applications.update(
              parseUpdateApplication(applicationId, toArgvWithoutWorkspace(flags)),
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
          'workspace',
        ]),
        positionalCount: 1,
        run: async (context, flags, applicationId) => {
          const client = await workspaceClient(context, flags)

          writeJson(
            context,
            await client.applications.workflow.update(
              parseWorkflowUpdate(applicationId, toArgvWithoutWorkspace(flags)),
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
          ...optionFlags(['external-id', 'workspace']),
          ...optionFlags([], ['kind', 'label', 'url']),
          ...booleanFlags(['primary']),
        },
        positionalCount: 1,
        run: async (context, flags, applicationId) => {
          const client = await workspaceClient(context, flags)

          writeJson(
            context,
            await client.applications.links.create(
              parseCreateApplicationLink(applicationId, toArgvWithoutWorkspace(flags)),
            ),
          )
        },
      }),
      update: makeCommand({
        docs: { brief: 'Update an application link' },
        flags: {
          ...optionFlags(['archived', 'external-id', 'kind', 'label', 'url', 'workspace']),
          ...booleanFlags(['archive', 'primary']),
        },
        positionalCount: 2,
        run: async (context, flags, applicationId, linkId) => {
          const client = await workspaceClient(context, flags)

          writeJson(
            context,
            await client.applications.links.update(
              parseUpdateApplicationLink(applicationId, linkId, toArgvWithoutWorkspace(flags)),
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
            'workspace',
          ],
          ['outcome'],
        ),
        positionalCount: 2,
        run: async (context, flags, applicationId, attemptId) => {
          const client = await workspaceClient(context, flags)

          writeJson(
            context,
            await client.applications.attempts.complete(
              parseAttemptComplete(applicationId, attemptId, toArgvWithoutWorkspace(flags)),
            ),
          )
        },
      }),
      list: makeCommand({
        docs: { brief: 'List application attempts' },
        flags: optionFlags(['limit', 'offset', 'workspace']),
        positionalCount: 1,
        run: async (context, flags, applicationId) => {
          const client = await workspaceClient(context, flags)

          writeJson(
            context,
            await client.applications.attempts.list(
              parseApplicationAttemptsQuery(applicationId, toArgvWithoutWorkspace(flags)),
            ),
          )
        },
      }),
      start: makeCommand({
        docs: { brief: 'Start an application attempt' },
        flags: optionFlags(
          ['actor-name', 'entry-url', 'resume-artifact-path', 'resume-variant', 'summary', 'workspace'],
          ['actor-type'],
        ),
        positionalCount: 1,
        run: async (context, flags, applicationId) => {
          const client = await workspaceClient(context, flags)

          writeJson(
            context,
            await client.applications.attempts.start(
              parseAttemptStart(applicationId, toArgvWithoutWorkspace(flags)),
            ),
          )
        },
      }),
      step: makeCommand({
        docs: { brief: 'Record an application attempt step' },
        flags: optionFlags(['actor', 'payload-json', 'workspace'], ['message', 'type']),
        positionalCount: 2,
        run: async (context, flags, applicationId, attemptId) => {
          const client = await workspaceClient(context, flags)

          writeJson(
            context,
            await client.applications.attempts.step(
              parseAttemptStep(applicationId, attemptId, toArgvWithoutWorkspace(flags)),
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
        flags: optionFlags(['blocker', 'metadata-json', 'outcome', 'status', 'summary', 'workspace']),
        positionalCount: 1,
        run: async (context, flags, workflowRunId) => {
          const client = await workspaceClient(context, flags)

          writeJson(
            context,
            await client.runs.complete(
              parseRunComplete(workflowRunId, toArgvWithoutWorkspace(flags)),
            ),
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
          'workspace',
        ]),
        run: async (context, flags) => {
          const client = await workspaceClient(context, flags)

          writeJson(
            context,
            await client.runs.list(parseWorkflowRunsListQuery(toArgvWithoutWorkspace(flags))),
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
            'workspace',
          ],
          ['actor-type', 'run-type'],
        ),
        run: async (context, flags) => {
          const client = await workspaceClient(context, flags)

          writeJson(context, await client.runs.start(parseRunStart(toArgvWithoutWorkspace(flags))))
        },
      }),
      step: makeCommand({
        docs: { brief: 'Record a workflow run step' },
        flags: optionFlags(['actor', 'payload-json', 'workspace'], ['message', 'type']),
        positionalCount: 1,
        run: async (context, flags, workflowRunId) => {
          const client = await workspaceClient(context, flags)

          writeJson(
            context,
            await client.runs.step(parseRunStep(workflowRunId, toArgvWithoutWorkspace(flags))),
          )
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
                'workspace',
              ],
              ['company-name', 'role-kind', 'role-title', 'work-mode', 'workflow-run-id'],
            ),
            run: async (context, flags) => {
              const client = await workspaceClient(context, flags)

              writeJson(
                context,
                await client.sourcing.findings.create(
                  parseSourcingFindingCreate(toArgvWithoutWorkspace(flags)),
                ),
              )
            },
          }),
          decide: makeCommand({
            docs: { brief: 'Set a manual sourcing finding disposition' },
            flags: optionFlags(['merge-notes', 'workspace'], ['merge-status']),
            positionalCount: 1,
            run: async (context, flags, findingId) => {
              const client = await workspaceClient(context, flags)

              writeJson(
                context,
                await client.sourcing.findings.decide(
                  parseSourcingFindingDecision(findingId, toArgvWithoutWorkspace(flags)),
                ),
              )
            },
          }),
          list: makeCommand({
            docs: { brief: 'List sourcing findings' },
            flags: optionFlags([
              'limit',
              'merge-status',
              'offset',
              'source',
              'source-id',
              'workflow-run-id',
              'workspace',
            ]),
            run: async (context, flags) => {
              const client = await workspaceClient(context, flags)

              writeJson(
                context,
                await client.sourcing.findings.list(
                  parseSourcingFindingsListQuery(toArgvWithoutWorkspace(flags)),
                ),
              )
            },
          }),
          promote: makeCommand({
            docs: { brief: 'Promote a sourcing finding into an application' },
            flags: optionFlags(['workspace']),
            positionalCount: 1,
            run: async (context, flags, findingId) => {
              const client = await workspaceClient(context, flags)

              writeJson(context, await client.sourcing.findings.promote({ findingId }))
            },
          }),
          update: makeCommand({
            docs: { brief: 'Update a sourcing finding' },
            flags: optionFlags([
              'blocker',
              'duplicate-notes',
              'merge-notes',
              'merge-status',
              'workspace',
            ]),
            positionalCount: 1,
            run: async (context, flags, findingId) => {
              const client = await workspaceClient(context, flags)

              writeJson(
                context,
                await client.sourcing.findings.update(
                  parseSourcingFindingUpdate(findingId, toArgvWithoutWorkspace(flags)),
                ),
              )
            },
          }),
        },
      }),
      run: makeCommand({
        docs: { brief: 'Run a sourcing batch' },
        flags: {
          ...optionFlags(['actor-name', 'candidates-json', 'source-id', 'source-name', 'workspace']),
          ...booleanFlags(['auto-promote']),
        },
        run: async (context, flags) => {
          const client = await workspaceClient(context, flags)

          writeJson(
            context,
            await runSourcingBatch(client, parseSourcingRun(toArgvWithoutWorkspace(flags))),
          )
        },
      }),
    },
  })
}

function buildExamplesRoute() {
  return buildRouteMap({
    docs: { brief: 'Show command examples' },
    routes: {
      attempts: buildRouteMap({
        docs: { brief: 'Show application attempt examples' },
        routes: {
          complete: makeCommand({
            docs: { brief: 'Show attempt completion examples' },
            flags: optionFlags(['outcome']),
            run: (context, flags) => {
              writeJson(context, buildAttemptCompleteExample(optionValue(flags, 'outcome')))
            },
          }),
        },
      }),
    },
  })
}

function buildAttemptCompleteExample(outcome: string | undefined) {
  const normalizedOutcome = outcome ?? 'submitted'

  if (normalizedOutcome !== 'submitted') {
    return {
      complete: [
        'valedictorian-cli --json applications attempts complete <application-id> <attempt-id>',
        '--workspace "$VALEDICTORIAN_WORKSPACE"',
        `--outcome ${normalizedOutcome}`,
        '--summary "Attempt completed."',
      ].join(' '),
    }
  }

  const verificationPayload = {
    version: 1,
    scope: 'final_review',
    status: 'passed',
    verified: ['identity', 'contact_info', 'resume_attachment', 'work_authorization'],
    unresolved: [],
    evidence: 'Final review screen matched the intended application payload before submit.',
  }

  return {
    note: 'Submitted attempts require a passed verification_receipt step before completion.',
    verificationReceiptStep: [
      'valedictorian-cli --json applications attempts step <application-id> <attempt-id>',
      '--workspace "$VALEDICTORIAN_WORKSPACE"',
      '--type verification_receipt',
      '--message "Final review verification passed."',
      `--payload-json '${JSON.stringify(verificationPayload)}'`,
    ].join(' '),
    complete: [
      'valedictorian-cli --json applications attempts complete <application-id> <attempt-id>',
      '--workspace "$VALEDICTORIAN_WORKSPACE"',
      '--outcome submitted',
      '--summary "Application submitted."',
      '--confirmation-url "https://example.com/confirmation"',
      '--confirmation-text "Thanks, your application was received."',
    ].join(' '),
  }
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
      this.outputJson = flags.json === true

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

function toArgvWithoutWorkspace(flags: RawFlags) {
  const { workspace: _workspace, ...rest } = flags
  return toArgv(rest)
}

async function workspaceClient(
  context: ValedictorianCliContext,
  flags: RawFlags,
): Promise<ValedictorianWorkspaceClient> {
  const workspaceId = await resolveWorkspaceId(
    context,
    readRequiredText(optionValue(flags, 'workspace'), '--workspace'),
  )
  const clientWithWorkspace = context.client as ValedictorianClient & {
    forWorkspace?: (workspaceId: string) => ValedictorianWorkspaceClient
  }

  if (clientWithWorkspace.forWorkspace) {
    return clientWithWorkspace.forWorkspace(workspaceId)
  }

  return createHttpValedictorianClient({
    baseUrl: context.apiBaseUrl,
    fetch: createWorkspaceFetch(workspaceId),
    token: context.apiToken,
  }) as unknown as ValedictorianWorkspaceClient
}

async function resolveWorkspaceId(context: ValedictorianCliContext, selector: string) {
  if (looksLikeWorkspaceId(selector)) {
    return selector
  }

  const result = (await listWorkspaces(context)) as {
    items?: Array<{ id: string; name: string }>
  }
  const workspaces = Array.isArray(result.items) ? result.items : []
  const idMatch = workspaces.find((workspace) => workspace.id === selector)

  if (idMatch) {
    return idMatch.id
  }

  const exactNameMatches = workspaces.filter((workspace) => workspace.name === selector)

  if (exactNameMatches.length === 1) {
    return exactNameMatches[0].id
  }

  if (exactNameMatches.length > 1) {
    throw new Error(formatAmbiguousWorkspaceError(selector, exactNameMatches))
  }

  const lowerSelector = selector.toLocaleLowerCase()
  const caseInsensitiveMatches = workspaces.filter(
    (workspace) => workspace.name.toLocaleLowerCase() === lowerSelector,
  )

  if (caseInsensitiveMatches.length === 1) {
    return caseInsensitiveMatches[0].id
  }

  if (caseInsensitiveMatches.length > 1) {
    throw new Error(formatAmbiguousWorkspaceError(selector, caseInsensitiveMatches))
  }

  throw new Error(`Workspace not found: ${selector}`)
}

function looksLikeWorkspaceId(selector: string) {
  return (
    /^workspace[-_]/i.test(selector) ||
    /^ws[-_]/i.test(selector) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      selector,
    )
  )
}

function formatAmbiguousWorkspaceError(
  selector: string,
  workspaces: Array<{ id: string; name: string }>,
) {
  return `Workspace name is ambiguous: ${selector}. Rerun with an id: ${workspaces
    .map((workspace) => `${workspace.name} (${workspace.id})`)
    .join(', ')}`
}

async function listWorkspaces(context: ValedictorianCliContext) {
  const clientWithWorkspaces = context.client as ValedictorianClient & {
    workspaces?: {
      list(): Promise<unknown>
    }
  }

  if (clientWithWorkspaces.workspaces) {
    return clientWithWorkspaces.workspaces.list()
  }

  return requestJson(context, '/v1/workspaces')
}

async function openWorkspace(context: ValedictorianCliContext, path: string, rekey: boolean) {
  const clientWithWorkspaces = context.client as ValedictorianClient & {
    workspaces?: {
      open(input: { path: string; rekey?: boolean }): Promise<unknown>
    }
  }
  const input = rekey ? { path, rekey } : { path }

  if (clientWithWorkspaces.workspaces) {
    return clientWithWorkspaces.workspaces.open(input)
  }

  return requestJson(context, '/v1/workspaces/open', {
    body: input,
    method: 'POST',
  })
}

async function createWorkspace(context: ValedictorianCliContext, path: string) {
  const clientWithWorkspaces = context.client as ValedictorianClient & {
    workspaces?: {
      create(input: { path: string }): Promise<unknown>
    }
  }
  const input = { path }

  if (clientWithWorkspaces.workspaces) {
    return clientWithWorkspaces.workspaces.create(input)
  }

  return requestJson(context, '/v1/workspaces/create', {
    body: input,
    method: 'POST',
  })
}

async function requestJson(
  context: ValedictorianCliContext,
  path: string,
  options: { body?: unknown; method?: 'GET' | 'POST' } = {},
) {
  const url = new URL(path, context.apiBaseUrl)
  const headers: Record<string, string> = {
    accept: 'application/json',
  }

  if (context.apiToken) {
    headers.authorization = `Bearer ${context.apiToken}`
  }

  const init: RequestInit = {
    headers,
    method: options.method ?? 'GET',
  }

  if (options.body !== undefined) {
    headers['content-type'] = 'application/json'
    init.body = JSON.stringify(options.body)
  }

  const response = await fetch(url.toString(), init)
  const body = await response.json().catch(() => undefined)

  if (!response.ok) {
    throw new Error(readResponseMessage(body, response.statusText))
  }

  return body
}

function readResponseMessage(body: unknown, fallback: string) {
  if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') {
    return body.message
  }

  return fallback || 'Valedictorian request failed'
}

function createWorkspaceFetch(workspaceId: string): typeof fetch {
  return (async (input, init) => {
    const url = new URL(readFetchUrl(input))

    if (url.pathname.startsWith('/v1/') && !url.pathname.startsWith('/v1/workspaces/')) {
      url.pathname = `/v1/workspaces/${encodeURIComponent(workspaceId)}${url.pathname.slice(
        '/v1'.length,
      )}`
    }

    return fetch(url.toString(), init)
  }) as typeof fetch
}

function readFetchUrl(input: Parameters<typeof fetch>[0]) {
  if (typeof input === 'string') {
    return input
  }

  if (input instanceof URL) {
    return input.toString()
  }

  return input.url
}

function optionValue(flags: RawFlags, name: string) {
  const value = flags[name]
  return typeof value === 'string' ? value : undefined
}

function requiredOption(flags: RawFlags, name: string, label: string) {
  return readRequiredText(optionValue(flags, name), label)
}

function writeJson(context: ValedictorianCliContext, value: unknown, pretty = true) {
  if (context.outputJson) {
    context.process.stdout.write(`${JSON.stringify(value, null, pretty ? 2 : 0)}\n`)
    return
  }

  context.process.stdout.write(formatHumanOutput(value))
}

function normalizeArgv(argv: string[]) {
  const normalized = argv[0] === '--' ? argv.slice(1) : [...argv]

  if (normalized[0] !== '--json') {
    return normalized
  }

  const withoutGlobalJson = normalized.slice(1)

  if (
    withoutGlobalJson.length === 0 ||
    withoutGlobalJson[0] === '--help' ||
    withoutGlobalJson[0] === '-h' ||
    withoutGlobalJson[0] === '--version' ||
    withoutGlobalJson[0] === '-v' ||
    withoutGlobalJson.includes('--json')
  ) {
    return withoutGlobalJson
  }

  return [...withoutGlobalJson, '--json']
}

function parseTimeoutMs(value: string | undefined) {
  if (value === undefined) {
    return 3000
  }

  const timeoutMs = Number(value)

  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`Invalid --timeout-ms value: ${value}`)
  }

  return timeoutMs
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
