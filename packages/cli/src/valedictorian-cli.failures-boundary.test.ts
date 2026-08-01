import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  profileDocumentErrorBodies,
  profileDocumentErrorStatusByCode,
} from '@sparxie/sdk'

import { jsonResponse, runCli } from './valedictorian-cli.test-helpers.js'

describe('typed CLI failure boundary', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('emits structured JSON and exit 4 for profile not-found failures', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(
      jsonResponse(profileDocumentErrorBodies.profile_document_unavailable, {
        status: profileDocumentErrorStatusByCode.profile_document_unavailable,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli(['profile', 'get', '--workspace', 'workspace-1', '--json'])

    expect(result.exitCode).toBe(4)
    expect(result.stdout).toBe('')
    expect(JSON.parse(result.stderr)).toEqual({
      error: {
        code: 'profile_document_unavailable',
        kind: 'not_found',
        status: 404,
        message: profileDocumentErrorBodies.profile_document_unavailable.message,
      },
    })
  })

  it('maps unreachable transport failures to exit 5 without leaking canaries', async () => {
    const canary = 'transport-canary-ECONNREFUSED-leak'
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockRejectedValueOnce(new Error(canary))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli([
      'applications',
      'list',
      '--workspace',
      'workspace-1',
      '--json',
    ])

    expect(result.exitCode).toBe(5)
    const payload = JSON.parse(result.stderr)
    expect(payload).toEqual({
      error: {
        code: 'transport_error',
        kind: 'unavailable',
      },
    })
    expect(result.stderr).not.toContain(canary)
    expect(result.stderr).not.toContain('ECONNREFUSED')
  })

  it('maps recognized code with wrong status to protocol exit 6', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          ...profileDocumentErrorBodies.invalid_profile_document,
          path: ['profile', 'email'],
          line: 3,
          column: 8,
        },
        { status: 500 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli([
      'profile',
      'get',
      '--workspace',
      'workspace-1',
      '--json',
    ])

    expect(result.exitCode).toBe(6)
    expect(JSON.parse(result.stderr)).toEqual({
      error: {
        code: 'protocol_error',
        kind: 'integrity',
      },
    })
    expect(result.stderr).not.toContain('"path"')
    expect(result.stderr).not.toContain('email')
  })

  it('maps malformed error bodies to protocol or fail-closed internal without body leakage', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          code: 'invalid_profile_document',
          message: 'hostile non-canonical message canary',
          path: ['profile', 'email'],
          line: 9,
          column: 1,
        },
        { status: profileDocumentErrorStatusByCode.invalid_profile_document },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli([
      'profile',
      'get',
      '--workspace',
      'workspace-1',
      '--json',
    ])

    expect([1, 6]).toContain(result.exitCode)
    const payload = JSON.parse(result.stderr)
    expect(payload.error).toBeTruthy()
    expect(result.stderr).not.toContain('hostile non-canonical')
    expect(result.stderr).not.toContain('"path"')
  })

  it('maps auth failures to exit 3 with stable human guidance', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'provider diagnostic leak' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli(['applications', 'list', '--workspace', 'workspace-1'])

    expect(result.exitCode).toBe(3)
    expect(result.stderr).toMatch(/authentication|authorization|auth/i)
    expect(result.stderr).toMatch(/recovery:/i)
    expect(result.stderr).not.toContain('provider diagnostic leak')
  })

  it('maps stricli argument failures to usage exit 2', async () => {
    const result = await runCli(['applications', 'list', '--not-a-real-flag'])
    expect(result.exitCode).toBe(2)
    expect(result.stderr.length).toBeGreaterThan(0)
  })

  it('rejects partial numeric limit values as usage exit 2', async () => {
    const result = await runCli([
      'applications',
      'list',
      '--workspace',
      'workspace-1',
      '--limit',
      '25abc',
      '--json',
    ])

    expect(result.exitCode).toBe(2)
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: {
        code: 'usage_error',
        kind: 'validation',
      },
    })
  })

  it('rejects malformed JSON option values as usage exit 2', async () => {
    const result = await runCli([
      'runs',
      'start',
      '--workspace',
      'workspace-1',
      '--run-type',
      'sourcing',
      '--actor-type',
      'agent',
      '--metadata-json',
      '{not-json',
      '--json',
    ])

    expect(result.exitCode).toBe(2)
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: {
        code: 'usage_error',
        kind: 'validation',
      },
    })
    expect(result.stderr).not.toContain('{not-json')
  })
})
