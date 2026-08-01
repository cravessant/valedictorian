import { buildRouteMap } from '@stricli/core'
import {
  captureHistoryInputSchema,
  captureListInputSchema,
  correctCaptureInputSchema,
  createCaptureInputSchema,
  promoteCaptureToJobInputSchema,
  removalInputSchema,
  restoreInputSchema,
} from '@sparxie/sdk'

import {
  makeCommand,
  optionFlags,
  workspaceClient,
  writeJson,
} from './valedictorian-cli.command-runtime.js'
import { CliOwnedFailure } from './valedictorian-cli.failures.js'
import {
  actorOptionalFlags,
  historyInputFlags,
  inputJsonFlags,
  listInputFlags,
  parseCaptureCreateInput,
  parseContractInput,
  parsePromotionInput,
  parseRemovalInput,
  parseRestoreInput,
  promotionOptionalFlags,
  removalRequiredFlags,
  restoreRequiredFlags,
} from './valedictorian-cli.lifecycle-input.js'
import { buildCaptureResolutionRoute } from './valedictorian-cli.capture-resolution-commands.js'

export function buildCapturesRoute() {
  return buildRouteMap({
    docs: { brief: 'Manage captured source evidence' },
    routes: {
      list: makeCommand({
        docs: { brief: 'List captures' },
        flags: optionFlags(listInputFlags),
        run: async (context, flags) => {
          const client = await workspaceClient(context, flags)
          const input = parseContractInput(flags, captureListInputSchema, { optional: true })
          writeJson(context, await client.captures.list(input))
        },
      }),
      get: makeCommand({
        docs: { brief: 'Get a capture' },
        flags: optionFlags(['workspace']),
        positionalCount: 1,
        run: async (context, flags, captureId) => {
          const resource = await (await workspaceClient(context, flags)).captures.get(captureId)
          if (!resource) throw notFound('capture', captureId)
          writeJson(context, resource)
        },
      }),
      create: makeCommand({
        docs: { brief: 'Create a capture with explicit provenance and evidence' },
        flags: optionFlags(
          ['evidence-json', 'payload-json', 'provider-record-id', 'provider-schema', 'workspace'],
          ['adapter-id', 'adapter-kind', 'adapter-version', 'evidence-mode', 'observed-at'],
        ),
        run: async (context, flags) => {
          const client = await workspaceClient(context, flags)
          writeJson(
            context,
            await client.captures.create(parseCaptureCreateInput(flags, createCaptureInputSchema)),
          )
        },
      }),
      correct: makeCommand({
        docs: { brief: 'Correct a capture' },
        flags: optionFlags([], inputJsonFlags),
        positionalCount: 1,
        run: async (context, flags, captureId) => {
          const client = await workspaceClient(context, flags)
          const input = parseContractInput(flags, correctCaptureInputSchema, {
            id: ['captureId', captureId],
          })
          writeJson(context, await client.captures.correct(input))
        },
      }),
      remove: makeCommand({
        docs: { brief: 'Remove a capture using an explicit dependent-resource choice' },
        flags: optionFlags(actorOptionalFlags, removalRequiredFlags),
        positionalCount: 1,
        run: async (context, flags, captureId) => {
          const client = await workspaceClient(context, flags)
          writeJson(
            context,
            await client.captures.remove(parseRemovalInput(flags, removalInputSchema, captureId)),
          )
        },
      }),
      restore: makeCommand({
        docs: { brief: 'Restore a capture' },
        flags: optionFlags(actorOptionalFlags, restoreRequiredFlags),
        positionalCount: 1,
        run: async (context, flags, captureId) => {
          const client = await workspaceClient(context, flags)
          writeJson(
            context,
            await client.captures.restore(parseRestoreInput(flags, restoreInputSchema, captureId)),
          )
        },
      }),
      history: makeCommand({
        docs: { brief: 'List capture history' },
        flags: optionFlags(historyInputFlags),
        positionalCount: 1,
        run: async (context, flags, captureId) => {
          const client = await workspaceClient(context, flags)
          const input = parseContractInput(flags, captureHistoryInputSchema, {
            id: ['id', captureId],
            optional: true,
          })
          writeJson(context, await client.captures.history(input))
        },
      }),
      'promote-to-job': makeCommand({
        docs: { brief: 'Promote a capture to a job' },
        flags: optionFlags(promotionOptionalFlags, ['input-json']),
        positionalCount: 1,
        run: async (context, flags, captureId) => {
          const client = await workspaceClient(context, flags)
          const input = parsePromotionInput(flags, promoteCaptureToJobInputSchema, [
            'captureId',
            captureId,
          ])
          writeJson(context, await client.captures.promoteToJob(input))
        },
      }),
      resolution: buildCaptureResolutionRoute(),
    },
  })
}

function notFound(resource: string, id: string) {
  return new CliOwnedFailure({
    code: `${resource}_not_found`,
    kind: 'not_found',
    status: 404,
    message: `${resource[0]?.toUpperCase()}${resource.slice(1)} not found: ${id}`,
  })
}
