import {
  buildApplication,
  buildRouteMap,
  type StricliProcess,
} from '@stricli/core'
import {
  applicationStatuses,
  createHttpValedictorianClient,
  defaultValedictorianApiBaseUrl,
  isApplicationStatus,
  type ValedictorianClient,
} from 'sparxie'

import { buildApplicationsRoute } from './valedictorian-cli.application-commands.js'
import { parseConnectorScheduleUpsert } from './valedictorian-cli.connector-schedule-parsers.js'
import { formatDoctorText, runContext, runDoctor } from './valedictorian-cli.doctor.js'
import {
  booleanFlags,
  createWorkspace,
  definedEnv,
  listWorkspaces,
  makeCommand,
  normalizeArgv,
  openWorkspace,
  optionFlags,
  optionValue,
  parseTimeoutMs,
  readArgvEscapeSuffix,
  readPackageVersion,
  requiredOption,
  toArgvWithoutWorkspace,
  workspaceClient,
  workspaceConnectorClient,
  writeJson,
  type ValedictorianCliContext,
} from './valedictorian-cli.command-runtime.js'
import {
  argvRequestsJson,
  CliUsageError,
  isStricliUsageExitCode,
  mapStricliExitCode,
  presentCliFailure,
} from './valedictorian-cli.failures.js'
import { parseStrictNumberOption } from './valedictorian-cli.parser-options.js'
import { buildProfileRoute } from './valedictorian-cli.profile-commands.js'
import { buildSecretsRoute } from './valedictorian-cli.secrets-commands.js'
import {
  parseConnectorConfiguration,
  parseConnectorObservationsList,
  parseConnectorRunsList,
  parseConnectorRunTrigger,
  parseActionQueueListQuery,
  parseRunComplete,
  parseRunStart,
  parseRunStep,
  parseSourcingFindingDecision,
  parseSourcingFindingsListQuery,
  parseSourcingFindingUpdate,
  parseWorkflowRunsListQuery,
} from './valedictorian-cli.parsers.js'
import { ingestRawSourcing, parseRawSourcingIntake } from './valedictorian-cli.raw-sourcing.js'

export interface RunValedictorianCliOptions {
  argv: string[]
  cwd?: string
  env?: Record<string, string | undefined>
  stdout?: (value: string) => void
  stderr?: (value: string) => void
  secretsRunSpawn?: import('./valedictorian-cli.secrets-run-spawn.js').SecretsRunSpawnAdapter
}

export async function runValedictorianCli({
  argv,
  cwd = process.cwd(),
  env = process.env,
  stdout = (value) => process.stdout.write(value),
  stderr = (value) => process.stderr.write(value),
  secretsRunSpawn,
}: RunValedictorianCliOptions): Promise<number> {
  const normalizedArgv = normalizeArgv(argv)
  const asJson = argvRequestsJson(normalizedArgv)
  const stderrChunks: string[] = []
  const processLike: StricliProcess = {
    env: definedEnv(env),
    stdout: { write: stdout },
    stderr: {
      write: (value: string) => {
        stderrChunks.push(value)
      },
    },
  }
  const apiBaseUrl = env.VALEDICTORIAN_API_URL ?? defaultValedictorianApiBaseUrl
  const context: ValedictorianCliContext = {
    apiBaseUrl,
    apiToken: env.VALEDICTORIAN_API_TOKEN,
    argvEscapeSuffix: readArgvEscapeSuffix(normalizedArgv),
    client: createClient(env),
    cwd,
    env,
    process: processLike,
    ...(secretsRunSpawn ? { secretsRunSpawn } : {}),
  }

  await runValedictorianApp(normalizedArgv, context)

  const rawExitCode = Number(processLike.exitCode ?? 0)
  if (isStricliUsageExitCode(rawExitCode)) {
    const message = stderrChunks.join('').replace(/\n$/, '') || 'Invalid command usage.'
    const presented = presentCliFailure(new CliUsageError(message), { asJson })
    stderr(presented.text)
    return presented.exitCode
  }

  for (const chunk of stderrChunks) {
    stderr(chunk)
  }
  return mapStricliExitCode(rawExitCode)
}

function createClient(env: Record<string, string | undefined>): ValedictorianClient {
  return createHttpValedictorianClient({
    baseUrl: env.VALEDICTORIAN_API_URL ?? defaultValedictorianApiBaseUrl,
    token: env.VALEDICTORIAN_API_TOKEN,
  })
}

const application = buildApplication(
  buildRouteMap({
    docs: { brief: 'Valedictorian resources' },
    routes: {
      applications: buildApplicationsRoute(),
      connectors: buildConnectorsRoute(),
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
              cwd: context.cwd,
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
            cwd: context.cwd,
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
      profile: buildProfileRoute(),
      secrets: buildSecretsRoute(),
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

              const score = await client.scores.record({
                applicationId,
                score: parseStrictNumberOption(requiredOption(flags, 'score', '--score value'), '--score'),
                band: requiredOption(flags, 'band', '--band value'),
                roleRelevance: parseStrictNumberOption(
                  requiredOption(flags, 'role-relevance', '--role-relevance value'),
                  '--role-relevance',
                ),
                careerSignal: parseStrictNumberOption(
                  requiredOption(flags, 'career-signal', '--career-signal value'),
                  '--career-signal',
                ),
                cityWorkMode: parseStrictNumberOption(
                  requiredOption(flags, 'city-work-mode', '--city-work-mode value'),
                  '--city-work-mode',
                ),
                compensationLogistics: parseStrictNumberOption(
                  requiredOption(flags, 'compensation-logistics', '--compensation-logistics value'),
                  '--compensation-logistics',
                ),
                penalties: [],
                rationale: requiredOption(flags, 'rationale', '--rationale value'),
                rubricVersion: optionValue(flags, 'rubric-version') ?? 'valedictorian-cli',
              })

              writeJson(context, score, false)
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

function buildConnectorsRoute() {
  return buildRouteMap({
    docs: { brief: 'Configure and advance continuous connector synchronization' },
    routes: {
      configure: makeCommand({
        docs: { brief: 'Configure continuous connector synchronization' },
        flags: optionFlags([
          'connector-version',
          'display-name',
          'earliest-backfill-date',
          'enabled',
          'filters-json',
          'workspace',
        ]),
        positionalCount: 1,
        run: async (context, flags, connectorInstanceId) => {
          const connectorClient = await workspaceConnectorClient(context, flags)

          writeJson(
            context,
            await connectorClient.update(
              parseConnectorConfiguration(connectorInstanceId, toArgvWithoutWorkspace(flags)),
            ),
          )
        },
      }),
      status: makeCommand({
        docs: { brief: 'Show connector synchronization status' },
        flags: optionFlags(['workspace']),
        positionalCount: 1,
        run: async (context, flags, connectorInstanceId) => {
          const connectorClient = await workspaceConnectorClient(context, flags)

          writeJson(context, await connectorClient.inspect(connectorInstanceId))
        },
      }),
      list: makeCommand({
        docs: { brief: 'List connector instances' },
        flags: optionFlags(['workspace']),
        run: async (context, flags) => {
          const connectorClient = await workspaceConnectorClient(context, flags)

          writeJson(context, await connectorClient.list())
        },
      }),
      observations: buildRouteMap({
        docs: { brief: 'Inspect connector observations' },
        routes: {
          list: makeCommand({
            docs: { brief: 'List connector observations' },
            flags: optionFlags(['connector-run-id', 'limit', 'offset', 'workspace']),
            positionalCount: 1,
            run: async (context, flags, connectorInstanceId) => {
              const connectorClient = await workspaceConnectorClient(context, flags)

              writeJson(
                context,
                await connectorClient.observations.list(
                  parseConnectorObservationsList(
                    connectorInstanceId,
                    toArgvWithoutWorkspace(flags),
                  ),
                ),
              )
            },
          }),
        },
      }),
      runs: buildRouteMap({
        docs: { brief: 'Inspect connector runs' },
        routes: {
          list: makeCommand({
            docs: { brief: 'List connector runs' },
            flags: optionFlags(['limit', 'mode', 'offset', 'status', 'workspace']),
            positionalCount: 1,
            run: async (context, flags, connectorInstanceId) => {
              const connectorClient = await workspaceConnectorClient(context, flags)

              writeJson(
                context,
                await connectorClient.runs.list(
                  parseConnectorRunsList(connectorInstanceId, toArgvWithoutWorkspace(flags)),
                ),
              )
            },
          }),
        },
      }),
      schedules: buildRouteMap({
        docs: { brief: 'Manage connector schedule policy' },
        routes: {
          get: makeCommand({
            docs: { brief: 'Get connector schedule policy' },
            flags: optionFlags(['workspace']),
            positionalCount: 1,
            run: async (context, flags, connectorInstanceId) => {
              const connectorClient = await workspaceConnectorClient(context, flags)

              writeJson(context, await connectorClient.schedules.get(connectorInstanceId))
            },
          }),
          upsert: makeCommand({
            docs: { brief: 'Create or update connector schedule policy' },
            flags: optionFlags(
              ['workspace'],
              ['cadence-json', 'expected-revision', 'state', 'timezone'],
            ),
            positionalCount: 1,
            run: async (context, flags, connectorInstanceId) => {
              const connectorClient = await workspaceConnectorClient(context, flags)

              writeJson(
                context,
                await connectorClient.schedules.upsert(
                  parseConnectorScheduleUpsert(
                    connectorInstanceId,
                    toArgvWithoutWorkspace(flags),
                  ),
                ),
              )
            },
          }),
        },
      }),
      trigger: makeCommand({
        docs: { brief: 'Advance continuous connector synchronization' },
        flags: {
          ...optionFlags([
            'filter-signature',
            'filters-json',
            'mode',
            'reason',
            'workspace',
          ]),
          ...booleanFlags(['dry-run']),
        },
        positionalCount: 1,
        run: async (context, flags, connectorInstanceId) => {
          const connectorClient = await workspaceConnectorClient(context, flags)

          writeJson(
            context,
            await connectorClient.runs.trigger(
              parseConnectorRunTrigger(connectorInstanceId, toArgvWithoutWorkspace(flags)),
            ),
          )
        },
      }),
    },
  })
}

function buildSourcingRoute() {
  return buildRouteMap({
    docs: { brief: 'Capture sourcing observations and manage findings' },
    routes: {
      findings: buildRouteMap({
        docs: { brief: 'Manage sourcing findings' },
        routes: {
          decide: makeCommand({
            docs: { brief: 'Set a manual sourcing finding disposition' },
            flags: optionFlags(
              ['disposition-reason', 'merge-notes', 'policy-blocker', 'workspace'],
              ['merge-status'],
            ),
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
              'disposition-reason',
              'duplicate-notes',
              'merge-notes',
              'merge-status',
              'policy-blocker',
              'start-date',
              'term',
              'terms-json',
              'workspace',
              'end-date',
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
      ingest: makeCommand({
        docs: { brief: 'Capture raw sourcing observations and inspect their outcomes' },
        flags: optionFlags([
          'batch-json', 'observed-at', 'origin-kind', 'origin-name', 'origin-provider-id',
          'origin-url', 'payload-json', 'provider-record-id', 'provider-schema', 'url', 'workspace',
        ]),
        run: async (context, flags) => {
          const records = parseRawSourcingIntake(
            toArgvWithoutWorkspace(flags),
            await readPackageVersion(),
          )
          const client = await workspaceClient(context, flags)
          const result = await ingestRawSourcing(client, records)
          writeJson(context, result)
          if (result.inspectionFailureCount > 0) context.process.exitCode = 1
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

  if (!isApplicationStatus(normalizedOutcome)) {
    throw new CliUsageError(
      `Invalid attempt outcome: ${normalizedOutcome}. Valid outcomes: ${applicationStatuses.join(', ')}`,
    )
  }

  if (normalizedOutcome !== 'submitted') {
    const requiredFlags = attemptCompletionRequiredFlags(normalizedOutcome)

    return {
      complete: [
        'valedictorian-cli --json applications attempts complete <application-id> <attempt-id>',
        '--workspace "$VALEDICTORIAN_WORKSPACE"',
        `--outcome ${normalizedOutcome}`,
        ...requiredFlags,
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

function attemptCompletionRequiredFlags(outcome: string) {
  if (outcome === 'needs_user_info') {
    return ['--missing-user-info "Synthetic missing answer to collect from the user."']
  }

  if (outcome === 'ready_for_review') {
    return [
      '--hold-started-at "2026-06-30T00:00:00.000Z"',
      '--manual-review-kind overridable',
    ]
  }

  if (attemptBlockerOutcomes.has(outcome)) {
    return ['--blocker-reason "Synthetic blocker reason."']
  }

  return []
}

const attemptBlockerOutcomes = new Set([
  'manual_captcha',
  'security_gate',
  'login_needed',
  'platform_error',
  'closed',
  'not_fit',
  'not_pursued',
])
