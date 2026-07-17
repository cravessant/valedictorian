import { afterEach, describe, expect, it, vi } from 'vitest'

import { runCli } from './valedictorian-cli.test-helpers.js'
import type { SecretsRunSpawnAdapter } from './valedictorian-cli.secrets-run-spawn.js'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function createRecordingSpawn(): {
  adapter: SecretsRunSpawnAdapter
  calls: unknown[]
} {
  const calls: unknown[] = []
  const adapter: SecretsRunSpawnAdapter = async (request) => {
    calls.push(request)
    return { exitCode: 0 }
  }
  return { adapter, calls }
}

async function runSecretsRun(
  argv: string[],
  options: { secretsRunSpawn?: SecretsRunSpawnAdapter } = {},
) {
  const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
  vi.stubGlobal('fetch', fetchMock)
  const result = await runCli(argv, {}, options)
  return { fetchMock, result }
}

describe('secrets run local validation', () => {
  it('rejects a positional child without an explicit -- escape marker before any I/O', async () => {
    const { adapter, calls } = createRecordingSpawn()
    const { fetchMock, result } = await runSecretsRun(
      [
        'secrets',
        'run',
        '--workspace',
        'workspace-1',
        '--env',
        'TOKEN=secret://greenhouse_password',
        'tool',
      ],
      { secretsRunSpawn: adapter },
    )

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toMatch(/executable after --|requires .*--/i)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(calls).toHaveLength(0)
  })

  it('rejects a positional child that appears before -- before any I/O or spawn', async () => {
    const { adapter, calls } = createRecordingSpawn()
    const { fetchMock, result } = await runSecretsRun(
      [
        'secrets',
        'run',
        '--workspace',
        'workspace-1',
        '--env',
        'TOKEN=secret://greenhouse_password',
        'tool',
        '--',
        'arg',
      ],
      { secretsRunSpawn: adapter },
    )

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toMatch(/executable after --|requires .*--|before --|escape marker/i)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(calls).toHaveLength(0)
  })

  it('rejects an empty executable after -- before any I/O or spawn', async () => {
    const { adapter, calls } = createRecordingSpawn()
    const { fetchMock, result } = await runSecretsRun(
      [
        'secrets',
        'run',
        '--workspace',
        'workspace-1',
        '--env',
        'TOKEN=secret://greenhouse_password',
        '--',
        '',
      ],
      { secretsRunSpawn: adapter },
    )

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toMatch(/executable|nonempty|non-empty|empty/i)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(calls).toHaveLength(0)
  })

  it('accepts dedicated FD boundaries 3 and 255 and rejects 256 before capability discovery', async () => {
    const cases: Array<{ fd: string; expectOk: boolean }> = [
      { fd: '3', expectOk: true },
      { fd: '255', expectOk: true },
      { fd: '256', expectOk: false },
    ]

    for (const testCase of cases) {
      const { adapter, calls } = createRecordingSpawn()
      const { fetchMock, result } = await runSecretsRun(
        [
          'secrets',
          'run',
          '--workspace',
          'workspace-1',
          '--fd',
          `${testCase.fd}=secret://greenhouse_password`,
          '--',
          'tool',
        ],
        { secretsRunSpawn: adapter },
      )

      if (testCase.expectOk) {
        // Local FD validation passed; capability fetch is attempted next.
        expect(result.exitCode, `fd ${testCase.fd}`).toBe(1)
        expect(fetchMock, `fd ${testCase.fd}`).toHaveBeenCalled()
        expect(String(fetchMock.mock.calls[0]?.[0]), `fd ${testCase.fd}`).toContain(
          '/v1/capabilities',
        )
        expect(calls, `fd ${testCase.fd}`).toHaveLength(0)
      } else {
        expect(result.exitCode, `fd ${testCase.fd}`).toBe(1)
        expect(result.stderr, `fd ${testCase.fd}`).toMatch(
          /file descriptor|3\.\.255|between 3 and 255|<= 255|at most 255/i,
        )
        expect(fetchMock, `fd ${testCase.fd}`).not.toHaveBeenCalled()
        expect(calls, `fd ${testCase.fd}`).toHaveLength(0)
      }
      vi.unstubAllGlobals()
    }
  })

  it('rejects non-portable and case-insensitive duplicate environment destinations before any I/O', async () => {
    const cases: Array<{ argv: string[]; match: RegExp }> = [
      {
        argv: [
          'secrets',
          'run',
          '--workspace',
          'workspace-1',
          '--env',
          'BAD-NAME=secret://greenhouse_password',
          '--',
          'tool',
        ],
        match: /environment name|portable|A-Za-z_|invalid/i,
      },
      {
        argv: [
          'secrets',
          'run',
          '--workspace',
          'workspace-1',
          '--env',
          'HAS SPACE=secret://greenhouse_password',
          '--',
          'tool',
        ],
        match: /environment name|portable|A-Za-z_|invalid/i,
      },
      {
        argv: [
          'secrets',
          'run',
          '--workspace',
          'workspace-1',
          '--env',
          'TOKEN=secret://greenhouse_password',
          '--env',
          'token=secret://other',
          '--',
          'tool',
        ],
        match: /duplicate.*[Tt]oken|[Tt]oken.*duplicate/i,
      },
    ]

    for (const testCase of cases) {
      const { fetchMock, result } = await runSecretsRun(testCase.argv)
      expect(result.exitCode, testCase.argv.join(' ')).toBe(1)
      expect(result.stderr, testCase.argv.join(' ')).toMatch(testCase.match)
      expect(fetchMock, testCase.argv.join(' ')).not.toHaveBeenCalled()
      vi.unstubAllGlobals()
    }
  })

  it('emits stable value-free JSON for local validation failures', async () => {
    const { fetchMock, result } = await runSecretsRun([
      '--json',
      'secrets',
      'run',
      '--workspace',
      'workspace-1',
      '--',
      'node',
      '-e',
      'process.exit(0)',
    ])

    expect(result.exitCode).toBe(1)
    expect(fetchMock).not.toHaveBeenCalled()
    const body = JSON.parse(result.stderr)
    expect(body).toEqual({
      code: 'secrets_run_invalid_usage',
      message: expect.stringMatching(/destination|injection|--env|--fd|--stdin-secret/i),
    })
    expect(result.stderr).not.toContain('secret://')
  })

  it('rejects omitted or empty workspace before any network calls', async () => {
    const cases: string[][] = [
      [
        'secrets',
        'run',
        '--env',
        'TOKEN=secret://greenhouse_password',
        '--',
        'node',
        '-e',
        'process.exit(0)',
      ],
      [
        'secrets',
        'run',
        '--workspace',
        '',
        '--env',
        'TOKEN=secret://greenhouse_password',
        '--',
        'node',
        '-e',
        'process.exit(0)',
      ],
      [
        'secrets',
        'run',
        '--workspace',
        '   ',
        '--env',
        'TOKEN=secret://greenhouse_password',
        '--',
        'node',
        '-e',
        'process.exit(0)',
      ],
    ]

    for (const argv of cases) {
      const { fetchMock, result } = await runSecretsRun(argv)
      expect(result.exitCode, argv.join(' ')).toBe(1)
      expect(result.stderr, argv.join(' ')).toMatch(/--workspace is required/)
      expect(fetchMock, argv.join(' ')).not.toHaveBeenCalled()
      vi.unstubAllGlobals()
    }
  })

  it('rejects missing destination, executable, malformed inputs, and duplicates before network calls', async () => {
    const cases: Array<{ argv: string[]; match: RegExp }> = [
      {
        argv: ['secrets', 'run', '--workspace', 'workspace-1', '--', 'node', '-e', 'process.exit(0)'],
        match: /destination|injection|--env|--fd|--stdin-secret/i,
      },
      {
        argv: [
          'secrets',
          'run',
          '--workspace',
          'workspace-1',
          '--env',
          'TOKEN=secret://greenhouse_password',
        ],
        match: /executable|command|--/i,
      },
      {
        argv: [
          'secrets',
          'run',
          '--workspace',
          'workspace-1',
          '--env',
          'TOKEN=not-a-secret',
          '--',
          'node',
          '-e',
          'process.exit(0)',
        ],
        match: /secret reference|malformed|invalid/i,
      },
      {
        argv: [
          'secrets',
          'run',
          '--workspace',
          'workspace-1',
          '--env',
          'TOKEN',
          '--',
          'node',
          '-e',
          'process.exit(0)',
        ],
        match: /assignment|NAME=secret:\/\//i,
      },
      {
        argv: [
          'secrets',
          'run',
          '--workspace',
          'workspace-1',
          '--env',
          'TOKEN=secret://greenhouse_password',
          '--env',
          'TOKEN=secret://other',
          '--',
          'node',
          '-e',
          'process.exit(0)',
        ],
        match: /duplicate.*TOKEN|TOKEN.*duplicate/i,
      },
      {
        argv: [
          'secrets',
          'run',
          '--workspace',
          'workspace-1',
          '--fd',
          '3=secret://greenhouse_password',
          '--fd',
          '3=secret://other',
          '--',
          'node',
          '-e',
          'process.exit(0)',
        ],
        match: /duplicate.*3|descriptor.*3/i,
      },
      {
        argv: [
          'secrets',
          'run',
          '--workspace',
          'workspace-1',
          '--fd',
          '2=secret://greenhouse_password',
          '--',
          'node',
          '-e',
          'process.exit(0)',
        ],
        match: /file descriptor|>= 3|at least 3/i,
      },
      {
        argv: [
          'secrets',
          'run',
          '--workspace',
          'workspace-1',
          '--stdin-secret',
          'secret://greenhouse_password',
          '--stdin-secret',
          'secret://other',
          '--',
          'node',
          '-e',
          'process.exit(0)',
        ],
        match: /stdin|multiple|--stdin-secret/i,
      },
      {
        argv: [
          'secrets',
          'run',
          '--workspace',
          'workspace-1',
          '--fd',
          'abc=secret://greenhouse_password',
          '--',
          'node',
          '-e',
          'process.exit(0)',
        ],
        match: /file descriptor|assignment|malformed/i,
      },
    ]

    for (const testCase of cases) {
      const { fetchMock, result } = await runSecretsRun(testCase.argv)
      expect(result.exitCode, testCase.argv.join(' ')).toBe(1)
      expect(result.stderr, testCase.argv.join(' ')).toMatch(testCase.match)
      expect(fetchMock, testCase.argv.join(' ')).not.toHaveBeenCalled()
      vi.unstubAllGlobals()
    }
  })
})
