import {
  createHttpValedictorianClient,
  connectorOptionQueryErrorBodies,
  connectorOptionQueryErrorStatusByCode,
  connectorScheduleErrorBodies,
  connectorScheduleErrorStatusByCode,
  connectorRetirementActiveWorkConflictMessage,
  profileDocumentErrorBodies,
  profileDocumentErrorStatusByCode,
  valedictorianRequestIdSchema,
  ValedictorianHttpError,
  type ConnectorScheduleErrorCode,
  type ValedictorianWorkspaceClient,
} from '@sparxie/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createBoundaryWorkspaceClient,
  createLocalServerHttpTestFixture,
} from './local-server.http-test-harness'
import { LocalWorkspaceConflictError } from './local-workspaces'

const INTERNAL_ERROR_BODY = {
  code: 'internal_error',
  message: 'An unexpected error occurred.',
}

const VALIDATION_ERROR_BODY = { message: 'The request is invalid.' }
const NOT_FOUND_ERROR_BODY = { message: 'The requested resource was not found.' }

const upsertScheduleBody = {
  cadence: { everyMinutes: 60, kind: 'interval' },
  expectedRevision: null,
  state: 'enabled',
  timezone: 'UTC',
} as const

describe('local server safe HTTP error boundary', () => {
  const fixture = createLocalServerHttpTestFixture()

  beforeEach(() => fixture.setup())
  afterEach(() => fixture.teardown())

  it('returns a fixed 500 while the injected logger receives the raw diagnostic and request identity', async () => {
    const diagnostic = new Error('database password canary at /private/workspace.sqlite')
    const events: unknown[] = []
    const server = await fixture.start({
      client: createBoundaryWorkspaceClient(() => {}),
      onRequestError(event) {
        events.push(event)
      },
      resolveWorkspaceClient() {
        throw diagnostic
      },
    })

    const response = await fetch(`${server.url}/v1/workspaces/error-workspace/applications`, {
      headers: { 'x-request-id': 'request-safe-boundary-279' },
    })
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(response.headers.get('access-control-allow-headers')).toContain('x-request-id')
    expect(body).toEqual({ ...INTERNAL_ERROR_BODY, requestId: 'request-safe-boundary-279' })
    expect(JSON.stringify(body)).not.toContain('password canary')
    expect(JSON.stringify(body)).not.toContain('workspace.sqlite')
    expect(events).toEqual([{
      error: diagnostic,
      method: 'GET',
      pathname: '/v1/workspaces/error-workspace/applications',
      requestId: 'request-safe-boundary-279',
    }])
  })

  it('returns the fixed 500 when mapping inspects a thrown object with a throwing code getter', async () => {
    const diagnostic = {
      get code() {
        throw new Error('hostile code getter canary')
      },
      message: 'hostile code access canary',
    }
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

    const response = await fetch(`${server.url}/v1/workspaces/hostile-code/applications`, {
      headers: { 'x-request-id': 'hostile-code-getter-279' },
      signal: AbortSignal.timeout(1_000),
    })
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(body).toEqual({ ...INTERNAL_ERROR_BODY, requestId: 'hostile-code-getter-279' })
    expect(JSON.stringify(body)).not.toContain('hostile code')
    expect(events).toHaveLength(1)
    expect(events[0]?.error === diagnostic).toBe(true)
    expect(events[0]).toMatchObject({
      method: 'GET',
      pathname: '/v1/workspaces/hostile-code/applications',
      requestId: 'hostile-code-getter-279',
    })
  })

  it('serializes a response before committing headers so serialization failures reach the boundary', async () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const events: unknown[] = []
    const client = createBoundaryWorkspaceClient(() => {}, {
      applications: {
        async list() {
          return circular
        },
      } as never,
    })
    const server = await fixture.start({
      client,
      onRequestError(event) {
        events.push(event)
      },
      resolveWorkspaceClient: () => client,
    })

    const response = await fetch(
      `${server.url}/v1/workspaces/serialization-errors/applications`,
      {
        headers: { 'x-request-id': 'serialization-boundary-279' },
        signal: AbortSignal.timeout(1_000),
      },
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      ...INTERNAL_ERROR_BODY,
      requestId: 'serialization-boundary-279',
    })
    expect(events).toEqual([expect.objectContaining({
      error: expect.any(TypeError),
      requestId: 'serialization-boundary-279',
    })])
  })

  it.each([
    ['missing', undefined],
    ['invalid', 'invalid request id with spaces'],
  ])('generates a schema-valid request id when the inbound id is %s', async (_label, requestId) => {
    const events: Array<{ requestId: string }> = []
    const server = await fixture.start({
      client: createBoundaryWorkspaceClient(() => {}),
      onRequestError(event) {
        events.push(event)
      },
      resolveWorkspaceClient() {
        throw new Error('generated-id diagnostic canary')
      },
    })

    const response = await fetch(`${server.url}/v1/workspaces/error-workspace/applications`, {
      headers: requestId === undefined ? undefined : { 'x-request-id': requestId },
    })
    const body = await response.json() as { requestId: string }

    expect(response.status).toBe(500)
    expect(body).toEqual({ ...INTERNAL_ERROR_BODY, requestId: expect.any(String) })
    expect(valedictorianRequestIdSchema.safeParse(body.requestId).success).toBe(true)
    expect(events).toEqual([expect.objectContaining({ requestId: body.requestId })])
  })

  it('keeps the safe response intact when a custom logger throws', async () => {
    const server = await fixture.start({
      client: createBoundaryWorkspaceClient(() => {}),
      onRequestError() {
        throw new Error('logger failure canary')
      },
      resolveWorkspaceClient() {
        throw new Error('request failure canary')
      },
    })

    const response = await fetch(`${server.url}/v1/workspaces/error-workspace/applications`)
    const body = await response.json() as { requestId: string }

    expect(response.status).toBe(500)
    expect(body).toEqual({ ...INTERNAL_ERROR_BODY, requestId: expect.any(String) })
    expect(JSON.stringify(body)).not.toContain('logger failure')
    expect(JSON.stringify(body)).not.toContain('request failure')
  })

  it('uses a real default stderr logger without exposing its diagnostic', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const diagnostic = new Error('default logger diagnostic canary')
    const server = await fixture.start({
      client: createBoundaryWorkspaceClient(() => {}),
      resolveWorkspaceClient() {
        throw diagnostic
      },
    })

    const response = await fetch(`${server.url}/v1/workspaces/error-workspace/applications`)
    const body = await response.json() as { requestId: string }

    expect(consoleError).toHaveBeenCalledWith(
      'Valedictorian HTTP request failed',
      expect.objectContaining({
        method: 'GET',
        pathname: '/v1/workspaces/error-workspace/applications',
        requestId: body.requestId,
      }),
      diagnostic,
    )
    expect(JSON.stringify(body)).not.toContain('default logger diagnostic')
    consoleError.mockRestore()
  })

  it.each([
    ['connector_scheduling_unavailable', 'PUT', '/schedule', upsertScheduleBody],
    ['invalid_timezone', 'PUT', '/schedule', upsertScheduleBody],
    ['invalid_cadence', 'PUT', '/schedule', upsertScheduleBody],
    ['schedule_too_frequent', 'PUT', '/schedule', upsertScheduleBody],
    ['stale_schedule_revision', 'POST', '/schedule/pause', { expectedRevision: 'revision-1' }],
    ['schedule_dispatch_conflict', 'POST', '/schedule/dispatch-due', {
      expectedRevision: 'revision-1',
    }],
  ] as const)(
    'maps schedule failure %s to its canonical contract through %s %s',
    async (code, method, route, body) => {
      const canary = `raw schedule diagnostic for ${code}`
      const failure = Object.assign(new Error(canary), { code, statusCode: 418 })
      const schedules = throwingScheduleMethods(failure)
      const client = createBoundaryWorkspaceClient(() => {}, {
        connectors: { schedules } as never,
      })
      const server = await fixture.start({
        client,
        onRequestError: vi.fn(),
        resolveWorkspaceClient: () => client,
      })

      const url = `${server.url}/v1/workspaces/schedule-errors/connectors/fixture${route}`
      const request = {
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
      }
      const response = await (method === 'PUT'
        ? fetch(url, { ...request, method: 'PUT' })
        : fetch(url, { ...request, method: 'POST' }))
      const responseBody = await response.json()

      expect(response.status).toBe(connectorScheduleErrorStatusByCode[code])
      expect(response.headers.get('content-type')).toBe('application/json')
      expect(responseBody).toEqual(connectorScheduleErrorBodies[code])
      expect(JSON.stringify(responseBody)).not.toContain(canary)
    },
  )

  it('reconstructs the canonical retirement conflict despite a noncanonical thrown message', async () => {
    const activeRuns = [{ connectorRunId: 'run-queued-279', status: 'queued' as const }]
    const failure = Object.assign(new Error('raw retirement SQL diagnostic canary'), {
      activeRuns,
      cancellationRequired: true,
      code: 'connector_retirement_active_work_conflict',
      connectorInstanceId: 'fixture-retirement',
      message: 'raw retirement SQL diagnostic canary',
      statusCode: 418,
    })
    const client = connectorRemovalFailureClient(failure)
    const server = await fixture.start({
      client,
      onRequestError: vi.fn(),
      resolveWorkspaceClient: () => client,
    })

    const response = await fetch(
      `${server.url}/v1/workspaces/retirement-errors/connectors/fixture-retirement`,
      { method: 'DELETE' },
    )
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body).toEqual({
      activeRuns,
      cancellationRequired: true,
      code: 'connector_retirement_active_work_conflict',
      connectorInstanceId: 'fixture-retirement',
      message: connectorRetirementActiveWorkConflictMessage,
    })
    expect(JSON.stringify(body)).not.toContain('SQL diagnostic')
  })

  it('fails safely when a recognized retirement conflict has malformed active-work facts', async () => {
    const failure = Object.assign(new Error('malformed retirement fact canary'), {
      activeRuns: [{ connectorRunId: 'run-queued-279', status: 'completed' }],
      cancellationRequired: true,
      code: 'connector_retirement_active_work_conflict',
      connectorInstanceId: 'fixture-retirement',
      statusCode: 409,
    })
    const client = connectorRemovalFailureClient(failure)
    const server = await fixture.start({
      client,
      onRequestError: vi.fn(),
      resolveWorkspaceClient: () => client,
    })

    const response = await fetch(
      `${server.url}/v1/workspaces/retirement-errors/connectors/fixture-retirement`,
      {
        headers: { 'x-request-id': 'malformed-retirement-279' },
        method: 'DELETE',
      },
    )
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ ...INTERNAL_ERROR_BODY, requestId: 'malformed-retirement-279' })
    expect(JSON.stringify(body)).not.toContain('malformed retirement')
  })

  it('accepts only a strict canonical profile error body and derives its status from Sparxie', async () => {
    const canonicalBody = profileDocumentErrorBodies.profile_revision_conflict
    const client = profileDocumentFailureClient(Object.assign(new Error('profile path canary'), {
      body: canonicalBody,
      statusCode: 418,
    }))
    const server = await fixture.start({
      client,
      onRequestError: vi.fn(),
      resolveWorkspaceClient: () => client,
    })

    const response = await fetch(
      `${server.url}/v1/workspaces/profile-errors/profile/document`,
    )

    expect(response.status).toBe(profileDocumentErrorStatusByCode.profile_revision_conflict)
    await expect(response.json()).resolves.toEqual(canonicalBody)
  })

  it('fails safely for a recognized profile code with a forged body', async () => {
    const client = profileDocumentFailureClient(Object.assign(new Error('profile forged canary'), {
      body: {
        code: 'profile_revision_conflict',
        message: 'profile database path forged canary',
      },
      statusCode: 409,
    }))
    const server = await fixture.start({
      client,
      onRequestError: vi.fn(),
      resolveWorkspaceClient: () => client,
    })

    const response = await fetch(
      `${server.url}/v1/workspaces/profile-errors/profile/document`,
      { headers: { 'x-request-id': 'forged-profile-279' } },
    )
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ ...INTERNAL_ERROR_BODY, requestId: 'forged-profile-279' })
    expect(JSON.stringify(body)).not.toContain('database path')
  })

  it('maps a connector option code to its canonical body and status', async () => {
    const code = 'option_dependency_invalid'
    const client = createBoundaryWorkspaceClient(() => {}, {
      connectors: {
        async list() {
          throw Object.assign(new Error('option provider token canary'), {
            body: { code, message: 'option provider token canary' },
            code,
            statusCode: 418,
          })
        },
      } as never,
    })
    const server = await fixture.start({
      client,
      onRequestError: vi.fn(),
      resolveWorkspaceClient: () => client,
    })

    const response = await fetch(
      `${server.url}/v1/workspaces/option-errors/connectors/fixture/options/query`,
      {
        body: JSON.stringify({
          dependencies: {},
          operation: { kind: 'search', limit: 10, search: 'react' },
          sourceId: 'fixture.skills',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      },
    )
    const body = await response.json()

    expect(response.status).toBe(connectorOptionQueryErrorStatusByCode[code])
    expect(body).toEqual(connectorOptionQueryErrorBodies[code])
    expect(JSON.stringify(body)).not.toContain('provider token')
  })

  it('preserves the fixed connector overview cursor error without forwarding its raw message', async () => {
    const client = createBoundaryWorkspaceClient(() => {}, {
      connectors: {
        overview: {
          async list() {
            throw Object.assign(new Error('overview cursor SQL canary'), {
              code: 'invalid_connector_overview_cursor',
              statusCode: 418,
            })
          },
        },
      } as never,
    })
    const server = await fixture.start({
      client,
      onRequestError: vi.fn(),
      resolveWorkspaceClient: () => client,
    })

    const response = await fetch(
      `${server.url}/v1/workspaces/overview-errors/connectors/overview`,
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({
      code: 'invalid_connector_overview_cursor',
      message: 'Invalid connector overview cursor.',
    })
    expect(JSON.stringify(body)).not.toContain('SQL canary')
  })

  it('preserves the fixed already-configured conflict and safely rejects unsupported local codes', async () => {
    const alreadyConfigured = await connectorCreateFailureResponse(fixture, {
      code: 'already_configured',
      message: 'connector database key canary',
      statusCode: 418,
    })
    expect(alreadyConfigured.response.status).toBe(409)
    expect(alreadyConfigured.body).toEqual({
      code: 'already_configured',
      message: 'This connector is already configured. Manage the existing instance.',
    })
    expect(JSON.stringify(alreadyConfigured.body)).not.toContain('database key')

    const unsupported = await connectorCreateFailureResponse(fixture, {
      code: 'capability_unavailable',
      message: 'capability provider diagnostic canary',
      statusCode: 409,
    }, 'unsupported-local-code-279')
    expect(unsupported.response.status).toBe(500)
    expect(unsupported.body).toEqual({
      ...INTERNAL_ERROR_BODY,
      requestId: 'unsupported-local-code-279',
    })
    expect(JSON.stringify(unsupported.body)).not.toContain('provider diagnostic')
  })

  it('preserves a workspace collision as a fixed 409 without exposing collision facts', async () => {
    const client = createBoundaryWorkspaceClient(() => {})
    const server = await fixture.start({
      client,
      onRequestError: vi.fn(),
      workspaceManager: {
        async open() {
          throw new LocalWorkspaceConflictError(
            'Workspace id private-id is registered at /private/workspace/path canary',
          )
        },
      } as never,
    })

    const response = await fetch(`${server.url}/v1/workspaces/open`, {
      body: JSON.stringify({ path: '/requested/path' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body).toEqual({ message: 'Workspace registration conflicts with an existing workspace.' })
    expect(JSON.stringify(body)).not.toContain('private-id')
    expect(JSON.stringify(body)).not.toContain('/private/')
  })

  it('keeps an unexpected secret resolution failure no-store and value-free while logging raw diagnostics', async () => {
    const diagnostic = new Error('secret_value=private-secret-canary')
    const events: unknown[] = []
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
      `${server.url}/v1/workspaces/secret-errors/secrets/local/resolve`,
      {
        body: JSON.stringify({
          purpose: { kind: 'subprocess_injection' },
          reference: { $valedictorianRef: 'secret://private-key' },
        }),
        headers: {
          authorization: 'Bearer server-token',
          'content-type': 'application/json',
          'x-request-id': 'secret-unexpected-279',
        },
        method: 'POST',
      },
    )
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(body).toEqual({ ...INTERNAL_ERROR_BODY, requestId: 'secret-unexpected-279' })
    expect(JSON.stringify(body)).not.toContain('private-secret-canary')
    expect(events).toEqual([expect.objectContaining({
      error: diagnostic,
      method: 'POST',
      pathname: '/v1/workspaces/secret-errors/secrets/local/resolve',
      requestId: expect.any(String),
    })])

    const typedError = await createHttpValedictorianClient({
      baseUrl: server.url,
      token: 'server-token',
    }).forWorkspace('secret-errors').secrets.local.resolve({
      purpose: { kind: 'subprocess_injection' },
      reference: { $valedictorianRef: 'secret://private-key' },
    }).catch((caught: unknown) => caught)

    expect(typedError).toBeInstanceOf(ValedictorianHttpError)
    expect(typedError).toMatchObject({
      body: { ...INTERNAL_ERROR_BODY, requestId: expect.any(String) },
      kind: 'internal',
      requestId: expect.any(String),
      status: 500,
    })
  })

  it('keeps secret-route fallback no-store when mapping inspects a throwing body getter', async () => {
    const diagnostic = {
      get body() {
        throw new Error('secret body getter canary')
      },
      message: 'secret body access canary',
    }
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
      `${server.url}/v1/workspaces/secret-body-trap/secrets/local/resolve`,
      {
        body: JSON.stringify({
          purpose: { kind: 'subprocess_injection' },
          reference: { $valedictorianRef: 'secret://private-key' },
        }),
        headers: {
          authorization: 'Bearer server-token',
          'content-type': 'application/json',
          'x-request-id': 'secret-body-trap-279',
        },
        method: 'POST',
        signal: AbortSignal.timeout(1_000),
      },
    )
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(body).toEqual({ ...INTERNAL_ERROR_BODY, requestId: 'secret-body-trap-279' })
    expect(JSON.stringify(body)).not.toContain('body getter canary')
    expect(JSON.stringify(body)).not.toContain('body access canary')
    expect(JSON.stringify(body)).not.toContain('private-key')
    expect(events).toHaveLength(1)
    expect(events[0]?.error === diagnostic).toBe(true)
    expect(events[0]).toMatchObject({
      method: 'POST',
      pathname: '/v1/workspaces/secret-body-trap/secrets/local/resolve',
      requestId: 'secret-body-trap-279',
    })
  })

  it('keeps no-store fallback writable when a secret success result cannot serialize', async () => {
    const client = createBoundaryWorkspaceClient(() => {}, {
      secrets: {
        local: {
          async resolve() {
            return { value: 1n } as never
          },
        },
      } as never,
    })
    const server = await fixture.start({
      client,
      localSecretResolutionEnabled: true,
      onRequestError: vi.fn(),
      resolveWorkspaceClient: () => client,
      token: 'server-token',
    })

    const response = await fetch(
      `${server.url}/v1/workspaces/secret-serialization/secrets/local/resolve`,
      {
        body: JSON.stringify({
          purpose: { kind: 'subprocess_injection' },
          reference: { $valedictorianRef: 'secret://private-key' },
        }),
        headers: {
          authorization: 'Bearer server-token',
          'content-type': 'application/json',
          'x-request-id': 'secret-serialization-279',
        },
        method: 'POST',
        signal: AbortSignal.timeout(1_000),
      },
    )

    expect(response.status).toBe(500)
    expect(response.headers.get('cache-control')).toContain('no-store')
    await expect(response.json()).resolves.toEqual({
      ...INTERNAL_ERROR_BODY,
      requestId: 'secret-serialization-279',
    })
  })

  it('returns a fixed 404 for a scoped legacy connector not-found outcome', async () => {
    const diagnostic = Object.assign(new Error('connector storage key canary'), {
      statusCode: 404,
    })
    const client = createBoundaryWorkspaceClient(() => {}, {
      connectors: {
        schedules: {
          async get() {
            throw diagnostic
          },
        },
      } as never,
    })
    const server = await fixture.start({
      client,
      onRequestError: vi.fn(),
      resolveWorkspaceClient: () => client,
    })

    const response = await fetch(
      `${server.url}/v1/workspaces/connector-errors/connectors/fixture/schedule`,
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual(NOT_FOUND_ERROR_BODY)
  })

  it('returns fixed parser responses without reflecting request values', async () => {
    const client = createBoundaryWorkspaceClient(() => {})
    const events: unknown[] = []
    const server = await fixture.start({
      client,
      onRequestError(event) {
        events.push(event)
      },
      resolveWorkspaceClient: () => client,
    })
    const base = `${server.url}/v1/workspaces/body-errors`

    const malformed = await fetch(`${base}/applications`, {
      body: '{"private":"malformed-json-canary"',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    expect(malformed.status).toBe(400)
    await expect(malformed.json()).resolves.toEqual(VALIDATION_ERROR_BODY)
    expect(events).toEqual([])
  })

  it.each([
    ['application schedule', '/applications', applicationListFailureClient, {
      code: 'invalid_timezone',
    }],
    ['policy option', '/policy/config', policyConfigFailureClient, {
      code: 'option_dependency_invalid',
    }],
    ['application retirement', '/applications', applicationListFailureClient, {
      activeRuns: [{ connectorRunId: 'collision-run', status: 'queued' }],
      cancellationRequired: true,
      code: 'connector_retirement_active_work_conflict',
      connectorInstanceId: 'collision-connector',
    }],
    ['policy profile', '/policy/config', policyConfigFailureClient, {
      body: profileDocumentErrorBodies.profile_revision_conflict,
    }],
  ] as const)(
    'does not apply the global %s contract outside its owning route',
    async (label, route, createClient, properties) => {
      const diagnostic = Object.assign(new Error(`${label} collision canary`), properties)
      const client = createClient(diagnostic)
      const requestId = `collision-${label.replaceAll(' ', '-')}-279`
      const server = await fixture.start({
        client,
        onRequestError: vi.fn(),
        resolveWorkspaceClient: () => client,
      })

      const response = await fetch(
        `${server.url}/v1/workspaces/collision-errors${route}`,
        { headers: { 'x-request-id': requestId } },
      )
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body).toEqual({ ...INTERNAL_ERROR_BODY, requestId })
      expect(JSON.stringify(body)).not.toContain('collision canary')
    },
  )

  it.each([
    ['application', '/applications', applicationListFailureClient],
    ['policy', '/policy/config', policyConfigFailureClient],
  ] as const)(
    'maps an unclassified %s exception with a forged statusCode to the fixed 500',
    async (family, route, createClient) => {
      const diagnostic = Object.assign(new Error(`${family} SQL/path diagnostic canary`), {
        statusCode: 400,
      })
      const client = createClient(diagnostic)
      const events: unknown[] = []
      const server = await fixture.start({
        client,
        onRequestError(event) {
          events.push(event)
        },
        resolveWorkspaceClient: () => client,
      })
      const requestId = `unclassified-${family}-279`

      const response = await fetch(
        `${server.url}/v1/workspaces/${family}-errors${route}`,
        { headers: { 'x-request-id': requestId } },
      )
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body).toEqual({ ...INTERNAL_ERROR_BODY, requestId })
      expect(JSON.stringify(body)).not.toContain('SQL/path')
      expect(events).toEqual([expect.objectContaining({ error: diagnostic, requestId })])
    },
  )

  it('maps an unclassified workspace-manager statusCode error to the fixed 500', async () => {
    const diagnostic = Object.assign(new Error('workspace registry path canary'), {
      statusCode: 409,
    })
    const server = await fixture.start({
      client: createBoundaryWorkspaceClient(() => {}),
      onRequestError: vi.fn(),
      workspaceManager: {
        async list() {
          throw diagnostic
        },
      } as never,
    })

    const response = await fetch(`${server.url}/v1/workspaces`, {
      headers: { 'x-request-id': 'unclassified-workspace-279' },
    })
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({
      ...INTERNAL_ERROR_BODY,
      requestId: 'unclassified-workspace-279',
    })
    expect(JSON.stringify(body)).not.toContain('registry path')
  })

  it('retains an explicit route-local connector schedule not-found response', async () => {
    const client = createBoundaryWorkspaceClient(() => {})
    client.connectors = {
      schedules: {
        async get() {
          return null
        },
      },
    } as never
    const server = await fixture.start({
      client,
      onRequestError: vi.fn(),
      resolveWorkspaceClient: () => client,
    })

    const response = await fetch(
      `${server.url}/v1/workspaces/explicit-route-results/connectors/missing-connector/schedule`,
    )
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ message: 'Not found' })
  })
})

function throwingScheduleMethods(error: Error & { code: ConnectorScheduleErrorCode }) {
  const fail = async () => { throw error }
  return {
    delete: fail,
    dispatchDue: fail,
    get: fail,
    listAudit: fail,
    listOccurrences: fail,
    pause: fail,
    resume: fail,
    upsert: fail,
  } satisfies ValedictorianWorkspaceClient['connectors']['schedules']
}

function connectorRemovalFailureClient(error: unknown) {
  return createBoundaryWorkspaceClient(() => {}, {
    connectors: {
      async remove() {
        throw error
      },
    } as never,
  })
}

function profileDocumentFailureClient(error: unknown) {
  return createBoundaryWorkspaceClient(() => {}, {
    profile: {
      document: {
        async get() {
          throw error
        },
      },
    } as never,
  })
}

async function connectorCreateFailureResponse(
  fixture: ReturnType<typeof createLocalServerHttpTestFixture>,
  failure: { code: string; message: string; statusCode: number },
  requestId = 'already-configured-279',
) {
  const client = createBoundaryWorkspaceClient(() => {}, {
    connectors: {
      async create() {
        throw Object.assign(new Error(failure.message), failure)
      },
    } as never,
  })
  const server = await fixture.start({
    client,
    onRequestError: vi.fn(),
    resolveWorkspaceClient: () => client,
  })
  const response = await fetch(`${server.url}/v1/workspaces/local-errors/connectors`, {
    body: JSON.stringify({
      connectorId: 'fixture.connector',
      connectorVersion: '1.0.0',
      displayName: 'Fixture',
      enabled: true,
      id: 'fixture-instance',
    }),
    headers: {
      'content-type': 'application/json',
      'x-request-id': requestId,
    },
    method: 'POST',
  })
  return { body: await response.json(), response }
}

function applicationListFailureClient(error: unknown) {
  return createBoundaryWorkspaceClient(() => {}, {
    applications: {
      async list() {
        throw error
      },
    } as never,
  })
}

function policyConfigFailureClient(error: unknown) {
  return createBoundaryWorkspaceClient(() => {}, {
    policy: {
      config: {
        async get() {
          throw error
        },
      },
    } as never,
  })
}
