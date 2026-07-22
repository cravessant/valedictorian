import { buildRouteMap } from '@stricli/core'

import {
  makeCommand,
  optionFlags,
  toArgvWithoutWorkspace,
  workspaceClient,
  writeJson,
} from './valedictorian-cli.command-runtime.js'
import {
  parseRunComplete,
  parseRunStart,
  parseRunStep,
  parseWorkflowRunsListQuery,
} from './valedictorian-cli.parsers.js'

export function buildRunsRoute() {
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
