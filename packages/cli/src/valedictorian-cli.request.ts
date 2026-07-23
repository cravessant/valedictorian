import {
  ValedictorianProtocolError,
  ValedictorianTransportError,
} from '@sparxie/sdk'

import {
  createFailClosedRequestError,
  type CliErrorSurfaceId,
} from './valedictorian-cli.endpoint-errors.js'

export async function requestValedictorianJson({
  apiBaseUrl,
  apiToken,
  path,
  body,
  method = 'GET',
  errorSurface,
}: {
  apiBaseUrl: string
  apiToken?: string
  path: string
  body?: unknown
  method?: 'GET' | 'POST'
  errorSurface: CliErrorSurfaceId
}): Promise<unknown> {
  const url = new URL(path, apiBaseUrl)
  const headers: Record<string, string> = {
    accept: 'application/json',
  }

  if (apiToken) {
    headers.authorization = `Bearer ${apiToken}`
  }

  const init: RequestInit = {
    headers,
    method,
  }

  if (body !== undefined) {
    headers['content-type'] = 'application/json'
    init.body = JSON.stringify(body)
  }

  let response: Response
  try {
    response = await fetch(url.toString(), init)
  } catch (error) {
    throw new ValedictorianTransportError({ cause: error })
  }

  const responseBody = await readResponseBody(response)

  if (!response.ok) {
    throw createFailClosedRequestError(response.status, responseBody, errorSurface)
  }

  return responseBody
}

async function readResponseBody(response: Response): Promise<unknown> {
  let text: string
  try {
    text = await response.text()
  } catch (error) {
    throw new ValedictorianTransportError({ cause: error })
  }

  if (!text) return undefined

  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new ValedictorianProtocolError({ cause: error })
  }
}

export type { CliErrorSurfaceId }
export { createFailClosedRequestError }
