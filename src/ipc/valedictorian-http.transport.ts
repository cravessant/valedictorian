export type ValedictorianHttpTransportRequest = {
  body?: string | null
  headers?: Record<string, string>
  method: string
  url: string
}

export type ValedictorianHttpTransportResponse = {
  body: string
  headers: Record<string, string>
  status: number
  statusText: string
}

export type ValedictorianHttpTransport = {
  request(
    input: ValedictorianHttpTransportRequest,
    options?: { signal?: AbortSignal },
  ): Promise<ValedictorianHttpTransportResponse>
}

export class ValedictorianHttpTransportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValedictorianHttpTransportError'
  }
}

export const VALEDICTORIAN_HTTP_ALLOWED_METHODS = [
  'DELETE',
  'GET',
  'PATCH',
  'POST',
  'PUT',
] as const

export const VALEDICTORIAN_HTTP_REQUEST_HEADER_ALLOWLIST = [
  'accept',
  'content-type',
] as const

export const VALEDICTORIAN_HTTP_RESPONSE_HEADER_ALLOWLIST = [
  'content-type',
] as const

export const VALEDICTORIAN_HTTP_MAX_BODY_BYTES = 1_000_000

export function createValedictorianHttpTransport({
  apiBaseUrl,
  apiToken,
  fetchImplementation = fetch,
  workspaceId,
}: {
  apiBaseUrl: string
  apiToken?: string
  fetchImplementation?: typeof fetch
  workspaceId: string
}): ValedictorianHttpTransport {
  const allowedOrigin = new URL(apiBaseUrl).origin
  const encodedWorkspaceId = encodeURIComponent(workspaceId)

  return {
    async request(input, options = {}) {
      const method = normalizeAllowedMethod(input.method)
      const url = parseAllowedValedictorianHttpUrl(
        input.url,
        method,
        allowedOrigin,
        encodedWorkspaceId,
      )
      const headers = sanitizeTransportRequestHeaders(input.headers)

      if (apiToken) {
        headers.authorization = `Bearer ${apiToken}`
      }

      const init: RequestInit = {
        headers,
        method,
        redirect: 'error',
        ...(options.signal ? { signal: options.signal } : {}),
      }

      if (input.body !== undefined && input.body !== null) {
        assertBodySize(input.body)
        init.body = input.body
      }

      const response = await fetchImplementation(url.toString(), init)
      return {
        body: await response.text(),
        headers: sanitizeTransportResponseHeaders(response.headers),
        status: response.status,
        statusText: response.statusText,
      }
    },
  }
}

export function parseAllowedValedictorianHttpUrl(
  rawUrl: string,
  method: string,
  allowedOrigin: string,
  encodedWorkspaceId: string,
) {
  let url: URL

  try {
    url = new URL(rawUrl)
  } catch {
    throw new ValedictorianHttpTransportError('Invalid Valedictorian HTTP URL.')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ValedictorianHttpTransportError('Valedictorian HTTP transport only allows http(s).')
  }

  if (url.username || url.password) {
    throw new ValedictorianHttpTransportError('Valedictorian HTTP transport rejects URL credentials.')
  }

  if (url.origin !== allowedOrigin) {
    throw new ValedictorianHttpTransportError('Valedictorian HTTP transport origin is not allowed.')
  }

  assertAllowedValedictorianHttpRoute(url.pathname, method, encodedWorkspaceId)
  return url
}

function assertAllowedValedictorianHttpRoute(
  pathname: string,
  method: string,
  encodedWorkspaceId: string,
) {
  if (pathname === '/v1/capabilities') {
    if (method !== 'GET') {
      throw new ValedictorianHttpTransportError(
        'Valedictorian HTTP transport only allows GET for capabilities.',
      )
    }
    return
  }

  const workspacePrefix = `/v1/workspaces/${encodedWorkspaceId}`
  if (pathname !== workspacePrefix && !pathname.startsWith(`${workspacePrefix}/`)) {
    throw new ValedictorianHttpTransportError(
      'Valedictorian HTTP transport path is not allowed for the active workspace.',
    )
  }

  const relativePath = pathname === workspacePrefix
    ? ''
    : pathname.slice(workspacePrefix.length + 1)

  assertDeniedLocalSecretResolveRoute(relativePath)

  if (relativePath.startsWith('connectors/')) {
    const afterConnectors = relativePath.slice('connectors/'.length)
    const connectorSeparator = afterConnectors.indexOf('/')
    if (connectorSeparator !== -1) {
      const connectorResourcePath = afterConnectors.slice(connectorSeparator + 1)
      if (
        connectorResourcePath === 'schedule'
        || connectorResourcePath.startsWith('schedule/')
      ) {
        assertAllowedConnectorScheduleRoute(connectorResourcePath, method)
        return
      }
    }
  }
}

function assertDeniedLocalSecretResolveRoute(relativePath: string) {
  if (
    relativePath === 'secrets/local/resolve'
    || relativePath.startsWith('secrets/local/resolve/')
  ) {
    throw new ValedictorianHttpTransportError(
      'Valedictorian HTTP transport local secret resolution is not allowed.',
    )
  }
}

function assertAllowedConnectorScheduleRoute(schedulePath: string, method: string) {
  if (schedulePath === 'schedule') {
    if (method !== 'GET' && method !== 'PUT' && method !== 'DELETE') {
      throw new ValedictorianHttpTransportError(
        'Valedictorian HTTP transport schedule method is not allowed.',
      )
    }
    return
  }

  if (schedulePath === 'schedule/pause' || schedulePath === 'schedule/resume') {
    if (method !== 'POST') {
      throw new ValedictorianHttpTransportError(
        'Valedictorian HTTP transport schedule action method is not allowed.',
      )
    }
    return
  }

  throw new ValedictorianHttpTransportError(
    'Valedictorian HTTP transport schedule subroute is not allowed.',
  )
}

function normalizeAllowedMethod(method: string) {
  const normalized = method.toUpperCase()
  if (!(VALEDICTORIAN_HTTP_ALLOWED_METHODS as readonly string[]).includes(normalized)) {
    throw new ValedictorianHttpTransportError('Valedictorian HTTP transport method is not allowed.')
  }
  return normalized
}

function sanitizeTransportRequestHeaders(headers: Record<string, string> | undefined) {
  const sanitized: Record<string, string> = {}

  for (const [key, value] of Object.entries(headers ?? {})) {
    const lower = key.toLowerCase()
    if (!(VALEDICTORIAN_HTTP_REQUEST_HEADER_ALLOWLIST as readonly string[]).includes(lower)) {
      continue
    }
    sanitized[lower] = value
  }

  return sanitized
}

function sanitizeTransportResponseHeaders(headers: Headers) {
  const sanitized: Record<string, string> = {}

  for (const name of VALEDICTORIAN_HTTP_RESPONSE_HEADER_ALLOWLIST) {
    const value = headers.get(name)
    if (value !== null) {
      sanitized[name] = value
    }
  }

  return sanitized
}

function assertBodySize(body: string) {
  if (utf8ByteLength(body) > VALEDICTORIAN_HTTP_MAX_BODY_BYTES) {
    throw new ValedictorianHttpTransportError('Valedictorian HTTP transport body is too large.')
  }
}

export function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength
}

export function createPrivilegedValedictorianFetch(
  transport: ValedictorianHttpTransport,
): typeof fetch {
  return (async (input, init) => {
    const request = new Request(input, init)
    const headerRecord: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      headerRecord[key] = value
    })

    const response = await transport.request({
      body: request.method === 'GET' || request.method === 'HEAD'
        ? null
        : await request.text(),
      headers: headerRecord,
      method: request.method,
      url: request.url,
    }, { signal: request.signal })

    return new Response(response.body, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    })
  }) as typeof fetch
}
