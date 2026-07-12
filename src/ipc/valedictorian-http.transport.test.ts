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

  it('exposes a privileged preload fetch without putting the token in argv or the renderer config', () => {
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
      request: expect.any(Function),
      workspaceId: 'ws-1',
    })
    expect(JSON.stringify(config)).not.toContain('remote-token')
    expect(JSON.stringify(config)).not.toContain('token')

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
})
