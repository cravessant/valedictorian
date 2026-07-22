import { buildRouteMap } from '@stricli/core'
import {
  createOpportunityInputSchema,
  opportunityHistoryInputSchema,
  opportunityListInputSchema,
  promoteOpportunityToApplicationInputSchema,
  removalInputSchema,
  restoreInputSchema,
  updateOpportunityDispositionInputSchema,
  updateOpportunityEvaluationInputSchema,
} from 'sparxie'

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
  parseContractInput,
  parsePromotionInput,
  parseRemovalInput,
  parseRestoreInput,
  promotionOptionalFlags,
  removalRequiredFlags,
  restoreRequiredFlags,
} from './valedictorian-cli.lifecycle-input.js'

export function buildOpportunitiesRoute() {
  return buildRouteMap({
    docs: { brief: 'Evaluate and manage opportunities' },
    routes: {
      list: makeCommand({
        docs: { brief: 'List opportunities' },
        flags: optionFlags(listInputFlags),
        run: async (context, flags) => {
          const client = await workspaceClient(context, flags)
          const input = parseContractInput(flags, opportunityListInputSchema, { optional: true })
          writeJson(context, await client.opportunities.list(input))
        },
      }),
      get: makeCommand({
        docs: { brief: 'Get an opportunity' },
        flags: optionFlags(['workspace']),
        positionalCount: 1,
        run: async (context, flags, opportunityId) => {
          const resource = await (await workspaceClient(context, flags)).opportunities.get(opportunityId)
          if (!resource) throw opportunityNotFound(opportunityId)
          writeJson(context, resource)
        },
      }),
      create: inputMutation('Create an opportunity', createOpportunityInputSchema, (client, input) =>
        client.opportunities.create(input)),
      'update-evaluation': identifiedMutation(
        'Update opportunity evaluation',
        updateOpportunityEvaluationInputSchema,
        (client, input) => client.opportunities.updateEvaluation(input),
      ),
      'update-disposition': identifiedMutation(
        'Update opportunity disposition',
        updateOpportunityDispositionInputSchema,
        (client, input) => client.opportunities.updateDisposition(input),
      ),
      remove: makeCommand({
        docs: { brief: 'Remove an opportunity using an explicit dependent-resource choice' },
        flags: optionFlags(actorOptionalFlags, removalRequiredFlags),
        positionalCount: 1,
        run: async (context, flags, opportunityId) => {
          const client = await workspaceClient(context, flags)
          writeJson(
            context,
            await client.opportunities.remove(
              parseRemovalInput(flags, removalInputSchema, opportunityId),
            ),
          )
        },
      }),
      restore: makeCommand({
        docs: { brief: 'Restore an opportunity' },
        flags: optionFlags(actorOptionalFlags, restoreRequiredFlags),
        positionalCount: 1,
        run: async (context, flags, opportunityId) => {
          const client = await workspaceClient(context, flags)
          writeJson(
            context,
            await client.opportunities.restore(
              parseRestoreInput(flags, restoreInputSchema, opportunityId),
            ),
          )
        },
      }),
      history: makeCommand({
        docs: { brief: 'List opportunity history' },
        flags: optionFlags(historyInputFlags),
        positionalCount: 1,
        run: async (context, flags, opportunityId) => {
          const client = await workspaceClient(context, flags)
          const input = parseContractInput(flags, opportunityHistoryInputSchema, {
            id: ['id', opportunityId],
            optional: true,
          })
          writeJson(context, await client.opportunities.history(input))
        },
      }),
      'promote-to-application': makeCommand({
        docs: { brief: 'Promote an opportunity to an application' },
        flags: optionFlags(promotionOptionalFlags, ['input-json']),
        positionalCount: 1,
        run: async (context, flags, opportunityId) => {
          const client = await workspaceClient(context, flags)
          const input = parsePromotionInput(flags, promoteOpportunityToApplicationInputSchema, [
            'opportunityId',
            opportunityId,
          ])
          writeJson(context, await client.opportunities.promoteToApplication(input))
        },
      }),
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
  operation: (client: WorkspaceClient, input: T) => Promise<unknown>,
) {
  return makeCommand({
    docs: { brief },
    flags: optionFlags([], inputJsonFlags),
    positionalCount: 1,
    run: async (context, flags, opportunityId) => {
      const client = await workspaceClient(context, flags)
      const input = parseContractInput(flags, schema, { id: ['opportunityId', opportunityId] })
      writeJson(context, await operation(client, input))
    },
  })
}

function opportunityNotFound(id: string) {
  return new CliOwnedFailure({
    code: 'opportunity_not_found',
    kind: 'not_found',
    status: 404,
    message: `Opportunity not found: ${id}`,
  })
}
