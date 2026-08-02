import type http from 'node:http'
import type { ValedictorianWorkspaceClient } from '@sparxie/sdk'
import type { LocalWorkspaceClient } from '../runtime/local-connector-client.contract.js'
import { readJsonBody, writeEmpty, writeJson } from './local-server.http.js'
import {
  parseDeleteConnectorScheduleInput,
  parseDispatchConnectorScheduleDueInput,
  parsePauseConnectorScheduleInput,
  parseResumeConnectorScheduleInput,
  parseConnectorScheduleHistoryQuery,
  parseUpsertConnectorScheduleInput,
} from './local-server.parsers.connector-schedules.js'

type ConnectorScheduleExtensionsClient = LocalWorkspaceClient & {
  connectors: ValedictorianWorkspaceClient['connectors'] & {
    schedules: ValedictorianWorkspaceClient['connectors']['schedules']
  }
}

function scheduleExtensions(client: LocalWorkspaceClient) {
  return (client as ConnectorScheduleExtensionsClient).connectors.schedules
}

export async function handleConnectorScheduleRoutes({
  client,
  request,
  requestUrl,
  response,
}: {
  client: LocalWorkspaceClient
  request: http.IncomingMessage
  requestUrl: URL
  response: http.ServerResponse
}): Promise<boolean> {
  const connectorScheduleMatch = requestUrl.pathname.match(
    /^\/v1\/connectors\/([^/]+)\/schedule$/,
  )
  const connectorSchedulePauseMatch = requestUrl.pathname.match(
    /^\/v1\/connectors\/([^/]+)\/schedule\/pause$/,
  )
  const connectorScheduleResumeMatch = requestUrl.pathname.match(
    /^\/v1\/connectors\/([^/]+)\/schedule\/resume$/,
  )
  const connectorScheduleAuditMatch = requestUrl.pathname.match(
    /^\/v1\/connectors\/([^/]+)\/schedule\/audit$/,
  )
  const connectorScheduleOccurrencesMatch = requestUrl.pathname.match(
    /^\/v1\/connectors\/([^/]+)\/schedule\/occurrences$/,
  )
  const connectorScheduleDispatchDueMatch = requestUrl.pathname.match(
    /^\/v1\/connectors\/([^/]+)\/schedule\/dispatch-due$/,
  )

  if (request.method === 'GET' && connectorScheduleMatch) {
    const schedule = await scheduleExtensions(client).get(
      decodeURIComponent(connectorScheduleMatch[1]),
    )
    if (!schedule) {
      writeJson(response, 404, { message: 'Not found' })
      return true
    }
    writeJson(response, 200, schedule)
    return true
  }

  if (request.method === 'PUT' && connectorScheduleMatch) {
    writeJson(
      response,
      200,
      await scheduleExtensions(client).upsert(
        parseUpsertConnectorScheduleInput(
          decodeURIComponent(connectorScheduleMatch[1]),
          await readJsonBody(request),
        ),
      ),
    )
    return true
  }

  if (request.method === 'DELETE' && connectorScheduleMatch) {
    await scheduleExtensions(client).delete(
      parseDeleteConnectorScheduleInput(
        decodeURIComponent(connectorScheduleMatch[1]),
        await readJsonBody(request),
      ),
    )
    writeEmpty(response, 204)
    return true
  }

  if (request.method === 'POST' && connectorSchedulePauseMatch) {
    writeJson(
      response,
      200,
      await scheduleExtensions(client).pause(
        parsePauseConnectorScheduleInput(
          decodeURIComponent(connectorSchedulePauseMatch[1]),
          await readJsonBody(request),
        ),
      ),
    )
    return true
  }

  if (request.method === 'POST' && connectorScheduleResumeMatch) {
    writeJson(
      response,
      200,
      await scheduleExtensions(client).resume(
        parseResumeConnectorScheduleInput(
          decodeURIComponent(connectorScheduleResumeMatch[1]),
          await readJsonBody(request),
        ),
      ),
    )
    return true
  }

  if (request.method === 'GET' && connectorScheduleAuditMatch) {
    writeJson(
      response,
      200,
      await scheduleExtensions(client).listAudit(
        parseConnectorScheduleHistoryQuery(
          decodeURIComponent(connectorScheduleAuditMatch[1]),
          requestUrl,
        ),
      ),
    )
    return true
  }

  if (request.method === 'GET' && connectorScheduleOccurrencesMatch) {
    writeJson(
      response,
      200,
      await scheduleExtensions(client).listOccurrences(
        parseConnectorScheduleHistoryQuery(
          decodeURIComponent(connectorScheduleOccurrencesMatch[1]),
          requestUrl,
        ),
      ),
    )
    return true
  }

  if (request.method === 'POST' && connectorScheduleDispatchDueMatch) {
    writeJson(
      response,
      200,
      await scheduleExtensions(client).dispatchDue(
        parseDispatchConnectorScheduleDueInput(
          decodeURIComponent(connectorScheduleDispatchDueMatch[1]),
          await readJsonBody(request),
        ),
      ),
    )
    return true
  }

  return false
}
