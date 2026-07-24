import type http from 'node:http'
import {
  companyAssignedJobListInputSchema,
  companyDirectoryListInputSchema,
  companyDuplicateListInputSchema,
  companyHistoryListInputSchema,
  companyMatchPreviewInputSchema,
  companySearchInputSchema,
  createCompanyInputSchema,
  addCompanyAliasInputSchema,
  archiveCompanyInputSchema,
  removeCompanyAliasInputSchema,
  markCompaniesDistinctInputSchema,
  reassignJobCompanyInputSchema,
  restoreCompanyInputSchema,
  updateCompanyAliasInputSchema,
  updateCompanyInputSchema,
  updateCompanyNotesInputSchema,
} from '@sparxie/sdk'
import type { LocalValedictorianClient } from '../runtime/local-connector-client.contract'
import {
  parseLocalHttpInput,
  readJsonBody,
  writeJson,
} from './local-server.http'

type CompanyRouteContext = {
  client: LocalValedictorianClient
  request: http.IncomingMessage
  requestUrl: URL
  response: http.ServerResponse
}

export async function handleCompanyRoutes({
  client,
  request,
  requestUrl,
  response,
}: CompanyRouteContext): Promise<boolean> {
  const workspaceId = client.workspaceId
  const assignmentMatch = requestUrl.pathname.match(
    /^\/v1\/jobs\/([^/]+)\/company-assignment(?:\/(reassign))?$/,
  )
  if (assignmentMatch) {
    const jobId = decode(assignmentMatch[1]!)
    if (request.method === 'GET' && !assignmentMatch[2]) {
      writeJson(response, 200, await client.companyAssignments.get(jobId))
      return true
    }
    if (request.method === 'POST' && assignmentMatch[2] === 'reassign') {
      const body = await readJsonBody(request)
      const input = parseLocalHttpInput(() => reassignJobCompanyInputSchema.parse({
        ...asRecord(body),
        workspaceId,
        jobId,
      }))
      writeJson(response, 200, await client.companyAssignments.reassign(input))
      return true
    }
    return false
  }
  if (!requestUrl.pathname.startsWith('/v1/companies')) return false
  const { method } = request
  const { pathname } = requestUrl

  if (method === 'GET' && pathname === '/v1/companies/capability') {
    writeJson(response, 200, await client.companies.capability.get())
    return true
  }
  if (method === 'GET' && pathname === '/v1/companies/search') {
    writeJson(response, 200, await client.companies.search(
      parseQuery(companySearchInputSchema, requestUrl),
    ))
    return true
  }
  if (method === 'POST' && pathname === '/v1/companies/match-preview') {
    const body = await readJsonBody(request)
    writeJson(response, 200, await client.companies.previewMatches(
      parseLocalHttpInput(() => companyMatchPreviewInputSchema.parse(body)),
    ))
    return true
  }
  if (pathname === '/v1/companies') {
    if (method === 'GET') {
      writeJson(response, 200, await client.companies.directory.list(
        parseQuery(companyDirectoryListInputSchema, requestUrl),
      ))
      return true
    }
    if (method === 'POST') {
      const body = await readJsonBody(request)
      const input = parseLocalHttpInput(() => createCompanyInputSchema.parse({
        ...asRecord(body),
        workspaceId,
      }))
      writeJson(response, 200, await client.companies.create(input))
      return true
    }
    return false
  }

  if (pathname === '/v1/companies/duplicate-candidates') {
    if (method === 'GET') {
      writeJson(response, 200, await client.companies.duplicates.list(
        parseQuery(companyDuplicateListInputSchema, requestUrl),
      ))
      return true
    }
    return false
  }
  const duplicateMatch = pathname.match(
    /^\/v1\/companies\/duplicate-candidates\/([^/]+)(?:\/(mark-distinct))?$/,
  )
  if (duplicateMatch) {
    const candidateId = decode(duplicateMatch[1]!)
    if (method === 'GET' && !duplicateMatch[2]) {
      writeJson(response, 200, await client.companies.duplicates.get(candidateId))
      return true
    }
    if (method === 'POST' && duplicateMatch[2] === 'mark-distinct') {
      const body = await readJsonBody(request)
      const input = parseLocalHttpInput(() => markCompaniesDistinctInputSchema.parse({
        ...asRecord(body),
        workspaceId,
        candidateId,
      }))
      writeJson(response, 200, await client.companies.duplicates.markDistinct(input))
      return true
    }
    return false
  }

  const aliasMatch = pathname.match(/^\/v1\/companies\/([^/]+)\/aliases\/([^/]+)$/)
  if (aliasMatch) {
    const companyId = decode(aliasMatch[1]!)
    const aliasId = decode(aliasMatch[2]!)
    const body = await readJsonBody(request)
    if (method === 'PATCH') {
      const input = parseLocalHttpInput(() => updateCompanyAliasInputSchema.parse({
        ...asRecord(body),
        workspaceId,
        companyId,
        aliasId,
      }))
      writeJson(response, 200, await client.companies.aliases.update(input))
      return true
    }
    if (method === 'DELETE') {
      const input = parseLocalHttpInput(() => removeCompanyAliasInputSchema.parse({
        ...asRecord(body),
        workspaceId,
        companyId,
        aliasId,
      }))
      writeJson(response, 200, await client.companies.aliases.remove(input))
      return true
    }
    return false
  }

  const actionMatch = pathname.match(
    /^\/v1\/companies\/([^/]+)\/(lookup|notes|aliases|archive|restore|assigned-jobs|history)$/,
  )
  if (actionMatch) {
    return handleCompanyAction({
      action: actionMatch[2]!,
      client,
      companyId: decode(actionMatch[1]!),
      method,
      request,
      requestUrl,
      response,
      workspaceId,
    })
  }

  const companyMatch = pathname.match(/^\/v1\/companies\/([^/]+)$/)
  if (!companyMatch) return false
  const companyId = decode(companyMatch[1]!)
  if (method === 'GET') {
    writeJson(response, 200, await client.companies.get(companyId))
    return true
  }
  if (method === 'PATCH') {
    const body = await readJsonBody(request)
    const input = parseLocalHttpInput(() => updateCompanyInputSchema.parse({
      ...asRecord(body),
      workspaceId,
      companyId,
    }))
    writeJson(response, 200, await client.companies.update(input))
    return true
  }
  return false
}

async function handleCompanyAction(input: {
  readonly action: string
  readonly client: LocalValedictorianClient
  readonly companyId: string
  readonly method: string | undefined
  readonly request: http.IncomingMessage
  readonly requestUrl: URL
  readonly response: http.ServerResponse
  readonly workspaceId: string
}): Promise<boolean> {
  const { action, client, companyId, method, request, requestUrl, response, workspaceId } = input
  if (method === 'GET' && action === 'lookup') {
    writeJson(response, 200, await client.companies.lookup(companyId))
    return true
  }
  if (method === 'GET' && action === 'assigned-jobs') {
    writeJson(response, 200, await client.companies.assignedJobs.list(
      companyId,
      parseQuery(companyAssignedJobListInputSchema, requestUrl),
    ))
    return true
  }
  if (method === 'GET' && action === 'history') {
    writeJson(response, 200, await client.companies.history.list(
      companyId,
      parseQuery(companyHistoryListInputSchema, requestUrl),
    ))
    return true
  }
  const body = await readJsonBody(request)
  const context = { ...asRecord(body), workspaceId, companyId }
  if (method === 'PATCH' && action === 'notes') {
    const parsed = parseLocalHttpInput(() => updateCompanyNotesInputSchema.parse(context))
    writeJson(response, 200, await client.companies.notes.update(parsed))
    return true
  }
  if (method === 'POST' && action === 'aliases') {
    const parsed = parseLocalHttpInput(() => addCompanyAliasInputSchema.parse(context))
    writeJson(response, 200, await client.companies.aliases.add(parsed))
    return true
  }
  if (method === 'POST' && action === 'archive') {
    const parsed = parseLocalHttpInput(() => archiveCompanyInputSchema.parse(context))
    writeJson(response, 200, await client.companies.archive(parsed))
    return true
  }
  if (method === 'POST' && action === 'restore') {
    const parsed = parseLocalHttpInput(() => restoreCompanyInputSchema.parse(context))
    writeJson(response, 200, await client.companies.restore(parsed))
    return true
  }
  return false
}

function parseQuery<T>(
  schema: { parse(input: unknown): T },
  requestUrl: URL,
): T {
  const query: Record<string, unknown> = {}
  for (const [key, value] of requestUrl.searchParams) {
    query[key] = key === 'limit' && /^\d+$/.test(value) ? Number(value) : value
  }
  return parseLocalHttpInput(() => schema.parse(query))
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function decode(value: string): string {
  return decodeURIComponent(value)
}
