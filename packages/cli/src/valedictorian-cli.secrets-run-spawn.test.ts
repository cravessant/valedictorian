import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultLocalCapabilities } from '@sparxie/sdk'

import { normalizeArgv } from './valedictorian-cli.command-runtime.js'
import { runCli } from './valedictorian-cli.test-helpers.js'
import type {
  SecretsRunSpawnAdapter,
  SecretsRunSpawnRequest,
} from './valedictorian-cli.secrets-run-spawn.js'
import { waitForSpawnedChild } from './valedictorian-cli.secrets-run-spawn.js'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function capabilitiesResponse() {
  return new Response(
    JSON.stringify({
      ...defaultLocalCapabilities,
      localSecretResolution: true,
    }),
    { headers: { 'content-type': 'application/json' }, status: 200 },
  )
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

describe('normalizeArgv leading globals vs child argv after --', () => {
  it('forwards leading --workspace even when the child argv also contains --workspace', () => {
    expect(
      normalizeArgv([
        '--workspace',
        'workspace-1',
        'secrets',
        'run',
        '--env',
        'TOKEN=secret://greenhouse_password',
        '--',
        'child',
        '--workspace',
        'child-value',
      ]),
    ).toEqual([
      'secrets',
      'run',
      '--env',
      'TOKEN=secret://greenhouse_password',
      '--workspace',
      'workspace-1',
      '--',
      'child',
      '--workspace',
      'child-value',
    ])
  })

  it('forwards leading --json even when the child argv also contains --json', () => {
    expect(
      normalizeArgv([
        '--json',
        'secrets',
        'run',
        '--workspace',
        'workspace-1',
        '--env',
        'TOKEN=secret://greenhouse_password',
        '--',
        'child',
        '--json',
      ]),
    ).toEqual([
      'secrets',
      'run',
      '--workspace',
      'workspace-1',
      '--env',
      'TOKEN=secret://greenhouse_password',
      '--json',
      '--',
      'child',
      '--json',
    ])
  })
})

describe('secrets run spawn plan', () => {
  it('uses leading --workspace for resolution when child argv also has --workspace', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(capabilitiesResponse())
    fetchMock.mockResolvedValueOnce(resolveResponse('workspace-bound-value'))
    vi.stubGlobal('fetch', fetchMock)

    let captured: SecretsRunSpawnRequest | undefined
    const adapter: SecretsRunSpawnAdapter = async (request) => {
      captured = { ...request, env: { ...request.env }, fdValues: new Map(request.fdValues) }
      return { exitCode: 0 }
    }

    const result = await runCli(
      [
        '--workspace',
        'workspace-1',
        'secrets',
        'run',
        '--env',
        'TOKEN=secret://greenhouse_password',
        '--',
        'child',
        '--workspace',
        'child-value',
      ],
      {},
      { secretsRunSpawn: adapter },
    )

    expect(result.exitCode).toBe(0)
    expect(captured?.argv).toEqual(['--workspace', 'child-value'])
    expect(captured?.env.TOKEN).toBe('workspace-bound-value')
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      '/v1/workspaces/workspace-1/secrets/local/resolve',
    )
    expect(String(fetchMock.mock.calls[1]?.[0])).not.toContain('child-value')
  })

  it('keeps leading global flags before -- and never puts secrets in argv', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(capabilitiesResponse())
    fetchMock.mockResolvedValueOnce(resolveResponse('canary-secret-value'))
    vi.stubGlobal('fetch', fetchMock)

    let captured: SecretsRunSpawnRequest | undefined
    const adapter: SecretsRunSpawnAdapter = async (request) => {
      captured = {
        ...request,
        argv: [...request.argv],
        env: { ...request.env },
        fdValues: new Map(request.fdValues),
      }
      return { exitCode: 0 }
    }

    const result = await runCli(
      [
        '--json',
        '--workspace',
        'workspace-1',
        'secrets',
        'run',
        '--env',
        'TOKEN=secret://greenhouse_password',
        '--',
        'printer',
        '--json',
        'literal-text',
      ],
      {},
      { secretsRunSpawn: adapter },
    )

    expect(result.exitCode).toBe(0)
    expect(captured?.shell).toBe(false)
    expect(captured?.executable).toBe('printer')
    expect(captured?.argv).toEqual(['--json', 'literal-text'])
    expect(captured?.argv.join(' ')).not.toContain('canary-secret-value')
    expect(captured?.argv.join(' ')).not.toContain('secret://')
    expect(captured?.env.TOKEN).toBe('canary-secret-value')
  })

  it('injects stdin and dedicated fds while defaulting stdin to ignore', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(capabilitiesResponse())
    fetchMock.mockResolvedValueOnce(resolveResponse('stdin-canary'))
    fetchMock.mockResolvedValueOnce(resolveResponse('fd-canary'))
    vi.stubGlobal('fetch', fetchMock)

    let captured: SecretsRunSpawnRequest | undefined
    const adapter: SecretsRunSpawnAdapter = async (request) => {
      captured = {
        ...request,
        stdin: request.stdin === 'ignore' ? 'ignore' : { ...request.stdin },
        fdValues: new Map(request.fdValues),
      }
      return { exitCode: 0 }
    }

    const result = await runCli(
      [
        'secrets',
        'run',
        '--workspace',
        'workspace-1',
        '--stdin-secret',
        'secret://stdin_key',
        '--fd',
        '4=secret://fd_key',
        '--',
        'tool',
      ],
      {},
      { secretsRunSpawn: adapter },
    )

    expect(result.exitCode).toBe(0)
    expect(captured?.stdin).toEqual({ value: 'stdin-canary' })
    expect(captured?.fdValues.get(4)).toBe('fd-canary')

    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(capabilitiesResponse())
    fetchMock.mockResolvedValueOnce(resolveResponse('env-only'))
    const envOnly: SecretsRunSpawnAdapter = async (request) => {
      expect(request.stdin).toBe('ignore')
      return { exitCode: 0 }
    }
    const envResult = await runCli(
      [
        'secrets',
        'run',
        '--workspace',
        'workspace-1',
        '--env',
        'TOKEN=secret://env_key',
        '--',
        'tool',
      ],
      {},
      { secretsRunSpawn: envOnly },
    )
    expect(envResult.exitCode).toBe(0)
  })

  it('propagates child exit codes through the injectable spawn port', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    vi.stubGlobal('fetch', fetchMock)

    for (const [exitCode, label] of [
      [0, 'zero'],
      [7, 'nonzero'],
      [130, 'sigint'],
    ] as const) {
      fetchMock.mockReset()
      fetchMock.mockResolvedValueOnce(capabilitiesResponse())
      fetchMock.mockResolvedValueOnce(resolveResponse('v'))
      const adapter: SecretsRunSpawnAdapter = async () => ({ exitCode })
      const result = await runCli(
        [
          'secrets',
          'run',
          '--workspace',
          'workspace-1',
          '--env',
          'TOKEN=secret://k',
          '--',
          'tool',
        ],
        {},
        { secretsRunSpawn: adapter },
      )
      expect(result.exitCode, label).toBe(exitCode)
      expect(result.stdout, label).toBe('')
    }
  })

  it('reports stable value-free spawn failures', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(capabilitiesResponse())
    fetchMock.mockResolvedValueOnce(resolveResponse('spawn-failure-canary'))
    vi.stubGlobal('fetch', fetchMock)

    const adapter: SecretsRunSpawnAdapter = async () => {
      const error = new Error('ENOENT spawn-failure-canary missing executable')
      ;(error as NodeJS.ErrnoException).code = 'ENOENT'
      throw error
    }

    const result = await runCli(
      [
        'secrets',
        'run',
        '--workspace',
        'workspace-1',
        '--env',
        'TOKEN=secret://k',
        '--',
        'missing-tool',
      ],
      {},
      { secretsRunSpawn: adapter },
    )

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('secrets run spawn failed')
    expect(result.stderr).not.toContain('spawn-failure-canary')
    expect(result.stderr).not.toContain('ENOENT')
    expect(result.stderr).not.toContain('missing executable')
  })

  it('keeps NUL env canaries out of human and JSON spawn diagnostics', async () => {
    const canary = 'nul-env-canary-Aa1Bb2\u0000Cc3Dd4'
    const transformedFragments = [
      canary,
      'nul-env-canary-Aa1Bb2',
      'Cc3Dd4',
      'nul-env-canary-Aa1Bb2\\x00Cc3Dd4',
      '\\x00',
      '\\u0000',
      '\u0000',
    ]

    for (const asJson of [false, true]) {
      const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      fetchMock.mockResolvedValueOnce(capabilitiesResponse())
      fetchMock.mockResolvedValueOnce(resolveResponse(canary))
      vi.stubGlobal('fetch', fetchMock)

      let adapterCalls = 0
      const adapter: SecretsRunSpawnAdapter = async () => {
        adapterCalls += 1
        const error = new Error(
          `The property 'options.env['TOKEN']' must be a string without null bytes. Received 'nul-env-canary-Aa1Bb2\\x00Cc3Dd4'`,
        )
        ;(error as NodeJS.ErrnoException).code = 'ERR_INVALID_ARG_VALUE'
        throw error
      }

      const argv = [
        ...(asJson ? ['--json'] : []),
        'secrets',
        'run',
        '--workspace',
        'workspace-1',
        '--env',
        'TOKEN=secret://k',
        '--',
        'tool',
      ]
      const result = await runCli(argv, {}, { secretsRunSpawn: adapter })

      expect(result.exitCode, `json=${asJson}`).toBe(1)
      expect(result.stderr, `json=${asJson}`).toMatch(
        /secrets_run_spawn_failed|secrets run spawn failed/i,
      )
      for (const fragment of transformedFragments) {
        expect(result.stderr, `json=${asJson} fragment=${JSON.stringify(fragment)}`).not.toContain(
          fragment,
        )
      }
      if (asJson) {
        const body = JSON.parse(result.stderr)
        expect(body.error.code).toBe('secrets_run_spawn_failed')
        expect(body.error.message).toMatch(/secrets run spawn failed/i)
        expect(JSON.stringify(body)).not.toContain('\\x00')
        expect(JSON.stringify(body)).not.toContain('nul-env-canary')
      }
      expect(adapterCalls, `json=${asJson}`).toBe(0)
      vi.unstubAllGlobals()
    }
  })

  it('scrubs wrapper-owned secret fields after successful spawn', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(capabilitiesResponse())
    fetchMock.mockResolvedValueOnce(resolveResponse('stdin-scrub-canary'))
    fetchMock.mockResolvedValueOnce(resolveResponse('env-scrub-canary'))
    fetchMock.mockResolvedValueOnce(resolveResponse('fd-scrub-canary'))
    vi.stubGlobal('fetch', fetchMock)

    let retained: SecretsRunSpawnRequest | undefined
    const adapter: SecretsRunSpawnAdapter = async (request) => {
      retained = request
      expect(request.env.TOKEN).toBe('env-scrub-canary')
      expect(request.stdin).toEqual({ value: 'stdin-scrub-canary' })
      expect(request.fdValues.get(3)).toBe('fd-scrub-canary')
      return { exitCode: 0 }
    }

    const parentEnv = { PATH: '/usr/bin', TOKEN: 'parent-token' }
    const result = await runCli(
      [
        'secrets',
        'run',
        '--workspace',
        'workspace-1',
        '--env',
        'TOKEN=secret://env_key',
        '--stdin-secret',
        'secret://stdin_key',
        '--fd',
        '3=secret://fd_key',
        '--',
        'tool',
      ],
      parentEnv,
      { secretsRunSpawn: adapter },
    )

    expect(result.exitCode).toBe(0)
    expect(retained).toBeDefined()
    expect(retained?.env.TOKEN).toBeUndefined()
    expect(retained?.env.PATH).toBe('/usr/bin')
    expect(retained?.stdin).toEqual({ value: '' })
    expect(retained?.fdValues.size).toBe(0)
    expect(parentEnv.TOKEN).toBe('parent-token')
  })

  it('scrubs wrapper-owned secret fields after spawn failure', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(capabilitiesResponse())
    fetchMock.mockResolvedValueOnce(resolveResponse('fail-scrub-canary'))
    vi.stubGlobal('fetch', fetchMock)

    let retained: SecretsRunSpawnRequest | undefined
    const adapter: SecretsRunSpawnAdapter = async (request) => {
      retained = request
      throw new Error('spawn boom fail-scrub-canary')
    }

    const result = await runCli(
      [
        'secrets',
        'run',
        '--workspace',
        'workspace-1',
        '--env',
        'TOKEN=secret://k',
        '--',
        'tool',
      ],
      {},
      { secretsRunSpawn: adapter },
    )

    expect(result.exitCode).toBe(1)
    expect(retained?.env.TOKEN).toBeUndefined()
    expect(result.stderr).not.toContain('fail-scrub-canary')
  })

  it('emits stable value-free JSON for redacted spawn failures', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(capabilitiesResponse())
    fetchMock.mockResolvedValueOnce(resolveResponse('json-spawn-canary'))
    vi.stubGlobal('fetch', fetchMock)

    const adapter: SecretsRunSpawnAdapter = async () => {
      const error = new Error('ENOENT json-spawn-canary missing executable')
      ;(error as NodeJS.ErrnoException).code = 'ENOENT'
      throw error
    }

    const result = await runCli(
      [
        '--json',
        'secrets',
        'run',
        '--workspace',
        'workspace-1',
        '--env',
        'TOKEN=secret://k',
        '--',
        'missing-tool',
      ],
      {},
      { secretsRunSpawn: adapter },
    )

    expect(result.exitCode).toBe(1)
    const body = JSON.parse(result.stderr)
    expect(body).toEqual({
      error: {
        code: 'secrets_run_spawn_failed',
        kind: 'internal',
        message: 'secrets run spawn failed',
      },
    })
    expect(result.stderr).not.toContain('json-spawn-canary')
    expect(result.stderr).not.toContain('ENOENT')
    expect(result.stderr).not.toContain('missing executable')
    expect(JSON.stringify(body)).not.toContain('json-spawn-canary')
  })

  it('uses fixed value-free diagnostics for hostile human spawn error shapes', async () => {
    const canary = 'hostile-human-spawn-canary'
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(capabilitiesResponse())
    fetchMock.mockResolvedValueOnce(resolveResponse(canary))
    vi.stubGlobal('fetch', fetchMock)

    const adapter: SecretsRunSpawnAdapter = async () => {
      throw new Error(`hostile_code: ${canary}`)
    }

    const result = await runCli(
      [
        'secrets',
        'run',
        '--workspace',
        'workspace-1',
        '--env',
        'TOKEN=secret://k',
        '--',
        'tool',
      ],
      {},
      { secretsRunSpawn: adapter },
    )

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toMatch(/secrets run spawn failed/i)
    expect(result.stderr).not.toContain(canary)
    expect(result.stderr).not.toContain('hostile_code')
    expect(result.stderr).not.toContain('[redacted]')
  })

  it('uses fixed value-free diagnostics for hostile JSON-shaped spawn errors', async () => {
    const canary = 'hostile-json-spawn-canary'
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(capabilitiesResponse())
    fetchMock.mockResolvedValueOnce(resolveResponse(canary))
    vi.stubGlobal('fetch', fetchMock)

    const adapter: SecretsRunSpawnAdapter = async () => {
      throw new Error(JSON.stringify({ code: 'hostile_code', message: canary }))
    }

    const result = await runCli(
      [
        '--json',
        'secrets',
        'run',
        '--workspace',
        'workspace-1',
        '--env',
        'TOKEN=secret://k',
        '--',
        'tool',
      ],
      {},
      { secretsRunSpawn: adapter },
    )

    expect(result.exitCode).toBe(1)
    const body = JSON.parse(result.stderr)
    expect(body).toEqual({
      error: {
        code: 'secrets_run_spawn_failed',
        kind: 'internal',
        message: expect.stringMatching(/secrets run spawn failed/i),
      },
    })
    expect(body.error.code).not.toBe('hostile_code')
    expect(result.stderr).not.toContain(canary)
    expect(result.stderr).not.toContain('hostile_code')
    expect(JSON.stringify(body)).not.toContain(canary)
  })

  it('does not trust a forged LocalSecretResolutionHttpError thrown by the spawn adapter', async () => {
    const canary = 'forged-resolution-spawn-canary'
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(capabilitiesResponse())
    fetchMock.mockResolvedValueOnce(resolveResponse(canary))
    vi.stubGlobal('fetch', fetchMock)

    const { LocalSecretResolutionHttpError, localSecretResolutionErrorBodies } = await import(
      '@sparxie/sdk'
    )

    for (const asJson of [false, true]) {
      fetchMock.mockReset()
      fetchMock.mockResolvedValueOnce(capabilitiesResponse())
      fetchMock.mockResolvedValueOnce(resolveResponse(canary))

      const adapter: SecretsRunSpawnAdapter = async () => {
        throw new LocalSecretResolutionHttpError(
          {
            ...localSecretResolutionErrorBodies.secret_not_found,
            message: canary,
          },
          404,
        )
      }

      const result = await runCli(
        [
          ...(asJson ? ['--json'] : []),
          'secrets',
          'run',
          '--workspace',
          'workspace-1',
          '--env',
          'TOKEN=secret://k',
          '--',
          'tool',
        ],
        {},
        { secretsRunSpawn: adapter },
      )

      expect(result.exitCode, `json=${asJson}`).toBe(1)
      expect(result.stderr, `json=${asJson}`).not.toContain(canary)
      expect(result.stderr, `json=${asJson}`).not.toMatch(/secret_not_found/)
      if (asJson) {
        const body = JSON.parse(result.stderr)
        expect(body).toEqual({
          error: {
            code: 'secrets_run_spawn_failed',
            kind: 'internal',
            message: expect.stringMatching(/secrets run spawn failed/i),
          },
        })
        expect(JSON.stringify(body)).not.toContain(canary)
      } else {
        expect(result.stderr).toMatch(/secrets run spawn failed/i)
      }
    }
  })
  it('does not trust an attacker-controlled uppercase spawn error code', async () => {
    const canary = 'UPPERCASESECRET'
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()

    for (const asJson of [false, true]) {
      fetchMock.mockReset()
      fetchMock.mockResolvedValueOnce(capabilitiesResponse())
      fetchMock.mockResolvedValueOnce(resolveResponse(canary))
      vi.stubGlobal('fetch', fetchMock)

      const adapter: SecretsRunSpawnAdapter = async () => {
        const error = new Error(`spawn failed with ${canary}`)
        ;(error as NodeJS.ErrnoException).code = canary
        throw error
      }

      const result = await runCli(
        [
          ...(asJson ? ['--json'] : []),
          'secrets',
          'run',
          '--workspace',
          'workspace-1',
          '--env',
          'TOKEN=secret://k',
          '--',
          'tool',
        ],
        {},
        { secretsRunSpawn: adapter },
      )

      expect(result.exitCode, `json=${asJson}`).toBe(1)
      expect(result.stderr, `json=${asJson}`).not.toContain(canary)
      expect(result.stderr, `json=${asJson}`).toMatch(
        /secrets_run_spawn_failed|secrets run spawn failed/i,
      )
      if (asJson) {
        const body = JSON.parse(result.stderr)
        expect(body).toEqual({
          error: {
            code: 'secrets_run_spawn_failed',
            kind: 'internal',
            message: 'secrets run spawn failed',
          },
        })
        expect(JSON.stringify(body)).not.toContain(canary)
      } else {
        expect(result.stderr).toContain('secrets run spawn failed')
      }
    }
  })

  it('never echoes a resolved value that equals a spawn errno symbol', async () => {
    const canary = 'ENOENT'
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()

    for (const asJson of [false, true]) {
      fetchMock.mockReset()
      fetchMock.mockResolvedValueOnce(capabilitiesResponse())
      fetchMock.mockResolvedValueOnce(resolveResponse(canary))
      vi.stubGlobal('fetch', fetchMock)

      const adapter: SecretsRunSpawnAdapter = async () => {
        const error = new Error('missing executable')
        ;(error as NodeJS.ErrnoException).code = 'ENOENT'
        throw error
      }

      const result = await runCli(
        [
          ...(asJson ? ['--json'] : []),
          'secrets',
          'run',
          '--workspace',
          'workspace-1',
          '--env',
          'TOKEN=secret://k',
          '--',
          'missing-tool',
        ],
        {},
        { secretsRunSpawn: adapter },
      )

      expect(result.exitCode, `json=${asJson}`).toBe(1)
      expect(result.stderr, `json=${asJson}`).not.toContain(canary)
      expect(result.stderr, `json=${asJson}`).not.toContain('missing executable')
      if (asJson) {
        const body = JSON.parse(result.stderr)
        expect(body).toEqual({ error: { code: 'secrets_run_spawn_failed', kind: 'internal', message: 'secrets run spawn failed' } })
        expect(JSON.stringify(body)).not.toContain(canary)
      } else {
        expect(result.stderr).toContain('secrets run spawn failed')
      }
    }
  })

  it('uses a fixed value-free spawn diagnostic even when the adapter supplies ENOENT', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(capabilitiesResponse())
    fetchMock.mockResolvedValueOnce(resolveResponse('errno-detail-canary'))
    vi.stubGlobal('fetch', fetchMock)

    const adapter: SecretsRunSpawnAdapter = async () => {
      const error = new Error('ENOENT errno-detail-canary missing executable')
      ;(error as NodeJS.ErrnoException).code = 'ENOENT'
      throw error
    }

    const result = await runCli(
      [
        '--json',
        'secrets',
        'run',
        '--workspace',
        'workspace-1',
        '--env',
        'TOKEN=secret://k',
        '--',
        'missing-tool',
      ],
      {},
      { secretsRunSpawn: adapter },
    )

    expect(result.exitCode).toBe(1)
    const body = JSON.parse(result.stderr)
    expect(body).toEqual({
      error: {
        code: 'secrets_run_spawn_failed',
        kind: 'internal',
        message: 'secrets run spawn failed',
      },
    })
    expect(result.stderr).not.toContain('ENOENT')
    expect(result.stderr).not.toContain('errno-detail-canary')
  })
})

describe('secrets run spawn lifecycle helpers', () => {
  it('forwards signals, writes injections, and removes listeners on exit', async () => {
    const beforeSigint = process.listenerCount('SIGINT')
    const beforeSigterm = process.listenerCount('SIGTERM')
    const child = new EventEmitter() as EventEmitter & {
      killed: boolean
      kill: ReturnType<typeof vi.fn>
      stdin: EventEmitter & {
        end: ReturnType<typeof vi.fn>
        destroy: ReturnType<typeof vi.fn>
        destroyed: boolean
      }
      stdio: Array<
        | string
        | (EventEmitter & {
            end?: ReturnType<typeof vi.fn>
            destroy: ReturnType<typeof vi.fn>
            destroyed: boolean
          })
      >
    }
    child.killed = false
    child.kill = vi.fn(() => true)
    const stdin = Object.assign(new EventEmitter(), {
      end: vi.fn(),
      destroy: vi.fn(),
      destroyed: false,
    })
    const fd3 = Object.assign(new EventEmitter(), {
      end: vi.fn(),
      destroy: vi.fn(),
      destroyed: false,
    })
    child.stdin = stdin
    child.stdio = [stdin, 'inherit', 'inherit', fd3]

    const resultPromise = waitForSpawnedChild(child, {
      executable: 'tool',
      argv: [],
      env: {},
      shell: false,
      stdin: { value: 'stdin-payload' },
      fdValues: new Map([[3, 'fd-payload']]),
    })

    expect(process.listenerCount('SIGINT')).toBe(beforeSigint + 1)
    expect(child.listenerCount('error')).toBe(1)
    expect(child.listenerCount('exit')).toBe(1)
    const added = process
      .listeners('SIGINT')
      .find((listener) => !process.listeners('SIGINT').slice(0, beforeSigint).includes(listener))
    expect(added).toBeTypeOf('function')
    ;(added as (signal: NodeJS.Signals) => void)('SIGINT')
    expect(child.kill).toHaveBeenCalledWith('SIGINT')

    queueMicrotask(() => child.emit('exit', null, 'SIGTERM'))
    const result = await resultPromise

    expect(result.exitCode).toBe(128 + 15)
    expect(stdin.end).toHaveBeenCalledWith('stdin-payload')
    expect(fd3.end).toHaveBeenCalledWith('fd-payload')
    expect(process.listenerCount('SIGINT')).toBe(beforeSigint)
    expect(process.listenerCount('SIGTERM')).toBe(beforeSigterm)
    expect(child.listenerCount('error')).toBe(0)
    expect(child.listenerCount('exit')).toBe(0)
  })

  it('removes listeners when spawn errors', async () => {
    const before = process.listenerCount('SIGINT')
    const child = new EventEmitter() as EventEmitter & {
      killed: boolean
      kill: ReturnType<typeof vi.fn>
      stdin: null
      stdio: string[]
    }
    child.killed = false
    child.kill = vi.fn()
    child.stdin = null
    child.stdio = ['ignore', 'inherit', 'inherit']

    const resultPromise = waitForSpawnedChild(child, {
      executable: 'tool',
      argv: [],
      env: {},
      shell: false,
      stdin: 'ignore',
      fdValues: new Map(),
    })

    expect(child.listenerCount('error')).toBe(1)
    expect(child.listenerCount('exit')).toBe(1)
    queueMicrotask(() => child.emit('error', new Error('spawn EACCES')))
    await expect(resultPromise).rejects.toThrow(/EACCES/)
    expect(process.listenerCount('SIGINT')).toBe(before)
    expect(child.listenerCount('error')).toBe(0)
    expect(child.listenerCount('exit')).toBe(0)
  })

  it('forwards a second signal while the child is still alive after ignoring the first', async () => {
    const beforeSigint = process.listenerCount('SIGINT')
    const beforeSigterm = process.listenerCount('SIGTERM')
    const child = new EventEmitter() as EventEmitter & {
      killed: boolean
      kill: ReturnType<typeof vi.fn>
      stdin: null
      stdio: string[]
    }
    child.killed = false
    child.kill = vi.fn((_signal?: NodeJS.Signals) => {
      // Simulate a successful signal delivery without process exit.
      child.killed = true
      return true
    })
    child.stdin = null
    child.stdio = ['ignore', 'inherit', 'inherit']

    const resultPromise = waitForSpawnedChild(child, {
      executable: 'tool',
      argv: [],
      env: {},
      shell: false,
      stdin: 'ignore',
      fdValues: new Map(),
    })

    const sigintListener = process
      .listeners('SIGINT')
      .find((listener) => !process.listeners('SIGINT').slice(0, beforeSigint).includes(listener))
    const sigtermListener = process
      .listeners('SIGTERM')
      .find((listener) => !process.listeners('SIGTERM').slice(0, beforeSigterm).includes(listener))
    expect(sigintListener).toBeTypeOf('function')
    expect(sigtermListener).toBeTypeOf('function')

    ;(sigintListener as (signal: NodeJS.Signals) => void)('SIGINT')
    expect(child.kill).toHaveBeenCalledWith('SIGINT')
    expect(child.killed).toBe(true)

    ;(sigtermListener as (signal: NodeJS.Signals) => void)('SIGTERM')
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(child.kill).toHaveBeenCalledTimes(2)

    queueMicrotask(() => child.emit('exit', null, 'SIGTERM'))
    const result = await resultPromise
    expect(result.exitCode).toBe(128 + 15)
    expect(process.listenerCount('SIGINT')).toBe(beforeSigint)
    expect(process.listenerCount('SIGTERM')).toBe(beforeSigterm)
  })

  it('still terminates on abort after a prior forwarded signal left the child alive', async () => {
    const child = new EventEmitter() as EventEmitter & {
      killed: boolean
      kill: ReturnType<typeof vi.fn>
      stdin: null
      stdio: string[]
    }
    child.killed = false
    child.kill = vi.fn(() => {
      child.killed = true
      return true
    })
    child.stdin = null
    child.stdio = ['ignore', 'inherit', 'inherit']

    const controller = new AbortController()
    const resultPromise = waitForSpawnedChild(child, {
      executable: 'tool',
      argv: [],
      env: {},
      shell: false,
      stdin: 'ignore',
      fdValues: new Map(),
      signal: controller.signal,
    })

    child.kill('SIGINT')
    expect(child.killed).toBe(true)
    child.kill.mockClear()

    controller.abort()
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')

    queueMicrotask(() => child.emit('exit', null, 'SIGTERM'))
    await resultPromise
    expect(child.listenerCount('error')).toBe(0)
    expect(child.listenerCount('exit')).toBe(0)
  })

  it('rejects value-free when an owned stdin pipe emits EPIPE', async () => {
    const beforeSigint = process.listenerCount('SIGINT')
    const child = new EventEmitter() as EventEmitter & {
      killed: boolean
      kill: ReturnType<typeof vi.fn>
      stdin: EventEmitter & {
        end: ReturnType<typeof vi.fn>
        destroy: ReturnType<typeof vi.fn>
        destroyed: boolean
      }
      stdio: Array<
        | string
        | (EventEmitter & {
            end?: ReturnType<typeof vi.fn>
            destroy: ReturnType<typeof vi.fn>
            destroyed: boolean
          })
      >
    }
    child.killed = false
    child.kill = vi.fn(() => true)
    const stdin = Object.assign(new EventEmitter(), {
      end: vi.fn(),
      destroy: vi.fn(),
      destroyed: false,
    })
    const fd3 = Object.assign(new EventEmitter(), {
      end: vi.fn(),
      destroy: vi.fn(),
      destroyed: false,
    })
    child.stdin = stdin
    child.stdio = [stdin, 'inherit', 'inherit', fd3]

    const epipe = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })
    stdin.end = vi.fn(() => {
      queueMicrotask(() => stdin.emit('error', epipe))
    })

    const unhandled: unknown[] = []
    const onUnhandled = (error: unknown) => {
      unhandled.push(error)
    }
    process.on('uncaughtException', onUnhandled)

    try {
      const resultPromise = waitForSpawnedChild(child, {
        executable: 'tool',
        argv: [],
        env: {},
        shell: false,
        stdin: { value: 'stdin-epipe-canary' },
        fdValues: new Map([[3, 'fd-sibling']]),
      })

      await expect(resultPromise).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(Error)
        expect(String(error)).not.toContain('stdin-epipe-canary')
        expect(String(error)).not.toContain('fd-sibling')
        return true
      })
      expect(child.kill).toHaveBeenCalled()
      expect(fd3.destroy).toHaveBeenCalled()
      expect(stdin.listenerCount('error')).toBe(0)
      expect(fd3.listenerCount('error')).toBe(0)
      expect(child.listenerCount('error')).toBe(0)
      expect(child.listenerCount('exit')).toBe(0)
      expect(process.listenerCount('SIGINT')).toBe(beforeSigint)
      expect(unhandled).toEqual([])
    } finally {
      process.off('uncaughtException', onUnhandled)
    }
  })
})
