import type http from 'node:http'
import {
  companyAssignedJobListInputSchema,
  companyDirectoryListInputSchema,
  companyDuplicateListInputSchema,
  companyHistoryListInputSchema,
  companyMatchPreviewInputSchema,
  companySearchInputSchema,
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
      writeJson(response, 200, await client.companyAssignments.reassign(untrusted(body, { workspaceId, jobId }) as never))
      return true
    }
    return false
  }
  if (!requestUrl.pathname.startsWith('/v1/companies')) return false
  const { method } = request
  const { pathname } = requestUrl

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
  if (method === 'POST' && pathname === '/v1/companies/merge') {
    const body = await readJsonBody(request)
    writeJson(response, 200, await client.companies.duplicates.merge(untrusted(body, { workspaceId }) as never))
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
      writeJson(response, 200, await client.companies.create(untrusted(body, { workspaceId }) as never))
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
      writeJson(response, 200, await client.companies.duplicates.markDistinct(untrusted(body, { workspaceId, candidateId }) as never))
      return true
    }
    return false
  }

  const aliasMatch = pathname.match(/^\/v1\/companies\/([^/]+)\/aliases\/([^/]+)$/)
  if (aliasMatch) {
    const companyId = decode(aliasMatch[1]!)
    const aliasId = decode(aliasMatch[2]!)
    const body = await readJsonBody(request)
    const alias = { workspaceId, companyId, aliasId }
    if (method === 'PATCH') {
      writeJson(response, 200, await client.companies.aliases.update(untrusted(body, alias) as never))
      return true
    }
    if (method === 'DELETE') {
      writeJson(response, 200, await client.companies.aliases.remove(untrusted(body, alias) as never))
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
    writeJson(response, 200, await client.companies.update(untrusted(body, { workspaceId, companyId }) as never))
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
  const target = { workspaceId, companyId }
  if (method === 'PATCH' && action === 'notes') {
    writeJson(response, 200, await client.companies.notes.update(untrusted(body, target) as never))
    return true
  }
  if (method === 'POST' && action === 'aliases') {
    writeJson(response, 200, await client.companies.aliases.add(untrusted(body, target) as never))
    return true
  }
  if (method === 'POST' && action === 'archive') {
    writeJson(response, 200, await client.companies.archive(untrusted(body, target) as never))
    return true
  }
  if (method === 'POST' && action === 'restore') {
    writeJson(response, 200, await client.companies.restore(untrusted(body, target) as never))
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

/**
 * Untrusted Company command representation: caller body fields first, authoritative route and
 * client context last, so a body-supplied identifier cannot override it. The Company module
 * parses the result; this adapter never parses a command schema and asserts no command type.
 */
function untrusted(body: unknown, context: Readonly<Record<string, string>>): unknown {
  const fields = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  return { ...fields, ...context }
}

function decode(value: string): string {
  return decodeURIComponent(value)
}
