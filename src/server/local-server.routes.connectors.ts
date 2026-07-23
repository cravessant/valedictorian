import type http from 'node:http'
import {
  connectorOverviewListResultSchema,
  connectorRetirementResultSchema,
  type ValedictorianWorkspaceClient,
} from '@sparxie/sdk'
import { publicConnectorStatusSummary } from '../runtime/local-connector-public-status'
import {
  publicConnectorRunsListResult,
  publicConnectorRunSummary,
} from '../runtime/local-connector-public-run'
import { readJsonBody, writeJson } from './local-server.http'
import {
  parseConnectorCheckpointsListQuery,
  parseConnectorObservationsListQuery,
  parseConnectorOverviewListQuery,
  parseConnectorRunsListQuery,
  parseConnectorRunTriggerInput,
  parseCreateConnectorInstanceInput,
  parseUpdateConnectorInstanceInput,
} from './local-server.parsers'
import { handleConnectorCapabilityRoutes } from './local-server.routes.connector-capabilities'
import { handleConnectorScheduleRoutes } from './local-server.routes.connector-schedules'

export async function handleConnectorRoutes({
  client,
  request,
  requestUrl,
  response,
}: {
  client: ValedictorianWorkspaceClient
  request: http.IncomingMessage
  requestUrl: URL
  response: http.ServerResponse
}): Promise<boolean> {
  if (await handleConnectorCapabilityRoutes({ client, request, requestUrl, response })) {
    return true
  }

  if (!requestUrl.pathname.startsWith('/v1/connectors')) return false

  const connectors = connectorExtensions(client)

  if (request.method === 'GET' && requestUrl.pathname === '/v1/connectors') {
    writeJson(response, 200, await connectors.list())
    return true
  }

  if (request.method === 'POST' && requestUrl.pathname === '/v1/connectors') {
    writeJson(
      response,
      200,
      await connectors.create(parseCreateConnectorInstanceInput(await readJsonBody(request))),
    )
    return true
  }

  if (request.method === 'GET' && requestUrl.pathname === '/v1/connectors/overview') {
    writeJson(
      response,
      200,
      connectorOverviewListResultSchema.parse(
        await connectors.overview.list(parseConnectorOverviewListQuery(requestUrl)),
      ),
    )
    return true
  }

  const connectorStatusMatch = requestUrl.pathname.match(/^\/v1\/connectors\/([^/]+)\/status$/)
  const connectorInstanceMatch = requestUrl.pathname.match(/^\/v1\/connectors\/([^/]+)$/)

  if (request.method === 'PATCH' && connectorInstanceMatch) {
    writeJson(
      response,
      200,
      await connectors.update(
        parseUpdateConnectorInstanceInput(
          decodeURIComponent(connectorInstanceMatch[1]),
          await readJsonBody(request),
        ),
      ),
    )
    return true
  }

  if (request.method === 'DELETE' && connectorInstanceMatch) {
    writeJson(
      response,
      200,
      connectorRetirementResultSchema.parse(
        await connectors.remove({
          connectorInstanceId: decodeURIComponent(connectorInstanceMatch[1]),
        }),
      ),
    )
    return true
  }

  if (request.method === 'GET' && connectorStatusMatch) {
    writeJson(
      response,
      200,
      publicConnectorStatusSummary(
        await connectors.inspect(decodeURIComponent(connectorStatusMatch[1])),
      ),
    )
    return true
  }

  const connectorRunsMatch = requestUrl.pathname.match(/^\/v1\/connectors\/([^/]+)\/runs$/)

  if (request.method === 'GET' && connectorRunsMatch) {
    writeJson(
      response,
      200,
      publicConnectorRunsListResult(
        await connectors.runs.list(
          parseConnectorRunsListQuery(decodeURIComponent(connectorRunsMatch[1]), requestUrl),
        ),
      ),
    )
    return true
  }

  if (request.method === 'POST' && connectorRunsMatch) {
    writeJson(
      response,
      200,
      publicConnectorRunSummary(
        await connectors.runs.trigger(
          parseConnectorRunTriggerInput(
            decodeURIComponent(connectorRunsMatch[1]),
            await readJsonBody(request),
          ),
        ),
      ),
    )
    return true
  }

  const connectorCheckpointsMatch = requestUrl.pathname.match(
    /^\/v1\/connectors\/([^/]+)\/checkpoints$/,
  )

  if (request.method === 'GET' && connectorCheckpointsMatch) {
    writeJson(
      response,
      200,
      await connectors.checkpoints.list(
        parseConnectorCheckpointsListQuery(
          decodeURIComponent(connectorCheckpointsMatch[1]),
          requestUrl,
        ),
      ),
    )
    return true
  }

  const connectorObservationsMatch = requestUrl.pathname.match(
    /^\/v1\/connectors\/([^/]+)\/observations$/,
  )

  if (request.method === 'GET' && connectorObservationsMatch) {
    writeJson(
      response,
      200,
      await connectors.observations.list(
        parseConnectorObservationsListQuery(
          decodeURIComponent(connectorObservationsMatch[1]),
          requestUrl,
        ),
      ),
    )
    return true
  }

  return handleConnectorScheduleRoutes({ client, request, requestUrl, response })
}

type ConnectorExtensionsClient = ValedictorianWorkspaceClient & {
  connectors: {
    list(): Promise<unknown>
    create(input: unknown): Promise<unknown>
    update(input: unknown): Promise<unknown>
    remove(input: { connectorInstanceId: string }): Promise<unknown>
    inspect(connectorInstanceId: string): Promise<unknown>
    overview: ValedictorianWorkspaceClient['connectors']['overview']
    runs: {
      list(input: unknown): Promise<unknown>
      trigger(input: unknown): Promise<unknown>
    }
    checkpoints: {
      list(input: unknown): Promise<unknown>
    }
    observations: {
      list(input: unknown): Promise<unknown>
    }
  }
}

function connectorExtensions(client: ValedictorianWorkspaceClient) {
  return (client as ConnectorExtensionsClient).connectors
}
