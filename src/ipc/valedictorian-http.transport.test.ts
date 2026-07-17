import { transferableAbortController } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import {
  createPrivilegedValedictorianFetch,
  createValedictorianHttpTransport,
  ValedictorianHttpTransportError,
} from './valedictorian-http.transport'
import {
  createBoundValedictorianHttpTransport,
  parseValedictorianHttpTransportRequest,
  registerValedictorianHttpIpc,
  VALEDICTORIAN_HTTP_CANCEL_CHANNEL,
  VALEDICTORIAN_HTTP_REQUEST_CHANNEL,
} from './valedictorian-http.ipc'
import {
  createValedictorianHttpPreloadApi,
  readRendererHttpConfig,
} from './valedictorian-http.preload'

describe('Valedictorian HTTP transport boundary', () => {
  it('allows root capabilities and exact active-workspace schedule calls with main-side auth', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      expect(request.headers.get('authorization')).toBe('Bearer remote-token')
      expect(init?.redirect).toBe('error')
      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          'content-type': 'application/json',
          'set-cookie': 'secret=1',
          'x-internal-token': 'leak',
        },
        status: 200,
      })
    })

    const transport = createValedictorianHttpTransport({
      apiBaseUrl: 'https://api.valedictorian.test',
      apiToken: 'remote-token',
      fetchImplementation: fetchMock as typeof fetch,
      workspaceId: 'ws-1',
    })

    const capabilities = await transport.request({
      headers: {
        accept: 'application/json',
        authorization: 'Bearer leaked',
        cookie: 'session=1',
        host: 'evil.test',
      },
      method: 'GET',
      url: 'https://api.valedictorian.test/v1/capabilities',
    })
    expect(capabilities.status).toBe(200)
    expect(capabilities.headers).toEqual({
      'content-type': 'application/json',
    })
    expect(capabilities.headers['set-cookie']).toBeUndefined()
    expect(capabilities.headers['x-internal-token']).toBeUndefined()

    const schedule = await transport.request({
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      method: 'PUT',
      url: 'https://api.valedictorian.test/v1/workspaces/ws-1/connectors/c-1/schedule',
      body: '{}',
    })
    expect(schedule.status).toBe(200)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstInit = fetchMock.mock.calls[0]![1]
    const firstHeaders = new Headers(firstInit?.headers)
    expect(firstHeaders.get('authorization')).toBe('Bearer remote-token')
    expect(firstHeaders.get('cookie')).toBeNull()
    expect(firstHeaders.get('host')).toBeNull()
    expect(firstInit?.redirect).toBe('error')
  })

  it('rejects cross-workspace paths, non-capabilities root routes, credentials, and unsupported methods', async () => {
    const transport = createValedictorianHttpTransport({
      apiBaseUrl: 'https://api.valedictorian.test',
      apiToken: 'remote-token',
      fetchImplementation: vi.fn() as unknown as typeof fetch,
      workspaceId: 'ws-1',
    })

    await expect(transport.request({
      method: 'GET',
      url: 'https://api.valedictorian.test/v1/workspaces/ws-other/connectors/c-1/schedule',
    })).rejects.toBeInstanceOf(ValedictorianHttpTransportError)

    await expect(transport.request({
      method: 'GET',
      url: 'https://api.valedictorian.test/v1/health',
    })).rejects.toBeInstanceOf(ValedictorianHttpTransportError)

    await expect(transport.request({
      method: 'GET',
      url: 'https://api.valedictorian.test/v1/workspaces',
    })).rejects.toBeInstanceOf(ValedictorianHttpTransportError)

    await expect(transport.request({
      method: 'GET',
      url: 'https://user:pass@api.valedictorian.test/v1/capabilities',
    })).rejects.toBeInstanceOf(ValedictorianHttpTransportError)

    await expect(transport.request({
      method: 'TRACE',
      url: 'https://api.valedictorian.test/v1/capabilities',
    })).rejects.toBeInstanceOf(ValedictorianHttpTransportError)

    await expect(transport.request({
      method: 'GET',
      url: 'https://evil.test/v1/capabilities',
    })).rejects.toBeInstanceOf(ValedictorianHttpTransportError)

    await expect(transport.request({
      method: 'GET',
      url: 'file:///etc/passwd',
    })).rejects.toBeInstanceOf(ValedictorianHttpTransportError)
  })

  it('allows only GET capabilities and exact schedule management routes while rejecting forbidden schedule subroutes', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', {
      headers: { 'content-type': 'application/json' },
      status: 200,
    }))
    const transport = createValedictorianHttpTransport({
      apiBaseUrl: 'https://api.valedictorian.test',
      apiToken: 'remote-token',
      fetchImplementation: fetchMock as typeof fetch,
      workspaceId: 'ws-1',
    })

    const allowed = [
      { method: 'GET', url: 'https://api.valedictorian.test/v1/capabilities' },
      { method: 'GET', url: 'https://api.valedictorian.test/v1/workspaces/ws-1/connectors/c-1/schedule' },
      { method: 'PUT', url: 'https://api.valedictorian.test/v1/workspaces/ws-1/connectors/c-1/schedule', body: '{}' },
      { method: 'DELETE', url: 'https://api.valedictorian.test/v1/workspaces/ws-1/connectors/c-1/schedule' },
      { method: 'POST', url: 'https://api.valedictorian.test/v1/workspaces/ws-1/connectors/c-1/schedule/pause', body: '{}' },
      { method: 'POST', url: 'https://api.valedictorian.test/v1/workspaces/ws-1/connectors/c-1/schedule/resume', body: '{}' },
      { method: 'GET', url: 'https://api.valedictorian.test/v1/workspaces/ws-1/applications' },
      { method: 'POST', url: 'https://api.valedictorian.test/v1/workspaces/ws-1/connectors/c-1/runs', body: '{}' },
    ] as const

    for (const request of allowed) {
      await expect(transport.request(request)).resolves.toMatchObject({ status: 200 })
    }
    expect(fetchMock).toHaveBeenCalledTimes(allowed.length)

    const forbidden = [
      { method: 'DELETE', url: 'https://api.valedictorian.test/v1/capabilities' },
      { method: 'POST', url: 'https://api.valedictorian.test/v1/capabilities', body: '{}' },
      { method: 'PUT', url: 'https://api.valedictorian.test/v1/capabilities', body: '{}' },
      { method: 'POST', url: 'https://api.valedictorian.test/v1/workspaces/ws-1/connectors/c-1/schedule', body: '{}' },
      { method: 'PATCH', url: 'https://api.valedictorian.test/v1/workspaces/ws-1/connectors/c-1/schedule', body: '{}' },
      { method: 'GET', url: 'https://api.valedictorian.test/v1/workspaces/ws-1/connectors/c-1/schedule/pause' },
      { method: 'POST', url: 'https://api.valedictorian.test/v1/workspaces/ws-1/connectors/c-1/schedule/dispatch-due', body: '{}' },
      { method: 'GET', url: 'https://api.valedictorian.test/v1/workspaces/ws-1/connectors/c-1/schedule/audit' },
      { method: 'GET', url: 'https://api.valedictorian.test/v1/workspaces/ws-1/connectors/c-1/schedule/occurrences' },
      { method: 'GET', url: 'https://api.valedictorian.test/v1/workspaces/ws-1/connectors/c-1/schedule/extra' },
      { method: 'GET', url: 'https://api.valedictorian.test/v1/workspaces/ws-1/connectors/c-1/schedule/extra/nested' },
      { method: 'POST', url: 'https://api.valedictorian.test/v1/workspaces/ws-1/connectors/c-1/schedule/pause/extra', body: '{}' },
      { method: 'GET', url: 'https://api.valedictorian.test/v1/workspaces/ws-1/connectors/c-1/schedule/audit/items' },
      { method: 'GET', url: 'https://api.valedictorian.test/v1/workspaces/ws-1/connectors/c-1/schedule/occurrences/0' },
      { method: 'POST', url: 'https://api.valedictorian.test/v1/workspaces/ws-1/connectors/c-1/schedule/dispatch-due/now', body: '{}' },
    ] as const

    for (const request of forbidden) {
      await expect(transport.request(request)).rejects.toBeInstanceOf(ValedictorianHttpTransportError)
    }
    expect(fetchMock).toHaveBeenCalledTimes(allowed.length)
  })

  it('rejects local secret-resolution routes before fetch, including query and path-confusion variants', async () => {
    const PLAINTEXT_CANARY = 'plaintext-secret-canary-4e8a'
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      value: PLAINTEXT_CANARY,
    }), {
      headers: { 'content-type': 'application/json' },
      status: 200,
    }))
    const transport = createValedictorianHttpTransport({
      apiBaseUrl: 'https://api.valedictorian.test',
      apiToken: 'remote-token',
      fetchImplementation: fetchMock as typeof fetch,
      workspaceId: 'ws-1',
    })

    const forbidden = [
      'https://api.valedictorian.test/v1/workspaces/ws-1/secrets/local/resolve',
      'https://api.valedictorian.test/v1/workspaces/ws-1/secrets/local/resolve?probe=1',
      'https://api.valedictorian.test/v1/workspaces/ws-1/secrets/local/resolve/',
      'https://api.valedictorian.test/v1/workspaces/ws-1/secrets/local/resolve/extra',
      'https://api.valedictorian.test/v1/workspaces/ws-1/applications/../secrets/local/resolve',
      'https://api.valedictorian.test/v1/workspaces/ws-1/secrets/local/./resolve',
      'https://api.valedictorian.test/v1/workspaces/ws-1/connectors/c-1/../../secrets/local/resolve',
    ] as const

    for (const url of forbidden) {
      await expect(transport.request({
        body: '{}',
        method: 'POST',
        url,
      })).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(ValedictorianHttpTransportError)
        expect(String(error)).not.toContain(PLAINTEXT_CANARY)
        expect(JSON.stringify(error)).not.toContain(PLAINTEXT_CANARY)
        return true
      })
    }

    expect(fetchMock).not.toHaveBeenCalled()

    await expect(transport.request({
      method: 'GET',
      url: 'https://api.valedictorian.test/v1/workspaces/ws-1/applications',
    })).resolves.toMatchObject({ status: 200 })
    await expect(transport.request({
      method: 'GET',
      url: 'https://api.valedictorian.test/v1/workspaces/ws-1/connectors/c-1/schedule',
    })).resolves.toMatchObject({ status: 200 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects every nested path under a connector schedule prefix before fetch', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    const transport = createValedictorianHttpTransport({
      apiBaseUrl: 'https://api.valedictorian.test',
      apiToken: 'remote-token',
      fetchImplementation: fetchMock as typeof fetch,
      workspaceId: 'ws-1',
    })

    const nestedForbidden = [
      'https://api.valedictorian.test/v1/workspaces/ws-1/connectors/c-1/schedule/extra/nested',
      'https://api.valedictorian.test/v1/workspaces/ws-1/connectors/c-1/schedule/pause/nested',
      'https://api.valedictorian.test/v1/workspaces/ws-1/connectors/c-1/schedule/resume/nested',
      'https://api.valedictorian.test/v1/workspaces/ws-1/connectors/c-1/schedule/dispatch-due/nested',
      'https://api.valedictorian.test/v1/workspaces/ws-1/connectors/c-1/schedule/audit/nested',
      'https://api.valedictorian.test/v1/workspaces/ws-1/connectors/c-1/schedule/occurrences/nested',
    ] as const

    for (const url of nestedForbidden) {
      await expect(transport.request({ method: 'GET', url })).rejects.toBeInstanceOf(
        ValedictorianHttpTransportError,
      )
    }
    expect(fetchMock).not.toHaveBeenCalled()

    await expect(transport.request({
      method: 'GET',
      url: 'https://api.valedictorian.test/v1/workspaces/ws-1/connectors/c-1/schedule',
    })).resolves.toMatchObject({ status: 200 })
    await expect(transport.request({
      method: 'POST',
      url: 'https://api.valedictorian.test/v1/workspaces/ws-1/connectors/c-1/schedule/pause',
      body: '{}',
    })).resolves.toMatchObject({ status: 200 })
    await expect(transport.request({
      method: 'POST',
      url: 'https://api.valedictorian.test/v1/workspaces/ws-1/connectors/c-1/schedule/resume',
      body: '{}',
    })).resolves.toMatchObject({ status: 200 })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('rejects malformed and oversized IPC transport input', () => {
    expect(() => parseValedictorianHttpTransportRequest(null)).toThrow(
      /Valedictorian HTTP transport request/i,
    )
    expect(() => parseValedictorianHttpTransportRequest({
      method: 'GET',
    })).toThrow(/url/i)
    expect(() => parseValedictorianHttpTransportRequest({
      method: 'GET',
      url: 'https://api.valedictorian.test/v1/capabilities',
      body: 'x'.repeat(1_000_001),
    })).toThrow(/body/i)
    expect(() => parseValedictorianHttpTransportRequest({
      method: 'GET',
      url: 'https://api.valedictorian.test/v1/capabilities',
      headers: 'nope',
    })).toThrow(/headers/i)
  })

  it('rejects bodies that exceed the UTF-8 byte limit before fetch', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    const transport = createValedictorianHttpTransport({
      apiBaseUrl: 'https://api.valedictorian.test',
      apiToken: 'remote-token',
      fetchImplementation: fetchMock as typeof fetch,
      workspaceId: 'ws-1',
    })

    // 500_001 code units of U+00A3 (£) encode to 1_000_002 UTF-8 bytes, but stay under
    // a 1_000_001 UTF-16 code-unit threshold that a naive string.length check would allow.
    const oversizedUtf8Body = '\u00A3'.repeat(500_001)
    expect(oversizedUtf8Body.length).toBeLessThanOrEqual(1_000_000)
    expect(new TextEncoder().encode(oversizedUtf8Body).byteLength).toBeGreaterThan(1_000_000)

    await expect(transport.request({
      body: oversizedUtf8Body,
      method: 'PUT',
      url: 'https://api.valedictorian.test/v1/workspaces/ws-1/connectors/c-1/schedule',
    })).rejects.toBeInstanceOf(ValedictorianHttpTransportError)
    expect(fetchMock).not.toHaveBeenCalled()

    expect(() => parseValedictorianHttpTransportRequest({
      body: oversizedUtf8Body,
      method: 'PUT',
      url: 'https://api.valedictorian.test/v1/workspaces/ws-1/connectors/c-1/schedule',
    })).toThrow(/body/i)
  })

  it('exposes a privileged preload fetch without putting the token in argv or the renderer config', async () => {
    const invoke = vi.fn(async () => ({
      body: '{}',
      headers: { 'content-type': 'application/json' },
      status: 200,
      statusText: 'OK',
    }))
    const config = createValedictorianHttpPreloadApi(
      { invoke },
      {
        apiBaseUrl: 'https://api.valedictorian.test',
        usePrivilegedTransport: true,
        workspaceId: 'ws-1',
      },
    )

    expect(config).toEqual({
      apiBaseUrl: 'https://api.valedictorian.test',
      getBackendState: expect.any(Function),
      onBackendStateChanged: expect.any(Function),
      request: expect.any(Function),
      retryBackend: expect.any(Function),
      workspaceId: 'ws-1',
    })
    expect(JSON.stringify(config)).not.toContain('remote-token')
    expect(JSON.stringify(config)).not.toContain('token')
    await config.retryBackend(); expect(invoke).toHaveBeenCalledWith('valedictorian-backend:retry')

    const argvConfig = readRendererHttpConfig([
      '--valedictorian-api-url=https://api.valedictorian.test',
      '--valedictorian-workspace-id=ws-1',
      '--valedictorian-http-transport=privileged',
    ])
    expect(argvConfig).toEqual({
      apiBaseUrl: 'https://api.valedictorian.test',
      usePrivilegedTransport: true,
      workspaceId: 'ws-1',
    })
    expect(JSON.stringify(argvConfig)).not.toContain('token')
  })

  it('rebinds subsequent renderer calls only after main publishes a verified origin', () => {
    let bindingListener: ((_event: unknown, state: unknown) => void) | undefined
    const config = createValedictorianHttpPreloadApi(
      {
        invoke: vi.fn(),
        on(channel, listener) {
          expect(channel).toBe('valedictorian-backend:state-changed')
          bindingListener = listener
        },
      },
      {
        apiBaseUrl: 'http://127.0.0.1:51001',
        usePrivilegedTransport: false,
        workspaceId: 'ws-1',
      },
    )
    const observed = vi.fn()
    config.onBackendStateChanged(observed)

    bindingListener?.({}, { status: 'unavailable' })
    expect(config.getBackendState()).toEqual({ status: 'unavailable' })
    bindingListener?.({}, {
      origin: 'http://127.0.0.1:51002',
      status: 'available',
    })

    expect(config.getBackendState()).toEqual({
      origin: 'http://127.0.0.1:51002',
      status: 'available',
    })
    expect(observed).toHaveBeenCalledTimes(2)
  })

  it('does not replay an ambiguous mutation when the backend binding recovers', async () => {
    let bindingListener: ((_event: unknown, state: unknown) => void) | undefined
    const invoke = vi.fn(async () => {
      throw new TypeError('connection closed before the response arrived')
    })
    const config = createValedictorianHttpPreloadApi(
      {
        invoke,
        on(_channel, listener) {
          bindingListener = listener
        },
      },
      {
        apiBaseUrl: 'http://127.0.0.1:51001',
        usePrivilegedTransport: true,
        workspaceId: 'ws-1',
      },
    )

    await expect(config.request!(
      'http://127.0.0.1:51001/v1/workspaces/ws-1/connectors',
      { body: '{}', method: 'POST' },
    )).rejects.toThrow(/connection closed/i)
    bindingListener?.({}, { status: 'unavailable' })
    bindingListener?.({}, { origin: 'http://127.0.0.1:51002', status: 'available' })

    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('registers a generic HTTP IPC channel that preserves Sparxie response fields and strips secrets', async () => {
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
    const transport = createBoundValedictorianHttpTransport({
      apiBaseUrl: 'https://api.valedictorian.test',
      apiToken: 'remote-token',
      workspaceId: 'ws-1',
      fetchImplementation: vi.fn(async () => new Response('{"available":false}', {
        headers: {
          'content-type': 'application/json',
          'set-cookie': 'session=1',
          'x-test': '1',
        },
        status: 200,
        statusText: 'OK',
      })) as unknown as typeof fetch,
    })

    registerValedictorianHttpIpc(transport, {
      handle(channel, handler) {
        handlers.set(channel, handler as (...args: unknown[]) => Promise<unknown>)
      },
    })

    const response = await handlers.get(VALEDICTORIAN_HTTP_REQUEST_CHANNEL)?.({}, {
      method: 'GET',
      url: 'https://api.valedictorian.test/v1/capabilities',
    })

    expect(response).toEqual({
      body: '{"available":false}',
      headers: {
        'content-type': 'application/json',
      },
      status: 200,
      statusText: 'OK',
    })

    const privilegedFetch = createPrivilegedValedictorianFetch(transport)
    const fetchResponse = await privilegedFetch('https://api.valedictorian.test/v1/capabilities')
    expect(fetchResponse.status).toBe(200)
    await expect(fetchResponse.json()).resolves.toEqual({ available: false })
  })

  it('propagates preload cancellation through IPC to fetch and cleans up without cross-request aborts', async () => {
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
    const fetchSignals: AbortSignal[] = []
    const fetchSettlers: Array<(response: Response) => void> = []
    const fetchImplementation = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal
      expect(signal).toBeDefined()
      fetchSignals.push(signal!)
      return new Promise<Response>((resolve, reject) => {
        fetchSettlers.push(resolve)
        signal!.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        }, { once: true })
      })
    }) as unknown as typeof fetch
    const transport = createBoundValedictorianHttpTransport({
      apiBaseUrl: 'https://api.valedictorian.test',
      apiToken: 'remote-token',
      workspaceId: 'ws-1',
      fetchImplementation,
    })
    registerValedictorianHttpIpc(transport, {
      handle(channel, handler) {
        handlers.set(channel, handler as (...args: unknown[]) => Promise<unknown>)
      },
    })
    const invoke = vi.fn((channel: string, ...args: unknown[]) => {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`Missing IPC handler: ${channel}`)
      return handler({}, ...args)
    })
    const preload = createValedictorianHttpPreloadApi(
      { invoke },
      {
        apiBaseUrl: 'https://api.valedictorian.test',
        usePrivilegedTransport: true,
        workspaceId: 'ws-1',
      },
    )

    const firstAbort = transferableAbortController()
    const first = preload.request!(
      'https://api.valedictorian.test/v1/workspaces/ws-1/connectors',
      { method: 'GET', signal: firstAbort.signal },
    )
    await vi.waitFor(() => expect(fetchSignals).toHaveLength(1))
    const firstRequestPayload = vi.mocked(invoke).mock.calls.find(
      ([channel]) => channel === VALEDICTORIAN_HTTP_REQUEST_CHANNEL,
    )?.[1] as { requestId: string } | undefined
    firstAbort.abort()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchSignals[0].aborted).toBe(true)

    const second = preload.request!(
      'https://api.valedictorian.test/v1/workspaces/ws-1/connectors',
      { method: 'GET' },
    )
    await vi.waitFor(() => expect(fetchSignals).toHaveLength(2))
    await handlers.get(VALEDICTORIAN_HTTP_CANCEL_CHANNEL)?.({}, firstRequestPayload?.requestId)
    expect(fetchSignals[1].aborted).toBe(false)
    fetchSettlers[1](new Response('{}', {
      headers: { 'content-type': 'application/json' },
      status: 200,
    }))
    await expect(second).resolves.toMatchObject({ status: 200 })
  })

  it('aborts while request-body serialization is pending without sending IPC and removes its abort listener', async () => {
    let bodyController!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        bodyController = controller
      },
    })
    const invoke = vi.fn(async () => ({
      body: '{}',
      headers: { 'content-type': 'application/json' },
      status: 200,
      statusText: 'OK',
    }))
    const preload = createValedictorianHttpPreloadApi(
      { invoke },
      {
        apiBaseUrl: 'https://api.valedictorian.test',
        usePrivilegedTransport: true,
        workspaceId: 'ws-1',
      },
    )
    const abort = transferableAbortController()
    const request = new Request(
      'https://api.valedictorian.test/v1/workspaces/ws-1/connectors',
      {
        body,
        duplex: 'half',
        method: 'POST',
        signal: abort.signal,
      } as RequestInit,
    )
    const response = preload.request!(request)
    const removeAbortListener = vi.spyOn(AbortSignal.prototype, 'removeEventListener')
    await Promise.resolve()
    abort.abort()
    bodyController.close()

    await expect(response).rejects.toMatchObject({ name: 'AbortError' })
    expect(invoke).not.toHaveBeenCalledWith(
      VALEDICTORIAN_HTTP_REQUEST_CHANNEL,
      expect.anything(),
    )
    expect(invoke).not.toHaveBeenCalledWith(
      VALEDICTORIAN_HTTP_CANCEL_CHANNEL,
      expect.anything(),
    )
    const abortRemoves = removeAbortListener.mock.calls.filter(([type]) => type === 'abort').length
    expect(abortRemoves).toBeGreaterThan(0)
  })
})
