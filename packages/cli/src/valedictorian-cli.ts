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
  readOption,
  readOptionalText,
  readRequiredArgument,
  readRequiredOption,
  readRequiredText,
  runSourcingBatch,
} from './valedictorian-cli.parsers'
export interface RunValedictorianCliOptions {
  argv: string[]
  env?: Record<string, string | undefined>
  stdout?: (value: string) => void
  stderr?: (value: string) => void
}

export async function runValedictorianCli({
  argv,
  env = process.env,
  stdout = (value) => process.stdout.write(value),
  stderr = (value) => process.stderr.write(value),
}: RunValedictorianCliOptions): Promise<number> {
  try {
    const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv
    const [resource, command, ...rest] = normalizedArgv

    if (resource === 'applications' && command === 'list') {
      const query = parseApplicationListQuery(rest)
      const result = await createClient(env).applications.list(query)

      stdout(`${JSON.stringify(result, null, 2)}\n`)
      return 0
    }

    if (resource === 'applications' && command === 'get') {
      const applicationId = readRequiredArgument(rest[0], 'application id')
      const application = await createClient(env).applications.get(applicationId)

      if (!application) {
        stderr(`Application not found: ${applicationId}\n`)
        return 1
      }

      stdout(`${JSON.stringify(application, null, 2)}\n`)
      return 0
    }

    if (resource === 'queue' && command === 'list') {
      const query = parseQueueListQuery(rest)
      const result = await createClient(env).queue.list(query)

      stdout(`${JSON.stringify(result, null, 2)}\n`)
      return 0
    }

    if (resource === 'runs') {
      const client = createClient(env)

      if (command === 'list') {
        const runs = await client.runs.list(parseWorkflowRunsListQuery(rest))

        stdout(`${JSON.stringify(runs, null, 2)}\n`)
        return 0
      }

      if (command === 'start') {
        const run = await client.runs.start(parseRunStart(rest))

        stdout(`${JSON.stringify(run, null, 2)}\n`)
        return 0
      }

      if (command === 'step') {
        const workflowRunId = readRequiredArgument(rest[0], 'workflow run id')
        const step = await client.runs.step(parseRunStep(workflowRunId, rest.slice(1)))

        stdout(`${JSON.stringify(step, null, 2)}\n`)
        return 0
      }

      if (command === 'complete') {
        const workflowRunId = readRequiredArgument(rest[0], 'workflow run id')
        const run = await client.runs.complete(parseRunComplete(workflowRunId, rest.slice(1)))

        stdout(`${JSON.stringify(run, null, 2)}\n`)
        return 0
      }

      throw new Error(`Unknown runs command: ${command ?? ''}`.trim())
    }

    if (resource === 'sourcing' && command === 'run') {
      const client = createClient(env)
      const result = await runSourcingBatch(client, parseSourcingRun(rest))

      stdout(`${JSON.stringify(result, null, 2)}\n`)
      return 0
    }

    if (resource === 'sourcing' && command === 'findings') {
      const subcommand = readRequiredArgument(rest[0], 'findings command')
      const client = createClient(env)

      if (subcommand === 'list') {
        const findings = await client.sourcing.findings.list(
          parseSourcingFindingsListQuery(rest.slice(1)),
        )

        stdout(`${JSON.stringify(findings, null, 2)}\n`)
        return 0
      }

      if (subcommand === 'create') {
        const finding = await client.sourcing.findings.create(
          parseSourcingFindingCreate(rest.slice(1)),
        )

        stdout(`${JSON.stringify(finding, null, 2)}\n`)
        return 0
      }

      if (subcommand === 'update') {
        const findingId = readRequiredArgument(rest[1], 'finding id')
        const finding = await client.sourcing.findings.update(
          parseSourcingFindingUpdate(findingId, rest.slice(2)),
        )

        stdout(`${JSON.stringify(finding, null, 2)}\n`)
        return 0
      }

      if (subcommand === 'promote') {
        const findingId = readRequiredArgument(rest[1], 'finding id')
        const finding = await client.sourcing.findings.promote({ findingId })

        stdout(`${JSON.stringify(finding, null, 2)}\n`)
        return 0
      }

      throw new Error(`Unknown sourcing findings command: ${subcommand}`)
    }

    if (resource === 'applications' && command === 'status') {
      const applicationId = readRequiredArgument(rest[0], 'application id')
      const status = readRequiredArgument(rest[1], 'application status')

      if (!isApplicationStatus(status)) {
        throw new Error(`Invalid application status: ${status}`)
      }

      const application = await createClient(env).applications.updateStatus({
        applicationId,
        status,
        notes: readOption(rest.slice(2), '--notes'),
      })

      stdout(`${JSON.stringify(application, null, 2)}\n`)
      return 0
    }

    if (resource === 'applications' && command === 'create') {
      const application = await createClient(env).applications.create(parseCreateApplication(rest))

      stdout(`${JSON.stringify(application, null, 2)}\n`)
      return 0
    }

    if (resource === 'applications' && command === 'update') {
      const applicationId = readRequiredArgument(rest[0], 'application id')
      const application = await createClient(env).applications.update(
        parseUpdateApplication(applicationId, rest.slice(1)),
      )

      stdout(`${JSON.stringify(application, null, 2)}\n`)
      return 0
    }

    if (resource === 'applications' && command === 'workflow') {
      const applicationId = readRequiredArgument(rest[0], 'application id')
      const application = await createClient(env).applications.workflow.update(
        parseWorkflowUpdate(applicationId, rest.slice(1)),
      )

      stdout(`${JSON.stringify(application, null, 2)}\n`)
      return 0
    }

    if (resource === 'applications' && command === 'note') {
      const applicationId = readRequiredArgument(rest[0], 'application id')
      const application = await createClient(env).applications.notes.append({
        applicationId,
        message: readRequiredText(readOption(rest.slice(1), '--message'), 'note message'),
      })

      stdout(`${JSON.stringify(application, null, 2)}\n`)
      return 0
    }

    if (resource === 'applications' && command === 'link' && rest[0] === 'add') {
      const applicationId = readRequiredArgument(rest[1], 'application id')
      const link = await createClient(env).applications.links.create(
        parseCreateApplicationLink(applicationId, rest.slice(2)),
      )

      stdout(`${JSON.stringify(link, null, 2)}\n`)
      return 0
    }

    if (resource === 'applications' && command === 'link' && rest[0] === 'update') {
      const applicationId = readRequiredArgument(rest[1], 'application id')
      const linkId = readRequiredArgument(rest[2], 'link id')
      const link = await createClient(env).applications.links.update(
        parseUpdateApplicationLink(applicationId, linkId, rest.slice(3)),
      )

      stdout(`${JSON.stringify(link, null, 2)}\n`)
      return 0
    }

    if (resource === 'applications' && command === 'events') {
      const applicationId = readRequiredArgument(rest[0], 'application id')
      const events = await createClient(env).applications.events.list(
        parseApplicationEventsQuery(applicationId, rest.slice(1)),
      )

      stdout(`${JSON.stringify(events, null, 2)}\n`)
      return 0
    }

    if (resource === 'applications' && command === 'attempts') {
      const subcommand = readRequiredArgument(rest[0], 'attempts command')
      const client = createClient(env)

      if (subcommand === 'start') {
        const applicationId = readRequiredArgument(rest[1], 'application id')
        const attempt = await client.applications.attempts.start(
          parseAttemptStart(applicationId, rest.slice(2)),
        )

        stdout(`${JSON.stringify(attempt, null, 2)}\n`)
        return 0
      }

      if (subcommand === 'step') {
        const applicationId = readRequiredArgument(rest[1], 'application id')
        const attemptId = readRequiredArgument(rest[2], 'attempt id')
        const step = await client.applications.attempts.step(
          parseAttemptStep(applicationId, attemptId, rest.slice(3)),
        )

        stdout(`${JSON.stringify(step, null, 2)}\n`)
        return 0
      }

      if (subcommand === 'complete') {
        const applicationId = readRequiredArgument(rest[1], 'application id')
        const attemptId = readRequiredArgument(rest[2], 'attempt id')
        const attempt = await client.applications.attempts.complete(
          parseAttemptComplete(applicationId, attemptId, rest.slice(3)),
        )

        stdout(`${JSON.stringify(attempt, null, 2)}\n`)
        return 0
      }

      if (subcommand === 'list') {
        const applicationId = readRequiredArgument(rest[1], 'application id')
        const attempts = await client.applications.attempts.list(
          parseApplicationAttemptsQuery(applicationId, rest.slice(2)),
        )

        stdout(`${JSON.stringify(attempts, null, 2)}\n`)
        return 0
      }

      throw new Error(`Unknown applications attempts command: ${subcommand}`)
    }

    if (resource === 'applications' && command === 'archive') {
      const applicationId = readRequiredArgument(rest[0], 'application id')

      await createClient(env).applications.archive({
        applicationId,
        note: readOptionalText(readOption(rest.slice(1), '--note'), 'archive note'),
      })

      stdout(`${JSON.stringify({ ok: true }, null, 2)}\n`)
      return 0
    }

    if (resource === 'scores' && command === 'record') {
      const applicationId = readRequiredArgument(rest[0], 'application id')

      await createClient(env).scores.record({
        applicationId,
        score: Number(readRequiredOption(rest.slice(1), '--score')),
        band: readRequiredOption(rest.slice(1), '--band'),
        roleRelevance: Number(readRequiredOption(rest.slice(1), '--role-relevance')),
        careerSignal: Number(readRequiredOption(rest.slice(1), '--career-signal')),
        cityWorkMode: Number(readRequiredOption(rest.slice(1), '--city-work-mode')),
        compensationLogistics: Number(readRequiredOption(rest.slice(1), '--compensation-logistics')),
        penalties: [],
        rationale: readRequiredOption(rest.slice(1), '--rationale'),
        rubricVersion: readOption(rest.slice(1), '--rubric-version') ?? 'valedictorian-cli',
      })

      stdout(`${JSON.stringify({ ok: true })}\n`)
      return 0
    }

    stderr(`Unknown command: ${normalizedArgv.join(' ')}\n`)
    return 1
  } catch (error) {
    stderr(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}

function createClient(env: Record<string, string | undefined>): ValedictorianClient {
  return createHttpValedictorianClient({
    baseUrl: env.VALEDICTORIAN_API_URL ?? defaultValedictorianApiBaseUrl,
    token: env.VALEDICTORIAN_API_TOKEN,
  })
}

