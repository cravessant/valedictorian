import {
  createValedictorianHttpTransport,
  utf8ByteLength,
  VALEDICTORIAN_HTTP_MAX_BODY_BYTES,
  type ValedictorianHttpTransport,
  type ValedictorianHttpTransportRequest,
} from './valedictorian-http.transport'

interface IpcMainLike {
  handle(
    channel: string,
    handler: (
      _event: unknown,
      input?: unknown,
    ) => Promise<unknown>,
  ): void
}

export const VALEDICTORIAN_HTTP_REQUEST_CHANNEL = 'valedictorian-http:request'
export const VALEDICTORIAN_HTTP_CANCEL_CHANNEL = 'valedictorian-http:cancel'

export function registerValedictorianHttpIpc(
  transport: ValedictorianHttpTransport | null,
  ipcMain: IpcMainLike,
) {
  const requests = new Map<string, AbortController>()
  ipcMain.handle(VALEDICTORIAN_HTTP_REQUEST_CHANNEL, async (_event, input) => {
    if (!transport) {
      throw new Error('Valedictorian HTTP transport is unavailable.')
    }

    const requestId = parseOptionalRequestId(input)
    const controller = new AbortController()
    if (requestId) requests.set(requestId, controller)
    try {
      return await transport.request(
        parseValedictorianHttpTransportRequest(input),
        { signal: controller.signal },
      )
    } finally {
      if (requestId) requests.delete(requestId)
    }
  })
  ipcMain.handle(VALEDICTORIAN_HTTP_CANCEL_CHANNEL, async (_event, input) => {
    const requestId = parseRequestId(input)
    requests.get(requestId)?.abort()
  })
}

function parseOptionalRequestId(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const requestId = (input as Record<string, unknown>).requestId
  return requestId === undefined ? undefined : parseRequestId(requestId)
}

function parseRequestId(input: unknown) {
  if (typeof input !== 'string' || input.length === 0 || input.length > 128) {
    throw new Error('Valedictorian HTTP transport request id is invalid.')
  }
  return input
}

export function createBoundValedictorianHttpTransport({
  apiBaseUrl,
  apiToken,
  fetchImplementation,
  workspaceId,
}: {
  apiBaseUrl: string
  apiToken?: string
  fetchImplementation?: typeof fetch
  workspaceId: string
}) {
  return createValedictorianHttpTransport({
    apiBaseUrl,
    apiToken,
    fetchImplementation,
    workspaceId,
  })
}

export function parseValedictorianHttpTransportRequest(
  input: unknown,
): ValedictorianHttpTransportRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Valedictorian HTTP transport request is required.')
  }

  const record = input as Record<string, unknown>

  if (typeof record.url !== 'string' || record.url.length === 0) {
    throw new Error('Valedictorian HTTP transport request url is required.')
  }

  if (typeof record.method !== 'string' || record.method.length === 0) {
    throw new Error('Valedictorian HTTP transport request method is required.')
  }

  let body: string | null | undefined
  if (record.body === undefined) {
    body = undefined
  } else if (record.body === null) {
    body = null
  } else if (typeof record.body === 'string') {
    if (utf8ByteLength(record.body) > VALEDICTORIAN_HTTP_MAX_BODY_BYTES) {
      throw new Error('Valedictorian HTTP transport request body is too large.')
    }
    body = record.body
  } else {
    throw new Error('Valedictorian HTTP transport request body must be a string or null.')
  }

  let headers: Record<string, string> | undefined
  if (record.headers === undefined) {
    headers = undefined
  } else if (!record.headers || typeof record.headers !== 'object' || Array.isArray(record.headers)) {
    throw new Error('Valedictorian HTTP transport request headers must be an object.')
  } else {
    headers = {}
    for (const [key, value] of Object.entries(record.headers as Record<string, unknown>)) {
      if (typeof value !== 'string') {
        throw new Error('Valedictorian HTTP transport request headers must be string values.')
      }
      headers[key] = value
    }
  }

  return {
    ...(body === undefined ? {} : { body }),
    ...(headers === undefined ? {} : { headers }),
    method: record.method,
    url: record.url,
  }
}
