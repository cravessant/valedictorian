import { buildRouteMap } from '@stricli/core'
import {
  captureResolutionListInputSchema,
  completeCaptureManuallyInputSchema,
  replayCaptureRevisionInputSchema,
  retryCaptureProcessingInputSchema,
} from '@sparxie/sdk'

import {
  makeCommand,
  optionFlags,
  workspaceClient,
  writeJson,
} from './valedictorian-cli.command-runtime.js'
import {
  inputJsonFlags,
  listInputFlags,
  parseContractInput,
} from './valedictorian-cli.lifecycle-input.js'

export function buildCaptureResolutionRoute() {
  return buildRouteMap({
    docs: { brief: 'Resolve captured evidence into jobs' },
    routes: {
      list: makeCommand({
        docs: { brief: 'List capture resolution projections' },
        flags: optionFlags(listInputFlags),
        run: async (context, flags) => {
          const client = await workspaceClient(context, flags)
          const input = parseContractInput(flags, captureResolutionListInputSchema, { optional: true })
          writeJson(context, await client.captureResolution.list(input))
        },
      }),
      get: makeCommand({
        docs: { brief: 'Get fresh capture completion detail' },
        flags: optionFlags(['workspace']),
        positionalCount: 1,
        run: async (context, flags, captureId) => {
          const client = await workspaceClient(context, flags)
          writeJson(context, await client.captureResolution.get(captureId))
        },
      }),
      retry: identifiedMutation(
        'Retry unpromoted capture processing',
        retryCaptureProcessingInputSchema,
        (client, input) => client.captureResolution.retry(input),
      ),
      replay: identifiedMutation(
        'Replay an unpromoted capture revision',
        replayCaptureRevisionInputSchema,
        (client, input) => client.captureResolution.replay(input),
      ),
      complete: identifiedMutation(
        'Atomically complete a capture into a job',
        completeCaptureManuallyInputSchema,
        (client, input) => client.captureResolution.complete(input),
      ),
    },
  })
}

type WorkspaceClient = Awaited<ReturnType<typeof workspaceClient>>
type ContractSchema<T> = { safeParse(value: unknown): { success: true; data: T } | { success: false } }

function identifiedMutation<T>(
  brief: string,
  schema: ContractSchema<T>,
  operation: (client: WorkspaceClient, input: T) => Promise<unknown>,
) {
  return makeCommand({
    docs: { brief },
    flags: optionFlags([], inputJsonFlags),
    positionalCount: 1,
    run: async (context, flags, captureId) => {
      const client = await workspaceClient(context, flags)
      const input = parseContractInput(flags, schema, { id: ['captureId', captureId] })
      writeJson(context, await operation(client, input))
    },
  })
}
