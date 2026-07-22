import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ProfileDocumentHttpError,
  ValedictorianHttpError,
  ValedictorianProtocolError,
  createValedictorianInternalErrorBody,
  profileDocumentErrorBodies,
  profileDocumentErrorStatusByCode,
  sourceAccessErrorBodies,
  sourceAccessErrorStatusByCode,
  valedictorianInternalErrorStatus,
  valedictorianSafeRequestFailedMessage,
} from 'sparxie'

import { jsonResponse, parseCliError, runCli } from './valedictorian-cli.test-helpers.js'
import { requestValedictorianJson } from './valedictorian-cli.request.js'

describe('requestValedictorianJson surface-scoped public errors', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('preserves shared unauthorized bodies on the workspace surface', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(
      jsonResponse(sourceAccessErrorBodies.unauthorized, {
        status: sourceAccessErrorStatusByCode.unauthorized,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      requestValedictorianJson({
        apiBaseUrl: 'https://valedictorian.test',
        path: '/v1/workspaces',
        errorSurface: 'workspace',
      }),
    ).rejects.toMatchObject({
      name: 'ValedictorianHttpError',
      status: 401,
      kind: 'authentication',
      body: sourceAccessErrorBodies.unauthorized,
      message: sourceAccessErrorBodies.unauthorized.message,
    })
  })

  it('maps shared unauthorized with wrong status to protocol on workspace', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(
      jsonResponse(sourceAccessErrorBodies.unauthorized, { status: 500 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      requestValedictorianJson({
        apiBaseUrl: 'https://valedictorian.test',
        path: '/v1/workspaces',
        errorSurface: 'workspace',
      }),
    ).rejects.toBeInstanceOf(ValedictorianProtocolError)
  })

  it('maps unrelated profile-document bodies on workspace to protocol', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(
      jsonResponse(profileDocumentErrorBodies.profile_document_unavailable, {
        status: profileDocumentErrorStatusByCode.profile_document_unavailable,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const error = await requestValedictorianJson({
      apiBaseUrl: 'https://valedictorian.test',
      path: '/v1/workspaces',
      errorSurface: 'workspace',
    }).then(
      () => null,
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(ValedictorianProtocolError)
    expect(error).not.toBeInstanceOf(ProfileDocumentHttpError)
  })

  it('maps known profile code with wrong status on workspace to protocol', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(
      jsonResponse(profileDocumentErrorBodies.profile_document_unavailable, { status: 500 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      requestValedictorianJson({
        apiBaseUrl: 'https://valedictorian.test',
        path: '/v1/workspaces',
        errorSurface: 'workspace',
      }),
    ).rejects.toBeInstanceOf(ValedictorianProtocolError)
  })

  it('preserves shared internal_error on workspace', async () => {
    const body = createValedictorianInternalErrorBody('req_workspace_1')
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(
      jsonResponse(body, { status: valedictorianInternalErrorStatus }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const error = await requestValedictorianJson({
      apiBaseUrl: 'https://valedictorian.test',
      path: '/v1/workspaces',
      errorSurface: 'workspace',
    }).then(
      () => null,
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(ValedictorianHttpError)
    expect(error).toMatchObject({
      status: 500,
      kind: 'internal',
      body,
      message: body.message,
      requestId: body.requestId,
    })
  })

  it('maps shared internal_error with wrong status to protocol', async () => {
    const body = createValedictorianInternalErrorBody('req_workspace_bad_status')
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(jsonResponse(body, { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      requestValedictorianJson({
        apiBaseUrl: 'https://valedictorian.test',
        path: '/v1/workspaces',
        errorSurface: 'workspace',
      }),
    ).rejects.toBeInstanceOf(ValedictorianProtocolError)
  })

  it('maps malformed known off-surface profile codes to protocol without reflecting canaries', async () => {
    const canary = 'forged-noncanonical-profile-message-canary'
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          code: 'profile_document_unavailable',
          message: canary,
        },
        { status: 404 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const error = await requestValedictorianJson({
      apiBaseUrl: 'https://valedictorian.test',
      path: '/v1/workspaces',
      errorSurface: 'workspace',
    }).then(
      () => null,
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(ValedictorianProtocolError)
    expect(error).not.toBeInstanceOf(ProfileDocumentHttpError)
    expect(error).not.toBeInstanceOf(ValedictorianHttpError)
    expect(JSON.stringify(error)).not.toContain(canary)
    expect(JSON.stringify(error)).not.toContain('profile_document_unavailable')
  })

  it('fails closed for malformed bodies without reflecting canaries', async () => {
    const canary = 'hostile-workspace-body-message-canary'
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: canary, detail: 'x' }, { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)

    const error = await requestValedictorianJson({
      apiBaseUrl: 'https://valedictorian.test',
      path: '/v1/workspaces',
      errorSurface: 'workspace',
    }).then(
      () => null,
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(ValedictorianHttpError)
    expect(error).toMatchObject({
      status: 503,
      body: null,
      message: valedictorianSafeRequestFailedMessage,
    })
    expect(JSON.stringify(error)).not.toContain(canary)
  })
})

describe('workspace generic request routes reject unrelated capability bodies', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    ['list', ['workspaces', 'list', '--json'] as const],
    ['create', ['workspaces', 'create', '/tmp/ws', '--json'] as const],
    ['open', ['workspaces', 'open', '/tmp/ws', '--json'] as const],
  ])('maps unrelated profile body on workspaces %s to protocol exit 6', async (_label, argv) => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(
      jsonResponse(profileDocumentErrorBodies.profile_document_unavailable, {
        status: profileDocumentErrorStatusByCode.profile_document_unavailable,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli([...argv])

    expect(result.exitCode).toBe(6)
    expect(result.stdout).toBe('')
    expect(parseCliError(result.stderr)).toEqual({
      code: 'protocol_error',
      kind: 'integrity',
    })
    expect(result.stderr).not.toContain('profile_document_unavailable')
  })
})
