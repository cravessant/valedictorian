import type http from 'node:http'
import type { LocalWorkspaceClient } from '../runtime/local-connector-client.contract'
import { readJsonBody, writeJson } from './local-server.http'

/**
 * The four lifecycle aggregate HTTP surfaces (captures, jobs, opportunities, applications) over the
 * in-process facade. Handlers stay thin: they extract path params, merge them with the JSON body (or
 * query string) — the path id is authoritative, so it is applied last — and hand the assembled
 * contract input to the facade, which owns all validation and DTO mapping. A `LifecycleHttpError`
 * raised by the facade propagates to the shared error boundary, which renders `{status, body}`; a
 * `get` returning null is rendered here as a 404. Wire protocol source of truth:
 * `sparxie/dist/api.js` (`valedictorianApiPaths`) + `sparxie/dist/http-client-lifecycle.js`.
 */

const NOT_FOUND_BODY = Object.freeze({ message: 'The requested resource was not found.' })

const LIFECYCLE_PREFIX = /^\/v1\/(captures|jobs|opportunities|applications)(?:\/|$)/

type LifecycleRouteContext = {
  client: LocalWorkspaceClient
  request: http.IncomingMessage
  requestUrl: URL
  response: http.ServerResponse
}

/** JSON body as a record, with the authoritative path param applied last so a body cannot spoof it. */
async function inputWithPathParam(
  request: http.IncomingMessage,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const body = (await readJsonBody(request)) as Record<string, unknown>
  return { ...body, ...params }
}

/** Query string as a record, with the authoritative path params applied last. */
function queryWithPathParam(
  requestUrl: URL,
  params: Record<string, string> = {},
): Record<string, unknown> {
  const query: Record<string, unknown> = {}
  for (const [key, value] of requestUrl.searchParams) {
    if (key === 'limit' || key === 'offset') {
      query[key] = /^\d+$/.test(value) ? Number(value) : value
    } else if (key === 'includeRemoved') {
      query[key] = value === 'true' ? true : value === 'false' ? false : value
    } else {
      query[key] = value
    }
  }
  return { ...query, ...params }
}

function decode(value: string): string {
  return decodeURIComponent(value)
}

export async function handleLifecycleRoutes({
  client,
  request,
  requestUrl,
  response,
}: LifecycleRouteContext): Promise<boolean> {
  const { pathname } = requestUrl
  if (!LIFECYCLE_PREFIX.test(pathname)) return false
  const method = request.method

  // ---- Captures ---------------------------------------------------------------------------------
  if (pathname === '/v1/captures') {
    if (method === 'GET') {
      writeJson(response, 200, await client.captures.list(queryWithPathParam(requestUrl)))
      return true
    }
    if (method === 'POST') {
      writeJson(response, 200, await client.captures.create(
        (await readJsonBody(request)) as Parameters<typeof client.captures.create>[0],
      ))
      return true
    }
  }
  {
    const m = pathname.match(/^\/v1\/captures\/([^/]+)\/promote-to-job$/)
    if (m && method === 'POST') {
      writeJson(response, 200, await client.captures.promoteToJob(
        await inputWithPathParam(request, { captureId: decode(m[1]) }) as Parameters<typeof client.captures.promoteToJob>[0],
      ))
      return true
    }
  }
  {
    const m = pathname.match(/^\/v1\/captures\/([^/]+)\/remove$/)
    if (m && method === 'POST') {
      writeJson(response, 200, await client.captures.remove(
        await inputWithPathParam(request, { id: decode(m[1]) }) as Parameters<typeof client.captures.remove>[0],
      ))
      return true
    }
  }
  {
    const m = pathname.match(/^\/v1\/captures\/([^/]+)\/restore$/)
    if (m && method === 'POST') {
      writeJson(response, 200, await client.captures.restore(
        await inputWithPathParam(request, { id: decode(m[1]) }) as Parameters<typeof client.captures.restore>[0],
      ))
      return true
    }
  }
  {
    const m = pathname.match(/^\/v1\/captures\/([^/]+)\/history$/)
    if (m && method === 'GET') {
      writeJson(response, 200, await client.captures.history(
        queryWithPathParam(requestUrl, { id: decode(m[1]) }) as Parameters<typeof client.captures.history>[0],
      ))
      return true
    }
  }
  {
    const m = pathname.match(/^\/v1\/captures\/([^/]+)$/)
    if (m && method === 'GET') {
      const resource = await client.captures.get(decode(m[1]))
      writeJson(response, resource === null ? 404 : 200, resource ?? NOT_FOUND_BODY)
      return true
    }
    if (m && method === 'PATCH') {
      writeJson(response, 200, await client.captures.correct(
        await inputWithPathParam(request, { captureId: decode(m[1]) }) as Parameters<typeof client.captures.correct>[0],
      ))
      return true
    }
  }

  // ---- Jobs -------------------------------------------------------------------------------------
  if (pathname === '/v1/jobs') {
    if (method === 'GET') {
      writeJson(response, 200, await client.jobs.list(queryWithPathParam(requestUrl)))
      return true
    }
    if (method === 'POST') {
      writeJson(response, 200, await client.jobs.create(
        (await readJsonBody(request)) as Parameters<typeof client.jobs.create>[0],
      ))
      return true
    }
  }
  {
    const m = pathname.match(/^\/v1\/jobs\/([^/]+)\/external-identities\/remove$/)
    if (m && method === 'POST') {
      writeJson(response, 200, await client.jobs.externalIdentities.remove(
        await inputWithPathParam(request, { jobId: decode(m[1]) }) as Parameters<typeof client.jobs.externalIdentities.remove>[0],
      ))
      return true
    }
  }
  {
    const m = pathname.match(/^\/v1\/jobs\/([^/]+)\/external-identities$/)
    if (m && method === 'POST') {
      writeJson(response, 200, await client.jobs.externalIdentities.add(
        await inputWithPathParam(request, { jobId: decode(m[1]) }) as Parameters<typeof client.jobs.externalIdentities.add>[0],
      ))
      return true
    }
  }
  {
    const m = pathname.match(/^\/v1\/jobs\/([^/]+)\/facts$/)
    if (m && method === 'PATCH') {
      writeJson(response, 200, await client.jobs.correctFacts(
        await inputWithPathParam(request, { jobId: decode(m[1]) }) as Parameters<typeof client.jobs.correctFacts>[0],
      ))
      return true
    }
  }
  {
    const m = pathname.match(/^\/v1\/jobs\/([^/]+)\/availability$/)
    if (m && method === 'PATCH') {
      writeJson(response, 200, await client.jobs.updateAvailability(
        await inputWithPathParam(request, { jobId: decode(m[1]) }) as Parameters<typeof client.jobs.updateAvailability>[0],
      ))
      return true
    }
  }
  {
    const m = pathname.match(/^\/v1\/jobs\/([^/]+)\/remove$/)
    if (m && method === 'POST') {
      writeJson(response, 200, await client.jobs.remove(
        await inputWithPathParam(request, { id: decode(m[1]) }) as Parameters<typeof client.jobs.remove>[0],
      ))
      return true
    }
  }
  {
    const m = pathname.match(/^\/v1\/jobs\/([^/]+)\/restore$/)
    if (m && method === 'POST') {
      writeJson(response, 200, await client.jobs.restore(
        await inputWithPathParam(request, { id: decode(m[1]) }) as Parameters<typeof client.jobs.restore>[0],
      ))
      return true
    }
  }
  {
    const m = pathname.match(/^\/v1\/jobs\/([^/]+)\/promote-to-opportunity$/)
    if (m && method === 'POST') {
      writeJson(response, 200, await client.jobs.promoteToOpportunity(
        await inputWithPathParam(request, { jobId: decode(m[1]) }) as Parameters<typeof client.jobs.promoteToOpportunity>[0],
      ))
      return true
    }
  }
  {
    const m = pathname.match(/^\/v1\/jobs\/([^/]+)\/history$/)
    if (m && method === 'GET') {
      writeJson(response, 200, await client.jobs.history(
        queryWithPathParam(requestUrl, { id: decode(m[1]) }) as Parameters<typeof client.jobs.history>[0],
      ))
      return true
    }
  }
  {
    const m = pathname.match(/^\/v1\/jobs\/([^/]+)$/)
    if (m && method === 'GET') {
      const resource = await client.jobs.get(
        decode(m[1]) as Parameters<typeof client.jobs.get>[0],
      )
      writeJson(response, resource === null ? 404 : 200, resource ?? NOT_FOUND_BODY)
      return true
    }
  }

  // ---- Opportunities ----------------------------------------------------------------------------
  if (pathname === '/v1/opportunities') {
    if (method === 'GET') {
      writeJson(response, 200, await client.opportunities.list(queryWithPathParam(requestUrl)))
      return true
    }
    if (method === 'POST') {
      writeJson(response, 200, await client.opportunities.create(
        (await readJsonBody(request)) as Parameters<typeof client.opportunities.create>[0],
      ))
      return true
    }
  }
  {
    const m = pathname.match(/^\/v1\/opportunities\/([^/]+)\/evaluation$/)
    if (m && method === 'PATCH') {
      writeJson(response, 200, await client.opportunities.updateEvaluation(
        await inputWithPathParam(request, { opportunityId: decode(m[1]) }) as Parameters<typeof client.opportunities.updateEvaluation>[0],
      ))
      return true
    }
  }
  {
    const m = pathname.match(/^\/v1\/opportunities\/([^/]+)\/disposition$/)
    if (m && method === 'PATCH') {
      writeJson(response, 200, await client.opportunities.updateDisposition(
        await inputWithPathParam(request, { opportunityId: decode(m[1]) }) as Parameters<typeof client.opportunities.updateDisposition>[0],
      ))
      return true
    }
  }
  {
    const m = pathname.match(/^\/v1\/opportunities\/([^/]+)\/remove$/)
    if (m && method === 'POST') {
      writeJson(response, 200, await client.opportunities.remove(
        await inputWithPathParam(request, { id: decode(m[1]) }) as Parameters<typeof client.opportunities.remove>[0],
      ))
      return true
    }
  }
  {
    const m = pathname.match(/^\/v1\/opportunities\/([^/]+)\/restore$/)
    if (m && method === 'POST') {
      writeJson(response, 200, await client.opportunities.restore(
        await inputWithPathParam(request, { id: decode(m[1]) }) as Parameters<typeof client.opportunities.restore>[0],
      ))
      return true
    }
  }
  {
    const m = pathname.match(/^\/v1\/opportunities\/([^/]+)\/promote-to-application$/)
    if (m && method === 'POST') {
      writeJson(response, 200, await client.opportunities.promoteToApplication(
        await inputWithPathParam(request, { opportunityId: decode(m[1]) }) as Parameters<typeof client.opportunities.promoteToApplication>[0],
      ))
      return true
    }
  }
  {
    const m = pathname.match(/^\/v1\/opportunities\/([^/]+)\/history$/)
    if (m && method === 'GET') {
      writeJson(response, 200, await client.opportunities.history(
        queryWithPathParam(requestUrl, { id: decode(m[1]) }) as Parameters<typeof client.opportunities.history>[0],
      ))
      return true
    }
  }
  {
    const m = pathname.match(/^\/v1\/opportunities\/([^/]+)$/)
    if (m && method === 'GET') {
      const resource = await client.opportunities.get(decode(m[1]))
      writeJson(response, resource === null ? 404 : 200, resource ?? NOT_FOUND_BODY)
      return true
    }
  }

  // ---- Applications -----------------------------------------------------------------------------
  if (pathname === '/v1/applications') {
    if (method === 'GET') {
      writeJson(response, 200, await client.applications.list(queryWithPathParam(requestUrl)))
      return true
    }
    if (method === 'POST') {
      writeJson(response, 200, await client.applications.create(
        (await readJsonBody(request)) as Parameters<typeof client.applications.create>[0],
      ))
      return true
    }
  }
  {
    const m = pathname.match(/^\/v1\/applications\/([^/]+)\/links\/([^/]+)\/remove$/)
    if (m && method === 'POST') {
      writeJson(response, 200, await client.applications.links.remove(
        await inputWithPathParam(request, { applicationId: decode(m[1]), linkId: decode(m[2]) }) as Parameters<typeof client.applications.links.remove>[0],
      ))
      return true
    }
  }
  {
    const m = pathname.match(/^\/v1\/applications\/([^/]+)\/links\/([^/]+)$/)
    if (m && method === 'PATCH') {
      writeJson(response, 200, await client.applications.links.update(
        await inputWithPathParam(request, { applicationId: decode(m[1]), linkId: decode(m[2]) }) as Parameters<typeof client.applications.links.update>[0],
      ))
      return true
    }
  }
  {
    const m = pathname.match(/^\/v1\/applications\/([^/]+)\/links$/)
    if (m && method === 'POST') {
      writeJson(response, 200, await client.applications.links.create(
        await inputWithPathParam(request, { applicationId: decode(m[1]) }) as Parameters<typeof client.applications.links.create>[0],
      ))
      return true
    }
  }
  {
    const m = pathname.match(/^\/v1\/applications\/([^/]+)\/snapshot\/refresh$/)
    if (m && method === 'POST') {
      writeJson(response, 200, await client.applications.refreshSnapshot(
        await inputWithPathParam(request, { applicationId: decode(m[1]) }) as Parameters<typeof client.applications.refreshSnapshot>[0],
      ))
      return true
    }
  }
  {
    const m = pathname.match(/^\/v1\/applications\/([^/]+)\/status$/)
    if (m && method === 'PATCH') {
      writeJson(response, 200, await client.applications.updateStatus(
        await inputWithPathParam(request, { applicationId: decode(m[1]) }) as Parameters<typeof client.applications.updateStatus>[0],
      ))
      return true
    }
  }
  {
    const m = pathname.match(/^\/v1\/applications\/([^/]+)\/company$/)
    if (m && method === 'PATCH') {
      writeJson(response, 200, await client.applications.updateCompany(
        await inputWithPathParam(request, { applicationId: decode(m[1]) }) as Parameters<typeof client.applications.updateCompany>[0],
      ))
      return true
    }
  }
  {
    const m = pathname.match(/^\/v1\/applications\/([^/]+)\/source$/)
    if (m && method === 'PATCH') {
      writeJson(response, 200, await client.applications.updateSource(
        await inputWithPathParam(request, { applicationId: decode(m[1]) }) as Parameters<typeof client.applications.updateSource>[0],
      ))
      return true
    }
  }
  {
    const m = pathname.match(/^\/v1\/applications\/([^/]+)\/remove$/)
    if (m && method === 'POST') {
      writeJson(response, 200, await client.applications.remove(
        await inputWithPathParam(request, { id: decode(m[1]) }) as Parameters<typeof client.applications.remove>[0],
      ))
      return true
    }
  }
  {
    const m = pathname.match(/^\/v1\/applications\/([^/]+)\/restore$/)
    if (m && method === 'POST') {
      writeJson(response, 200, await client.applications.restore(
        await inputWithPathParam(request, { id: decode(m[1]) }) as Parameters<typeof client.applications.restore>[0],
      ))
      return true
    }
  }
  {
    const m = pathname.match(/^\/v1\/applications\/([^/]+)\/history$/)
    if (m && method === 'GET') {
      writeJson(response, 200, await client.applications.history(
        queryWithPathParam(requestUrl, { id: decode(m[1]) }) as Parameters<typeof client.applications.history>[0],
      ))
      return true
    }
  }
  {
    const m = pathname.match(/^\/v1\/applications\/([^/]+)\/attempts$/)
    if (m && method === 'GET') {
      writeJson(response, 200, await client.applications.attempts.list(
        queryWithPathParam(requestUrl, { applicationId: decode(m[1]) }) as Parameters<typeof client.applications.attempts.list>[0],
      ))
      return true
    }
  }
  {
    const m = pathname.match(/^\/v1\/applications\/([^/]+)\/events$/)
    if (m && method === 'GET') {
      writeJson(response, 200, await client.applications.events.list(
        queryWithPathParam(requestUrl, { applicationId: decode(m[1]) }) as Parameters<typeof client.applications.events.list>[0],
      ))
      return true
    }
  }
  {
    const m = pathname.match(/^\/v1\/applications\/([^/]+)$/)
    if (m && method === 'GET') {
      const resource = await client.applications.get(decode(m[1]))
      writeJson(response, resource === null ? 404 : 200, resource ?? NOT_FOUND_BODY)
      return true
    }
  }

  return false
}
