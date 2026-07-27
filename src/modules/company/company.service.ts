import type { PgliteDatabase } from '../../db/pglite'
import type { Clock, UuidV7Generator } from '../../db/uuidv7'
import type { LocalWorkspaceCompaniesClient } from '../../runtime/local-connector-client.contract'
import { createCompanyCommands } from './company.commands'
import { createCompanyDuplicateService } from './company.duplicates'
import { createCompanyMergeService } from './company.merge'
import { createCompanyQueries } from './company.queries'
import { createCompanyRelatedQueries } from './company.related-queries'

export interface CompanyServiceOptions {
  readonly workspaceId: string
  readonly now?: Clock
  readonly newId?: UuidV7Generator
}

export function createPgliteCompanyService(
  database: PgliteDatabase,
  options: CompanyServiceOptions,
): LocalWorkspaceCompaniesClient {
  const commands = createCompanyCommands(database, options.workspaceId, {
    ...(options.now ? { now: options.now } : {}),
    ...(options.newId ? { newId: options.newId } : {}),
  })
  const queries = createCompanyQueries(database, options.workspaceId)
  const related = createCompanyRelatedQueries(database, options.workspaceId)
  const duplicates = createCompanyDuplicateService(database, options.workspaceId, {
    ...(options.now ? { now: options.now } : {}),
    ...(options.newId ? { newId: options.newId } : {}),
  })
  const merge = createCompanyMergeService(database, options.workspaceId, {
    ...(options.now ? { now: options.now } : {}),
    ...(options.newId ? { newId: options.newId } : {}),
  })

  return {
    create: (...args) => commands.create(...args),
    get: (...args) => queries.get(...args),
    lookup: (...args) => queries.lookup(...args),
    search: (...args) => queries.search(...args),
    previewMatches: (...args) => queries.previewMatches(...args),
    directory: { list: (...args) => queries.listDirectory(...args) },
    update: (...args) => commands.update(...args),
    notes: { update: (...args) => commands.updateNotes(...args) },
    aliases: {
      add: (...args) => commands.addAlias(...args),
      update: (...args) => commands.updateAlias(...args),
      remove: (...args) => commands.removeAlias(...args),
    },
    archive: (...args) => commands.archive(...args),
    restore: (...args) => commands.restore(...args),
    duplicates: {
      list: (...args) => duplicates.list(...args),
      get: (...args) => duplicates.get(...args),
      markDistinct: (...args) => duplicates.markDistinct(...args),
      merge,
    },
    assignedJobs: { list: (...args) => related.listAssignedJobs(...args) },
    history: { list: (...args) => related.listHistory(...args) },
  }
}
