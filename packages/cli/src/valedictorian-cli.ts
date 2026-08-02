import {
  buildApplication,
  buildRouteMap,
  type StricliProcess,
} from '@stricli/core'
import {
  createHttpValedictorianClient,
  defaultValedictorianApiBaseUrl,
  type ValedictorianClientV2,
} from '@sparxie/sdk'

import { buildActionQueueRoute } from './valedictorian-cli.action-queue-commands.js'
import { buildApplicationsRoute } from './valedictorian-cli.application-commands.js'
import { buildCapturesRoute } from './valedictorian-cli.capture-commands.js'
import { buildCompaniesRoute } from './valedictorian-cli.company-commands.js'
import { buildConnectorsRoute } from './valedictorian-cli.connector-commands.js'
import {
  definedEnv,
  normalizeArgv,
  readArgvEscapeSuffix,
  readPackageVersion,
  type ValedictorianCliContext,
} from './valedictorian-cli.command-runtime.js'
import {
  buildContextCommand,
  buildDoctorCommand,
} from './valedictorian-cli.diagnostics-commands.js'
import {
  argvRequestsJson,
  CliUsageError,
  isStricliUsageExitCode,
  mapStricliExitCode,
  presentCliFailure,
} from './valedictorian-cli.failures.js'
import { buildJobsRoute } from './valedictorian-cli.job-commands.js'
import { buildOpportunitiesRoute } from './valedictorian-cli.opportunity-commands.js'
import { buildProfileRoute } from './valedictorian-cli.profile-commands.js'
import { buildRunsRoute } from './valedictorian-cli.run-commands.js'
import { buildScoresRoute } from './valedictorian-cli.score-commands.js'
import { buildSecretsRoute } from './valedictorian-cli.secrets-commands.js'
import { buildWorkspacesRoute } from './valedictorian-cli.workspace-commands.js'

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

function createClient(env: Record<string, string | undefined>): ValedictorianClientV2 {
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
      captures: buildCapturesRoute(),
      companies: buildCompaniesRoute(),
      connectors: buildConnectorsRoute(),
      context: buildContextCommand(),
      doctor: buildDoctorCommand(),
      jobs: buildJobsRoute(),
      opportunities: buildOpportunitiesRoute(),
      profile: buildProfileRoute(),
      secrets: buildSecretsRoute(),
      workspaces: buildWorkspacesRoute(),
      'action-queue': buildActionQueueRoute(),
      runs: buildRunsRoute(),
      scores: buildScoresRoute(),
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
