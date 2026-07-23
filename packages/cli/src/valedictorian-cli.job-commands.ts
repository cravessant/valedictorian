import { buildRouteMap } from '@stricli/core'
import {
  addJobExternalIdentityInputSchema,
  correctJobFactsInputSchema,
  createJobInputSchema,
  jobHistoryInputSchema,
  jobIdSchema,
  jobListInputSchema,
  promoteJobToOpportunityInputSchema,
  removeJobExternalIdentityInputSchema,
  removeJobInputSchema,
  restoreJobInputSchema,
  updateJobAvailabilityInputSchema,
} from '@sparxie/sdk'

import {
  makeCommand,
  optionFlags,
  workspaceClient,
  writeJson,
} from './valedictorian-cli.command-runtime.js'
import { CliOwnedFailure, CliUsageError } from './valedictorian-cli.failures.js'
import {
  actorOptionalFlags,
  historyInputFlags,
  inputJsonFlags,
  listInputFlags,
  parseContractInput,
  parsePromotionInput,
  parseRemovalInput,
  parseRestoreInput,
  promotionOptionalFlags,
  removalRequiredFlags,
  restoreRequiredFlags,
} from './valedictorian-cli.lifecycle-input.js'

export function buildJobsRoute() {
  return buildRouteMap({
    docs: { brief: 'Manage canonical jobs' },
    routes: {
      list: makeCommand({
        docs: { brief: 'List jobs' },
        flags: optionFlags(listInputFlags),
        run: async (context, flags) => {
          const client = await workspaceClient(context, flags)
          writeJson(
            context,
            await client.jobs.list(parseContractInput(flags, jobListInputSchema, { optional: true })),
          )
        },
      }),
      get: makeCommand({
        docs: { brief: 'Get a job' },
        flags: optionFlags(['workspace']),
        positionalCount: 1,
        run: async (context, flags, jobId) => {
          const parsedId = jobIdSchema.safeParse(jobId)
          if (!parsedId.success) throw new CliUsageError(`Invalid job id: ${jobId}`)
          const resource = await (await workspaceClient(context, flags)).jobs.get(parsedId.data)
          if (!resource) throw jobNotFound(jobId)
          writeJson(context, resource)
        },
      }),
      create: inputMutation('Create a job', createJobInputSchema, (client, input) =>
        client.jobs.create(input)),
      'correct-facts': identifiedMutation(
        'Correct job facts',
        correctJobFactsInputSchema,
        'jobId',
        (client, input) => client.jobs.correctFacts(input),
      ),
      'update-availability': identifiedMutation(
        'Update job availability',
        updateJobAvailabilityInputSchema,
        'jobId',
        (client, input) => client.jobs.updateAvailability(input),
      ),
      'external-identities': buildExternalIdentitiesRoute(),
      remove: makeCommand({
        docs: { brief: 'Remove a job using an explicit dependent-resource choice' },
        flags: optionFlags(actorOptionalFlags, removalRequiredFlags),
        positionalCount: 1,
        run: async (context, flags, jobId) => {
          const client = await workspaceClient(context, flags)
          writeJson(
            context,
            await client.jobs.remove(parseRemovalInput(flags, removeJobInputSchema, jobId)),
          )
        },
      }),
      restore: makeCommand({
        docs: { brief: 'Restore a job' },
        flags: optionFlags(actorOptionalFlags, restoreRequiredFlags),
        positionalCount: 1,
        run: async (context, flags, jobId) => {
          const client = await workspaceClient(context, flags)
          writeJson(
            context,
            await client.jobs.restore(parseRestoreInput(flags, restoreJobInputSchema, jobId)),
          )
        },
      }),
      history: makeCommand({
        docs: { brief: 'List job history' },
        flags: optionFlags(historyInputFlags),
        positionalCount: 1,
        run: async (context, flags, jobId) => {
          const client = await workspaceClient(context, flags)
          const input = parseContractInput(flags, jobHistoryInputSchema, {
            id: ['id', jobId],
            optional: true,
          })
          writeJson(context, await client.jobs.history(input))
        },
      }),
      'promote-to-opportunity': makeCommand({
        docs: { brief: 'Promote a job to an opportunity' },
        flags: optionFlags(promotionOptionalFlags, ['input-json']),
        positionalCount: 1,
        run: async (context, flags, jobId) => {
          const client = await workspaceClient(context, flags)
          const input = parsePromotionInput(flags, promoteJobToOpportunityInputSchema, [
            'jobId',
            jobId,
          ])
          writeJson(context, await client.jobs.promoteToOpportunity(input))
        },
      }),
    },
  })
}

function buildExternalIdentitiesRoute() {
  return buildRouteMap({
    docs: { brief: 'Manage job external identities' },
    routes: {
      add: identifiedMutation(
        'Add a job external identity',
        addJobExternalIdentityInputSchema,
        'jobId',
        (client, input) => client.jobs.externalIdentities.add(input),
      ),
      remove: identifiedMutation(
        'Remove a job external identity',
        removeJobExternalIdentityInputSchema,
        'jobId',
        (client, input) => client.jobs.externalIdentities.remove(input),
      ),
    },
  })
}

type WorkspaceClient = Awaited<ReturnType<typeof workspaceClient>>
type ContractSchema<T> = { safeParse(value: unknown): { success: true; data: T } | { success: false } }

function inputMutation<T>(
  brief: string,
  schema: ContractSchema<T>,
  operation: (client: WorkspaceClient, input: T) => Promise<unknown>,
) {
  return makeCommand({
    docs: { brief },
    flags: optionFlags([], inputJsonFlags),
    run: async (context, flags) => {
      const client = await workspaceClient(context, flags)
      writeJson(context, await operation(client, parseContractInput(flags, schema)))
    },
  })
}

function identifiedMutation<T>(
  brief: string,
  schema: ContractSchema<T>,
  idField: string,
  operation: (client: WorkspaceClient, input: T) => Promise<unknown>,
) {
  return makeCommand({
    docs: { brief },
    flags: optionFlags([], inputJsonFlags),
    positionalCount: 1,
    run: async (context, flags, id) => {
      const client = await workspaceClient(context, flags)
      const input = parseContractInput(flags, schema, { id: [idField, id] })
      writeJson(context, await operation(client, input))
    },
  })
}

function jobNotFound(id: string) {
  return new CliOwnedFailure({
    code: 'job_not_found',
    kind: 'not_found',
    status: 404,
    message: `Job not found: ${id}`,
  })
}
