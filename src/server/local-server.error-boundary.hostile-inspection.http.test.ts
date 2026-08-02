import type http from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { handleHttpRequestError } from '@sparxie/valedictorian-local-runtime/testing/server/local-server.error-boundary'
import {
  createBoundaryWorkspaceClient,
  createLocalServerHttpTestFixture,
} from './local-server.http-test-harness'

const INTERNAL_ERROR_BODY = {
  code: 'internal_error',
  message: 'An unexpected error occurred.',
}

describe('local server hostile error-inspection boundary', () => {
  const fixture = createLocalServerHttpTestFixture()

  beforeEach(() => fixture.setup())
  afterEach(() => fixture.teardown())

  it('keeps direct secret-route boundary no-store when instanceof hits a throwing getPrototypeOf trap', () => {
    const diagnostic = createHostilePrototypeProxy()
    const events: Array<{ error: unknown }> = []
    const { response, state } = createCaptureResponse()

    expect(() => handleHttpRequestError({
      error: diagnostic,
      isLocalSecretResolveRoute: true,
      onRequestError(event) {
        events.push(event)
      },
      pathname: '/v1/workspaces/secret-proto-trap/secrets/local/resolve',
      // A hostile probe supplies only the fields the boundary is allowed to read.
      request: {
        headers: { 'x-request-id': 'secret-proto-trap-279' },
        method: 'POST',
      } as unknown as http.IncomingMessage,
      response,
    })).not.toThrow()

    expect(state.ended).toBe(true)
    expect(state.statusCode).toBe(500)
    expect(state.headers?.['cache-control']).toBe('no-store')
    expect(JSON.parse(state.body ?? '')).toEqual({
      ...INTERNAL_ERROR_BODY,
      requestId: 'secret-proto-trap-279',
    })
    expect(state.body).not.toContain('getPrototypeOf')
    expect(events).toHaveLength(1)
    expect(events[0]?.error === diagnostic).toBe(true)
  })

  it('keeps secret-route HTTP fallback no-store when instanceof hits a throwing getPrototypeOf trap', async () => {
    const diagnostic = createHostilePrototypeProxy()
    const events: Array<{ error: unknown; method: string; pathname: string; requestId: string }> = []
    const client = createBoundaryWorkspaceClient(() => {}, {
      secrets: {
        local: {
          async resolve() {
            throw diagnostic
          },
        },
      } as never,
    })
    const server = await fixture.start({
      client,
      localSecretResolutionEnabled: true,
      onRequestError(event) {
        events.push(event)
      },
      resolveWorkspaceClient: () => client,
      token: 'server-token',
    })

    const response = await fetch(
      `${server.url}/v1/workspaces/secret-proto-trap/secrets/local/resolve`,
      {
        body: JSON.stringify({
          purpose: { kind: 'subprocess_injection' },
          reference: { $valedictorianRef: 'secret://private-key' },
        }),
        headers: {
          authorization: 'Bearer server-token',
          'content-type': 'application/json',
          'x-request-id': 'secret-proto-http-279',
        },
        method: 'POST',
        signal: AbortSignal.timeout(1_000),
      },
    )
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(body).toEqual({ ...INTERNAL_ERROR_BODY, requestId: 'secret-proto-http-279' })
    expect(JSON.stringify(body)).not.toContain('getPrototypeOf')
    expect(events).toHaveLength(1)
    expect(events[0]?.error === diagnostic).toBe(true)
    expect(events[0]).toMatchObject({
      method: 'POST',
      pathname: '/v1/workspaces/secret-proto-trap/secrets/local/resolve',
      requestId: 'secret-proto-http-279',
    })
  })

  it('returns the fixed 500 when generic mapping hits a throwing getPrototypeOf trap', async () => {
    const diagnostic = createHostilePrototypeProxy()
    const events: Array<{ error: unknown; method: string; pathname: string; requestId: string }> = []
    const server = await fixture.start({
      client: createBoundaryWorkspaceClient(() => {}),
      onRequestError(event) {
        events.push(event)
      },
      resolveWorkspaceClient() {
        throw diagnostic
      },
    })

    const response = await fetch(`${server.url}/v1/workspaces/proto-trap/applications`, {
      headers: { 'x-request-id': 'generic-proto-trap-279' },
      signal: AbortSignal.timeout(1_000),
    })
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ ...INTERNAL_ERROR_BODY, requestId: 'generic-proto-trap-279' })
    expect(JSON.stringify(body)).not.toContain('getPrototypeOf')
    expect(events).toHaveLength(1)
    expect(events[0]?.error === diagnostic).toBe(true)
    expect(events[0]).toMatchObject({
      method: 'GET',
      pathname: '/v1/workspaces/proto-trap/applications',
      requestId: 'generic-proto-trap-279',
    })
  })
})

function createHostilePrototypeProxy() {
  return new Proxy({}, {
    getPrototypeOf() {
      throw new Error('getPrototypeOf inspection canary')
    },
  })
}

function createCaptureResponse() {
  const state: {
    body?: string
    ended: boolean
    headers?: Record<string, string>
    statusCode?: number
  } = { ended: false }
  const response = {
    end(body?: string) {
      state.body = body
      state.ended = true
    },
    writeHead(statusCode: number, headers: Record<string, string>) {
      state.headers = headers
      state.statusCode = statusCode
    },
  } as unknown as http.ServerResponse
  return { response, state }
}
