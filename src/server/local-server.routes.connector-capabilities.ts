import type http from 'node:http'
import type { ConnectorOptionQueryErrorCode, ValedictorianWorkspaceClient } from 'sparxie'
import {
  connectorOptionQueryBodySchema,
  connectorOptionQueryErrorBodies,
  connectorOptionQueryErrorStatusByCode,
} from 'sparxie'
import { readJsonBody, writeJson } from './local-server.http'

export async function handleConnectorCapabilityRoutes({
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
  if (request.method === 'GET' && requestUrl.pathname === '/v1/connector-descriptors') {
    writeJson(response, 200, await client.connectors.descriptors.list())
    return true
  }

  const descriptorMatch = requestUrl.pathname.match(
    /^\/v1\/connector-descriptors\/([^/]+)\/versions\/([^/]+)$/,
  )
  if (request.method === 'GET' && descriptorMatch) {
    writeJson(response, 200, await client.connectors.descriptors.get(
      decodeURIComponent(descriptorMatch[1]),
      decodeURIComponent(descriptorMatch[2]),
    ))
    return true
  }

  const optionQueryMatch = requestUrl.pathname.match(
    /^\/v1\/connectors\/([^/]+)\/options\/query$/,
  )
  if (request.method !== 'POST' || !optionQueryMatch) return false

  const connectorInstanceId = decodeURIComponent(optionQueryMatch[1])
  const rawBody = await readJsonBody(request)
  if (isEndpointShapedOptionSource(rawBody)) throw optionQueryError('option_source_undeclared')
  const body = connectorOptionQueryBodySchema.parse(rawBody)
  const instances = await client.connectors.list()
  const instance = instances.items.find((candidate) => candidate.id === connectorInstanceId)
  if (!instance) throw optionQueryError('unsupported_descriptor')
  let descriptor
  try {
    descriptor = await client.connectors.descriptors.get(
      instance.connectorId,
      instance.connectorVersion,
    )
  } catch {
    throw optionQueryError('unsupported_descriptor')
  }
  const source = descriptor.dynamicOptions?.sources.find((candidate) => candidate.id === body.sourceId)
  if (!descriptor.filterSchema || !descriptor.dynamicOptions || !source) {
    return writeOptionQueryThroughClient({
      body,
      client,
      connectorInstanceId,
      expectedIdentity: {
        connectorId: descriptor.connectorId,
        connectorVersion: descriptor.connectorVersion,
        filterSchemaVersion: descriptor.filterSchema?.version ?? 'unsupported',
        catalogVersion: descriptor.dynamicOptions?.version ?? 'unsupported',
        sourceVersion: source?.version ?? 'unsupported',
      },
      request,
      response,
    })
  }
  return writeOptionQueryThroughClient({
    body,
    client,
    connectorInstanceId,
    expectedIdentity: {
      connectorId: descriptor.connectorId,
      connectorVersion: descriptor.connectorVersion,
      filterSchemaVersion: descriptor.filterSchema.version,
      catalogVersion: descriptor.dynamicOptions.version,
      sourceVersion: source.version,
    },
    request,
    response,
  })
}

function optionQueryError(code: ConnectorOptionQueryErrorCode) {
  const body = connectorOptionQueryErrorBodies[code]
  return Object.assign(new Error(body.message), {
    code,
    statusCode: connectorOptionQueryErrorStatusByCode[code],
  })
}

function isEndpointShapedOptionSource(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const sourceId = (value as Record<string, unknown>).sourceId
  return typeof sourceId === 'string'
    && /^(?:https?:\/\/|\.{1,2}\/|\/)/i.test(sourceId)
}

async function writeOptionQueryThroughClient({
  body,
  client,
  connectorInstanceId,
  expectedIdentity,
  request,
  response,
}: {
  body: Parameters<ValedictorianWorkspaceClient['connectors']['options']['query']>[0]['body']
  client: ValedictorianWorkspaceClient
  connectorInstanceId: string
  expectedIdentity: Parameters<ValedictorianWorkspaceClient['connectors']['options']['query']>[0]['expectedIdentity']
  request: http.IncomingMessage
  response: http.ServerResponse
}) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  const abortOnPrematureClose = () => {
    if (!response.writableEnded) controller.abort()
  }
  request.once('aborted', abort)
  response.once('close', abortOnPrematureClose)
  try {
    writeJson(response, 200, await client.connectors.options.query({
      connectorInstanceId,
      body,
      expectedIdentity,
    }, { signal: controller.signal }))
    return true
  } finally {
    request.off('aborted', abort)
    response.off('close', abortOnPrematureClose)
  }
}
