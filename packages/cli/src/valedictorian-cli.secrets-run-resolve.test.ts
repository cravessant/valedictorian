import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createSecretReference,
  defaultLocalCapabilities,
  localSecretResolutionErrorBodies,
  localSecretResolutionErrorStatusByCode,
} from 'sparxie'

import { jsonResponse, runCli } from './valedictorian-cli.test-helpers.js'
import type { SecretsRunSpawnAdapter } from './valedictorian-cli.secrets-run-spawn.js'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function capabilitiesResponse(localSecretResolution: boolean) {
  return jsonResponse({
    ...defaultLocalCapabilities,
    localSecretResolution,
  })
}

function resolveResponse(value: string) {
  return new Response(
    JSON.stringify({
      value,
      handling: { cache: 'no-store', sensitivity: 'secret' },
    }),
    {
      headers: {
        'cache-control': 'no-store',
        'content-type': 'application/json',
      },
      status: 200,
    },
  )
}

function createRecordingSpawn(): {
  adapter: SecretsRunSpawnAdapter
  calls: Array<{
    argv: readonly string[]
    env: NodeJS.ProcessEnv
    executable: string
    shell: boolean
    stdin: 'ignore' | { value: string }
    fdValues: ReadonlyMap<number, string>
  }>
} {
  const calls: Array<{
    argv: readonly string[]
    env: NodeJS.ProcessEnv
    executable: string
    shell: boolean
    stdin: 'ignore' | { value: string }
    fdValues: ReadonlyMap<number, string>
  }> = []

  const adapter: SecretsRunSpawnAdapter = async (request) => {
    calls.push({
      argv: [...request.argv],
      env: { ...request.env },
      executable: request.executable,
      shell: request.shell,
      stdin: request.stdin === 'ignore' ? 'ignore' : { value: request.stdin.value },
      fdValues: new Map(request.fdValues),
    })
    return { exitCode: 0 }
  }

  return { adapter, calls }
}

describe('secrets run capability and resolution', () => {
  it('fails before resolution when local secret resolution is unsupported', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(capabilitiesResponse(false))
    vi.stubGlobal('fetch', fetchMock)
    const { adapter, calls } = createRecordingSpawn()

    const result = await runCli(
      [
        'secrets',
        'run',
        '--workspace',
        'workspace-1',
        '--env',
        'TOKEN=secret://greenhouse_password',
        '--',
        'node',
        '-e',
        'process.exit(0)',
      ],
      {},
      { secretsRunSpawn: adapter },
    )

    expect(result.exitCode).toBe(4)
    expect(result.stderr).toMatch(/local_secret_resolution_unsupported|unsupported/i)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/v1/capabilities')
    expect(calls).toHaveLength(0)
  })

  it('resolves each unique reference once sequentially before spawn', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(capabilitiesResponse(true))
    fetchMock.mockResolvedValueOnce(resolveResponse('value-one'))
    fetchMock.mockResolvedValueOnce(resolveResponse('value-two'))
    vi.stubGlobal('fetch', fetchMock)
    const { adapter, calls } = createRecordingSpawn()

    const result = await runCli(
      [
        'secrets',
        'run',
        '--workspace',
        'workspace-1',
        '--env',
        'A=secret://one',
        '--env',
        'B=secret://two',
        '--fd',
        '3=secret://one',
        '--',
        'node',
        '-e',
        'process.exit(0)',
      ],
      {},
      { secretsRunSpawn: adapter },
    )

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/v1/capabilities')
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      '/v1/workspaces/workspace-1/secrets/local/resolve',
    )
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      reference: createSecretReference('one'),
      purpose: { kind: 'subprocess_injection' },
    })
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      reference: createSecretReference('two'),
      purpose: { kind: 'subprocess_injection' },
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.env.A).toBe('value-one')
    expect(calls[0]?.env.B).toBe('value-two')
    expect(calls[0]?.fdValues.get(3)).toBe('value-one')
    expect(calls[0]?.shell).toBe(false)
    expect(calls[0]?.executable).toBe('node')
    expect(calls[0]?.argv).toEqual(['-e', 'process.exit(0)'])
    expect(calls[0]?.stdin).toEqual('ignore')
  })

  it('preserves the original portable environment name spelling in the child env', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(capabilitiesResponse(true))
    fetchMock.mockResolvedValueOnce(resolveResponse('mixed-case-value'))
    vi.stubGlobal('fetch', fetchMock)
    const { adapter, calls } = createRecordingSpawn()

    const result = await runCli(
      [
        'secrets',
        'run',
        '--workspace',
        'workspace-1',
        '--env',
        'Api_Token=secret://greenhouse_password',
        '--',
        'tool',
      ],
      {},
      { secretsRunSpawn: adapter },
    )

    expect(result.exitCode).toBe(0)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.env.Api_Token).toBe('mixed-case-value')
    expect(calls[0]?.env.API_TOKEN).toBeUndefined()
    expect(calls[0]?.env.api_token).toBeUndefined()
  })

  it('removes inherited env keys that collide case-insensitively before injecting', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(capabilitiesResponse(true))
    fetchMock.mockResolvedValueOnce(resolveResponse('injected-secret-value'))
    vi.stubGlobal('fetch', fetchMock)
    const { adapter, calls } = createRecordingSpawn()

    const parentEnv = {
      PATH: '/usr/bin',
      TOKEN: 'parent-token-value',
      Token: 'should-not-remain-either',
    }
    const result = await runCli(
      [
        'secrets',
        'run',
        '--workspace',
        'workspace-1',
        '--env',
        'Token=secret://greenhouse_password',
        '--',
        'tool',
      ],
      parentEnv,
      { secretsRunSpawn: adapter },
    )

    expect(result.exitCode).toBe(0)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.env.Token).toBe('injected-secret-value')
    expect(calls[0]?.env.TOKEN).toBeUndefined()
    expect(Object.keys(calls[0]?.env ?? {}).filter((name) => name.toLowerCase() === 'token')).toEqual([
      'Token',
    ])
    expect(calls[0]?.env.PATH).toBe('/usr/bin')
    expect(parentEnv.TOKEN).toBe('parent-token-value')
    expect(parentEnv.Token).toBe('should-not-remain-either')
  })

  it('surfaces stable value-free typed resolution failures', async () => {
    const cases = [
      'secret_not_found',
      'local_secret_resolution_unsupported',
      'local_secret_resolution_unauthorized',
      'secure_storage_unavailable',
    ] as const

    for (const code of cases) {
      const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      fetchMock.mockResolvedValueOnce(capabilitiesResponse(true))
      fetchMock.mockResolvedValueOnce(
        jsonResponse(localSecretResolutionErrorBodies[code], {
          status: localSecretResolutionErrorStatusByCode[code],
          headers: {
            'cache-control': 'no-store',
            'content-type': 'application/json',
          },
        }),
      )
      vi.stubGlobal('fetch', fetchMock)
      const { adapter, calls } = createRecordingSpawn()

      const result = await runCli(
        [
          '--json',
          'secrets',
          'run',
          '--workspace',
          'workspace-1',
          '--env',
          'TOKEN=secret://greenhouse_password',
          '--',
          'node',
          '-e',
          'process.exit(0)',
        ],
        {},
        { secretsRunSpawn: adapter },
      )

      const kindByCode = {
        secret_not_found: 'not_found',
        local_secret_resolution_unauthorized: 'authorization',
        local_secret_resolution_unsupported: 'conflict',
        secure_storage_unavailable: 'unavailable',
      } as const
      const exitByKind = { not_found: 4, authorization: 3, conflict: 4, unavailable: 5 } as const
      expect(result.exitCode, code).toBe(exitByKind[kindByCode[code]])
      expect(JSON.parse(result.stderr), code).toEqual({
        error: {
          ...localSecretResolutionErrorBodies[code],
          kind: kindByCode[code],
          status: localSecretResolutionErrorStatusByCode[code],
        },
      })
      expect(result.stderr, code).not.toContain('greenhouse_password-value')
      expect(calls, code).toHaveLength(0)
      vi.unstubAllGlobals()
    }
  })

  it('maps non-canonical remote JSON failures to unavailable without spawning', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          message: 'remote-body-canary leaked detail',
          detail: 'do-not-echo-remote-body',
        },
        { status: 503 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { adapter, calls } = createRecordingSpawn()

    const result = await runCli(
      [
        '--json',
        'secrets',
        'run',
        '--workspace',
        'workspace-1',
        '--env',
        'TOKEN=secret://greenhouse_password',
        '--',
        'node',
        '-e',
        'process.exit(0)',
      ],
      {},
      { secretsRunSpawn: adapter },
    )

    expect(result.exitCode).toBe(5)
    expect(calls).toHaveLength(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(result.stderr)
    expect(body).toEqual({
      error: {
        code: 'unavailable',
        kind: 'unavailable',
        status: 503,
      },
    })
    expect(body.error.code).not.toBe('secrets_run_spawn_failed')
    expect(result.stderr).not.toContain('remote-body-canary')
    expect(result.stderr).not.toContain('do-not-echo-remote-body')
    expect(result.stderr).not.toContain('greenhouse_password')
    expect(JSON.stringify(body)).not.toContain('remote-body-canary')
  })

  it('maps non-canonical human remote failures to a fixed value-free message without hostile text', async () => {
    const hostile = 'remote\u0001hostile\u001b[31mLEAKED\nforgedField=spoofed'
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          message: hostile,
          detail: 'do-not-echo-remote-body',
          code: 'ENOENT',
        },
        { status: 503 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { adapter, calls } = createRecordingSpawn()

    const result = await runCli(
      [
        'secrets',
        'run',
        '--workspace',
        'workspace-1',
        '--env',
        'TOKEN=secret://greenhouse_password',
        '--',
        'node',
        '-e',
        'process.exit(0)',
      ],
      {},
      { secretsRunSpawn: adapter },
    )

    expect(result.exitCode).toBe(5)
    expect(calls).toHaveLength(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.stderr).toContain('temporarily unavailable')
    expect(result.stderr).toMatch(/recovery:/i)
    expect(result.stderr).not.toMatch(/secrets_run_spawn_failed/i)
    expect(result.stderr).not.toContain(hostile)
    expect(result.stderr).not.toContain('LEAKED')
    expect(result.stderr).not.toContain('forgedField')
    expect(result.stderr).not.toContain('do-not-echo-remote-body')
    expect(result.stderr).not.toContain('\u0001')
    expect(result.stderr).not.toContain('\u001b')
  })

  it('preserves remote transport failures as transport_error exit 5 without secret leakage', async () => {
    const canary = 'transport-secrets-run-canary-ECONNREFUSED'
    const secretValue = 'super-secret-password-value'
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockRejectedValueOnce(new Error(`${canary}:${secretValue}`))
    vi.stubGlobal('fetch', fetchMock)
    const { adapter, calls } = createRecordingSpawn()

    const result = await runCli(
      [
        '--json',
        'secrets',
        'run',
        '--workspace',
        'workspace-1',
        '--env',
        'TOKEN=secret://greenhouse_password',
        '--',
        'node',
        '-e',
        'process.exit(0)',
      ],
      {},
      { secretsRunSpawn: adapter },
    )

    expect(result.exitCode).toBe(5)
    expect(calls).toHaveLength(0)
    expect(JSON.parse(result.stderr)).toEqual({
      error: {
        code: 'transport_error',
        kind: 'unavailable',
      },
    })
    expect(result.stderr).not.toContain(canary)
    expect(result.stderr).not.toContain(secretValue)
    expect(result.stderr).not.toContain('secrets_run_remote_failed')
  })

  it('preserves remote protocol mismatches as protocol_error exit 6 without secret leakage', async () => {
    const canary = 'protocol-secrets-run-message-canary'
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(capabilitiesResponse(true))
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          ...localSecretResolutionErrorBodies.secret_not_found,
          message: canary,
        },
        { status: localSecretResolutionErrorStatusByCode.secret_not_found },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { adapter, calls } = createRecordingSpawn()

    const result = await runCli(
      [
        '--json',
        'secrets',
        'run',
        '--workspace',
        'workspace-1',
        '--env',
        'TOKEN=secret://greenhouse_password',
        '--',
        'node',
        '-e',
        'process.exit(0)',
      ],
      {},
      { secretsRunSpawn: adapter },
    )

    expect(result.exitCode).toBe(6)
    expect(calls).toHaveLength(0)
    expect(JSON.parse(result.stderr)).toEqual({
      error: {
        code: 'protocol_error',
        kind: 'integrity',
      },
    })
    expect(result.stderr).not.toContain(canary)
    expect(result.stderr).not.toContain('secret_not_found')
    expect(result.stderr).not.toContain('secrets_run_remote_failed')
  })

  it('preserves remote authentication failures as authentication exit 3', async () => {
    const { sourceAccessErrorBodies, sourceAccessErrorStatusByCode } = await import('sparxie')
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(capabilitiesResponse(true))
    fetchMock.mockResolvedValueOnce(
      jsonResponse(sourceAccessErrorBodies.unauthorized, {
        status: sourceAccessErrorStatusByCode.unauthorized,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { adapter, calls } = createRecordingSpawn()

    const result = await runCli(
      [
        '--json',
        'secrets',
        'run',
        '--workspace',
        'workspace-1',
        '--env',
        'TOKEN=secret://greenhouse_password',
        '--',
        'node',
        '-e',
        'process.exit(0)',
      ],
      {},
      { secretsRunSpawn: adapter },
    )

    expect(result.exitCode).toBe(3)
    expect(calls).toHaveLength(0)
    const body = JSON.parse(result.stderr)
    expect(body.error.kind).toBe('authentication')
    expect(body.error.code).toBe('authentication_error')
    expect(result.stderr).not.toContain('secrets_run_remote_failed')
  })

  it('fails closed when a direct LocalSecretResolutionHttpError body or status is non-canonical', async () => {
    const canary = 'forged-remote-resolution-canary'
    const { LocalSecretResolutionHttpError, localSecretResolutionErrorBodies } = await import(
      'sparxie'
    )
    const { ValedictorianHttpError } = await import('sparxie')

    const cases = [
      {
        label: 'wrong-message',
        error: new LocalSecretResolutionHttpError(
          { ...localSecretResolutionErrorBodies.secret_not_found, message: canary },
          404,
        ),
      },
      {
        label: 'wrong-status',
        error: new LocalSecretResolutionHttpError(
          localSecretResolutionErrorBodies.secret_not_found,
          500,
        ),
      },
    ] as const

    for (const testCase of cases) {
      const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      fetchMock.mockImplementation(async () => {
        throw testCase.error
      })
      vi.stubGlobal('fetch', fetchMock)
      const { adapter, calls } = createRecordingSpawn()

      const result = await runCli(
        [
          '--json',
          'secrets',
          'run',
          '--workspace',
          'workspace-1',
          '--env',
          'TOKEN=secret://greenhouse_password',
          '--',
          'node',
          '-e',
          'process.exit(0)',
        ],
        {},
        { secretsRunSpawn: adapter },
      )

      expect(result.exitCode, testCase.label).toBe(5)
      expect(calls, testCase.label).toHaveLength(0)
      const body = JSON.parse(result.stderr)
      expect(body, testCase.label).toEqual({
        error: {
          code: 'transport_error',
          kind: 'unavailable',
        },
      })
      expect(result.stderr, testCase.label).not.toContain(canary)
      expect(result.stderr, testCase.label).not.toContain('secret_not_found')
      expect(testCase.error).toBeInstanceOf(LocalSecretResolutionHttpError)
      expect(testCase.error).toBeInstanceOf(ValedictorianHttpError)
      vi.unstubAllGlobals()
    }
  })
})
