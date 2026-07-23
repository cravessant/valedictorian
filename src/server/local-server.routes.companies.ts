import type http from 'node:http'
import type { ValedictorianWorkspaceClient } from '@sparxie/sdk'
import { writeJson } from './local-server.http'

type CompanyRouteContext = {
  client: ValedictorianWorkspaceClient
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
  if (
    request.method !== 'GET'
    || requestUrl.pathname !== '/v1/companies/capability'
  ) {
    return false
  }
  writeJson(response, 200, await client.companies.capability.get())
  return true
}
