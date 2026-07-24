import { buildRouteMap } from '@stricli/core'
import {
  addCompanyAliasInputSchema,
  archiveCompanyInputSchema,
  companyAssignedJobListInputSchema,
  companyDirectoryListInputSchema,
  companyDuplicateListInputSchema,
  companyHistoryListInputSchema,
  companyMatchPreviewInputSchema,
  companySearchInputSchema,
  createCompanyInputSchema,
  markCompaniesDistinctInputSchema,
  mergeCompaniesInputSchema,
  removeCompanyAliasInputSchema,
  restoreCompanyInputSchema,
  updateCompanyAliasInputSchema,
  updateCompanyInputSchema,
  updateCompanyNotesInputSchema,
} from '@sparxie/sdk'

import {
  makeCommand,
  optionFlags,
  workspaceClient,
  workspaceClientWithId,
  writeJson,
} from './valedictorian-cli.command-runtime.js'
import {
  inputJsonFlags,
  listInputFlags,
  parseContractInput,
} from './valedictorian-cli.lifecycle-input.js'
import type { CompanyCollectionOutput } from './valedictorian-cli.company-output.js'

export function buildCompaniesRoute() {
  return buildRouteMap({
    docs: { brief: 'Manage Workspace Companies' },
    routes: {
      capability: makeCommand({
        docs: { brief: 'Get Workspace Company capability' },
        flags: optionFlags(['workspace']),
        run: async (context, flags) => {
          const client = await workspaceClient(context, flags)
          writeJson(context, await client.companies.capability.get())
        },
      }),
      list: directoryList(),
      get: companyRead('Get a Workspace Company', (client, companyId) => client.companies.get(companyId)),
      lookup: companyRead(
        'Get a Workspace Company and canonical merge target',
        (client, companyId) => client.companies.lookup(companyId),
      ),
      search: queryCommand(
        'Search active Workspace Companies; include archived only with explicit scope',
        companySearchInputSchema,
        (client, input) => client.companies.search(input),
      ),
      'preview-matches': queryCommand(
        'Preview possible Company matches without creating a Company',
        companyMatchPreviewInputSchema,
        (client, input) => client.companies.previewMatches(input),
        'match-preview',
      ),
      create: companyMutation('Create a Workspace Company', createCompanyInputSchema, (client, input) =>
        client.companies.create(input)),
      update: identifiedCompanyMutation(
        'Update a Workspace Company',
        updateCompanyInputSchema,
        (client, input) => client.companies.update(input),
      ),
      notes: buildNotesRoute(),
      aliases: buildAliasesRoute(),
      archive: identifiedCompanyMutation(
        'Archive a Workspace Company',
        archiveCompanyInputSchema,
        (client, input) => client.companies.archive(input),
      ),
      restore: identifiedCompanyMutation(
        'Restore a Workspace Company',
        restoreCompanyInputSchema,
        (client, input) => client.companies.restore(input),
      ),
      duplicates: buildDuplicatesRoute(),
      'assigned-jobs': buildAssignedJobsRoute(),
      history: buildHistoryRoute(),
    },
  })
}

function directoryList() {
  return makeCommand({
    docs: { brief: 'List the Workspace Company directory' },
    flags: optionFlags(listInputFlags),
    run: async (context, flags) => {
      const client = await workspaceClient(context, flags)
      const input = parseContractInput(flags, companyDirectoryListInputSchema, { optional: true })
      writeJson(context, await client.companies.directory.list(input), true, {
        companyCollection: 'directory',
      })
    },
  })
}

function companyRead(
  brief: string,
  operation: (client: WorkspaceClient, companyId: string) => Promise<unknown>,
) {
  return makeCommand({
    docs: { brief },
    flags: optionFlags(['workspace']),
    positionalCount: 1,
    run: async (context, flags, companyId) => {
      const client = await workspaceClient(context, flags)
      writeJson(context, await operation(client, companyId))
    },
  })
}

function queryCommand<T>(
  brief: string,
  schema: ContractSchema<T>,
  operation: (client: WorkspaceClient, input: T) => Promise<unknown>,
  companyCollection?: CompanyCollectionOutput,
) {
  return makeCommand({
    docs: { brief },
    flags: optionFlags([], inputJsonFlags),
    run: async (context, flags) => {
      const client = await workspaceClient(context, flags)
      writeJson(context, await operation(client, parseContractInput(flags, schema)), true, {
        companyCollection,
      })
    },
  })
}

function companyMutation<T>(
  brief: string,
  schema: ContractSchema<T>,
  operation: (client: WorkspaceClient, input: T) => Promise<unknown>,
) {
  return makeCommand({
    docs: { brief },
    flags: optionFlags([], inputJsonFlags),
    run: async (context, flags) => {
      const { client, workspaceId } = await workspaceClientWithId(context, flags)
      const input = parseContractInput(flags, schema, { workspaceId })
      writeJson(context, await operation(client, input))
    },
  })
}

function identifiedCompanyMutation<T>(
  brief: string,
  schema: ContractSchema<T>,
  operation: (client: WorkspaceClient, input: T) => Promise<unknown>,
) {
  return makeCommand({
    docs: { brief },
    flags: optionFlags([], inputJsonFlags),
    positionalCount: 1,
    run: async (context, flags, companyId) => {
      const { client, workspaceId } = await workspaceClientWithId(context, flags)
      const input = parseContractInput(flags, schema, {
        id: ['companyId', companyId],
        workspaceId,
      })
      writeJson(context, await operation(client, input))
    },
  })
}

function buildNotesRoute() {
  return buildRouteMap({
    docs: { brief: 'Edit Workspace Company notes' },
    routes: {
      update: identifiedCompanyMutation(
        'Update Workspace Company notes',
        updateCompanyNotesInputSchema,
        (client, input) => client.companies.notes.update(input),
      ),
    },
  })
}

function buildAliasesRoute() {
  return buildRouteMap({
    docs: { brief: 'Manage Workspace Company aliases' },
    routes: {
      add: identifiedCompanyMutation(
        'Add a Workspace Company alias',
        addCompanyAliasInputSchema,
        (client, input) => client.companies.aliases.add(input),
      ),
      update: makeAliasMutation(
        'Update a Workspace Company alias',
        updateCompanyAliasInputSchema,
        (client, input) => client.companies.aliases.update(input),
      ),
      remove: makeAliasMutation(
        'Remove a Workspace Company alias',
        removeCompanyAliasInputSchema,
        (client, input) => client.companies.aliases.remove(input),
      ),
    },
  })
}

function makeAliasMutation<T>(
  brief: string,
  schema: ContractSchema<T>,
  operation: (client: WorkspaceClient, input: T) => Promise<unknown>,
) {
  return makeCommand({
    docs: { brief },
    flags: optionFlags([], inputJsonFlags),
    positionalCount: 2,
    run: async (context, flags, companyId, aliasId) => {
      const { client, workspaceId } = await workspaceClientWithId(context, flags)
      const input = parseContractInput(flags, schema, {
        ids: [['companyId', companyId], ['aliasId', aliasId]],
        workspaceId,
      })
      writeJson(context, await operation(client, input))
    },
  })
}

function buildDuplicatesRoute() {
  return buildRouteMap({
    docs: { brief: 'Review possible Workspace Company duplicates' },
    routes: {
      list: makeCommand({
        docs: { brief: 'List possible Company duplicates' },
        flags: optionFlags(listInputFlags),
        run: async (context, flags) => {
          const client = await workspaceClient(context, flags)
          const input = parseContractInput(flags, companyDuplicateListInputSchema, { optional: true })
          writeJson(context, await client.companies.duplicates.list(input), true, {
            companyCollection: 'duplicates',
          })
        },
      }),
      get: makeCommand({
        docs: { brief: 'Get a possible Company duplicate' },
        flags: optionFlags(['workspace']),
        positionalCount: 1,
        run: async (context, flags, candidateId) => {
          const client = await workspaceClient(context, flags)
          writeJson(context, await client.companies.duplicates.get(candidateId))
        },
      }),
      'mark-distinct': candidateMutation(
        'Mark a possible Company duplicate as distinct',
        markCompaniesDistinctInputSchema,
        (client, input) => client.companies.duplicates.markDistinct(input),
      ),
      merge: makeCommand({
        docs: { brief: 'Irreversibly merge a losing Company into an explicit winner' },
        flags: optionFlags([], inputJsonFlags),
        positionalCount: 2,
        run: async (context, flags, winnerCompanyId, loserCompanyId) => {
          const { client, workspaceId } = await workspaceClientWithId(context, flags)
          const input = parseContractInput(flags, mergeCompaniesInputSchema, {
            ids: [['winnerCompanyId', winnerCompanyId], ['loserCompanyId', loserCompanyId]],
            workspaceId,
          })
          writeJson(context, await client.companies.duplicates.merge(input))
        },
      }),
    },
  })
}

function candidateMutation<T>(
  brief: string,
  schema: ContractSchema<T>,
  operation: (client: WorkspaceClient, input: T) => Promise<unknown>,
) {
  return makeCommand({
    docs: { brief },
    flags: optionFlags([], inputJsonFlags),
    positionalCount: 1,
    run: async (context, flags, candidateId) => {
      const { client, workspaceId } = await workspaceClientWithId(context, flags)
      const input = parseContractInput(flags, schema, {
        id: ['candidateId', candidateId],
        workspaceId,
      })
      writeJson(context, await operation(client, input))
    },
  })
}

function buildAssignedJobsRoute() {
  return buildRouteMap({
    docs: { brief: 'Inspect current Jobs assigned to a Company' },
    routes: {
      list: companyPage(
        'List current Jobs assigned to a Company',
        companyAssignedJobListInputSchema,
        'assigned-jobs',
        (client, companyId, input) => client.companies.assignedJobs.list(companyId, input),
      ),
    },
  })
}

function buildHistoryRoute() {
  return buildRouteMap({
    docs: { brief: 'Inspect Workspace Company history' },
    routes: {
      list: companyPage(
        'List Workspace Company history',
        companyHistoryListInputSchema,
        'history',
        (client, companyId, input) => client.companies.history.list(companyId, input),
      ),
    },
  })
}

function companyPage<T>(
  brief: string,
  schema: ContractSchema<T>,
  companyCollection: CompanyCollectionOutput,
  operation: (client: WorkspaceClient, companyId: string, input: T) => Promise<unknown>,
) {
  return makeCommand({
    docs: { brief },
    flags: optionFlags(listInputFlags),
    positionalCount: 1,
    run: async (context, flags, companyId) => {
      const client = await workspaceClient(context, flags)
      const input = parseContractInput(flags, schema, { optional: true })
      writeJson(context, await operation(client, companyId, input), true, {
        companyCollection,
      })
    },
  })
}

type WorkspaceClient = Awaited<ReturnType<typeof workspaceClient>>
type ContractSchema<T> = { safeParse(value: unknown): { success: true; data: T } | { success: false } }
