import type http from 'node:http'
import {
  captureResolutionListInputSchema,
  replayCaptureRevisionInputSchema,
  retryCaptureProcessingInputSchema,
} from '@sparxie/sdk'
import type { LocalValedictorianClient } from '../runtime/local-connector-client.contract'
import { LifecycleHttpError } from '../runtime/local-lifecycle-methods'
import { parseLocalHttpInput, readJsonBody, writeJson } from './local-server.http'

const NOT_FOUND = Object.freeze({ message: 'The requested resource was not found.' })

export async function handleCaptureResolutionRoutes(input: {
  readonly client: LocalValedictorianClient
  readonly request: http.IncomingMessage
  readonly requestUrl: URL
  readonly response: http.ServerResponse
}): Promise<boolean> {
  const { client, request, requestUrl, response } = input
  if (!requestUrl.pathname.startsWith('/v1/capture-resolution/captures')) {
    return false
  }
  if (requestUrl.pathname === '/v1/capture-resolution/captures') {
    if (request.method !== 'GET') return false
    const query = Object.fromEntries(requestUrl.searchParams)
    const parsed = parseLocalHttpInput(() => captureResolutionListInputSchema.parse({
      ...query,
      ...(query.limit === undefined ? {} : { limit: Number(query.limit) }),
    }))
    writeJson(response, 200, await client.captureResolution.list(parsed))
    return true
  }
  const match = requestUrl.pathname.match(
    /^\/v1\/capture-resolution\/captures\/([^/]+)(?:\/(retry|replay))?$/,
  )
  if (!match) return false
  const captureId = decodeURIComponent(match[1]!)
  const action = match[2]
  if (action && request.method === 'POST') {
    const body = await readJsonBody(request)
    const requestInput = { ...(body as Record<string, unknown>), captureId }
    if (action === 'retry') {
      const parsed = parseLocalHttpInput(() => retryCaptureProcessingInputSchema.parse(requestInput))
      writeJson(response, 200, await client.captureResolution.retry(parsed))
      return true
    }
    const parsed = parseLocalHttpInput(() => replayCaptureRevisionInputSchema.parse(requestInput))
    writeJson(response, 200, await client.captureResolution.replay(parsed))
    return true
  }
  if (action || request.method !== 'GET') return false
  if (await client.captures.get(captureId) === null) {
    throw new LifecycleHttpError(404, NOT_FOUND)
  }
  writeJson(response, 200, await client.captureResolution.get(captureId))
  return true
}
